import { createHash } from "node:crypto";

import { screenBlob, screenLicenseEvidence } from "@codeguessr/content/local-poc-support";
import { canonicalHash } from "./canonical";
import type { CrawlProfile } from "./profile";
import type { RetryController } from "./retry";
import type { StackMetadataRow } from "./stack-metadata";
import type { BoundedTransport } from "./transport";

type UnknownRecord = Record<string, unknown>;
type GitHubEntry = Readonly<{ path: string; mode: string; type: string; sha: string }>;
export class StackRevalidationError extends Error {
  public constructor() {
    super("STACK_REVALIDATION_REJECTED");
    this.name = "StackRevalidationError";
  }
}
export interface SelectedStackBlob {
  readonly stableRowId: string;
  readonly swhBlobId: string;
  readonly contentBase64: string;
  readonly byteLength: number;
}
export interface StackRevalidationOptions {
  readonly profile: CrawlProfile;
  readonly profileHash: string;
  readonly crawlSnapshotId: string;
  readonly metadata: StackMetadataRow;
  readonly selectedBlob: SelectedStackBlob;
  readonly transport: Pick<BoundedTransport, "requestJson">;
  readonly retry: Pick<RetryController, "execute">;
  readonly seenNormalizedHashes?: ReadonlySet<string>;
}
export interface RevalidatedStackCandidate extends Readonly<Record<string, unknown>> {
  readonly discoverySource: "STACK_V2";
  readonly repository: string;
  readonly path: string;
  readonly commit: string;
  readonly excerpt: string;
  readonly detectedLanguage: "Python" | "TypeScript";
}
const fail = (): never => { throw new StackRevalidationError(); };
const record = (value: unknown): UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : fail();
const text = (value: unknown): string =>
  typeof value === "string" && value.trim() === value && value.length > 0 ? value : fail();
const gitId = (value: unknown): string => /^[0-9a-f]{40}$/u.test(text(value)) ? value as string : fail();
const hash = (value: unknown): string => /^[0-9a-f]{64}$/u.test(text(value)) ? value as string : fail();
const sha = (algorithm: "sha1" | "sha256", value: Uint8Array | string): string =>
  createHash(algorithm).update(value).digest("hex");
const gitBlob = (bytes: Uint8Array): string => createHash("sha1")
  .update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");
const METADATA_KEYS = [
  "stableRowId", "swhBlobId", "swhContentId", "swhDirectoryId", "swhSnapshotId",
  "swhRevisionId", "repository", "path", "detectedLicenses", "detectedLanguage",
  "generated", "vendor", "sourceEncoding", "byteLength", "visitDate", "revisionDate",
  "committerDate",
] as const;
const UTC_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{6})?Z$/u;
const MAX_TREE_ENTRIES = 10_000;
const exactKeys = (value: UnknownRecord, expected: readonly string[]): void => {
  const actual = Object.keys(value).sort();
  if (actual.join("|") !== [...expected].sort().join("|")) fail();
};

const request = (options: StackRevalidationOptions, url: string): Promise<unknown> =>
  options.retry.execute(() => options.transport.requestJson({
    provider: "github", method: "GET", url,
    headers: { accept: "application/vnd.github+json", "x-github-api-version": options.profile.github.apiVersion },
  }));
