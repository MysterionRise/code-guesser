import {
  authorizeRequest,
  type CredentialPolicy,
  type Provider,
  type RequestInput,
} from "./request-policy";
import { RetryRequestError } from "./retry";

export type TransportErrorCode =
  | "POLICY"
  | "TIMEOUT"
  | "CONCURRENCY_LIMIT"
  | "REQUEST_LIMIT"
  | "RESPONSE_LIMIT"
  | "PAGE_LIMIT"
  | "MALFORMED_BODY"
  | "UNSUPPORTED_STATUS"
  | "NETWORK";

export interface TransportDiagnostic {
  readonly provider: Provider;
  readonly hostClass: Provider;
  readonly method: "GET" | "HEAD";
  readonly pathTemplate: string;
  readonly statusClass: string;
  readonly reasonCode: TransportErrorCode;
}

export class TransportError extends Error {
  public constructor(
    public readonly code: TransportErrorCode,
    public readonly diagnostic: TransportDiagnostic,
  ) {
    super(code);
    this.name = "TransportError";
  }
}

export interface TransportLimits {
  readonly timeoutMilliseconds: number;
  readonly concurrentRequests: number;
  readonly requestCount: number;
  readonly responseBytes: number;
  readonly pages: number;
}

type FetchLike = (input: string | URL, init: RequestInit) => Promise<Response>;
const MINIMUM_SUCCESS_STATUS = 200;
const MAXIMUM_SUCCESS_STATUS = 299;
const STATUS_CLASS_DIVISOR = 100;
const FIRST_PAGE_NUMBER = 1;
const MILLISECONDS_PER_SECOND = 1000;
const RATE_LIMIT_STATUSES = new Set([403, 429]);
const MALFORMED_RETRY_SIGNAL = "MALFORMED";

export interface TransportOptions {
  readonly fetch: FetchLike;
  readonly limits: TransportLimits;
  readonly credentials?: CredentialPolicy;
  readonly now?: () => number;
}

export interface BoundedTransport {
  requestBytes(request: RequestInput, page?: number): Promise<Uint8Array>;
  requestJson(request: RequestInput, page?: number): Promise<unknown>;
}

const pathTemplate = (provider: Provider, pathname: string): string => {
  if (provider === "github" && pathname === "/search/commits") return "/search/commits";
  if (provider === "github") return "/repos/{owner}/{repository}/{resource}";
  if (provider === "huggingFace") return "/datasets/bigcode/the-stack-v2/{resource}";
  return "/content/{object}";
};

const diagnostic = (
  request: RequestInput,
  code: TransportErrorCode,
  status?: number,
): TransportDiagnostic => {
  let pathname = "/";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    // Policy rejection retains only the provider path class.
  }
  return Object.freeze({
    provider: request.provider,
    hostClass: request.provider,
    method: request.method,
    pathTemplate: pathTemplate(request.provider, pathname),
    statusClass: status === undefined ? "none" : `${Math.floor(status / STATUS_CLASS_DIVISOR)}xx`,
    reasonCode: code,
  });
};

const reject = (request: RequestInput, code: TransportErrorCode, status?: number): never => {
  throw new TransportError(code, diagnostic(request, code, status));
};

const readMetered = async (
  request: RequestInput,
  response: Response,
  limit: number,
): Promise<Uint8Array> => {
  const declaredHeader = response.headers.get("content-length");
  const contentEncoding = response.headers.get("content-encoding");
  const declared = declaredHeader === null ? undefined : Number(declaredHeader);
  if (declared !== undefined && (!Number.isSafeInteger(declared) || declared < 0)) {
    return reject(request, "MALFORMED_BODY", response.status);
  }
  if (declared !== undefined && declared > limit) return reject(request, "RESPONSE_LIMIT", response.status);
  if (!response.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel();
      return reject(request, "RESPONSE_LIMIT", response.status);
    }
    chunks.push(value);
  }
  const hasIdentityEncoding = contentEncoding === null || contentEncoding === "identity";
  if (declared !== undefined && hasIdentityEncoding && declared !== received) {
    return reject(request, "MALFORMED_BODY", response.status);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

interface TransportState {
  activeRequests: number;
  requestCount: number;
}

interface ResponseExchange {
  readonly bytes: Uint8Array;
  readonly response: Response;
}

const withinDeadline = async <Value>(
  request: RequestInput,
  milliseconds: number,
  controller: AbortController,
  operation: () => Promise<Value>,
): Promise<Value> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, timeoutReject) => {
    timer = setTimeout(() => {
      controller.abort();
      timeoutReject(new TransportError("TIMEOUT", diagnostic(request, "TIMEOUT")));
    }, milliseconds);
  });
  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const positiveInteger = (value: string | null): number | undefined => {
  if (value === null || !/^[1-9]\d*$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

/**
 * Translates a GitHub rate-limit instruction into the retry controller's wait. Only an explicit
 * provider instruction yields a wait; an absent instruction returns undefined so the status still
 * fails closed, and a present-but-unusable instruction is surfaced as a malformed signal.
 */
const retryInstruction = (headers: Headers, now: number): number | typeof MALFORMED_RETRY_SIGNAL | undefined => {
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = positiveInteger(retryAfter);
    return seconds === undefined ? MALFORMED_RETRY_SIGNAL : seconds * MILLISECONDS_PER_SECOND;
  }
  if (headers.get("x-ratelimit-remaining") !== "0") return undefined;
  const reset = positiveInteger(headers.get("x-ratelimit-reset"));
  if (reset === undefined) return MALFORMED_RETRY_SIGNAL;
  const wait = reset * MILLISECONDS_PER_SECOND - now;
  return Number.isSafeInteger(wait) && wait > 0 ? wait : MALFORMED_RETRY_SIGNAL;
};

const discardBody = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // The body is never read; a failed cancel changes nothing about the signal.
  }
};

