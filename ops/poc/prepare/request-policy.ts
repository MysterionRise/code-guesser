export class RequestPolicyError extends Error {
  public constructor() {
    super("REQUEST_POLICY_REJECTED");
    this.name = "RequestPolicyError";
  }
}

export type Provider = "github" | "huggingFace" | "softwareHeritage";
export type ReadMethod = "GET" | "HEAD";

export interface RequestInput {
  readonly provider: Provider;
  readonly method: ReadMethod;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface CredentialPolicy {
  readonly github?: string;
  readonly huggingFace?: string;
  readonly softwareHeritage?: string;
  readonly softwareHeritageSessionToken?: string;
}

export interface AuthorizedRequest {
  readonly provider: Provider;
  readonly method: ReadMethod;
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
}

const fail = (): never => { throw new RequestPolicyError(); };
const PROVIDERS = new Set<Provider>(["github", "huggingFace", "softwareHeritage"]);
const CALLER_HEADERS = new Set(["accept", "user-agent", "x-github-api-version"]);
const CREDENTIAL_LIKE_VALUE = /(?:\bbearer\b|\bbasic\b|\btoken\s*[:=]|\bsecret\s*[:=]|\bpassword\s*[:=]|\bcredential\s*[:=]|\baws4-hmac-sha256\b)/iu;
const SENSITIVE_QUERY = /^(?:access_token|token|authorization|signature|x-amz-.+|awsaccesskeyid)$/iu;
const STACK_CARD_PATH = "/datasets/bigcode/the-stack-v2/raw/main/README.md";
// Exact hosts a Hugging Face resolve redirect may target. The one entry was observed under
// authorization on 2026-10-08 (HEAD on the pinned resolve endpoint answered 302 to this host);
// see docs/gangsta/codeguessr-poc-readiness/evidence/2026-10-08-hugging-face-redirect-observation.md.
const HUGGING_FACE_REDIRECT_HOSTS: ReadonlySet<string> = new Set(["us.aws.cdn.hf.co"]);

const pathAllowed = (provider: Provider, url: URL): boolean => {
  if (provider === "github") {
    if (url.hostname !== "api.github.com") return false;
    return url.pathname === "/search/commits" || /^\/repos\/[^/]+\/[^/]+(?:\/)?$/u.test(url.pathname)
      || /^\/repos\/[^/]+\/[^/]+\/(?:commits\/[0-9a-f]{40}|git\/(?:commits|trees|blobs)\/[0-9a-f]{40}|license|contents(?:\/.*)?)$/u.test(url.pathname);
  }
  if (provider === "huggingFace") {
    if (url.hostname !== "huggingface.co") return false;
    if (url.pathname === STACK_CARD_PATH) {
      return url.port === "" && url.search === "" && url.hash === "";
    }
    return /^\/api\/datasets\/bigcode\/the-stack-v2(?:\/revision\/[0-9a-f]{40})?$/u.test(url.pathname)
      || /^\/datasets\/bigcode\/the-stack-v2\/(?:resolve|raw)\/[0-9a-f]{40}\/.+$/u.test(url.pathname);
  }
  return url.hostname === "softwareheritage.s3.amazonaws.com"
    && /^\/content\/[A-Za-z0-9:._-]+$/u.test(url.pathname);
};

const parseRequest = (request: RequestInput, allowSensitive = false): URL => {
  if (!PROVIDERS.has(request.provider) || (request.method !== "GET" && request.method !== "HEAD")) fail();
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return fail();
  }
  if (url.protocol !== "https:" || url.username || url.password || !pathAllowed(request.provider, url)) fail();
  if (!allowSensitive && [...url.searchParams.keys()].some((key) => SENSITIVE_QUERY.test(key))) fail();
  if (request.headers && !allowSensitive) {
    for (const [key, value] of Object.entries(request.headers)) {
      if (!CALLER_HEADERS.has(key.toLowerCase())
        || typeof value !== "string"
        || value.length === 0
        || CREDENTIAL_LIKE_VALUE.test(value)) fail();
    }
  }
  return url;
};

const credentialHeaders = (
  provider: Provider,
  credentials: CredentialPolicy,
): Readonly<Record<string, string>> => {
  const headers: Record<string, string> = {};
  if (provider === "github" && credentials.github) headers.authorization = credentials.github;
  if (provider === "huggingFace" && credentials.huggingFace) headers.authorization = credentials.huggingFace;
  if (provider === "softwareHeritage" && credentials.softwareHeritage) {
    headers.authorization = credentials.softwareHeritage;
    if (credentials.softwareHeritageSessionToken) {
      headers["x-amz-security-token"] = credentials.softwareHeritageSessionToken;
    }
  }
  return Object.freeze(headers);
};

export const authorizeRequest = (
  request: RequestInput,
  credentials: CredentialPolicy = {},
): AuthorizedRequest => {
  const url = parseRequest(request);
  const supplied = request.headers ? Object.fromEntries(Object.entries(request.headers).map(
    ([key, value]) => [key.toLowerCase(), value],
  )) : {};
  return Object.freeze({
    provider: request.provider,
    method: request.method,
    url,
    headers: Object.freeze({ ...supplied, ...credentialHeaders(request.provider, credentials) }),
  });
};

/**
 * A resolve redirect to the observed CDN host carries the target host's own signed query and
 * receives no credential: the origin token, cookies, and signing state never cross hosts.
 */
const authorizeHuggingFaceRedirectTarget = (
  origin: RequestInput,
  location: string,
): AuthorizedRequest | undefined => {
  if (origin.provider !== "huggingFace" || /\/\.\.(?:\/|$)/u.test(location)) return undefined;
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return undefined;
  }
  if (!HUGGING_FACE_REDIRECT_HOSTS.has(url.hostname)) return undefined;
  if (url.protocol !== "https:" || url.username || url.password || url.port !== "" || url.hash !== "") fail();
  return Object.freeze({ provider: "huggingFace", method: origin.method, url, headers: Object.freeze({}) });
};

export const authorizeRedirect = (
  origin: RequestInput,
  location: string,
  targetProvider: Provider,
  credentials: CredentialPolicy = {},
): AuthorizedRequest => {
  parseRequest(origin, true);
  if (targetProvider === "huggingFace") {
    const target = authorizeHuggingFaceRedirectTarget(origin, location);
    if (target) return target;
  }
  return authorizeRequest({
    provider: targetProvider,
    method: origin.method,
    url: location,
  }, credentials);
};
