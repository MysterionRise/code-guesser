import { admitLicense, admitRepository, selectedAuthor } from "./github-admission";
import { gitObject, gitReader, githubGet, type GitReaderOptions } from "./github-git";
import type { GitHubFileOptions } from "./github-files";
import type { DatasetFix } from "./fix-patch";
import type { FixDataset, StackLanguage } from "./profile";

export class GitHubFixError extends Error {
  /** `code` names the check that rejected the fix; the message stays the stable stage code. */
  public constructor(public readonly code: string = "GITHUB_FIX_REJECTED") {
    super("GITHUB_FIX_REJECTED");
    this.name = "GitHubFixError";
  }
}

const fail = (code: string): never => { throw new GitHubFixError(code); };
const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

/** One bug a dataset lists: where its patch is, and where the record of its two commits is. */
export interface DatasetBug {
  readonly dataset: FixDataset["id"];
  readonly project: string;
  /** The dataset's own name for the bug, such as `Lang-26` or `black-3`. */
  readonly bug: string;
  readonly patchBlob: string;
  /** The patch's size as the tree reports it, so a long patch is never read. */
  readonly patchSize: number;
  /** Defects4J's project table, or BugsInPy's `bug.info`, naming the bug's commits. */
  readonly revisionsBlob: string;
}

/**
 * The bugs a dataset lists for its configured projects, from verified trees at the dataset's pin:
 * - Defects4J: each project's `patches/<id>.src.patch`, with the project's `active-bugs.csv`;
 * - BugsInPy: each project's `bugs/<n>/bug_patch.txt`, with that bug's `bug.info`, from one recursive listing.
 */
export const readDatasetBugs = async (options: GitReaderOptions, dataset: FixDataset): Promise<readonly DatasetBug[]> => {
  const git = gitReader(options, dataset.repository, (check) => fail(`FIX_DATASET_${check}`));
  const root = (await git.commit(dataset.commit)).tree;
  const bugs: DatasetBug[] = [];
  const projects = dataset.projects.map(({ name }) => name).sort();
  if (dataset.id === "defects4j") {
    for (const project of projects) {
      const files = await git.entries(root, `framework/projects/${project}`);
      const table = files.find(({ path, type }) => path === "active-bugs.csv" && type === "blob") ?? fail("FIX_DATASET_PATH");
      for (const entry of await git.entries(root, `framework/projects/${project}/patches`)) {
        const id = /^([1-9][0-9]*)\.src\.patch$/u.exec(entry.path)?.[1];
        if (id === undefined || entry.type !== "blob") continue;
        bugs.push(Object.freeze({ dataset: dataset.id, project, bug: `${project}-${id}`, patchBlob: entry.sha,
          patchSize: entry.size ?? fail("FIX_DATASET_TREE"), revisionsBlob: table.sha }));
      }
    }
    return Object.freeze(bugs);
  }
  const directory = (await git.entries(root, "")).find(({ path, type }) => path === "projects" && type === "tree") ?? fail("FIX_DATASET_PATH");
  const listed = await git.recursiveTree(directory.sha);
  const byPath = new Map(listed.map((entry) => [entry.path, entry]));
  for (const entry of listed) {
    const match = /^([^/]+)\/bugs\/([1-9][0-9]*)\/bug_patch\.txt$/u.exec(entry.path);
    if (!match || !projects.includes(match[1]!) || entry.type !== "blob") continue;
    const info = byPath.get(`${match[1]}/bugs/${match[2]}/bug.info`);
    if (!info || info.type !== "blob") continue;
    bugs.push(Object.freeze({ dataset: dataset.id, project: match[1]!, bug: `${match[1]}-${match[2]}`, patchBlob: entry.sha,
      patchSize: entry.size ?? fail("FIX_DATASET_TREE"), revisionsBlob: info.sha }));
  }
  return Object.freeze(bugs);
};

/** One blob of a dataset's repository, checked against its id. */
export const readDatasetBlob = async (options: GitReaderOptions, target: Readonly<{ repository: string; blob: string }>): Promise<Uint8Array> => {
  const git = gitReader(options, target.repository, (check) => fail(`FIX_DATASET_${check}`));
  if (!/^[0-9a-f]{40}$/u.test(target.blob)) fail("FIX_DATASET_SHAPE");
  return git.blob(target.blob);
};

/** A bug a dataset records as fixed by changing one line, with the upstream repository its code comes from. */
export interface FixPointer {
  readonly dataset: FixDataset["id"];
  readonly bug: string;
  readonly repository: string;
  readonly language: StackLanguage;
  readonly fixCommit: string;
  readonly fix: DatasetFix;
}

