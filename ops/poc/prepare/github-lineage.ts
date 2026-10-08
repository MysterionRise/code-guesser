import { createHash } from "node:crypto";
import { isScreenablePath, patchFitsExcerptWindow, reconstructChangedLines, screenBlob } from "@codeguessr/content/local-poc-support";
import type { GitHubSearchCandidate } from "./github-search";
import type { CrawlProfile } from "./profile";
import type { RetryController } from "./retry";
import type { BoundedTransport } from "./transport";
type UnknownRecord = Record<string, unknown>;
type GitMode = "100644" | "100755";
export class GitHubLineageError extends Error {
  public constructor() {
    super("GITHUB_LINEAGE_REJECTED");
    this.name = "GitHubLineageError";
  }
}
export interface GitHubLineageOptions {
  readonly profile: CrawlProfile;
  readonly candidates: readonly GitHubSearchCandidate[];
  readonly transport: Pick<BoundedTransport, "requestJson">;
  readonly retry: Pick<RetryController, "execute">;
  readonly seenNormalizedHashes?: ReadonlySet<string>;
}
export interface GitHubLineageCandidate extends GitHubSearchCandidate {
  readonly path: string;
  readonly blob: string;
  readonly commitMessage: string;
  readonly childCommit: string;
  readonly childTree: string;
  readonly parentCommit: string;
  readonly parentTree: string;
  readonly parentPath: string;
  readonly childPath: string;
  readonly parentMode: GitMode;
  readonly childMode: GitMode;
  readonly parentBlob: string;
  readonly childBlob: string;
  readonly parentRawContentHash: string;
  readonly childRawContentHash: string;
  readonly changedLineHash: string;
  readonly excerpt: string;
  readonly excerptHash: string;
}
interface CommitRecord {
  readonly sha: string;
  readonly tree: string;
  readonly message: string;
  readonly parents: readonly string[];
  readonly files: readonly UnknownRecord[];
}
interface TreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly type: string;
  readonly sha: string;
}
const fail = (): never => { throw new GitHubLineageError(); };
const record = (value: unknown): UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : fail();
const text = (value: unknown): string =>
  typeof value === "string" && value.length > 0 ? value : fail();
const gitId = (value: unknown): string =>
  typeof value === "string" && /^[0-9a-f]{40}$/u.test(value) ? value : fail();
const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");
const gitObject = (type: "blob" | "tree", bytes: Uint8Array): string =>
  createHash("sha1").update(`${type} ${bytes.byteLength}\0`).update(bytes).digest("hex");
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const repositoryParts = (repository: string): readonly [string, string] => {
  const parts = repository.split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/u.test(part))) fail();
  return parts as unknown as readonly [string, string];
};

const requestJson = (
  options: GitHubLineageOptions,
  url: string,
): Promise<unknown> => options.retry.execute(() => options.transport.requestJson({
  provider: "github",
  method: "GET",
  url,
  headers: {
    accept: "application/vnd.github+json",
    "x-github-api-version": options.profile.github.apiVersion,
  },
}));

const parseCommit = (
  value: unknown,
  expectedSha: string,
  api: string,
  web: string,
): CommitRecord => {
  const response = record(value);
  if (gitId(response.sha) !== expectedSha
    || response.url !== `${api}/commits/${expectedSha}`
    || response.html_url !== `${web}/commit/${expectedSha}`) fail();
  const commit = record(response.commit);
  const tree = record(commit.tree);
  const treeSha = gitId(tree.sha);
  if (tree.url !== `${api}/git/trees/${treeSha}`) fail();
  const parents = Array.isArray(response.parents) ? response.parents.map((item) => {
    const parent = record(item);
    const sha = gitId(parent.sha);
    if (parent.url !== `${api}/commits/${sha}` || parent.html_url !== `${web}/commit/${sha}`) fail();
    return sha;
  }) : fail();
  return Object.freeze({
    sha: expectedSha,
    tree: treeSha,
    message: text(commit.message),
    parents: Object.freeze(parents),
    files: Object.freeze(Array.isArray(response.files) ? response.files.map(record) : fail()),
  });
};

/**
 * FR-024 requires a single-parent commit; the commit itself may touch several files.
 * Exactly one same-path modification is bound: the first screenable one in path order,
 * so the choice is deterministic for the pinned commit and recorded in the fixture.
 */
