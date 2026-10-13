import { createHash } from "node:crypto";

import type { CrawlProfile } from "./profile";
import type { RetryController } from "./retry";
import type { BoundedTransport } from "./transport";

/**
 * Verified reads of one GitHub repository's git objects: every commit is checked against its id and URLs, every
 * tree against its hash, and every blob against its id. The caller names the failure codes, so lineage keeps
 * `LINEAGE_TREE` and a curated file read reports `FILE_TREE`.
 */
export type GitCheck = "SHAPE" | "COMMIT" | "TREE" | "PATH" | "BLOB";
export type GitMode = "100644" | "100755";

export interface GitReaderOptions {
  readonly profile: CrawlProfile;
  readonly transport: Pick<BoundedTransport, "requestJson">;
  readonly retry: Pick<RetryController, "execute">;
}

export interface CommitRecord {
  readonly sha: string;
  readonly tree: string;
  readonly message: string;
  readonly parents: readonly string[];
  readonly files: readonly Record<string, unknown>[];
  readonly stats: unknown;
}

export interface TreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly type: string;
  readonly sha: string;
  /** A blob's size as GitHub reports it: a hint for choosing what to read, never verified by the tree's hash. */
  readonly size?: number;
}

export interface GitReader {
  readonly api: string;
  readonly web: string;
  commit(sha: string): Promise<CommitRecord>;
  /** The blob at `path` under `rootTree`, walked one verified tree at a time. */
  resolvePath(rootTree: string, path: string): Promise<Readonly<{ mode: GitMode; blob: string }>>;
  /** The files directly inside the directory at `path` under `rootTree`, from verified trees. */
  listFiles(rootTree: string, path: string): Promise<readonly string[]>;
  /** The entries directly inside the directory at `path` (`""` for the root) under `rootTree`, from verified trees. */
  entries(rootTree: string, path: string): Promise<readonly TreeEntry[]>;
  /** Every entry under a tree, with full paths, from one listing whose every subtree is checked against its hash. */
  recursiveTree(sha: string): Promise<readonly TreeEntry[]>;
  blob(sha: string): Promise<Uint8Array>;
}

export const gitObject = (type: "blob" | "tree", bytes: Uint8Array): string =>
  createHash("sha1").update(`${type} ${bytes.byteLength}\0`).update(bytes).digest("hex");
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

/** One GitHub API GET through the run's transport and retry policy. */
export const githubGet = (options: GitReaderOptions, url: string): Promise<unknown> =>
  options.retry.execute(() => options.transport.requestJson({
    provider: "github",
    method: "GET",
    url,
    headers: { accept: "application/vnd.github+json", "x-github-api-version": options.profile.github.apiVersion },
  }));

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

