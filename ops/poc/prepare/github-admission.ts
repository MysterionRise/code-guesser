import { createHash } from "node:crypto";
import { screenLicenseEvidence } from "@codeguessr/content/local-poc-support";
import { canonicalHash } from "./canonical";
import type { GitHubLineageCandidate } from "./github-lineage";
import type { CrawlProfile } from "./profile";
import type { RetryController } from "./retry";
import type { BoundedTransport } from "./transport";

type UnknownRecord = Record<string, unknown>;
type BoundLineageKey =
  | "path" | "blob" | "queryId" | "childCommit" | "childTree"
  | "parentCommit" | "parentTree" | "parentPath" | "childPath"
  | "parentMode" | "childMode" | "parentBlob" | "childBlob"
  | "parentRawContentHash" | "childRawContentHash" | "parentExcerptHash" | "linesRemoved" | "linesAdded";
export class GitHubAdmissionError extends Error {
  /** `code` names the check that rejected the candidate; the message stays the stable stage code. */
  public constructor(public readonly code: string = "GITHUB_ADMISSION_REJECTED") {
    super("GITHUB_ADMISSION_REJECTED");
    this.name = "GitHubAdmissionError";
  }
}
export interface AdmittedProvenanceSource extends Pick<GitHubLineageCandidate, BoundLineageKey> {
  readonly discoverySource: "GITHUB_COMMIT_SEARCH";
  readonly repository: string;
  readonly repositoryUrl: string;
  readonly authorName: string;
  readonly authorLogin: string | null;
  readonly authorBasis: "SELECTED_COMMIT";
  readonly authorSourceUrl: string;
  readonly rawContentHash: string;
  readonly excerptHash: string;
  readonly licenseName: string;
  readonly licenseSpdx: string;
  readonly licenseFileUrl: string;
  readonly commit: string;
  readonly commitUrl: string;
  readonly blobUrl: string;
  readonly profileVersion: string;
  readonly crawlSnapshotId: string;
}
export interface GitHubAdmissionCandidate {
  readonly admissionDecision: "AUTOMATED_POC_ADMISSION_ONLY";
  readonly lineage: GitHubLineageCandidate;
  readonly source: Readonly<AdmittedProvenanceSource>;
}
export interface GitHubAdmissionOptions {
  readonly profile: CrawlProfile;
  readonly profileHash: string;
  readonly crawlSnapshotId: string;
  readonly candidates: readonly GitHubLineageCandidate[];
  readonly transport: Pick<BoundedTransport, "requestJson">;
  readonly retry: Pick<RetryController, "execute">;
}
export interface RepositoryAdmission {
  readonly licenseName: string;
  readonly licenseSpdx: string;
}
export interface LicenseAdmission {
  readonly path: string;
  readonly url: string;
}
const fail = (code: string): never => { throw new GitHubAdmissionError(code); };
const record = (value: unknown): UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : fail("ADMISSION_SHAPE");
const text = (value: unknown): string =>
  typeof value === "string" && value.trim() === value && value.length > 0 ? value : fail("ADMISSION_SHAPE");
const gitId = (value: unknown): string =>
  typeof value === "string" && /^[0-9a-f]{40}$/u.test(value) ? value : fail("ADMISSION_SHAPE");
const hash = (value: unknown): string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : fail("ADMISSION_SHAPE");
const encodePath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const requestJson = (options: GitHubAdmissionOptions, url: string): Promise<unknown> => {
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": options.profile.github.apiVersion,
  };
  return options.retry.execute(() => options.transport.requestJson({
    headers,
    url,
    method: "GET",
    provider: "github",
  }));
};

const detectedLicense = (value: unknown): RepositoryAdmission => {
  const license = record(value);
  const licenseName = text(license.name);
  const licenseSpdx = text(license.spdx_id);
  text(license.key);
  if (license.url !== `https://api.github.com/licenses/${license.key as string}`) fail("ADMISSION_LICENSE_SHAPE");
  return Object.freeze({ licenseName, licenseSpdx });
};

/** The repository is public, live, not a fork, and under an allowlisted licence. */
export const admitRepository = (
  value: unknown,
  repository: string,
  api: string,
  web: string,
  allowlist: readonly string[],
): RepositoryAdmission => {
  const response = record(value);
  if (response.full_name !== repository || response.url !== api || response.html_url !== web
    || response.private !== false || response.visibility !== "public" || response.disabled !== false
    || response.archived !== false || response.fork !== false) fail("ADMISSION_REPOSITORY");
  const license = detectedLicense(response.license);
  if (!allowlist.includes(license.licenseSpdx)) fail("ADMISSION_REPOSITORY_LICENSE");
  return license;
};

