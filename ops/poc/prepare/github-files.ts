import { createHash } from "node:crypto";

import { admitLicense, admitRepository, selectedAuthor } from "./github-admission";
import { gitReader, githubGet, type GitMode, type GitReaderOptions } from "./github-git";

export class GitHubFileError extends Error {
  /** `code` names the check that rejected the file; the message stays the stable stage code. */
  public constructor(public readonly code: string = "GITHUB_FILE_REJECTED") {
    super("GITHUB_FILE_REJECTED");
    this.name = "GitHubFileError";
  }
}

export interface GitHubFileOptions extends GitReaderOptions {
  readonly profileHash: string;
}

/** Who a curated file is credited to: the newest human author in its history up to the pin. */
export interface FileAuthor {
  readonly name: string;
  readonly login: string | null;
  readonly commit: string;
}

/** One file of a curated repository at a pinned commit, with its licence and author bound. */
export interface CuratedFile {
  readonly repository: string;
  readonly commit: string;
  readonly path: string;
  readonly mode: GitMode;
  readonly blob: string;
  readonly bytes: Uint8Array;
  readonly rawContentHash: string;
  readonly licenseName: string;
  readonly licenseSpdx: string;
  readonly licenseFileUrl: string;
  readonly author: FileAuthor;
}

const fail = (code: string): never => { throw new GitHubFileError(code); };
const HISTORY_PAGE = 10;
const BOT = /\[bot\]$/iu;

/** A commit made by an automation account, such as `github-actions[bot]` or `pre-commit-ci[bot]`. */
const fromBot = (item: Record<string, unknown>): boolean => {
  const user = item.author as Record<string, unknown> | null | undefined;
  const commit = item.commit as Record<string, unknown> | undefined;
  const name = (commit?.author as Record<string, unknown> | undefined)?.name;
  return user?.type === "Bot" || (typeof user?.login === "string" && BOT.test(user.login))
    || (typeof name === "string" && BOT.test(name));
};

/**
 * The file's last human author: one page of the file's history up to the pinned commit, newest first, skipping
 * automation accounts. A file whose last ten changes all came from bots has no author to credit.
 */
export const fileAuthor = async (
  options: GitReaderOptions,
  target: Readonly<{ repository: string; commit: string; path: string }>,
): Promise<FileAuthor> => {
  const git = gitReader(options, target.repository, (check) => fail(`FILE_${check}`));
  const url = new URL(`${git.api}/commits`);
  url.searchParams.set("path", target.path);
  url.searchParams.set("sha", target.commit);
  url.searchParams.set("per_page", String(HISTORY_PAGE));
  const history = await githubGet(options, url.href);
  if (!Array.isArray(history) || history.length === 0 || history.length > HISTORY_PAGE) return fail("FILE_AUTHOR");
  for (const item of history) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return fail("FILE_AUTHOR");
    const sha = (item as Record<string, unknown>).sha;
    if (typeof sha !== "string" || !/^[0-9a-f]{40}$/u.test(sha)) return fail("FILE_AUTHOR");
    if (fromBot(item as Record<string, unknown>)) continue;
    return Object.freeze({ ...selectedAuthor(item, sha, git.api, git.web), commit: sha });
  }
  return fail("FILE_AUTHOR_AUTOMATED");
};

/**
 * Reads one file of a curated repository at a pinned commit:
 * - the repository passes admission (public, not a fork or archived, licence allowed);
 * - the path resolves through verified trees from the pinned commit's root tree, and the blob matches its id;
 * - the licence file at the pin agrees with the repository's licence;
 * - the author is the file's last human author.
 * Repository, commit, licence, and tree reads repeat across files of one pin, and the run's GET reuse
 * answers those repeats without a second request.
 */
export const bindGitHubFile = async (
  options: GitHubFileOptions,
  target: Readonly<{ repository: string; commit: string; path: string }>,
): Promise<CuratedFile> => {
  const git = gitReader(options, target.repository, (check) => fail(`FILE_${check}`));
  if (!/^[0-9a-f]{40}$/u.test(target.commit)) fail("FILE_SHAPE");
  const metadata = admitRepository(await githubGet(options, git.api), target.repository, git.api, git.web, options.profile.licenses);
  const pinned = await git.commit(target.commit);
  const file = await git.resolvePath(pinned.tree, target.path);
  const bytes = await git.blob(file.blob);
  const license = admitLicense(await githubGet(options, `${git.api}/license?ref=${target.commit}`), metadata, target,
    { profileVersion: options.profile.profileVersion, profileHash: options.profileHash }, git.api, git.web);
  const author = await fileAuthor(options, target);
  return Object.freeze({
    repository: target.repository,
    commit: target.commit,
    path: target.path,
    mode: file.mode,
    blob: file.blob,
    bytes,
    rawContentHash: createHash("sha256").update(bytes).digest("hex"),
    licenseName: metadata.licenseName,
    licenseSpdx: metadata.licenseSpdx,
    licenseFileUrl: license.url,
    author,
  });
};