export const gitReader = (
  options: GitReaderOptions,
  repository: string,
  fail: (check: GitCheck) => never,
): GitReader => {
  const parts = repository.split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/u.test(part))) fail("SHAPE");
  const api = `https://api.github.com/repos/${repository}`;
  const web = `https://github.com/${repository}`;
  const record = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : fail("SHAPE");
  const text = (value: unknown): string => typeof value === "string" && value.length > 0 ? value : fail("SHAPE");
  const gitId = (value: unknown): string =>
    typeof value === "string" && /^[0-9a-f]{40}$/u.test(value) ? value : fail("SHAPE");

  const commit = async (sha: string): Promise<CommitRecord> => {
    const response = record(await githubGet(options, `${api}/commits/${sha}`));
    if (gitId(response.sha) !== sha || response.url !== `${api}/commits/${sha}`
      || response.html_url !== `${web}/commit/${sha}`) fail("COMMIT");
    const detail = record(response.commit);
    const tree = record(detail.tree);
    const treeSha = gitId(tree.sha);
    if (tree.url !== `${api}/git/trees/${treeSha}`) fail("COMMIT");
    const parents = Array.isArray(response.parents) ? response.parents.map((item) => {
      const parent = record(item);
      const parentSha = gitId(parent.sha);
      if (parent.url !== `${api}/commits/${parentSha}` || parent.html_url !== `${web}/commit/${parentSha}`) fail("COMMIT");
      return parentSha;
    }) : fail("COMMIT");
    return Object.freeze({
      sha,
      tree: treeSha,
      message: text(detail.message),
      parents: Object.freeze(parents),
      files: Object.freeze(Array.isArray(response.files) ? response.files.map(record) : fail("COMMIT")),
      stats: response.stats,
    });
  };

  /** One tree listing's entries, each checked for shape, URL, and kind; a listing cut short is rejected. */
  const listing = async (sha: string, recursive: boolean): Promise<readonly TreeEntry[]> => {
    const response = record(await githubGet(options, `${api}/git/trees/${sha}${recursive ? "?recursive=1" : ""}`));
    const treeValues = response.tree;
    if (response.sha !== sha || response.url !== `${api}/git/trees/${sha}` || response.truncated !== false) fail("TREE");
    const treeEntries: unknown[] = Array.isArray(treeValues) ? treeValues : fail("TREE");
    const entries: readonly TreeEntry[] = treeEntries.map((value: unknown) => {
      const item = record(value);
      const size = item.type === "blob" && Number.isSafeInteger(item.size) && (item.size as number) >= 0 ? { size: item.size as number } : {};
      const entry = Object.freeze({ path: text(item.path), mode: text(item.mode), type: text(item.type), sha: gitId(item.sha), ...size });
      if (item.url !== `${api}/git/${entry.type}s/${entry.sha}`) fail("TREE");
      const regular = entry.type === "blob" && (entry.mode === "100644" || entry.mode === "100755");
      const directory = entry.type === "tree" && entry.mode === "040000";
      if (!regular && !directory) fail("TREE");
      return entry;
    });
    if (new Set(entries.map(({ path }) => path)).size !== entries.length) fail("TREE");
    return Object.freeze(entries);
  };

  const tree = async (sha: string): Promise<readonly TreeEntry[]> => {
    const entries = await listing(sha, false);
    if (entries.some(({ path }) => path.includes("/")) || treeHash(entries) !== sha) fail("TREE");
    return entries;
  };

  const recursiveTree = async (sha: string): Promise<readonly TreeEntry[]> => {
    const entries = await listing(sha, true);
    // Group every entry under its directory, then require each directory's entries to hash to that directory.
    const children = new Map<string, TreeEntry[]>([["", []]]);
    for (const entry of entries) {
      if (entry.type === "tree") children.set(entry.path, children.get(entry.path) ?? []);
    }
    for (const entry of entries) {
      const slash = entry.path.lastIndexOf("/");
      const parent = slash < 0 ? "" : entry.path.slice(0, slash);
      (children.get(parent) ?? fail("TREE")).push({ ...entry, path: entry.path.slice(slash + 1) });
    }
    const directories = entries.filter(({ type }) => type === "tree");
    if (treeHash(children.get("")!) !== sha || directories.some((entry) => treeHash(children.get(entry.path)!) !== entry.sha)) fail("TREE");
    return entries;
  };

  const resolvePath = async (rootTree: string, path: string): Promise<Readonly<{ mode: GitMode; blob: string }>> => {
    const segments = path.split("/");
    if (segments.some((segment) => !/^(?!\.{1,2}$)[^/\\\0]+$/u.test(segment))) fail("PATH");
    let current = rootTree;
    for (const [index, segment] of segments.entries()) {
      const entry = (await tree(current)).find(({ path: name }) => name === segment) ?? fail("PATH");
      if (index < segments.length - 1) {
        if (entry.type !== "tree" || entry.mode !== "040000") fail("PATH");
        current = entry.sha;
        continue;
      }
      if (entry.type !== "blob") fail("PATH");
      const mode: GitMode = entry.mode === "100644" ? "100644" : entry.mode === "100755" ? "100755" : fail("PATH");
      return Object.freeze({ mode, blob: entry.sha });
    }
    return fail("PATH");
  };

  const entries = async (rootTree: string, path: string): Promise<readonly TreeEntry[]> => {
    let current = rootTree;
    for (const segment of path === "" ? [] : path.split("/")) {
      if (!/^(?!\.{1,2}$)[^/\\\0]+$/u.test(segment)) fail("PATH");
      const entry = (await tree(current)).find(({ path: name }) => name === segment) ?? fail("PATH");
      if (entry.type !== "tree" || entry.mode !== "040000") fail("PATH");
      current = entry.sha;
    }
    return tree(current);
  };

  const listFiles = async (rootTree: string, path: string): Promise<readonly string[]> =>
    Object.freeze((await entries(rootTree, path)).filter(({ type }) => type === "blob").map(({ path: name }) => `${path}/${name}`).sort());

  const blob = async (sha: string): Promise<Uint8Array> => {
    const response = record(await githubGet(options, `${api}/git/blobs/${sha}`));
    if (response.sha !== sha || response.url !== `${api}/git/blobs/${sha}`
      || response.encoding !== "base64" || !Number.isSafeInteger(response.size)) fail("BLOB");
    const encoded = text(response.content).replace(/\s/gu, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) fail("BLOB");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.byteLength !== response.size || gitObject("blob", bytes) !== sha || bytes.toString("base64") !== encoded) fail("BLOB");
    return bytes;
  };

  return Object.freeze({ api, web, commit, resolvePath, listFiles, entries, recursiveTree, blob });
};