/** The author of one commit, from that commit's own response (single or listed). */
export const selectedAuthor = (
  value: unknown,
  commit: string,
  api: string,
  web: string,
): Readonly<{ name: string; login: string | null }> => {
  const response = record(value);
  if (response.sha !== commit || response.url !== `${api}/commits/${commit}`
    || response.html_url !== `${web}/commit/${commit}`) fail("ADMISSION_AUTHOR");
  const name = text(record(record(response.commit).author).name);
  // Some imported histories record an email address as the author's name: contact data, never published.
  if (name.includes("@")) fail("ADMISSION_AUTHOR_CONTACT");
  if (response.author === null) return Object.freeze({ name, login: null });
  const author = record(response.author);
  const login = text(author.login);
  if (author.url !== `https://api.github.com/users/${login}`
    || author.html_url !== `https://github.com/${login}`) fail("ADMISSION_AUTHOR");
  return Object.freeze({ name, login });
};

const decodeLicense = (response: UnknownRecord): Uint8Array => {
  if (response.encoding !== "base64" || !Number.isSafeInteger(response.size)) fail("ADMISSION_LICENSE_DECODE");
  // The provider wraps base64 content at 60 columns with a trailing newline; only the
  // whitespace-free payload is validated and decoded.
  const content = typeof response.content === "string" && response.content.trim().length > 0
    ? response.content
    : fail("ADMISSION_LICENSE_DECODE");
  const encoded = content.replace(/\s/gu, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) fail("ADMISSION_LICENSE_DECODE");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength !== response.size || bytes.toString("base64") !== encoded) fail("ADMISSION_LICENSE_DECODE");
  return bytes;
};

/** The licence file at `target.commit` agrees with the repository's licence and passes the evidence screen. */
export const admitLicense = (
  value: unknown,
  metadata: RepositoryAdmission,
  target: Readonly<{ repository: string; commit: string }>,
  policy: Readonly<{ profileVersion: string; profileHash: string }>,
  api: string,
  web: string,
): LicenseAdmission => {
  const response = record(value);
  const path = text(response.path);
  const encodedPath = encodePath(path);
  const blob = gitId(response.sha);
  if (response.name !== path.split("/").at(-1) || response.type !== "file"
    || response.url !== `${api}/contents/${encodedPath}?ref=${target.commit}`
    || response.html_url !== `${web}/blob/${target.commit}/${encodedPath}`
    || response.git_url !== `${api}/git/blobs/${blob}`
    || response.download_url !== `https://raw.githubusercontent.com/${target.repository}/${target.commit}/${encodedPath}`) fail("ADMISSION_LICENSE");
  const detected = detectedLicense(response.license);
  if (detected.licenseName !== metadata.licenseName || detected.licenseSpdx !== metadata.licenseSpdx) fail("ADMISSION_LICENSE");
  const bytes = decodeLicense(response);
  const textHash = createHash("sha256").update(bytes).digest("hex");
  const evidence = screenLicenseEvidence({
    identifier: metadata.licenseSpdx,
    metadataIdentifiers: [detected.licenseSpdx],
    licenseFilePresent: true,
    licensePath: path,
    licenseBlobSha: blob,
    licenseTextSha256: textHash,
    licenseBytes: bytes,
    repositoryPolicyVersion: policy.profileVersion,
    repositoryPolicyHash: policy.profileHash,
  });
  if (evidence.decision !== "ADMISSION_SCREENING_ONLY" || evidence.licenseBlobSha !== blob
    || evidence.licenseTextSha256 !== textHash) fail("ADMISSION_LICENSE");
  return Object.freeze({ path, url: response.html_url as string });
};