/** A fix confirmed upstream: the file before it, the line it changed, the licence there, and the fix's author. */
export interface BoundFix extends FixPointer {
  /** The fix commit's parent, whose file the round shows. */
  readonly commit: string;
  readonly buggyBlob: string;
  readonly fixBlob: string;
  readonly bytes: Uint8Array;
  /** The changed line in the file before the fix, counted from one. */
  readonly changedLine: number;
  readonly licenseName: string;
  readonly licenseSpdx: string;
  readonly licenseFileUrl: string;
  readonly author: Readonly<{ name: string; login: string | null }>;
}

const decoder = new TextDecoder("utf-8", { fatal: true });
const linesOf = (bytes: Uint8Array): readonly string[] => {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return fail("FIX_ENCODING");
  }
  return text.split("\n").map((line) => line.replace(/\r$/u, ""));
};

/**
 * Confirms a dataset's one-line fix against the upstream repository:
 * - the repository passes admission (public, not a fork or archived, licence allowed);
 * - the fix commit has one parent, and changes the file by one line each way;
 * - the file at the parent and at the fix matches its blob id, and the two differ in exactly the line the
 *   dataset records. The dataset's own buggy commit may be an older base; the round shows the fix's parent;
 * - the licence at the parent, whose file the round shows, agrees with the repository's;
 * - the fix's author is a person, not an automation account.
 */
export const bindFixCommit = async (options: GitHubFileOptions, pointer: FixPointer): Promise<BoundFix> => {
  const git = gitReader(options, pointer.repository, (check) => fail(`FIX_${check}`));
  if (!/^[0-9a-f]{40}$/u.test(pointer.fixCommit)) fail("FIX_SHAPE");
  const metadata = admitRepository(await githubGet(options, git.api), pointer.repository, git.api, git.web, options.profile.licenses);
  const commit = await git.commit(pointer.fixCommit);
  if (commit.parents.length !== 1) fail("FIX_PARENT");
  const parent = commit.parents[0]!;
  const changed = commit.files.filter((file) => file.filename === pointer.fix.path);
  const file = changed.length === 1 ? changed[0]! : fail("FIX_CHANGE");
  if (file.status !== "modified" || file.additions !== 1 || file.deletions !== 1 || typeof file.sha !== "string"
    || !/^[0-9a-f]{40}$/u.test(file.sha)) fail("FIX_CHANGE");
  const read = async (ref: string): Promise<Readonly<{ blob: string; bytes: Uint8Array }>> => {
    const url = `${git.api}/contents/${encodedPath(pointer.fix.path)}?ref=${ref}`;
    const response = await githubGet(options, url) as Record<string, unknown> | null;
    if (typeof response !== "object" || response === null || Array.isArray(response) || response.type !== "file"
      || response.path !== pointer.fix.path || response.encoding !== "base64" || typeof response.sha !== "string"
      || !/^[0-9a-f]{40}$/u.test(response.sha) || response.url !== url || response.git_url !== `${git.api}/git/blobs/${response.sha}`
      || typeof response.content !== "string" || !Number.isSafeInteger(response.size)) return fail("FIX_CONTENT");
    const encoded = response.content.replace(/\s/gu, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) fail("FIX_CONTENT");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.byteLength !== response.size || gitObject("blob", bytes) !== response.sha) fail("FIX_CONTENT");
    return Object.freeze({ blob: response.sha, bytes });
  };
  const fixed = await read(pointer.fixCommit);
  if (fixed.blob !== file.sha) fail("FIX_CONTENT");
  const buggy = await read(parent);
  const before = linesOf(buggy.bytes);
  const after = linesOf(fixed.bytes);
  const differing = before.flatMap((line, index) => line === after[index] ? [] : [index]);
  if (before.length !== after.length || differing.length !== 1
    || before[differing[0]!] !== pointer.fix.buggyLine || after[differing[0]!] !== pointer.fix.fixedLine) fail("FIX_DIFF");
  const license = admitLicense(await githubGet(options, `${git.api}/license?ref=${parent}`), metadata,
    { repository: pointer.repository, commit: parent },
    { profileVersion: options.profile.profileVersion, profileHash: options.profileHash }, git.api, git.web);
  const author = selectedAuthor(await githubGet(options, `${git.api}/commits/${pointer.fixCommit}`), pointer.fixCommit, git.api, git.web);
  if (/\[bot\]$/iu.test(author.name) || (author.login !== null && /\[bot\]$/iu.test(author.login))) fail("FIX_AUTHOR_AUTOMATED");
  return Object.freeze({
    ...pointer, commit: parent, buggyBlob: buggy.blob, fixBlob: fixed.blob, bytes: buggy.bytes, changedLine: differing[0]! + 1,
    licenseName: metadata.licenseName, licenseSpdx: metadata.licenseSpdx, licenseFileUrl: license.url, author,
  });
};