const validDate = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const match = UTC_DATE.exec(value);
  if (!match) return false;
  const instant = new Date(value);
  const expected = match.slice(1, 7).map(Number);
  const observed = [instant.getUTCFullYear(), instant.getUTCMonth() + 1, instant.getUTCDate(),
    instant.getUTCHours(), instant.getUTCMinutes(), instant.getUTCSeconds()];
  return !Number.isNaN(instant.valueOf()) && expected.every((part, index) => part === observed[index]);
};
const decode = (value: unknown, size: unknown, whitespace = true): Uint8Array => {
  // GitHub wraps base64 content at 60 columns with a trailing newline; the worker's own base64 is exact.
  const source = whitespace
    ? (typeof value === "string" && value.trim().length > 0 ? value : fail())
    : text(value);
  const encoded = whitespace ? source.replace(/\s/gu, "") : source;
  if (!Number.isSafeInteger(size) || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) fail();
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength !== size || bytes.toString("base64") !== encoded) fail();
  return bytes;
};
const selectedBytes = (options: StackRevalidationOptions): Uint8Array => {
  const metadata = record(options.metadata);
  const selected = record(options.selectedBlob);
  exactKeys(metadata, METADATA_KEYS);
  exactKeys(selected, ["stableRowId", "swhBlobId", "contentBase64", "byteLength"]);
  for (const key of ["swhBlobId", "swhContentId", "swhDirectoryId", "swhSnapshotId", "swhRevisionId"]) {
    gitId(metadata[key]);
  }
  const repository = text(metadata.repository);
  const path = text(metadata.path);
  const licenses = Array.isArray(metadata.detectedLicenses) ? metadata.detectedLicenses.map(text) : fail();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
    || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")
    || licenses.length === 0 || new Set(licenses).size !== licenses.length
    || licenses.some((identifier) => !options.profile.licenses.includes(identifier))
    || !Number.isSafeInteger(metadata.byteLength) || (metadata.byteLength as number) < 1
    || (metadata.byteLength as number) > options.profile.capacity.perBlobBytes
    || ![metadata.visitDate, metadata.revisionDate, metadata.committerDate].every(validDate)) fail();
  const { stableRowId, ...fields } = metadata;
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(fields).sort()));
  if (hash(stableRowId) !== sha("sha256", canonical)
    || selected.stableRowId !== stableRowId || selected.swhBlobId !== metadata.swhBlobId
    || selected.byteLength !== metadata.byteLength || metadata.sourceEncoding !== "UTF-8"
    || metadata.generated !== false || metadata.vendor !== false) fail();
  const bytes = decode(selected.contentBase64, selected.byteLength, false);
  if (sha("sha1", bytes) !== gitId(metadata.swhBlobId)
    || gitBlob(bytes) !== gitId(metadata.swhContentId)) fail();
  const language = metadata.detectedLanguage;
  const configuration = options.profile.stack.configurations.find(({ language: name }) => name === language) ?? fail();
  if (!configuration.extensions.some((extension) => text(metadata.path).endsWith(extension))) fail();
  return bytes;
};

