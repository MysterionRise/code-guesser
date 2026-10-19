import { createHash } from "node:crypto";
import { isScreenablePath, screenBlob } from "@codeguessr/content/local-poc-support";
import { profileAtLeast } from "../../../packages/artifact/src/index";
import { changesOnlyProse, patchOnlyComments } from "./code-skeleton";
import { changeWindows } from "./code-windows";
import { gitReader, type CommitRecord, type GitMode } from "./github-git";
import { looksGenerated } from "./excerpt-window";
import type { GitHubSearchCandidate } from "./github-search";
import type { CrawlProfile } from "./profile";
import type { RetryController } from "./retry";
import type { BoundedTransport } from "./transport";
type UnknownRecord = Record<string, unknown>;
export class GitHubLineageError extends Error {
  /** `code` names the check that rejected the candidate; the message stays the stable stage code. */
  public constructor(public readonly code: string = "GITHUB_LINEAGE_REJECTED") {
    super("GITHUB_LINEAGE_REJECTED");
    this.name = "GitHubLineageError";
  }
}
export interface GitHubLineageOptions {
  readonly profile: CrawlProfile;
  readonly candidates: readonly GitHubSearchCandidate[];
  /**
   * From profile v6 on (#75), whether the deck still has room for a change that grows its pane like this, estimated
   * from the commit's patch (`paneGrowth`'s order) before the file's trees and blobs are read.
   */
  readonly admitGrowth?: (growth: readonly number[]) => boolean;
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
  /** The same stretch of the file before and after the commit; the later one is also `excerpt`. */
  readonly beforeExcerpt: string;
  readonly afterExcerpt: string;
  readonly excerpt: string;
  readonly excerptHash: string;
  readonly parentExcerptHash: string;
  readonly linesRemoved: number;
  readonly linesAdded: number;
}
const fail = (code: string): never => { throw new GitHubLineageError(code); };
const record = (value: unknown): UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : fail("LINEAGE_SHAPE");
const text = (value: unknown): string =>
  typeof value === "string" && value.length > 0 ? value : fail("LINEAGE_SHAPE");
const gitId = (value: unknown): string =>
  typeof value === "string" && /^[0-9a-f]{40}$/u.test(value) ? value : fail("LINEAGE_SHAPE");
const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

/**
 * FR-024 requires a single-parent commit; the commit itself may touch several files.
 * Exactly one same-path modification is bound: the first screenable one in path order,
 * so the choice is deterministic for the pinned commit and recorded in the fixture.
 */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u;
/**
 * A recorded patch can fit one change window only when its hunks sit close together and change few lines.
 * The windows computed from the pinned blobs decide; this only skips files that cannot pass.
 */
const patchFitsWindow = (patch: string, limits: Readonly<{ maxChangedLines: number; changeWindowLines: number }>): boolean => {
  const lines = patch.split("\n");
  const hunks = lines.map((line) => HUNK_HEADER.exec(line)).filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ start: Number(match[1]), length: match[2] === undefined ? 1 : Number(match[2]) }));
  if (hunks.length === 0 || hunks.length > 2) return false;
  const span = hunks.at(-1)!.start + hunks.at(-1)!.length - hunks[0]!.start;
  const removed = lines.filter((line) => line.startsWith("-")).length;
  const added = lines.filter((line) => line.startsWith("+")).length;
  return span <= limits.changeWindowLines && removed <= 2 * limits.maxChangedLines && added <= 2 * limits.maxChangedLines;
};

const parseChangedPath = (
  commit: CommitRecord,
  api: string,
  web: string,
  limits: Readonly<{ maxChangedLines: number; changeWindowLines: number }>,
): Readonly<{ path: string; blob: string; patch: string | undefined }> => {
  if (commit.parents.length !== 1 || commit.files.length === 0) fail("LINEAGE_CHANGED_PATH");
  // A recorded patch too large for one change window disqualifies its file before any blob is
  // fetched; an absent patch leaves the decision to the windows computed from the pinned blobs.
  const modifications = commit.files.filter((entry) => entry.status === "modified"
    && entry.previous_filename === undefined && typeof entry.filename === "string"
    && isScreenablePath(entry.filename)
    && (typeof entry.patch !== "string" || patchFitsWindow(entry.patch, limits)));
  const names = modifications.map((entry) => text(entry.filename));
  if (names.length === 0 || new Set(names).size !== names.length) fail("LINEAGE_CHANGED_PATH");
  const file = [...modifications].sort((left, right) => compareText(text(left.filename), text(right.filename)))[0]!;
  const path = text(file.filename);
  const blob = gitId(file.sha);
  // GitHub percent-encodes the whole path (slashes included) inside these per-file URLs.
  const encoded = encodeURIComponent(path);
  if (file.status !== "modified" || file.previous_filename !== undefined
    || file.blob_url !== `${web}/blob/${commit.sha}/${encoded}`
    || file.raw_url !== `${web}/raw/${commit.sha}/${encoded}`
    || file.contents_url !== `${api}/contents/${encoded}?ref=${commit.sha}`) fail("LINEAGE_CHANGED_PATH");
  return Object.freeze({ path, blob, patch: typeof file.patch === "string" ? file.patch : undefined });
};

