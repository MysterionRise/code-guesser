import {
  EXERCISE_SOURCE_KEYS,
  FIX_SOURCE_KEYS,
  FRAMEWORK_SOURCE_KEYS,
  MAINSTREAM_LANGUAGES,
  LINEAGE_SOURCE_KEYS,
  MISSING_LINE_SOURCE_KEYS,
  NAME_FUNCTION_SOURCE_KEYS,
  PROFILE_VERSION,
  STACK_LANGUAGES,
  STACK_SOURCE_KEYS,
  VULNERABLE_LINE_SOURCE_KEYS,
  type ParsedSource,
} from "./domain";
import { fail } from "./errors";
import { CWE_ID, GHSA_ID, type AdvisorySnapshot } from "./vulnerable-line";
import {
  bool,
  count,
  gitId,
  gitMode,
  positiveInteger,
  record,
  sha256,
  text,
  texts,
  utcTimestamp,
  type JsonRecord,
} from "./validation";

/** The Stack v2 release and revision the crawl snapshot names; every Stack source must match it. */
export interface StackIdentity {
  readonly release: string;
  readonly revision: string;
}

const encodedPath = (value: string): string =>
  value.split("/").map(encodeURIComponent).join("/");

/**
 * Every URL of a GitHub-hosted source follows from its repository, commit, and path. The author's commit is
 * the source commit unless the author was found in the file's history (`authorCommit`).
 */
export const validateGitHubBinding = (source: JsonRecord, authorCommit?: string): void => {
  const repository = text(source.repository);
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) fail();
  const commit = gitId(source.commit);
  const path = text(source.path);
  if (path.startsWith("/") || path.includes("\\")
    || path.split("/").some((part) => part === "" || part === "." || part === "..")) fail();
  const root = `https://github.com/${repository}`;
  const commitUrl = `${root}/commit/${commit}`;
  if (source.repositoryUrl !== root || source.commitUrl !== commitUrl
    || source.authorSourceUrl !== `${root}/commit/${authorCommit === undefined ? commit : gitId(authorCommit)}`
    || source.blobUrl !== `${root}/blob/${commit}/${encodedPath(path)}`) fail();
  const licensePrefix = `${root}/blob/${commit}/`;
  if (!text(source.licenseFileUrl).startsWith(licensePrefix)
    || text(source.licenseFileUrl).length === licensePrefix.length) fail();
};

const validateBaseSource = (source: JsonRecord, snapshotId: string, authorBasis = "SELECTED_COMMIT", authorCommit?: string): void => {
  for (const key of [
    "repository", "repositoryUrl", "authorName", "path", "licenseName", "licenseSpdx",
    "licenseFileUrl", "commitUrl", "blobUrl", "profileVersion",
  ]) text(source[key]);
  if (source.authorLogin !== null) text(source.authorLogin);
  // An author's name is never an email address: that is contact data.
  if (text(source.authorName).includes("@")) fail();
  if (source.authorBasis !== authorBasis) fail();
  gitId(source.blob);
  gitId(source.commit);
  sha256(source.rawContentHash);
  sha256(source.excerptHash);
  if (source.profileVersion !== PROFILE_VERSION || source.crawlSnapshotId !== snapshotId) fail();
  validateGitHubBinding(source, authorCommit);
};

/** `owner/name@commit`: how the snapshot lists the commits curated repositories are pinned to. */
export const pinKey = (repository: string, commit: string): string => `${repository}@${commit}`;

/**
 * A file from a curated GitHub repository: the repository and commit must be one of the snapshot's pins, and the
 * author is the file's last human author before the pin (`PATH_HISTORY`), credited through that author's commit.
 * `keys` are the kind's own source keys, which start with `CURATED_SOURCE_KEYS`.
 */
export const validateCuratedSource = (
  value: unknown,
  keys: readonly string[],
  snapshotId: string,
  pins: ReadonlySet<string>,
): ParsedSource => {
  const source = record(value, keys);
  if (source.discoverySource !== "CURATED_GITHUB") fail();
  validateBaseSource(source, snapshotId, "PATH_HISTORY", gitId(source.authorCommit));
  if (!pins.has(pinKey(text(source.repository), gitId(source.commit)))) fail();
  return source as ParsedSource;
};

/** A missing-line round's file (#57): a curated file, its language, and where its window and gap sit. */
export const validateMissingLineSource = (value: unknown, snapshotId: string, pins: ReadonlySet<string>): ParsedSource => {
  const source = validateCuratedSource(value, MISSING_LINE_SOURCE_KEYS, snapshotId, pins);
  if (!(STACK_LANGUAGES as readonly unknown[]).includes(source.language)) fail();
  if (positiveInteger(source.windowStart) > positiveInteger(source.gapLine)) fail();
  return source;
};

/** A name-the-function round's file (#73): a curated file, its language, and the function whose name is hidden. */
export const validateNameFunctionSource = (value: unknown, snapshotId: string, pins: ReadonlySet<string>): ParsedSource => {
  const source = validateCuratedSource(value, NAME_FUNCTION_SOURCE_KEYS, snapshotId, pins);
  if (!(STACK_LANGUAGES as readonly unknown[]).includes(source.language)) fail();
  if (!/^[A-Za-z_][A-Za-z0-9_]{1,63}$/u.test(text(source.functionName))) fail();
  positiveInteger(source.functionLine);
  return source;
};

/** A framework round's file (#62): a curated file in one framework's example, and the line its pane begins with. */
export const validateFrameworkSource = (value: unknown, snapshotId: string, pins: ReadonlySet<string>): ParsedSource => {
  const source = validateCuratedSource(value, FRAMEWORK_SOURCE_KEYS, snapshotId, pins);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(text(source.framework))) fail();
  positiveInteger(source.windowStart);
  return source;
};