const repositoryState = (value: unknown, repository: string, api: string, web: string) => {
  const response = record(value);
  if (response.full_name !== repository || response.url !== api || response.html_url !== web
    || response.private !== false || response.visibility !== "public" || response.disabled !== false
    || response.archived !== false || response.fork !== false) fail();
  const license = record(response.license);
  const key = text(license.key);
  const name = text(license.name);
  const spdx = text(license.spdx_id);
  if (license.url !== `https://api.github.com/licenses/${key}`) fail();
  return Object.freeze({ name, spdx });
};
const commitState = (value: unknown, commit: string, api: string, web: string) => {
  const response = record(value);
  if (response.sha !== commit || response.url !== `${api}/commits/${commit}`
    || response.html_url !== `${web}/commit/${commit}`) fail();
  const details = record(response.commit);
  const tree = record(details.tree);
  const treeSha = gitId(tree.sha);
  if (tree.url !== `${api}/git/trees/${treeSha}`) fail();
  const name = text(record(details.author).name);
  if (response.author === null) return Object.freeze({ treeSha, name, login: null });
  const author = record(response.author);
  const login = text(author.login);
  if (author.url !== `https://api.github.com/users/${login}`
    || author.html_url !== `https://github.com/${login}`) fail();
  return Object.freeze({ treeSha, name, login });
};
const treeSha = (entries: readonly GitHubEntry[]): string => {
  const ordered = [...entries].sort((left, right) => Buffer.compare(
    Buffer.from(left.type === "tree" ? `${left.path}/` : left.path),
    Buffer.from(right.type === "tree" ? `${right.path}/` : right.path),
  ));
  const body = Buffer.concat(ordered.map((entry) => Buffer.concat([
    Buffer.from(`${entry.mode === "040000" ? "40000" : entry.mode} ${entry.path}\0`),
    Buffer.from(entry.sha, "hex"),
  ])));
  return createHash("sha1").update(`tree ${body.byteLength}\0`).update(body).digest("hex");
};
const loadTree = async (options: StackRevalidationOptions, api: string, expected: string) => {
  const response = record(await request(options, `${api}/git/trees/${expected}`));
  const treeValues: unknown[] = Array.isArray(response.tree) ? response.tree : fail();
  if (response.sha !== expected || response.url !== `${api}/git/trees/${expected}`
    || response.truncated !== false || treeValues.length > MAX_TREE_ENTRIES) fail();
  const entries: GitHubEntry[] = treeValues.map((value: unknown) => {
    const item = record(value);
    if (Object.keys(item).some((key) => !["path", "mode", "type", "sha", "url", "size"].includes(key))
      || (item.size !== undefined && (!Number.isSafeInteger(item.size) || (item.size as number) < 0))) fail();
    const entry = { path: text(item.path), mode: text(item.mode), type: text(item.type), sha: gitId(item.sha) };
    if (entry.path.includes("/") || entry.path === "." || entry.path === ".."
      || item.url !== `${api}/git/${entry.type}s/${entry.sha}`) fail();
    const regular = entry.type === "blob" && (entry.mode === "100644" || entry.mode === "100755");
    if (!regular && !(entry.type === "tree" && entry.mode === "040000")) fail();
    return Object.freeze(entry);
  });
  if (new Set(entries.map(({ path }) => path)).size !== entries.length || treeSha(entries) !== expected) fail();
  return Object.freeze(entries);
};
const resolvePath = async (options: StackRevalidationOptions, api: string, root: string, path: string) => {
  const segments = path.split("/");
  if (segments.some((segment) => !/^(?!\.{1,2}$)[^/\\\0]+$/u.test(segment))) fail();
  let cursor = root;
  for (const [index, segment] of segments.entries()) {
    const entry = (await loadTree(options, api, cursor)).find(({ path: name }) => name === segment) ?? fail();
    if (index === segments.length - 1) {
      if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) fail();
      return entry.sha;
    }
    if (entry.type !== "tree" || entry.mode !== "040000") fail();
    cursor = entry.sha;
  }
  return fail();
};
const loadGitHubBytes = async (options: StackRevalidationOptions, api: string, blob: string) => {
  const response = record(await request(options, `${api}/git/blobs/${blob}`));
  if (response.sha !== blob || response.url !== `${api}/git/blobs/${blob}` || response.encoding !== "base64") fail();
  const bytes = decode(response.content, response.size);
  if (gitBlob(bytes) !== blob) fail();
  return bytes;
};

const licenseState = async (
  options: StackRevalidationOptions, api: string, web: string, commit: string,
  metadata: Readonly<{ name: string; spdx: string }>, stackIdentifiers: unknown,
) => {
  if (!options.profile.licenses.includes(metadata.spdx)) fail();
  const identifiers = Array.isArray(stackIdentifiers) ? stackIdentifiers.map(text) : fail();
  if (!identifiers.includes(metadata.spdx)) fail();
  const response = record(await request(options, `${api}/license?ref=${commit}`));
  const path = text(response.path);
  const blob = gitId(response.sha);
  const detected = record(response.license);
  const key = text(detected.key);
  if (response.name !== path.split("/").at(-1) || response.type !== "file" || response.encoding !== "base64"
    || response.url !== `${api}/contents/${encodedPath(path)}?ref=${commit}`
    || response.html_url !== `${web}/blob/${commit}/${encodedPath(path)}`
    || response.git_url !== `${api}/git/blobs/${blob}`
    || response.download_url !== `https://raw.githubusercontent.com/${text(options.metadata.repository)}/${commit}/${encodedPath(path)}`
    || detected.name !== metadata.name || detected.spdx_id !== metadata.spdx
    || detected.url !== `https://api.github.com/licenses/${key}`) fail();
  const bytes = decode(response.content, response.size);
  const textHash = sha("sha256", bytes);
  const screened = screenLicenseEvidence({
    identifier: metadata.spdx, metadataIdentifiers: [metadata.spdx], licenseFilePresent: true,
    licensePath: path, licenseBlobSha: blob, licenseTextSha256: textHash, licenseBytes: bytes,
    repositoryPolicyVersion: options.profile.profileVersion, repositoryPolicyHash: options.profileHash,
  });
  if (screened.decision !== "ADMISSION_SCREENING_ONLY" || screened.identifier !== metadata.spdx
    || screened.licenseBlobSha !== blob || screened.licenseTextSha256 !== textHash
    || screened.repositoryPolicyHash !== options.profileHash) fail();
  return response.html_url as string;
};
const excerpt = (textValue: string, maximum: number, minimum: number): string => {
  const bytes = new TextEncoder().encode(textValue);
  let end = Math.min(bytes.byteLength, maximum);
  let value: string | undefined;
  while (end > 0 && value === undefined) {
    try { value = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, end)); } catch { end -= 1; }
  }
  const excerptValue = value ?? fail();
  if (new TextEncoder().encode(excerptValue).byteLength < minimum) fail();
  return excerptValue;
};