const sourceRecord = (
  candidate: GitHubLineageCandidate,
  options: GitHubAdmissionOptions,
  author: Readonly<{ name: string; login: string | null }>,
  metadata: RepositoryAdmission,
  license: LicenseAdmission,
): Readonly<AdmittedProvenanceSource> => Object.freeze({
  discoverySource: "GITHUB_COMMIT_SEARCH",
  repository: candidate.repository, repositoryUrl: candidate.repositoryUrl,
  authorName: author.name, authorLogin: author.login, authorBasis: "SELECTED_COMMIT",
  authorSourceUrl: candidate.commitUrl, path: candidate.path, blob: candidate.blob,
  rawContentHash: candidate.childRawContentHash, excerptHash: candidate.excerptHash,
  licenseName: metadata.licenseName, licenseSpdx: metadata.licenseSpdx,
  licenseFileUrl: license.url, commit: candidate.commit, commitUrl: candidate.commitUrl,
  blobUrl: `${candidate.repositoryUrl}/blob/${candidate.commit}/${encodePath(candidate.path)}`,
  profileVersion: options.profile.profileVersion, crawlSnapshotId: options.crawlSnapshotId,
  queryId: candidate.queryId, childCommit: candidate.childCommit, childTree: candidate.childTree,
  parentCommit: candidate.parentCommit, parentTree: candidate.parentTree,
  parentPath: candidate.parentPath, childPath: candidate.childPath,
  parentMode: candidate.parentMode, childMode: candidate.childMode,
  parentBlob: candidate.parentBlob, childBlob: candidate.childBlob,
  parentRawContentHash: candidate.parentRawContentHash,
  childRawContentHash: candidate.childRawContentHash, parentExcerptHash: candidate.parentExcerptHash,
  linesRemoved: candidate.linesRemoved, linesAdded: candidate.linesAdded,
});

const admitCandidate = async (
  options: GitHubAdmissionOptions,
  candidate: GitHubLineageCandidate,
): Promise<GitHubAdmissionCandidate> => {
  const api = `https://api.github.com/repos/${candidate.repository}`;
  const web = `https://github.com/${candidate.repository}`;
  if (candidate.repositoryUrl !== web || candidate.commit !== candidate.childCommit) fail("ADMISSION_BINDING");
  const metadata = admitRepository(await requestJson(options, api), candidate.repository,
    api, web, options.profile.licenses);
  const author = selectedAuthor(await requestJson(options, `${api}/commits/${candidate.commit}`),
    candidate.commit, api, web);
  const license = admitLicense(await requestJson(options, `${api}/license?ref=${candidate.commit}`),
    metadata, candidate, { profileVersion: options.profile.profileVersion, profileHash: options.profileHash }, api, web);
  return Object.freeze({
    admissionDecision: "AUTOMATED_POC_ADMISSION_ONLY",
    lineage: candidate,
    source: sourceRecord(candidate, options, author, metadata, license),
  });
};

/**
 * The repository half of admission (public, not archived, not a fork, licence allowed). The
 * orchestrator runs it once per repository before any lineage request; admission repeats it,
 * and the run's GET reuse answers that repeat without a second request.
 */
export const screenGitHubRepository = async (
  options: Pick<GitHubAdmissionOptions, "profile" | "transport" | "retry">,
  repository: string,
): Promise<void> => {
  const api = `https://api.github.com/repos/${repository}`;
  admitRepository(await requestJson(options as GitHubAdmissionOptions, api), repository, api,
    `https://github.com/${repository}`, options.profile.licenses);
};

/**
 * A repository as a project round's option shows it: its public description (null when it has none),
 * and whether it is a fork or archived, which keeps it out of the options. The same GET the repository
 * screen makes, so a screened repository costs no second request.
 */
export const describeGitHubRepository = async (
  options: Pick<GitHubAdmissionOptions, "profile" | "transport" | "retry">,
  repository: string,
): Promise<Readonly<{ description: string | null; fork: boolean; archived: boolean }>> => {
  const api = `https://api.github.com/repos/${repository}`;
  const response = record(await requestJson(options as GitHubAdmissionOptions, api));
  if (response.full_name !== repository || response.url !== api || response.html_url !== `https://github.com/${repository}`
    || response.private !== false || typeof response.fork !== "boolean" || typeof response.archived !== "boolean"
    || (response.description !== null && typeof response.description !== "string")) fail("ADMISSION_REPOSITORY");
  const description = typeof response.description === "string" && response.description.trim().length > 0
    ? response.description.trim() : null;
  return Object.freeze({ description, fork: response.fork as boolean, archived: response.archived as boolean });
};

export const admitGitHubCandidates = async (
  options: GitHubAdmissionOptions,
): Promise<readonly GitHubAdmissionCandidate[]> => {
  if (canonicalHash(options.profile) !== hash(options.profileHash)) fail("ADMISSION_SHAPE");
  hash(options.crawlSnapshotId);
  return Object.freeze(
    await Promise.all(options.candidates.map((candidate) => admitCandidate(options, candidate))),
  );
};