/** An exercise round's file (#58): a curated file, its track's language, and the line its pane begins with. */
export const validateExerciseSource = (value: unknown, snapshotId: string, pins: ReadonlySet<string>): ParsedSource => {
  const source = validateCuratedSource(value, EXERCISE_SOURCE_KEYS, snapshotId, pins);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(text(source.exercise)) || !(STACK_LANGUAGES as readonly unknown[]).includes(source.language)) fail();
  positiveInteger(source.windowStart);
  return source;
};

/**
 * A file before a one-line fix a bug dataset records: the dataset must be one the snapshot pins, the shown file is
 * at the fix's parent (`commit`), and the fix's author is credited through `fixCommit` (`FIX_COMMIT`).
 */
export const validateFixSource = (value: unknown, snapshotId: string, datasets: ReadonlySet<string>): ParsedSource => {
  const source = record(value, FIX_SOURCE_KEYS);
  if (source.discoverySource !== "CURATED_DATASET" || !datasets.has(text(source.dataset))) fail();
  validateBaseSource(source, snapshotId, "FIX_COMMIT", gitId(source.fixCommit));
  gitId(source.fixBlob);
  text(source.bugId);
  if (!(STACK_LANGUAGES as readonly unknown[]).includes(source.language)) fail();
  const changedLine = positiveInteger(source.changedLine);
  const windowStart = positiveInteger(source.windowStart);
  if (windowStart > changedLine || source.fixCommit === source.commit || source.fixBlob === source.blob) fail();
  return source as ParsedSource;
};

/**
 * A file before a one-line fix a reviewed GitHub advisory links (#59): as a fix round's, but the record is the advisory,
 * filed under one of the snapshot's ecosystems and a CWE the snapshot gives a hint for.
 */
export const validateVulnerableLineSource = (value: unknown, snapshotId: string, advisories: AdvisorySnapshot): ParsedSource => {
  const source = record(value, VULNERABLE_LINE_SOURCE_KEYS);
  if (source.discoverySource !== "GITHUB_ADVISORY" || !GHSA_ID.test(text(source.advisory))
    || !advisories.ecosystems.has(text(source.ecosystem)) || !CWE_ID.test(text(source.cwe)) || !advisories.cwes.has(text(source.cwe))) fail();
  validateBaseSource(source, snapshotId, "FIX_COMMIT", gitId(source.fixCommit));
  gitId(source.fixBlob);
  text(source.packageName);
  if (!(MAINSTREAM_LANGUAGES as readonly unknown[]).includes(source.language)) fail();
  const changedLine = positiveInteger(source.changedLine);
  const windowStart = positiveInteger(source.windowStart);
  if (windowStart > changedLine || source.fixCommit === source.commit || source.fixBlob === source.blob) fail();
  return source as ParsedSource;
};

/** A commit from GitHub search and one file's parent and child versions; the round shows both. */
export const validateLineageSource = (
  value: unknown,
  snapshotId: string,
  queryIds: ReadonlySet<string>,
): ParsedSource => {
  const source = record(value, LINEAGE_SOURCE_KEYS);
  validateBaseSource(source, snapshotId);
  if (source.discoverySource !== "GITHUB_COMMIT_SEARCH" || !queryIds.has(text(source.queryId))) fail();
  for (const key of ["childCommit", "childTree", "parentCommit", "parentTree", "parentBlob", "childBlob"]) gitId(source[key]);
  for (const key of ["parentRawContentHash", "childRawContentHash", "parentExcerptHash"]) sha256(source[key]);
  for (const key of ["parentPath", "childPath"]) text(source[key]);
  gitMode(source.parentMode);
  gitMode(source.childMode);
  const removed = count(source.linesRemoved);
  const added = count(source.linesAdded);
  if (removed + added === 0
    || source.commit !== source.childCommit || source.blob !== source.childBlob
    || source.path !== source.parentPath || source.path !== source.childPath
    || source.rawContentHash !== source.childRawContentHash
    || source.parentCommit === source.childCommit || source.parentBlob === source.childBlob
    || source.parentExcerptHash === source.excerptHash) fail();
  return source as ParsedSource;
};

/** A Stack v2 file revalidated against GitHub: the Stack identities are the revalidated blob and commit. */
export const validateStackSource = (
  value: unknown,
  snapshotId: string,
  stack: StackIdentity,
): ParsedSource => {
  const source = record(value, STACK_SOURCE_KEYS);
  validateBaseSource(source, snapshotId);
  if (source.discoverySource !== "STACK_V2" || source.stackRelease !== stack.release
    || source.stackRevision !== stack.revision
    || !(STACK_LANGUAGES as readonly unknown[]).includes(source.configuration)
    || source.detectedLanguage !== source.configuration || source.sourceEncoding !== "UTF-8"
    || bool(source.generated) || bool(source.vendor)) fail();
  sha256(source.stableRowId);
  for (const key of [
    "swhBlobId", "swhContentId", "swhDirectoryId", "swhSnapshotId", "swhRevisionId",
  ]) gitId(source[key]);
  for (const key of ["stackRepository", "stackPath", "detectedLanguage"]) text(source[key]);
  const licences = texts(source.detectedLicenses);
  positiveInteger(source.byteLength);
  count(source.starEventsCount);
  count(source.forkEventsCount);
  for (const key of ["visitDate", "revisionDate", "committerDate"]) utcTimestamp(source[key]);
  if (source.repository !== source.stackRepository || source.path !== source.stackPath
    || source.commit !== source.swhRevisionId || source.blob !== source.swhContentId
    || !licences.includes(source.licenseSpdx as string)) fail();
  return source as ParsedSource;
};
