import "server-only";

import {
  PROFILE_VERSION,
  STACK_LANGUAGES,
  STACK_REVISION,
  fail,
  type JsonRecord,
  type ParsedSource,
} from "./local-real-experiment-domain.server";
import {
  bool,
  count,
  gitId,
  positiveInteger,
  record,
  sha256,
  text,
  texts,
} from "./local-real-experiment-validation.server";

const BASE_SOURCE_KEYS = [
  "discoverySource", "repository", "repositoryUrl", "authorName", "authorLogin",
  "authorBasis", "authorSourceUrl", "path", "blob", "rawContentHash", "excerptHash",
  "licenseName", "licenseSpdx", "licenseFileUrl", "commit", "commitUrl", "blobUrl",
  "profileVersion", "crawlSnapshotId",
] as const;
const PROJECT_SOURCE_KEYS = [
  ...BASE_SOURCE_KEYS, "queryId", "childCommit", "childTree", "parentCommit", "parentTree",
  "parentPath", "childPath", "parentMode", "childMode", "parentBlob", "childBlob",
  "parentRawContentHash", "childRawContentHash", "changedLineHash",
] as const;
const AI_SOURCE_KEYS = [
  ...PROJECT_SOURCE_KEYS, "aiCreditRecorded", "aiAssistant", "changedFileCount", "commitAdditions", "commitDeletions",
] as const;
const LANGUAGE_SOURCE_KEYS = [
  ...BASE_SOURCE_KEYS, "stackRelease", "stackRevision", "configuration", "stableRowId",
  "swhBlobId", "swhContentId", "swhDirectoryId", "swhSnapshotId", "swhRevisionId",
  "stackRepository", "stackPath", "detectedLicenses", "detectedLanguage", "generated",
  "vendor", "sourceEncoding", "byteLength", "visitDate", "revisionDate", "committerDate",
] as const;

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
  if ((source.parentMode !== "100644" && source.parentMode !== "100755")
    || (source.childMode !== "100644" && source.childMode !== "100755")) fail();
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

const validTimestamp = (value: unknown): void => {
  const parsed = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{6})?Z$/u.exec(parsed);
  if (match === null) return fail();
  const date = new Date(parsed);
  if (Number.isNaN(date.valueOf())) fail();
  const parts = match.slice(1, 7).map(Number);
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() + 1 !== parts[1]
    || date.getUTCDate() !== parts[2] || date.getUTCHours() !== parts[3]
    || date.getUTCMinutes() !== parts[4] || date.getUTCSeconds() !== parts[5]) fail();
};

export const validateLanguageSource = (
  value: unknown,
  snapshotId: string,
): ParsedSource => {
  const source = record(value, LANGUAGE_SOURCE_KEYS);
  validateBaseSource(source, snapshotId);
  if (source.discoverySource !== "STACK_V2" || source.stackRelease !== "v2.2.0"
    || source.stackRevision !== STACK_REVISION
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
  for (const key of ["visitDate", "revisionDate", "committerDate"]) validTimestamp(source[key]);
  if (source.repository !== source.stackRepository || source.path !== source.stackPath
    || source.commit !== source.swhRevisionId || source.blob !== source.swhContentId
    || !licences.includes(source.licenseSpdx as string)) fail();
  return source as ParsedSource;
};