const fetchResponse = async (
  options: TransportOptions,
  request: RequestInput,
  authorized: ReturnType<typeof authorizeRequest>,
  signal: AbortSignal,
): Promise<ResponseExchange> => {
  const response = await options.fetch(authorized.url, {
    method: authorized.method,
    headers: authorized.headers,
    redirect: "manual",
    signal,
  });
  if (request.provider === "github" && RATE_LIMIT_STATUSES.has(response.status)) {
    const instruction = retryInstruction(response.headers, (options.now ?? Date.now)());
    if (instruction !== undefined) {
      await discardBody(response);
      throw new RetryRequestError(instruction);
    }
  }
  if (response.status < MINIMUM_SUCCESS_STATUS || response.status > MAXIMUM_SUCCESS_STATUS) {
    return reject(request, "UNSUPPORTED_STATUS", response.status);
  }
  return {
    bytes: await readMetered(request, response, options.limits.responseBytes),
    response,
  };
};

const performRequest = async (
  options: TransportOptions,
  state: TransportState,
  request: RequestInput,
  page: number,
): Promise<ResponseExchange> => {
  const { limits } = options;
  if (!Number.isSafeInteger(page) || page < FIRST_PAGE_NUMBER || page > limits.pages) {
    return reject(request, "PAGE_LIMIT");
  }
  if (state.activeRequests >= limits.concurrentRequests) return reject(request, "CONCURRENCY_LIMIT");
  if (state.requestCount >= limits.requestCount) return reject(request, "REQUEST_LIMIT");
  let authorized: ReturnType<typeof authorizeRequest>;
  try {
    authorized = authorizeRequest(request, options.credentials);
  } catch {
    return reject(request, "POLICY");
  }
  state.requestCount += 1;
  state.activeRequests += 1;
  const controller = new AbortController();
  try {
    return await withinDeadline(request, limits.timeoutMilliseconds, controller, () =>
      fetchResponse(options, request, authorized, controller.signal));
  } catch (error) {
    if (error instanceof TransportError || error instanceof RetryRequestError) throw error;
    return reject(request, controller.signal.aborted ? "TIMEOUT" : "NETWORK");
  } finally {
    state.activeRequests -= 1;
  }
};

const parseJsonResponse = (request: RequestInput, exchange: ResponseExchange): unknown => {
  if (!exchange.response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return reject(request, "MALFORMED_BODY", exchange.response.status);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(exchange.bytes)) as unknown;
  } catch {
    return reject(request, "MALFORMED_BODY", exchange.response.status);
  }
};

export const createBoundedTransport = (options: TransportOptions): BoundedTransport => {
  const { limits } = options;
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new TypeError("INVALID_TRANSPORT_LIMITS");
  }
  const state: TransportState = { activeRequests: 0, requestCount: 0 };
  const perform = (request: RequestInput, page = FIRST_PAGE_NUMBER): Promise<ResponseExchange> =>
    performRequest(options, state, request, page);

  return Object.freeze({
    requestBytes: async (request: RequestInput, page?: number) => (await perform(request, page)).bytes,
    requestJson: async (request: RequestInput, page?: number) =>
      parseJsonResponse(request, await perform(request, page)),
  });
};
