import { CWE_ID, GHSA_ID, MAINSTREAM_LANGUAGES, type AdvisoryEcosystem } from "../../../packages/artifact/src/index";
import type { DatasetFix } from "./fix-patch";
import { githubGet, type GitReaderOptions } from "./github-git";
import { STACK_EXTENSIONS, type StackLanguage } from "./profile";

/**
 * Reviewed GitHub advisories (#59): one listing page per ecosystem and publication window, and the fix commit an
 * advisory links, read only far enough to tell whether it replaces one line of code. The advisory database is
 * CC-BY 4.0; a round keeps the advisory's id, ecosystem, package, and CWE, never its description or credits.
 */

const fail = (code: string): never => { throw new Error(code); };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const shape = <Value>(value: Value | undefined | false): Value => value === undefined || value === false ? fail("VULNERABLE_ADVISORY_SHAPE") : value;

/** One reviewed advisory as a deck needs it. */
export interface AdvisoryPointer {
  readonly advisory: string;
  /** The ecosystem whose listing named it, and its packages there, in the advisory's order. */
  readonly ecosystem: AdvisoryEcosystem;
  readonly packages: readonly string[];
  readonly cwes: readonly string[];
  /** Every distinct GitHub commit the advisory's references link, `owner/name` as the reference spells it. */
  readonly commits: readonly Readonly<{ repository: string; commit: string }>[];
  readonly withdrawn: boolean;
}

const COMMIT_REFERENCE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/commit\/([0-9a-f]{40})\/?$/u;
const PUBLISHED = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}Z$/u;
/** The most advisories one listing page holds. */
export const ADVISORY_PAGE_SIZE = 100;

export const advisoryListingUrl = (ecosystem: AdvisoryEcosystem, published: string): string =>
  `https://api.github.com/advisories?type=reviewed&ecosystem=${ecosystem}&published=${published}&sort=published&direction=asc&per_page=${ADVISORY_PAGE_SIZE}`;

/**
 * The first page of an ecosystem's reviewed advisories published in one window, oldest first. A page that is not a
 * list of advisories in that window and order, each naming a package in the ecosystem, fails whole.
 */
export const readAdvisories = async (
  options: GitReaderOptions,
  target: Readonly<{ ecosystem: AdvisoryEcosystem; published: string }>,
): Promise<readonly AdvisoryPointer[]> => {
  const [from, to] = target.published.split("..");
  const response = await githubGet(options, advisoryListingUrl(target.ecosystem, target.published));
  const items = shape(Array.isArray(response) && response.length <= ADVISORY_PAGE_SIZE && response);
  let previous = "";
  return Object.freeze(items.map((item: unknown): AdvisoryPointer => {
    const entry = shape(isRecord(item) && item);
    const advisory = shape(typeof entry.ghsa_id === "string" && GHSA_ID.test(entry.ghsa_id) && entry.ghsa_id);
    const published = shape(typeof entry.published_at === "string" && PUBLISHED.exec(entry.published_at)?.[1]);
    shape(entry.type === "reviewed" && entry.url === `https://api.github.com/advisories/${advisory}`
      && entry.html_url === `https://github.com/advisories/${advisory}` && published >= from! && published <= to!
      && (entry.published_at as string) >= previous && (entry.withdrawn_at === null || typeof entry.withdrawn_at === "string"));
    previous = entry.published_at as string;
    const references = shape(Array.isArray(entry.references) && entry.references.every((reference) => typeof reference === "string")
      && entry.references as readonly string[]);
    const packages = shape(Array.isArray(entry.vulnerabilities) && entry.vulnerabilities).flatMap((vulnerability: unknown) => {
      const known = shape(isRecord(vulnerability) && isRecord(vulnerability.package) && vulnerability.package);
      shape(typeof known.ecosystem === "string" && typeof known.name === "string" && known.name.length > 0);
      return known.ecosystem === target.ecosystem ? [known.name as string] : [];
    });
    const cwes = shape(Array.isArray(entry.cwes) && entry.cwes).map((cwe: unknown) =>
      shape(isRecord(cwe) && typeof cwe.cwe_id === "string" && CWE_ID.test(cwe.cwe_id) && cwe.cwe_id));
    const commits = new Map<string, Readonly<{ repository: string; commit: string }>>();
    for (const reference of references) {
      const match = COMMIT_REFERENCE.exec(reference);
      if (match) commits.set(`${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}@${match[3]}`, Object.freeze({ repository: `${match[1]}/${match[2]}`, commit: match[3]! }));
    }
    return Object.freeze({
      advisory, ecosystem: target.ecosystem, packages: Object.freeze(shape(packages.length > 0 && [...new Set(packages)])),
      cwes: Object.freeze([...new Set(cwes)]), commits: Object.freeze([...commits.values()]), withdrawn: entry.withdrawn_at !== null,
    });
  }));
};

