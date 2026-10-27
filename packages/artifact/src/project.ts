import { profileAtLeast, type ProfileVersion } from "./domain";

/**
 * "Which project?": how a pane may name or echo a repository. These rules are shared by the selector, the generator,
 * and the parser.
 */

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
/** Case-insensitive whole-word owner, name, or `owner/name`. */
export const mentionsRepository = (haystack: string, repository: string): boolean => {
  const [owner, name] = repository.split("/") as [string, string];
  return [repository, owner, name].some((value) =>
    new RegExp(`(^|[^A-Za-z0-9_])${escape(value)}([^A-Za-z0-9_]|$)`, "iu").test(haystack));
};

const folded = (value: string): string => value.toLocaleLowerCase("en-US").replace(/[-_.]/gu, "");
/** Parts of a repository name too common to give a project away: languages and words many names share. */
const COMMON_NAME_PARTS: ReadonlySet<string> = new Set([
  "python", "ruby", "java", "javascript", "typescript", "golang", "rust", "kotlin", "swift", "csharp", "android",
  "core", "docs", "tools", "utils", "examples", "example", "framework", "project", "projects", "server", "client",
  "library", "plugin", "plugins", "awesome", "sample", "samples", "official",
]);
/**
 * Whether code names a repository: its owner, name, or `owner/name` as a whole word; an owner or name of four
 * characters or more anywhere inside an identifier, so `deno_exe` names deno and `rustlings_run` names
 * rustlings; or a distinctive part of a hyphenated name, so `module GraphQL` names graphql-ruby. Short names
 * such as `go`, and common parts such as `ruby`, count only as whole names.
 */
export const namesRepository = (text: string, repository: string): boolean => {
  if (mentionsRepository(text, repository)) return true;
  const haystack = folded(text);
  const names = repository.split("/");
  const parts = names.flatMap((name) => name.toLocaleLowerCase("en-US").split(/[-_.]/u))
    .filter((part) => part.length >= 4 && !COMMON_NAME_PARTS.has(part));
  return names.map(folded).some((name) => name.length >= 4 && haystack.includes(name)) || parts.some((part) => haystack.includes(part));
};

/** Words too common in code and prose to tie a pane to an option. */
const COMMON_WORDS: ReadonlySet<string> = new Set(("the and for with that this from are was were not but you your all any can has have had its "
  + "into out use used one two get set new return returns true false null none nil self var let val const def func fun function class "
  + "struct public private static final void int string bool boolean else elif then end import package module type types err error "
  + "value values data list dict map key keys item items name names file files code index len length test tests our more most some "
  + "only also each when what which who will would should could may might must than them they their there these those here how why "
  + "make made just like about over under after before onto via per").split(" "));
/**
 * A text's distinctive words, each cut to its first five letters: words split at case changes and at anything but
 * letters and digits, of three characters or more, common words and bare numbers aside. `Aws::SQS` gives `aws` and
 * `sqs`; "A utility-first CSS framework" gives `utili`, `first`, `css`, and `frame`. With `whole` (v7, #200), a word
 * split at a case change counts whole too: `GitHub` gives `git`, `hub`, and `githu`, so it meets an upper-case
 * `GITHUB`, which no case change splits.
 */
export const wordStems = (text: string, whole = false): ReadonlySet<string> => new Set([
  ...text.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2").toLocaleLowerCase("en-US").split(/[^a-z0-9]+/u),
  ...whole ? text.toLocaleLowerCase("en-US").split(/[^a-z0-9]+/u) : [],
].filter((word) => word.length >= 3 && !COMMON_WORDS.has(word) && !/^\d+$/u.test(word)).map((word) => word.slice(0, 5)));
/** Scripts other than Latin that code or a description may be written in (#200). */
const SCRIPTS: readonly (readonly [string, RegExp])[] = Object.freeze(["Arabic", "Armenian", "Bengali", "Cyrillic", "Devanagari",
  "Georgian", "Greek", "Han", "Hangul", "Hebrew", "Hiragana", "Katakana", "Thai"]
  .map((script) => [script, new RegExp(`\\p{Script=${script}}`, "u")] as const));
/** The scripts other than Latin a text has letters of: "管理后台" has Han. */
export const scriptsShown = (text: string): readonly string[] => SCRIPTS.filter(([, pattern]) => pattern.test(text)).map(([script]) => script);
/**
 * The distinctive words a pane shares with an option as the round shows it, its owner, name, and description (#77):
 * a pane that shares one with an option tells a player who never reads code which option to pick, or which to avoid.
 * From v7 on (#200), a word split at a case change counts whole on both sides too (`wordStems`), and a script other
 * than Latin that the pane and the description both show counts as a shared word (`script:Han`): a pane in Chinese
 * beside the only option described in Chinese points to it.
 */
export const sharedOptionWords = (pane: string, repository: string, detail: string | null, version: ProfileVersion): readonly string[] => {
  const whole = profileAtLeast(version, "local-real-rounds.v7");
  const words = wordStems(pane, whole);
  const shared = [...wordStems(`${repository.replace("/", " ")} ${detail ?? ""}`, whole)].filter((word) => words.has(word));
  if (!whole) return shared;
  const scripts = scriptsShown(detail ?? "");
  return [...shared, ...scriptsShown(pane).filter((script) => scripts.includes(script)).map((script) => `script:${script}`)];
};
