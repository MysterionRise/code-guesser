import { createHash } from "node:crypto";

export interface ScreenedBlob {
  readonly text: string;
  readonly rawSha256: string;
  readonly normalizedSha256: string;
  readonly decodedBytes: number;
}

export class BlobScreenError extends Error {
  public constructor(reasonCode: string) {
    super(reasonCode);
    this.name = "BlobScreenError";
  }
}

const MAX_DECODED_BYTES = 256 * 1024;
const MAX_LINE_LENGTH = 1_000;
const SUPPORTED_EXTENSION =
  /\.(?:c|cc|cpp|cs|go|h|hpp|html|java|js|jsx|kt|php|py|rb|rs|scala|sh|sql|swift|ts|tsx|vue)$/u;
const EXCLUDED_PATH =
  /(?:^|\/)(?:\.github|docs?|generated|node_modules|vendor)(?:\/|$)|(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.min\.(?:js|css)$/iu;
const GENERATED_MARKER = /(?:code generated|auto-generated|generated file).{0,40}(?:do not edit|automatic)/iu;
const DECEPTIVE_CONTROL = /[\u200b-\u200d\u202a-\u202e\u2066-\u2069\ufeff]/u;
const SECRET_LIKE =
  /(?:gh[opusr]_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|password|secret)\s*[:=]\s*['"][^'"]{8,})/iu;
const PERSONAL_DATA = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[A-Za-z0-9._/-]+$/u;

const fail = (reasonCode: string): never => {
  throw new BlobScreenError(reasonCode);
};
const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

/** True when a repository path could pass screening on its own merits: safe, supported, not excluded. */
export const isScreenablePath = (path: string): boolean =>
  SAFE_PATH.test(path) && SUPPORTED_EXTENSION.test(path) && !EXCLUDED_PATH.test(path);

export const screenBlob = (
  input: Readonly<{ path: string; bytes: Uint8Array }>,
  seenNormalizedHashes: ReadonlySet<string>,
): ScreenedBlob => {
  if (!SAFE_PATH.test(input.path)) fail("INVALID_PATH");
  if (!SUPPORTED_EXTENSION.test(input.path)) fail("UNSUPPORTED_EXTENSION");
  if (EXCLUDED_PATH.test(input.path)) fail("EXCLUDED_PATH");
  if (input.bytes.byteLength > MAX_DECODED_BYTES) fail("BLOB_SIZE_LIMIT");
  if (input.bytes.includes(0)) fail("BINARY_CONTENT");
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    return fail("INVALID_UTF8");
  }
  if (GENERATED_MARKER.test(decoded)) fail("GENERATED_CONTENT");
  if (decoded.split(/\r\n?|\n/u).some((line) => line.length > MAX_LINE_LENGTH)) {
    fail("MINIFIED_CONTENT");
  }
  if (DECEPTIVE_CONTROL.test(decoded)) fail("DECEPTIVE_CONTROL");
  if (SECRET_LIKE.test(decoded)) fail("SECRET_LIKE");
  if (PERSONAL_DATA.test(decoded)) fail("PERSONAL_DATA");
  const text = decoded.replace(/\r\n?/gu, "\n");
  const normalizedSha256 = sha256(text);
  if (seenNormalizedHashes.has(normalizedSha256)) fail("DUPLICATE_CONTENT");
  return Object.freeze({
    text,
    rawSha256: sha256(input.bytes),
    normalizedSha256,
    decodedBytes: input.bytes.byteLength,
  });
};