/**
 * How a patch's change grows its file, in `paneGrowth`'s measures: the characters and lines it adds against those it
 * removes, and its longest added line against its longest removed one. The windows share their context lines, so
 * this is how the later pane will compare with the earlier one, near enough to skip a commit before its blobs.
 */
export const patchGrowth = (patch: string): readonly number[] => {
  const lines = patch.split("\n");
  const side = (mark: string) => lines.filter((line) => line.startsWith(mark) && !line.startsWith(`${mark.repeat(3)} `)).map((line) => line.slice(1));
  const [removed, added] = [side("-"), side("+")];
  const characters = (changed: readonly string[]) => changed.reduce((sum, line) => sum + line.length + 1, 0);
  const longest = (changed: readonly string[]) => Math.max(0, ...changed.map((line) => line.trim().length));
  return Object.freeze([Math.sign(characters(added) - characters(removed)), Math.sign(added.length - removed.length),
    Math.sign(longest(added) - longest(removed))]);
};

/** Both versions pass the content screen; the windows show the same stretch before and after the commit. */
const screenChange = (
  options: GitHubLineageOptions,
  path: string,
  parent: Uint8Array,
  child: Uint8Array,
) => {
  const parentHash = sha256(parent);
  const childHash = sha256(child);
  const seen = options.seenNormalizedHashes ?? new Set<string>();
  const parentScreen = screenBlob({ path, bytes: parent }, seen);
  const childScreen = screenBlob({ path, bytes: child }, seen);
  if (parentScreen.rawSha256 !== parentHash || childScreen.rawSha256 !== childHash) fail("LINEAGE_CHANGE_SCREEN");
  const { screening } = options.profile;
  const windows = changeWindows(parentScreen.text, childScreen.text, {
    maxLines: screening.changeWindowLines, maxBytes: screening.excerptBytes,
    maxChangedLines: screening.maxChangedLines, contextLines: screening.changeContextLines,
  }) ?? fail("LINEAGE_CHANGE_WINDOW");
  return Object.freeze({ parentHash, childHash, windows, parentText: parentScreen.text, childText: childScreen.text });
};

const bindCandidate = async (
  options: GitHubLineageOptions,
  candidate: GitHubSearchCandidate,
): Promise<GitHubLineageCandidate> => {
  const git = gitReader(options, candidate.repository, (check) => fail(`LINEAGE_${check}`));
  const { api, web } = git;
  if (candidate.repositoryUrl !== web || candidate.commitUrl !== `${web}/commit/${candidate.commit}`) fail("LINEAGE_BINDING");
  const child = await git.commit(candidate.commit);
  const changed = parseChangedPath(child, api, web, options.profile.screening);
  // From v6 on (#75), a change to comments alone, or one the deck has no room for, is skipped before any tree or blob.
  const strict = profileAtLeast(options.profile.profileVersion, "local-real-rounds.v6");
  if (strict && changed.patch !== undefined) {
    if (patchOnlyComments(changed.patch, changed.path)) fail("LINEAGE_PROSE_ONLY");
    if (options.admitGrowth && !options.admitGrowth(patchGrowth(changed.patch))) fail("LINEAGE_SIZE_UNBALANCED");
  }
  // Child side first: its tree binding and blob screening reject most candidates, and every
  // request they save is a request the run's ceiling keeps for the next candidate.
  const childPath = await git.resolvePath(child.tree, changed.path);
  if (childPath.blob !== changed.blob) fail("LINEAGE_BINDING");
  const childBytes = await git.blob(childPath.blob);
  const childScreen = screenBlob({ path: changed.path, bytes: childBytes }, options.seenNormalizedHashes ?? new Set<string>());
  // FR-023 as amended: the experiment's stricter generated-file screen applies to every fixture.
  if (looksGenerated(childScreen.text, options.profile.screening.generatedScanLines)) fail("LINEAGE_BINDING");
  const parentSha = child.parents[0]!;
  const parent = await git.commit(parentSha);
  const parentPath = await git.resolvePath(parent.tree, changed.path);
  if (childPath.blob === parentPath.blob) fail("LINEAGE_BINDING");
  const parentBytes = await git.blob(parentPath.blob);
  const { parentHash, childHash, windows, parentText, childText } = screenChange(options, changed.path, parentBytes, childBytes);
  // A round needs a change to code, not only to comments, docstrings, or string text (#75).
  if (strict && changesOnlyProse(parentText, childText, changed.path)) fail("LINEAGE_PROSE_ONLY");
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
    beforeExcerpt: windows.before,
    afterExcerpt: windows.after,
    excerpt: windows.after,
    excerptHash: sha256(windows.after),
    parentExcerptHash: sha256(windows.before),
    linesRemoved: windows.removed,
    linesAdded: windows.added,
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
