import {
  AI_SOURCE_KEYS,
  LANGUAGE_SOURCE_KEYS,
  PROFILE_VERSION,
  PROJECT_SOURCE_KEYS,
  STACK_LANGUAGES,
  type ParsedSource,
} from "./domain";
import { fail } from "./errors";
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

/** The Stack v2 release and revision the crawl snapshot names; every language source must match it. */
export interface StackIdentity {
  readonly release: string;
  readonly revision: string;
}

const encodedPath = (value: string): string =>
  value.split("/").map(encodeURIComponent).join("/");

const validateGitHubBinding = (source: JsonRecord): void => {
  const repository = text(source.repository);
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) fail();
  const commit = gitId(source.commit);
  const path = text(source.path);
  if (path.startsWith("/") || path.includes("\\")
    || path.split("/").some((part) => part === "" || part === "." || part === "..")) fail();
  const root = `https://github.com/${repository}`;
  const commitUrl = `${root}/commit/${commit}`;
  if (source.repositoryUrl !== root || source.commitUrl !== commitUrl
    || source.authorSourceUrl !== commitUrl
    || source.blobUrl !== `${root}/blob/${commit}/${encodedPath(path)}`) fail();
  const licensePrefix = `${root}/blob/${commit}/`;
  if (!text(source.licenseFileUrl).startsWith(licensePrefix)
    || text(source.licenseFileUrl).length === licensePrefix.length) fail();
};

const validateBaseSource = (source: JsonRecord, snapshotId: string): void => {
  for (const key of [
    "repository", "repositoryUrl", "authorName", "path", "licenseName", "licenseSpdx",
    "licenseFileUrl", "commitUrl", "blobUrl", "profileVersion",
  ]) text(source[key]);
  if (source.authorLogin !== null) text(source.authorLogin);
  if (source.authorBasis !== "SELECTED_COMMIT") fail();
  gitId(source.blob);
  gitId(source.commit);
  sha256(source.rawContentHash);
  sha256(source.excerptHash);
  if (source.profileVersion !== PROFILE_VERSION || source.crawlSnapshotId !== snapshotId) fail();
  validateGitHubBinding(source);
};

const validateLineage = (source: JsonRecord, queryRoles: ReadonlyMap<string, string>): string => {
  if (source.discoverySource !== "GITHUB_COMMIT_SEARCH") fail();
  const role = queryRoles.get(text(source.queryId)) ?? fail();
  for (const key of [
    "childCommit", "childTree", "parentCommit", "parentTree", "parentBlob", "childBlob",
  ]) gitId(source[key]);
  for (const key of [
    "parentRawContentHash", "childRawContentHash", "changedLineHash",
  ]) sha256(source[key]);
  for (const key of ["parentPath", "childPath"]) text(source[key]);
  gitMode(source.parentMode);
  gitMode(source.childMode);
  if (source.commit !== source.childCommit || source.blob !== source.childBlob
    || source.path !== source.parentPath || source.path !== source.childPath
    || source.rawContentHash !== source.childRawContentHash
    || source.parentCommit === source.childCommit || source.parentBlob === source.childBlob) fail();
  return role;
};

/** FR-032: a project round comes from an `ordinary` query commit. */
export const validateProjectSource = (
  value: unknown,
  snapshotId: string,
  queryRoles: ReadonlyMap<string, string>,
): ParsedSource => {
  const source = record(value, PROJECT_SOURCE_KEYS);
  validateBaseSource(source, snapshotId);
  if (validateLineage(source, queryRoles) !== "ordinary") fail();
  return source as ParsedSource;
};

/** FR-020 roles: a credited commit comes from an `ai-credit` query and an uncredited one from `ordinary`. */
export const validateAiSource = (
  value: unknown,
  snapshotId: string,
  queryRoles: ReadonlyMap<string, string>,
): ParsedSource => {
  const source = record(value, AI_SOURCE_KEYS);
  validateBaseSource(source, snapshotId);
  const role = validateLineage(source, queryRoles);
  const recorded = bool(source.aiCreditRecorded);
  if (recorded) text(source.aiAssistant);
  else if (source.aiAssistant !== null) fail();
  if (recorded !== (role === "ai-credit")) fail();
  positiveInteger(source.changedFileCount);
  count(source.commitAdditions);
  count(source.commitDeletions);
  return source as ParsedSource;
};

/** A Stack v2 row revalidated against GitHub: the Stack identities are the revalidated blob and commit. */
export const validateLanguageSource = (
  value: unknown,
  snapshotId: string,
  stack: StackIdentity,
): ParsedSource => {
  const source = record(value, LANGUAGE_SOURCE_KEYS);
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
  for (const key of ["visitDate", "revisionDate", "committerDate"]) utcTimestamp(source[key]);
  if (source.repository !== source.stackRepository || source.path !== source.stackPath
    || source.commit !== source.swhRevisionId || source.blob !== source.swhContentId
    || !licences.includes(source.licenseSpdx as string)) fail();
  return source as ParsedSource;
};