const parseChangedPath = (
  commit: CommitRecord,
  api: string,
  web: string,
): Readonly<{ path: string; blob: string }> => {
  if (commit.parents.length !== 1 || commit.files.length === 0) fail();
  // A recorded patch that cannot fit the excerpt window disqualifies its file up front; an
  // absent patch leaves the decision to the authoritative reconstruction from pinned blobs.
  const modifications = commit.files.filter((entry) => entry.status === "modified"
    && entry.previous_filename === undefined && typeof entry.filename === "string"
    && isScreenablePath(entry.filename)
    && (typeof entry.patch !== "string" || patchFitsExcerptWindow(entry.patch)));
  const names = modifications.map((entry) => text(entry.filename));
  if (names.length === 0 || new Set(names).size !== names.length) fail();
  const file = [...modifications].sort((left, right) => compareText(text(left.filename), text(right.filename)))[0]!;
  const path = text(file.filename);
  const blob = gitId(file.sha);
  // GitHub percent-encodes the whole path (slashes included) inside these per-file URLs.
  const encoded = encodeURIComponent(path);
  if (file.status !== "modified" || file.previous_filename !== undefined
    || file.blob_url !== `${web}/blob/${commit.sha}/${encoded}`
    || file.raw_url !== `${web}/raw/${commit.sha}/${encoded}`
    || file.contents_url !== `${api}/contents/${encoded}?ref=${commit.sha}`) fail();
  return Object.freeze({ path, blob });
};

const treeHash = (entries: readonly TreeEntry[]): string => {
  const parts = [...entries].sort((left, right) => compareText(
    left.type === "tree" ? `${left.path}/` : left.path,
    right.type === "tree" ? `${right.path}/` : right.path,
  )).map((entry) => Buffer.concat([
    Buffer.from(`${entry.mode === "040000" ? "40000" : entry.mode} ${entry.path}\0`),
    Buffer.from(entry.sha, "hex"),
  ]));
  return gitObject("tree", Buffer.concat(parts));
};

const loadTree = async (
  options: GitHubLineageOptions,
  api: string,
  sha: string,
): Promise<readonly TreeEntry[]> => {
  const response = record(await requestJson(options, `${api}/git/trees/${sha}`));
  const treeValues = response.tree;
  if (response.sha !== sha || response.url !== `${api}/git/trees/${sha}`
    || response.truncated !== false) fail();
  const treeEntries: unknown[] = Array.isArray(treeValues) ? treeValues : fail();
  const entries: readonly TreeEntry[] = treeEntries.map((value: unknown) => {
    const item = record(value);
    const entry = Object.freeze({
      path: text(item.path),
      mode: text(item.mode),
      type: text(item.type),
      sha: gitId(item.sha),
    });
    if (item.url !== `${api}/git/${entry.type}s/${entry.sha}`) fail();
    const regular = entry.type === "blob" && (entry.mode === "100644" || entry.mode === "100755");
    const directory = entry.type === "tree" && entry.mode === "040000";
    if (!regular && !directory) fail();
    return entry;
  });
  if (new Set(entries.map(({ path }) => path)).size !== entries.length || treeHash(entries) !== sha) fail();
  return Object.freeze(entries);
};

const resolvePath = async (
  options: GitHubLineageOptions,
  api: string,
  rootTree: string,
  path: string,
): Promise<Readonly<{ mode: GitMode; blob: string }>> => {
  const segments = path.split("/");
  if (segments.some((segment) => !/^(?!\.{1,2}$)[^/\\\0]+$/u.test(segment))) fail();
  let tree = rootTree;
  for (const [index, segment] of segments.entries()) {
    const entry = (await loadTree(options, api, tree)).find(({ path: name }) => name === segment) ?? fail();
    if (index < segments.length - 1) {
      if (entry.type !== "tree" || entry.mode !== "040000") fail();
      tree = entry.sha;
      continue;
    }
    const entryMode = entry.mode;
    if (entry.type !== "blob") fail();
    const mode: GitMode = entryMode === "100644"
      ? "100644"
      : entryMode === "100755" ? "100755" : fail();
    return Object.freeze({ mode, blob: entry.sha });
  }
  return fail();
};