/** Test code is not the vulnerable line, and a fix may add or change tests beside it. */
const TEST_PATH = /(?:^|\/)(?:tests?|spec|specs|testing|__tests__|testdata|fixtures?|e2e)(?:\/|$)|(?:^|\/)test_[^/]*\.py$|_test\.(?:py|go|rb)$|(?:Test|Tests|IT)\.(?:java|kt|cs)$|\.(?:test|spec)\.[cm]?[jt]sx?$|_spec\.rb$/u;
/** Notes and manifests a fix may touch beside its code: changelogs, documents, version files, and package manifests. */
const COMPANION_PATH = /\.(?:md|rst|txt|adoc)$|(?:^|\/)(?:changelog|changes|history|news|authors|version)$|(?:^|\/)_*version_*\.(?:py|rb|go|js|ts|rs)$|(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.(?:toml|lock)|go\.(?:mod|sum)|pom\.xml|build\.gradle(?:\.kts)?|gradle\.properties|Gemfile(?:\.lock)?|[^/]+\.gemspec|pyproject\.toml|setup\.cfg|poetry\.lock|Pipfile(?:\.lock)?)$/iu;
/** A version number, such as `7.2.3` or `1.0.0-rc.1`. */
const VERSION = /\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.]+)?/gu;
/** The most files GitHub lists in one commit response; a commit that reaches it may list only some. */
const COMMIT_FILES_MAXIMUM = 300;

/** The language a path's extension names, among the mainstream languages. */
export const advisoryLanguage = (path: string): StackLanguage | undefined =>
  MAINSTREAM_LANGUAGES.find((language) => STACK_EXTENSIONS[language].some((extension) => path.endsWith(extension)));

/** An advisory's fix commit as a round needs it: the repository as GitHub names it, the file's language, and its one line. */
export interface AdvisoryFix {
  readonly repository: string;
  readonly language: StackLanguage;
  readonly fix: DatasetFix;
}

/**
 * Whether an advisory's fix commit replaces one line of code, from the commit alone: it has one parent; every file it
 * changes but one is a test, a note, or a manifest; and that one is a source file of a known language, modified by
 * one line each way, not only in whitespace or a version number. The repository is the name GitHub answers with, so
 * a reference that spells it in another case still binds. The file's contents are checked later, by the fix binder.
 */
export const readAdvisoryFix = async (
  options: GitReaderOptions,
  target: Readonly<{ repository: string; commit: string }>,
): Promise<AdvisoryFix> => {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(target.repository) || !/^[0-9a-f]{40}$/u.test(target.commit)) fail("VULNERABLE_ADVISORY_SHAPE");
  const response = await githubGet(options, `https://api.github.com/repos/${target.repository}/commits/${target.commit}`);
  const commit = isRecord(response) ? response : fail("FIX_COMMIT");
  const named = /^https:\/\/api\.github\.com\/repos\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/commits\/([0-9a-f]{40})$/u.exec(String(commit.url));
  const repository = named?.[1] ?? fail("FIX_COMMIT");
  if (named![2] !== target.commit || commit.sha !== target.commit || repository.toLowerCase() !== target.repository.toLowerCase()
    || commit.html_url !== `https://github.com/${repository}/commit/${target.commit}`) fail("FIX_COMMIT");
  if (!Array.isArray(commit.parents) || commit.parents.length !== 1) fail("VULNERABLE_PARENT");
  const files = (Array.isArray(commit.files) ? commit.files : fail("FIX_COMMIT")).map((file: unknown) => {
    if (!isRecord(file) || typeof file.filename !== "string" || typeof file.status !== "string"
      || !Number.isSafeInteger(file.additions) || !Number.isSafeInteger(file.deletions)) fail("FIX_COMMIT");
    return file as Record<string, unknown> & { filename: string };
  });
  if (files.length >= COMMIT_FILES_MAXIMUM) fail("VULNERABLE_CHANGE");
  const code = files.filter(({ filename }) => !TEST_PATH.test(filename) && !COMPANION_PATH.test(filename));
  const file = code.length === 1 ? code[0]! : fail("VULNERABLE_CHANGE");
  if (file.status !== "modified" || file.additions !== 1 || file.deletions !== 1 || typeof file.patch !== "string") fail("VULNERABLE_CHANGE");
  const language = advisoryLanguage(file.filename) ?? fail("VULNERABLE_LANGUAGE");
  const lines = (file.patch as string).split("\n").filter((line) => !line.startsWith("\\"));
  const removed = lines.filter((line) => line.startsWith("-") && !line.startsWith("--- "));
  const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++ "));
  if (removed.length !== 1 || added.length !== 1) fail("VULNERABLE_CHANGE");
  const buggyLine = removed[0]!.slice(1).replace(/\r$/u, "");
  const fixedLine = added[0]!.slice(1).replace(/\r$/u, "");
  if (buggyLine.trim().length === 0 || fixedLine.trim().length === 0 || buggyLine.trim() === fixedLine.trim()) fail("VULNERABLE_CHANGE");
  if (buggyLine.replace(VERSION, "") === fixedLine.replace(VERSION, "")) fail("VULNERABLE_VERSION");
  return Object.freeze({ repository, language, fix: Object.freeze({ path: file.filename, buggyLine, fixedLine }) });
};