export const revalidateStackCandidate = async (
  options: StackRevalidationOptions,
): Promise<Readonly<RevalidatedStackCandidate>> => {
  if (canonicalHash(options.profile) !== hash(options.profileHash)) fail();
  const crawlSnapshotId = hash(options.crawlSnapshotId);
  const selected = selectedBytes(options);
  const metadata = options.metadata;
  const repository = text(metadata.repository);
  const commit = gitId(metadata.swhRevisionId);
  const path = text(metadata.path);
  const api = `https://api.github.com/repos/${repository}`;
  const web = `https://github.com/${repository}`;
  const repo = repositoryState(await request(options, api), repository, api, web);
  const commitRecord = commitState(await request(options, `${api}/commits/${commit}`), commit, api, web);
  const blob = await resolvePath(options, api, commitRecord.treeSha, path);
  if (blob !== metadata.swhContentId) fail();
  const githubBytes = await loadGitHubBytes(options, api, blob);
  if (githubBytes.byteLength !== selected.byteLength
    || githubBytes.some((value, index) => value !== selected[index])) fail();
  const licenseUrl = await licenseState(options, api, web, commit, repo, metadata.detectedLicenses);
  const screened = screenBlob({ path, bytes: githubBytes }, options.seenNormalizedHashes ?? new Set());
  const excerptText = excerpt(screened.text, options.profile.screening.excerptBytes,
    options.profile.screening.minimumExcerptBytes);
  return Object.freeze({
    discoverySource: "STACK_V2", repository, repositoryUrl: web,
    authorName: commitRecord.name, authorLogin: commitRecord.login, authorBasis: "SELECTED_COMMIT",
    authorSourceUrl: `${web}/commit/${commit}`, path, blob, rawContentHash: screened.rawSha256,
    excerptHash: sha("sha256", excerptText), licenseName: repo.name, licenseSpdx: repo.spdx,
    licenseFileUrl: licenseUrl, commit, commitUrl: `${web}/commit/${commit}`,
    blobUrl: `${web}/blob/${commit}/${encodedPath(path)}`, profileVersion: options.profile.profileVersion,
    crawlSnapshotId, excerpt: excerptText, stackRelease: options.profile.stack.release,
    stackRevision: options.profile.stack.revision, configuration: metadata.detectedLanguage,
    stableRowId: metadata.stableRowId, swhBlobId: metadata.swhBlobId,
    swhContentId: metadata.swhContentId, swhDirectoryId: metadata.swhDirectoryId,
    swhSnapshotId: metadata.swhSnapshotId, swhRevisionId: metadata.swhRevisionId,
    stackRepository: repository, stackPath: path, detectedLicenses: Object.freeze([...metadata.detectedLicenses]),
    detectedLanguage: metadata.detectedLanguage, generated: false, vendor: false,
    sourceEncoding: "UTF-8", byteLength: metadata.byteLength, visitDate: metadata.visitDate,
    revisionDate: metadata.revisionDate, committerDate: metadata.committerDate,
  });
};