const loadBlob = async (
  options: GitHubLineageOptions,
  api: string,
  sha: string,
): Promise<Uint8Array> => {
  const response = record(await requestJson(options, `${api}/git/blobs/${sha}`));
  if (response.sha !== sha || response.url !== `${api}/git/blobs/${sha}`
    || response.encoding !== "base64" || !Number.isSafeInteger(response.size)) fail();
  const encoded = text(response.content).replace(/\s/gu, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) fail();
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength !== response.size || gitObject("blob", bytes) !== sha
    || bytes.toString("base64") !== encoded) fail();
  return bytes;
};

const screenChange = (
  options: GitHubLineageOptions,
  path: string,
  parents: readonly string[],
  parent: Readonly<{ blob: string; bytes: Uint8Array }>,
  child: Readonly<{ blob: string; bytes: Uint8Array }>,
) => {
  const parentHash = sha256(parent.bytes);
  const childHash = sha256(child.bytes);
  const seen = options.seenNormalizedHashes ?? new Set<string>();
  const parentScreen = screenBlob({ path, bytes: parent.bytes }, seen);
  const childScreen = screenBlob({ path, bytes: child.bytes }, seen);
  if (parentScreen.rawSha256 !== parentHash || childScreen.rawSha256 !== childHash) fail();
  const diff = reconstructChangedLines({
    parentCommits: parents,
    changeKind: "modified",
    parentPath: path,
    childPath: path,
    parent: { ...parentScreen, blobSha: parent.blob, kind: "regular", binary: false },
    child: { ...childScreen, blobSha: child.blob, kind: "regular", binary: false },
  });
  return Object.freeze({ parentHash, childHash, diff });
};

const bindCandidate = async (
  options: GitHubLineageOptions,
  candidate: GitHubSearchCandidate,
): Promise<GitHubLineageCandidate> => {
  repositoryParts(candidate.repository);
  const api = `https://api.github.com/repos/${candidate.repository}`;
  const web = `https://github.com/${candidate.repository}`;
  if (candidate.repositoryUrl !== web || candidate.commitUrl !== `${web}/commit/${candidate.commit}`) fail();
  const child = parseCommit(await requestJson(options, `${api}/commits/${candidate.commit}`),
    candidate.commit, api, web);
  const changed = parseChangedPath(child, api, web);
  // Child side first: its tree binding and blob screening reject most candidates, and every
  // request they save is a request the signed ceiling keeps for the next candidate.
  const childPath = await resolvePath(options, api, child.tree, changed.path);
  if (childPath.blob !== changed.blob) fail();
  const childBytes = await loadBlob(options, api, childPath.blob);
  screenBlob({ path: changed.path, bytes: childBytes }, options.seenNormalizedHashes ?? new Set<string>());
  const parentSha = child.parents[0]!;
  const parent = parseCommit(await requestJson(options, `${api}/commits/${parentSha}`), parentSha, api, web);
  const parentPath = await resolvePath(options, api, parent.tree, changed.path);
  if (childPath.blob === parentPath.blob) fail();
  const parentBytes = await loadBlob(options, api, parentPath.blob);
  const { parentHash, childHash, diff } = screenChange(options, changed.path, child.parents,
    { blob: parentPath.blob, bytes: parentBytes }, { blob: childPath.blob, bytes: childBytes });
  return Object.freeze({
    ...candidate,
    path: changed.path,
    blob: childPath.blob,
    commitMessage: child.message,
    childCommit: child.sha,
    childTree: child.tree,
    parentCommit: parent.sha,
    parentTree: parent.tree,
    parentPath: changed.path,
    childPath: changed.path,
    parentMode: parentPath.mode,
    childMode: childPath.mode,
    parentBlob: parentPath.blob,
    childBlob: childPath.blob,
    parentRawContentHash: parentHash,
    childRawContentHash: childHash,
    changedLineHash: sha256(JSON.stringify(diff.changedLines)),
    excerpt: diff.excerpt,
    excerptHash: diff.excerptSha256,
  });
};

const completeOrder = (left: GitHubLineageCandidate, right: GitHubLineageCandidate): number =>
  left.queryIndex - right.queryIndex
  || compareText(right.committerDate, left.committerDate)
  || compareText(left.repository, right.repository)
  || compareText(left.commit, right.commit)
  || compareText(left.path, right.path)
  || compareText(left.blob, right.blob);

export const bindGitHubLineage = async (
  options: GitHubLineageOptions,
): Promise<readonly GitHubLineageCandidate[]> => Object.freeze(
  (await Promise.all(options.candidates.map((candidate) => bindCandidate(options, candidate))))
    .sort(completeOrder),
);
