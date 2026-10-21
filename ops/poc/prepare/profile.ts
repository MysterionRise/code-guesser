import { CAPACITY_CEILINGS, STACK_RELEASE, STACK_REVISION, type CeilingKey } from "../limits";
import {
  ADVISORY_ECOSYSTEMS, AUTHORSHIP_CLAIM, CWE_ID, MAINSTREAM_LANGUAGES, MAXIMUM_POOL_SIZE, PROFILE_VERSION, PROFILE_VERSIONS, ROUNDS_PER_LANGUAGE,
  STACK_LANGUAGES, isLanguageSelection, profileAtLeast, spellsFramework, copyNamesExercise, type AdvisoryEcosystem, type DeckId, type ProfileVersion,
  type StackLanguage,
} from "../../../packages/artifact/src/index";
import { isKnownFramework } from "./framework-markers";

/** The hard ceilings from `ops/poc/limits.json`; a profile may lower any of them, never raise one. */
export { CAPACITY_CEILINGS, MAINSTREAM_LANGUAGES, PROFILE_VERSION, STACK_LANGUAGES, type StackLanguage };

export type CapacityLimits = Readonly<Record<CeilingKey, number>>;

export interface ProfileQuery {
  readonly id: string;
  readonly query: string;
  readonly sort: "committer-date";
  readonly order: "desc";
}

/** Each language's exact file extensions. C keeps to `.c` because a `.h` header may be C or C++. */
export const STACK_EXTENSIONS: Readonly<Record<StackLanguage, readonly string[]>> = Object.freeze({
  Python: [".py"], Ruby: [".rb"], TypeScript: [".ts", ".tsx"], JavaScript: [".js"], Go: [".go"], Rust: [".rs"],
  Java: [".java"], "C#": [".cs"], Kotlin: [".kt"], Swift: [".swift"], C: [".c"], "C++": [".cpp", ".cc", ".cxx", ".hpp"],
  // Prolog keeps to `.pl` and `.pro` as The Stack v2 classifies them; a Perl `.pl` file is Perl's, never read here.
  Haskell: [".hs"], Elm: [".elm"], OCaml: [".ml"], "F#": [".fs"], Erlang: [".erl"], Prolog: [".pl", ".pro"],
  Clojure: [".clj", ".cljc"], Racket: [".rkt"], Julia: [".jl"], MATLAB: [".m"], Ada: [".adb"], Pascal: [".pas", ".pp"],
  Elixir: [".ex", ".exs"], Crystal: [".cr"],
});

export interface CrawlProfile {
  readonly profileVersion: ProfileVersion;
  /** Commit searches that feed the before-or-after deck. */
  readonly github: Readonly<{ apiVersion: "2022-11-28"; queries: readonly ProfileQuery[] }>;
  readonly stack: Readonly<{
    release: string;
    revision: string;
    configurations: readonly Readonly<{
      language: StackLanguage;
      configuration: StackLanguage;
      extensions: readonly string[];
      /** Present, and false, for a language read for the language deck alone (#129): its popular repositories are
       * mostly other languages' projects with a few of its files, so no project round could fairly ask about them. */
      projectDeck?: false;
    }>[];
  }>;
  readonly licenses: readonly string[];
  readonly templates: Readonly<{
    project: Readonly<{
      title: string; description: string; prompt: string; fileClue: string; popularityClue: string;
      evidence: string; explanation: string;
    }>;
    language: Readonly<{
      title: string; description: string; prompt: string; syntaxClue: string; evidence: string; explanation: string;
    }>;
    beforeAfter: Readonly<{
      title: string; description: string; prompt: string; laterA: string; laterB: string;
      subjectClue: string; linesClue: string; evidence: string; explanation: string;
    }>;
  }>;
  readonly deduplication: readonly ["repository", "commit", "path", "blob", "rawContentHash", "excerptHash"];
  readonly capacity: CapacityLimits;
  readonly screening: Readonly<{
    excerptLines: number; excerptBytes: number; minimumExcerptBytes: number; generatedScanLines: number;
    subjectMaxLength: number; changeWindowLines: number; changeContextLines: number; maxChangedLines: number;
  }>;
  readonly selection: Readonly<{
    /** Rounds in the before-or-after pool; the Stack decks hold two rounds per language unless set below. */
    beforeAfterPool: number;
    /**
     * From v7 on (#167), the project deck's rounds per language, in groups of two answers and two decoys (2 or 4);
     * present only when set, and two when not.
     */
    projectRoundsPerLanguage?: number;
    /** A project round's repositories, answer and distractors, all have at least this many star events. */
    minimumStarEvents: number;
    /** What the metadata worker returns per language: the most-starred repositories, a few files of each, */
    popularRepositories: number;
    filesPerRepository: number;
    /** and one file from each of this many other repositories, for the language deck. */
    ordinaryRows: number;
  }>;
  /** Curated repositories at pinned commits, and the decks built from them; absent when the run reads none. */
  readonly curated?: CuratedProfile;
}

/**
 * A licence a curated pin declares for a repository whose licence file GitHub names no licence for, such as the MIT
 * text under a line on its scope (tastejs/todomvc's "MIT License unless otherwise specified"). The profile declares
 * it after reading the file, and pins the file by path and blob.
 */
export interface DeclaredLicense {
  readonly spdx: string;
  readonly path: string;
  readonly blob: string;
}

/** The names GitHub gives the licences a pin may declare. */
export const DECLARABLE_LICENSES: Readonly<Record<string, string>> = Object.freeze({ MIT: "MIT License" });

/** A repository read at one pinned commit, in one language. */
export interface CuratedRepository {
  readonly repository: string;
  readonly commit: string;
  readonly language: StackLanguage;
  /** The licence of a repository whose licence file GitHub names none for, declared after reading it, its file pinned. */
  readonly license?: DeclaredLicense;
}
/** One file that shows an algorithm, and any identifiers in it that name the algorithm too briefly to match by name. */
export interface AlgorithmFile {
  readonly path: string;
  readonly symbols: readonly string[];
}
export interface AlgorithmEntry {
  readonly id: string;
  readonly label: string;
  /** Distinctive spellings code uses for it (`quick_sort`, `dijkstra`); any of them in a round's code names it. */
  readonly names: readonly string[];
  /** The first hint: how it works, naming no algorithm. */
  readonly idea: string;
  /** The second hint: its cost. */
  readonly complexity: string;
  readonly files: Readonly<Record<string, AlgorithmFile>>;
}
/** Four algorithms offered together; each family's rounds answer each of them once, or from v7 on equally often. */
export interface AlgorithmFamily {
  readonly id: string;
  /** What the reveal says the family shares, so the wrong options were tempting. */
  readonly note: string;
  readonly algorithms: readonly AlgorithmEntry[];
}
/** The output deck: functions of one Python repository whose doctests record what a call returns. */
export interface OutputDeck {
  readonly rounds: number;
  readonly repository: string;
  /** Top-level directories whose files are read, in an order fixed by hash. */
  readonly directories: readonly string[];
  /** At most this many files are read; most hold no function a round can ask about. */
  readonly fileReads: number;
  readonly templates: Readonly<{ title: string; description: string; prompt: string; evidence: string; explanation: string }>;
}
/** A bug dataset at a pinned commit, and the upstream repository and language of each of its projects it may use. */
export interface FixDataset {
  readonly id: "defects4j" | "bugsinpy";
  readonly repository: string;
  readonly commit: string;
  /** A list, not a map: a project's name is data, and a name such as `cookiecutter` is no credential-shaped key. */
  readonly projects: readonly Readonly<{ name: string; repository: string; language: StackLanguage }>[];
}
/** The fix deck: one-line fixes two bug datasets record, read from their upstream repositories. */
export interface FixDeck {
  readonly rounds: number;
  readonly datasets: readonly FixDataset[];
  /** At most this many dataset patches are read; most fix more than one line. */
  readonly patchReads: number;
  /** At most this many rounds come from one upstream repository. */
  readonly perRepository: number;
  readonly templates: Readonly<{ title: string; description: string; prompt: string; evidence: string; explanation: string }>;
}
/** "Missing line" (#57): windows of a curated repository's files with one line hidden. */
export interface MissingLineDeck {
  readonly rounds: number;
  readonly repository: string;
  /** Top-level directories whose files are read, in an order fixed by hash. */
  readonly directories: readonly string[];
  /** At most this many files are read. */
  readonly fileReads: number;
  /** Lines a pane shows, the gap among them. */
  readonly windowLines: number;
  readonly templates: Readonly<{ title: string; description: string; prompt: string; evidence: string; explanation: string }>;
}
/** "Name the function" (#73): functions of curated repositories' files, each name masked. */
export interface NameFunctionDeck {
  readonly rounds: number;
  /** Each repository's directories (nested paths allowed) whose files are read, all in one order fixed by hash. */
  readonly sources: readonly Readonly<{ repository: string; directories: readonly string[] }>[];
  /** At most this many files are read, across all sources. */
  readonly fileReads: number;
  /** The most lines a function a round shows may span, its declaration and closing line included. */
  readonly functionLines: number;
  readonly templates: Readonly<{ title: string; description: string; prompt: string; evidence: string; explanation: string }>;
}
/** One framework of "Which framework?" (#62): its TodoMVC examples, and the files a round may show. */
export interface FrameworkEntry {
  /** One of `FRAMEWORK_MARKERS`' frameworks. */
  readonly id: string;
  readonly label: string;
  /** Spellings code may name it by (`React`, `glimmer`), matched across an identifier's words and masked in every round. */
  readonly names: readonly string[];
  /** Identifiers that name it only when whole (`can`), masked in every round. */
  readonly symbols: readonly string[];
  /** The first hint: how it builds a page, naming no framework. */
  readonly idea: string;
  /** Its examples' directories, each checked for a licence of its own. */
  readonly examples: readonly string[];
  /** Files a round may show, in the order they are tried; its rounds show different files. */
  readonly files: readonly string[];
}
/** Four frameworks offered together; each family's rounds answer each of them equally often. */
export interface FrameworkFamily {
  readonly id: string;
  /** What the reveal says the family shares, so the wrong options were tempting. */
  readonly note: string;
  readonly frameworks: readonly FrameworkEntry[];
}
/** "Which framework?" (#62): windows of one repository's examples of the same app, each in a different framework. */
export interface FrameworkDeck {
  readonly rounds: number;
  readonly repository: string;
  /** Rounds each framework of a published family answers, each from a different file. */
  readonly roundsPerFramework: number;
  /** The most lines a pane shows. */
  readonly windowLines: number;
  readonly families: readonly FrameworkFamily[];
  readonly templates: Readonly<{ title: string; description: string; prompt: string; evidence: string; explanation: string }>;
}
/** Options per framework round: one whole family. */
export const FRAMEWORK_FAMILY_SIZE = 4;
/** One exercise of "Which exercise?" (#58), found by its directory in every track. */
export interface ExerciseEntry {
  /** Its directory's name in every track, `exercises/practice/<id>`. */
  readonly id: string;
  readonly label: string;
  /** Spellings code may name it by (`isogram`, `twofer`), matched across an identifier's words and masked. */
  readonly names: readonly string[];
  /** Identifiers that name it only when whole, masked. */
  readonly symbols: readonly string[];
  /** The first hint: what the exercise asks for, naming no exercise of its family. */
  readonly idea: string;
  /** The second hint: what a solution takes and gives back, naming none either. */
  readonly detail: string;
}
/** Four exercises offered together; each family's rounds answer each of them equally often. */
export interface ExerciseFamily {
  readonly id: string;
  /** What the reveal says the family shares, so the wrong options were tempting. */
  readonly note: string;
  readonly exercises: readonly ExerciseEntry[];
}
/** "Which exercise?" (#58): reference solutions to Exercism practice exercises, from several tracks. */
export interface ExerciseDeck {
  readonly rounds: number;
  /** Rounds each exercise of a published family answers, each from a different track. */
  readonly roundsPerExercise: number;
  /** Each track's repository, a curated pin, and where its reference solution to `{slug}` sits. */
  readonly tracks: readonly Readonly<{ repository: string; solution: string }>[];
  readonly families: readonly ExerciseFamily[];
  readonly templates: Readonly<{ title: string; description: string; prompt: string; evidence: string; explanation: string }>;
}
/** Options per exercise round: one whole family. */
export const EXERCISE_FAMILY_SIZE = 4;
/**
 * "Spot the vulnerable line" (#59): one-line fixes that reviewed GitHub advisories link, one round per repository.
 * Each ecosystem's advisories are listed once per `published` window, the first page of 100 in publication order, so
 * the listing needs no cursor and reads the same at any time but for withdrawn or amended advisories.
 */
export interface VulnerableLineDeck {
  readonly rounds: number;
  readonly ecosystems: readonly AdvisoryEcosystem[];
  /** Publication windows, `YYYY-MM-DD..YYYY-MM-DD`, in order and apart. */
  readonly published: readonly string[];
  /** At most this many fix commits are read; most change more than one line. */
  readonly commitReads: number;
  /** The CWEs a round may name, in id order, each with its hint's plain words. */
  readonly cwes: readonly Readonly<{ id: string; hint: string }>[];
  readonly templates: Readonly<{ title: string; description: string; prompt: string; evidence: string; explanation: string }>;
}
/** The most fix commits a vulnerable-line deck may read. */
export const VULNERABLE_COMMIT_READS_MAXIMUM = 600;

/** The languages whose functions "Name the function" can find. */
export const NAME_FUNCTION_LANGUAGES: readonly StackLanguage[] = Object.freeze(["Java", "Go", "Python"]);
export interface CuratedProfile {
  readonly repositories: readonly CuratedRepository[];
  readonly algorithm?: Readonly<{
    rounds: number;
    /** From v7 on (#167), how often each algorithm of a published family is the answer, each time from another
     * language (1 or 2); present only when set, and once when not. */
    roundsPerAlgorithm?: number;
    templates: Readonly<{ title: string; description: string; prompt: string; evidence: string; explanation: string }>;
    families: readonly AlgorithmFamily[];
  }>;
  readonly output?: OutputDeck;
  readonly fix?: FixDeck;
  readonly "missing-line"?: MissingLineDeck;
  readonly "name-function"?: NameFunctionDeck;
  readonly framework?: FrameworkDeck;
  readonly exercise?: ExerciseDeck;
  readonly "vulnerable-line"?: VulnerableLineDeck;
}

/** Options per algorithm round: one whole family. */
export const ALGORITHM_FAMILY_SIZE = 4;
/** Options per output round; the answer's rank among them cycles through all four across the pool. */
export const OUTPUT_OPTIONS = 4;
/** Options per fix round; the answer's rank among them cycles through all four across the pool. */
export const FIX_OPTIONS = 4;
/** The datasets a fix deck can read, each with the direction its patches run in. */
export const FIX_DATASETS = Object.freeze(["defects4j", "bugsinpy"] as const);

/** What a profile version lets its curated decks ask for. */
export interface CuratedCaps {
  /** The most rounds an algorithm, output, fix, or vulnerable-line deck may hold; the other curated decks hold up to a pool. */
  readonly rounds: number;
  /** The most files an output, missing-line, or name-function deck may read, and the most patches a fix deck may. */
  readonly reads: number;
}
const CAPS_TO_V6: CuratedCaps = Object.freeze({ rounds: 40, reads: 240 });
/** Through v6 the caps of the v1.0 run; from v7 on (#167) every curated deck may fill a whole pool and read twice as far. */
export const CURATED_CAPS: Readonly<Record<ProfileVersion, CuratedCaps>> = Object.freeze({
  "local-real-rounds.v5": CAPS_TO_V6,
  "local-real-rounds.v6": CAPS_TO_V6,
  "local-real-rounds.v7": Object.freeze({ rounds: MAXIMUM_POOL_SIZE, reads: 480 }),
});

/** The configured languages the project deck reads: all but those marked for the language deck alone. */
export const projectLanguages = (profile: CrawlProfile): readonly StackLanguage[] =>
  profile.stack.configurations.filter(({ projectDeck }) => projectDeck !== false).map(({ language }) => language);

/** The answers in a group of project rounds: two, beside two decoys, so the group's rounds offer the same four repositories. */
export const PROJECT_GROUP_ANSWERS = 2;
/** The project deck's rounds per language: two, one group, unless a v7 profile sets more (#167). */
export const projectRoundsPerLanguage = (profile: CrawlProfile): number =>
  profile.selection.projectRoundsPerLanguage ?? ROUNDS_PER_LANGUAGE;

/** Rounds in each deck's pool; a session deals five of them. A deck the profile does not configure holds none. */
export const poolSizes = (profile: CrawlProfile): Readonly<Record<DeckId, number>> => Object.freeze({
  project: projectRoundsPerLanguage(profile) * projectLanguages(profile).length,
  language: ROUNDS_PER_LANGUAGE * profile.stack.configurations.length,
  "before-after": profile.selection.beforeAfterPool,
  algorithm: profile.curated?.algorithm?.rounds ?? 0,
  output: profile.curated?.output?.rounds ?? 0,
  fix: profile.curated?.fix?.rounds ?? 0,
  "missing-line": profile.curated?.["missing-line"]?.rounds ?? 0,
  "name-function": profile.curated?.["name-function"]?.rounds ?? 0,
  framework: profile.curated?.framework?.rounds ?? 0,
  exercise: profile.curated?.exercise?.rounds ?? 0,
  "vulnerable-line": profile.curated?.["vulnerable-line"]?.rounds ?? 0,
});

export class CrawlProfileError extends Error {
  public constructor() {
    super("CRAWL_PROFILE_REJECTED");
    this.name = "CrawlProfileError";
  }
}

type UnknownRecord = Record<string, unknown>;
const fail = (): never => { throw new CrawlProfileError(); };
const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactRecord = (value: unknown, keys: readonly string[]): UnknownRecord => {
  if (!isRecord(value)) return fail();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail();
  return value;
};

const deepFreeze = <T>(value: T, seen = new Set<object>()): T => {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
};

const text = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) return fail();
  return value;
};

const integer = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) return fail();
  return value as number;
};

/** A profile holds no credential, address, or credential-shaped key. */
const scanForbidden = (value: unknown, seen = new Set<object>()): void => {
  if (typeof value === "string") {
    if (/https?:\/\//iu.test(value)) fail();
    if (/(?:authorization|cookie|credential|password|secret|token|aws[_-]?(?:access[_-]?key|secret[_-]?access[_-]?key|session[_-]?token))\s*(?::|=)\s*\S+/iu.test(value)) fail();
    if (/\bbearer\s+[a-z0-9._~+\/-]{4,}/iu.test(value)) fail();
  }
  if (!isRecord(value) && !Array.isArray(value)) return;
  if (seen.has(value as object)) fail();
  seen.add(value as object);
  for (const [key, nested] of Object.entries(value as UnknownRecord)) {
    if (/(?:credential|password|secret|token|authorization|cookie|url|endpoint)/iu.test(key)) fail();
    scanForbidden(nested, seen);
  }
  seen.delete(value as object);
};

const exactTexts = <Values extends readonly string[]>(value: unknown, expected: Values): Values => {
  if (!Array.isArray(value) || value.length !== expected.length) return fail();
  if (value.some((entry, index) => entry !== expected[index])) fail();
  return Object.freeze([...expected]) as unknown as Values;
};

const uniqueTexts = (value: unknown): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0) return fail();
  const values = value.map(text);
  if (new Set(values).size !== values.length) fail();
  return Object.freeze(values);
};

/** Whole-word, case-sensitive mention of a label (labels are proper names such as Go or Ruby). */
export const mentionsLabel = (haystack: string, label: string): boolean => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_+#])${escaped}([^A-Za-z0-9_+#]|$)`, "u").test(haystack);
};

/** A file extension token such as `.py`, not followed by another word character. */
export const mentionsExtension = (haystack: string, extension: string): boolean => {
  const escaped = extension.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`${escaped}(?![A-Za-z0-9_])`, "iu").test(haystack);
};

/** A template must contain each listed placeholder exactly once and no other placeholder. */
const placeholderText = (value: unknown, placeholders: readonly string[]): string => {
  const parsed = text(value);
  const found = [...parsed.matchAll(/\{([a-z]+)\}/gu)].map((match) => match[1]!);
  if (found.length !== placeholders.length || placeholders.some((name) => found.filter((item) => item === name).length !== 1)) fail();
  return parsed;
};


const parseQueries = (value: unknown): readonly ProfileQuery[] => {
  if (!Array.isArray(value) || value.length === 0) return fail();
  const queries = value.map((entry) => {
    const item = exactRecord(entry, ["id", "query", "sort", "order"]);
    if (!/^[a-z0-9-]+$/u.test(text(item.id)) || item.sort !== "committer-date" || item.order !== "desc") fail();
    return Object.freeze({ id: item.id as string, query: text(item.query), sort: "committer-date" as const, order: "desc" as const });
  });
  if (new Set(queries.map(({ id }) => id)).size !== queries.length || new Set(queries.map(({ query }) => query)).size !== queries.length) fail();
  return Object.freeze(queries);
};

/**
 * The languages a run reads: whole look-alike pairs in `STACK_LANGUAGES` order. A language marked
 * `"projectDeck": false` feeds the language deck alone; the key appears only when set, so a profile without it
 * parses (and hashes) as before.
 */
const parseConfigurations = (value: unknown): CrawlProfile["stack"]["configurations"] => {
  if (!Array.isArray(value)) return fail();
  const configurations = value.map((entry) => {
    const languageOnly = isRecord(entry) && Object.hasOwn(entry, "projectDeck");
    const item = exactRecord(entry, languageOnly ? ["language", "extensions", "projectDeck"] : ["language", "extensions"]);
    if (!(STACK_LANGUAGES as readonly unknown[]).includes(item.language) || (languageOnly && item.projectDeck !== false)) fail();
    const language = item.language as StackLanguage;
    return Object.freeze({ language, configuration: language, extensions: exactTexts(item.extensions, STACK_EXTENSIONS[language]),
      ...(languageOnly ? { projectDeck: false as const } : {}) });
  });
  if (!isLanguageSelection(configurations.map(({ language }) => language))) fail();
  // The project deck needs at least one language, and its options are whole repositories, not pairs.
  if (!configurations.some(({ projectDeck }) => projectDeck !== false)) fail();
  return Object.freeze(configurations);
};

const parseCapacity = (value: unknown): CapacityLimits => {
  const keys = Object.keys(CAPACITY_CEILINGS) as (keyof CapacityLimits)[];
  const item = exactRecord(value, keys);
  return Object.freeze(Object.fromEntries(keys.map((key) => {
    const parsed = integer(item[key]);
    if (parsed > CAPACITY_CEILINGS[key]) fail();
    return [key, parsed];
  })) as Record<keyof CapacityLimits, number>);
};

const parseTemplates = (value: unknown): CrawlProfile["templates"] => {
  const templates = exactRecord(value, ["project", "language", "beforeAfter"]);
  const project = exactRecord(templates.project, [
    "title", "description", "prompt", "fileClue", "popularityClue", "evidence", "explanation",
  ]);
  const language = exactRecord(templates.language, [
    "title", "description", "prompt", "syntaxClue", "evidence", "explanation",
  ]);
  const beforeAfter = exactRecord(templates.beforeAfter, [
    "title", "description", "prompt", "laterA", "laterB", "subjectClue", "linesClue", "evidence", "explanation",
  ]);
  const parsed = Object.freeze({
    project: Object.freeze({
      title: text(project.title), description: text(project.description), prompt: placeholderText(project.prompt, []),
      fileClue: placeholderText(project.fileClue, ["file"]), popularityClue: placeholderText(project.popularityClue, ["stars"]),
      evidence: placeholderText(project.evidence, ["path", "repository"]), explanation: placeholderText(project.explanation, []),
    }),
    language: Object.freeze({
      title: text(language.title), description: text(language.description), prompt: placeholderText(language.prompt, []),
      syntaxClue: placeholderText(language.syntaxClue, ["syntax"]),
      evidence: placeholderText(language.evidence, ["path", "language"]), explanation: placeholderText(language.explanation, []),
    }),
    beforeAfter: Object.freeze({
      title: text(beforeAfter.title), description: text(beforeAfter.description), prompt: placeholderText(beforeAfter.prompt, []),
      laterA: placeholderText(beforeAfter.laterA, []), laterB: placeholderText(beforeAfter.laterB, []),
      subjectClue: placeholderText(beforeAfter.subjectClue, ["subject"]),
      linesClue: placeholderText(beforeAfter.linesClue, ["removed", "added"]),
      evidence: placeholderText(beforeAfter.evidence, ["commit", "earlier", "later"]),
      explanation: placeholderText(beforeAfter.explanation, []),
    }),
  });
  const copy = [parsed.project, parsed.language, parsed.beforeAfter].flatMap((template) => Object.values(template));
  if (copy.some((value) => AUTHORSHIP_CLAIM.test(value))) fail();
  return parsed;
};

const parseScreening = (value: unknown): CrawlProfile["screening"] => {
  const screening = exactRecord(value, [
    "excerptLines", "excerptBytes", "minimumExcerptBytes", "generatedScanLines", "subjectMaxLength",
    "changeWindowLines", "changeContextLines", "maxChangedLines",
  ]);
  const parsed = Object.fromEntries(Object.entries(screening).map(([key, entry]) => [key, integer(entry)])) as CrawlProfile["screening"];
  if (parsed.minimumExcerptBytes >= parsed.excerptBytes || parsed.maxChangedLines >= parsed.changeWindowLines) fail();
  return Object.freeze(parsed);
};

/** The metadata worker's own bounds on what one language may return. */
export const SAMPLE_MAXIMA = Object.freeze({ popularRepositories: 100, filesPerRepository: 10, ordinaryRows: 1000 });

/**
 * Whether a section sets a key that only `minimum` and later profiles may carry. The key appears only when set, so an
 * earlier profile parses (and hashes) as before, and an earlier profile that sets it is refused.
 */
const laterKey = (value: unknown, key: string, version: ProfileVersion, minimum: ProfileVersion): boolean => {
  const set = isRecord(value) && Object.hasOwn(value, key);
  if (set && !profileAtLeast(version, minimum)) fail();
  return set;
};

const parseSelection = (value: unknown, version: ProfileVersion): CrawlProfile["selection"] => {
  // From v7 on (#167) the project deck may hold more rounds per language, in whole groups.
  const grouped = laterKey(value, "projectRoundsPerLanguage", version, "local-real-rounds.v7");
  const selection = exactRecord(value, ["beforeAfterPool", "minimumStarEvents", "popularRepositories", "filesPerRepository", "ordinaryRows",
    ...(grouped ? ["projectRoundsPerLanguage"] : [])]);
  const parsed = Object.fromEntries(Object.entries(selection).map(([key, entry]) => [key, integer(entry)])) as CrawlProfile["selection"];
  if (grouped && ![PROJECT_GROUP_ANSWERS, 2 * PROJECT_GROUP_ANSWERS].includes(parsed.projectRoundsPerLanguage!)) fail();
  // A pool holds at least one five-round session and at most forty rounds.
  if (parsed.beforeAfterPool < 5 || parsed.beforeAfterPool > 40) fail();
  if (parsed.popularRepositories > SAMPLE_MAXIMA.popularRepositories || parsed.filesPerRepository > SAMPLE_MAXIMA.filesPerRepository
    || parsed.ordinaryRows > SAMPLE_MAXIMA.ordinaryRows) fail();
  return Object.freeze(parsed);
};

const REPOSITORY_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const ALGORITHM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const foldName = (value: string): string => value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, "");

const SAFE_PATH = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u;
const safePath = (value: unknown): string => {
  const path = text(value);
  return SAFE_PATH.test(path) && !path.split("/").some((part) => part === "." || part === "..") ? path : fail();
};

/** A pin's declared licence: one GitHub can name, and the licence file's path and blob. */
const parseDeclaredLicense = (value: unknown): DeclaredLicense => {
  const license = exactRecord(value, ["spdx", "path", "blob"]);
  const spdx = text(license.spdx);
  if (!Object.hasOwn(DECLARABLE_LICENSES, spdx) || !/^[0-9a-f]{40}$/u.test(text(license.blob))) fail();
  return Object.freeze({ spdx, path: safePath(license.path), blob: license.blob as string });
};

const parseCuratedRepositories = (value: unknown): readonly CuratedRepository[] => {
  if (!Array.isArray(value) || value.length === 0) return fail();
  const repositories = value.map((entry) => {
    // A pin declares a licence only when it needs one; one without hashes exactly as before.
    const declared = isRecord(entry) && Object.hasOwn(entry, "license");
    const item = exactRecord(entry, ["repository", "commit", "language", ...(declared ? ["license"] : [])]);
    const repository = text(item.repository);
    const commit = text(item.commit);
    if (!REPOSITORY_NAME.test(repository) || !/^[0-9a-f]{40}$/u.test(commit)
      || !(STACK_LANGUAGES as readonly unknown[]).includes(item.language)) fail();
    return Object.freeze({ repository, commit, language: item.language as StackLanguage,
      ...(declared ? { license: parseDeclaredLicense(item.license) } : {}) });
  });
  if (new Set(repositories.map(({ repository }) => repository)).size !== repositories.length) fail();
  return Object.freeze(repositories);
};

const parseAlgorithmEntry = (value: unknown, repositories: ReadonlySet<string>): AlgorithmEntry => {
  const item = exactRecord(value, ["id", "label", "names", "idea", "complexity", "files"]);
  const id = text(item.id);
  if (!ALGORITHM_ID.test(id)) fail();
  const filesValue = isRecord(item.files) ? item.files : fail();
  const files = Object.fromEntries(Object.entries(filesValue).map(([repository, file]) => {
    if (!repositories.has(repository)) fail();
    const entry = exactRecord(file, ["path", "symbols"]);
    const path = text(entry.path);
    if (path.startsWith("/") || path.split("/").some((part) => part === "" || part === "." || part === "..")) fail();
    const symbols = Array.isArray(entry.symbols) ? entry.symbols.map(text) : fail();
    if (symbols.some((symbol) => !IDENTIFIER.test(symbol))) fail();
    return [repository, Object.freeze({ path, symbols: Object.freeze(symbols) })];
  }));
  if (Object.keys(files).length === 0) fail();
  const names = uniqueTexts(item.names);
  if (names.some((name) => foldName(name).length < 3)) fail();
  return Object.freeze({ id, label: text(item.label), names, idea: text(item.idea), complexity: text(item.complexity), files: Object.freeze(files) });
};

/** Hints and notes may not name any algorithm of their family, or they would answer the round. */
const namesAny = (copy: string, algorithms: readonly AlgorithmEntry[]): boolean =>
  algorithms.some(({ label, names }) => [label, ...names].map(foldName).some((name) => foldName(copy).includes(name)));

const parseAlgorithmDeck = (value: unknown, repositories: readonly CuratedRepository[], version: ProfileVersion): NonNullable<CuratedProfile["algorithm"]> => {
  // From v7 on (#167) each algorithm may be the answer twice, from two languages' files.
  const repeated = laterKey(value, "roundsPerAlgorithm", version, "local-real-rounds.v7");
  const algorithm = exactRecord(value, ["rounds", "templates", "families", ...(repeated ? ["roundsPerAlgorithm"] : [])]);
  const rounds = integer(algorithm.rounds);
  const roundsPerAlgorithm = repeated ? integer(algorithm.roundsPerAlgorithm) : 1;
  if (roundsPerAlgorithm > 2 || rounds % (ALGORITHM_FAMILY_SIZE * roundsPerAlgorithm) !== 0 || rounds < 8 || rounds > CURATED_CAPS[version].rounds) fail();
  const templates = exactRecord(algorithm.templates, ["title", "description", "prompt", "evidence", "explanation"]);
  const known = new Set(repositories.map(({ repository }) => repository));
  const languageOf = (repository: string) => repositories.find((pin) => pin.repository === repository)!.language;
  const families = (Array.isArray(algorithm.families) && algorithm.families.length * ALGORITHM_FAMILY_SIZE * roundsPerAlgorithm >= rounds
    ? algorithm.families : fail()).map((entry: unknown) => {
    const family = exactRecord(entry, ["id", "note", "algorithms"]);
    const algorithms = (Array.isArray(family.algorithms) && family.algorithms.length === ALGORITHM_FAMILY_SIZE
      ? family.algorithms : fail()).map((item: unknown) => parseAlgorithmEntry(item, known));
    // Each answer comes from another language, so every algorithm lists files in that many languages.
    if (algorithms.some(({ files }) => new Set(Object.keys(files).map(languageOf)).size < roundsPerAlgorithm)) fail();
    const note = text(family.note);
    if (algorithms.some(({ idea, complexity }) => namesAny(idea, algorithms) || namesAny(complexity, algorithms))) fail();
    if (namesAny(note, algorithms)) fail();
    const id = text(family.id);
    if (!ALGORITHM_ID.test(id)) fail();
    return Object.freeze({ id, note, algorithms: Object.freeze(algorithms) });
  });
  const all = families.flatMap(({ algorithms }) => algorithms);
  if (new Set(families.map(({ id }) => id)).size !== families.length || new Set(all.map(({ id }) => id)).size !== all.length
    || new Set(all.map(({ label }) => label)).size !== all.length) fail();
  return Object.freeze({
    rounds,
    ...(repeated ? { roundsPerAlgorithm } : {}),
    templates: Object.freeze({
      title: text(templates.title), description: text(templates.description), prompt: placeholderText(templates.prompt, []),
      evidence: placeholderText(templates.evidence, ["path", "repository", "name"]),
      explanation: placeholderText(templates.explanation, []),
    }),
    families: Object.freeze(families),
  });
};

const parseOutputDeck = (value: unknown, repositories: readonly CuratedRepository[], caps: CuratedCaps): OutputDeck => {
  const deck = exactRecord(value, ["rounds", "repository", "directories", "fileReads", "templates"]);
  const rounds = integer(deck.rounds);
  if (rounds % OUTPUT_OPTIONS !== 0 || rounds < 8 || rounds > caps.rounds) fail();
  const repository = text(deck.repository);
  // Doctests are Python's; the repository must be one of the curated pins.
  if (repositories.find((known) => known.repository === repository)?.language !== "Python") fail();
  const directories = uniqueTexts(deck.directories);
  if (directories.some((directory) => !/^[A-Za-z0-9_]+$/u.test(directory))) fail();
  const fileReads = integer(deck.fileReads);
  if (fileReads < rounds || fileReads > caps.reads) fail();
  const templates = exactRecord(deck.templates, ["title", "description", "prompt", "evidence", "explanation"]);
  return Object.freeze({
    rounds, repository, directories, fileReads,
    templates: Object.freeze({
      title: text(templates.title), description: text(templates.description), prompt: placeholderText(templates.prompt, []),
      evidence: placeholderText(templates.evidence, ["path", "repository", "call", "output"]),
      explanation: placeholderText(templates.explanation, []),
    }),
  });
};

const parseMissingLineDeck = (value: unknown, repositories: readonly CuratedRepository[], caps: CuratedCaps): MissingLineDeck => {
  const deck = exactRecord(value, ["rounds", "repository", "directories", "fileReads", "windowLines", "templates"]);
  const rounds = integer(deck.rounds);
  if (rounds % 4 !== 0 || rounds < 8 || rounds > 60) fail();
  const repository = text(deck.repository);
  if (repositories.find((known) => known.repository === repository) === undefined) fail();
  const directories = uniqueTexts(deck.directories);
  if (directories.some((directory) => !/^[A-Za-z0-9_]+$/u.test(directory))) fail();
  const fileReads = integer(deck.fileReads);
  if (fileReads < rounds || fileReads > caps.reads) fail();
  const windowLines = integer(deck.windowLines);
  if (windowLines < 6 || windowLines > 20) fail();
  const templates = exactRecord(deck.templates, ["title", "description", "prompt", "evidence", "explanation"]);
  return Object.freeze({
    rounds, repository, directories, fileReads, windowLines,
    templates: Object.freeze({
      title: text(templates.title), description: text(templates.description), prompt: placeholderText(templates.prompt, []),
      evidence: placeholderText(templates.evidence, ["path", "repository", "line"]),
      explanation: placeholderText(templates.explanation, []),
    }),
  });
};

const parseNameFunctionDeck = (value: unknown, repositories: readonly CuratedRepository[], caps: CuratedCaps): NameFunctionDeck => {
  const deck = exactRecord(value, ["rounds", "sources", "fileReads", "functionLines", "templates"]);
  const rounds = integer(deck.rounds);
  if (rounds % 4 !== 0 || rounds < 8 || rounds > 60) fail();
  const sources = (Array.isArray(deck.sources) && deck.sources.length > 0 && deck.sources.length <= 3 ? deck.sources : fail()).map((entry: unknown) => {
    const item = exactRecord(entry, ["repository", "directories"]);
    const repository = text(item.repository);
    const pin = repositories.find((known) => known.repository === repository) ?? fail();
    if (!NAME_FUNCTION_LANGUAGES.includes(pin.language)) fail();
    const directories = uniqueTexts(item.directories);
    if (directories.some((directory) => !/^[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*$/u.test(directory))) fail();
    return Object.freeze({ repository, directories });
  });
  if (new Set(sources.map(({ repository }) => repository)).size !== sources.length) fail();
  const fileReads = integer(deck.fileReads);
  if (fileReads < rounds || fileReads > caps.reads) fail();
  const functionLines = integer(deck.functionLines);
  if (functionLines < 6 || functionLines > 30) fail();
  const templates = exactRecord(deck.templates, ["title", "description", "prompt", "evidence", "explanation"]);
  return Object.freeze({
    rounds, sources: Object.freeze(sources), fileReads, functionLines,
    templates: Object.freeze({
      title: text(templates.title), description: text(templates.description), prompt: placeholderText(templates.prompt, []),
      evidence: placeholderText(templates.evidence, ["path", "repository", "name"]),
      explanation: placeholderText(templates.explanation, []),
    }),
  });
};

const FRAMEWORK_NAME = /^[A-Za-z][A-Za-z0-9]{1,31}$/u;
const parseFrameworkEntry = (value: unknown): FrameworkEntry => {
  const item = exactRecord(value, ["id", "label", "names", "symbols", "idea", "examples", "files"]);
  const id = text(item.id);
  if (!ALGORITHM_ID.test(id) || !isKnownFramework(id)) fail();
  const names = uniqueTexts(item.names);
  const symbols = Array.isArray(item.symbols) ? item.symbols.map(text) : fail();
  if (names.some((name) => !FRAMEWORK_NAME.test(name)) || symbols.some((symbol) => !IDENTIFIER.test(symbol))
    || new Set(symbols).size !== symbols.length) fail();
  const examples = uniqueTexts(item.examples).map(safePath);
  const files = uniqueTexts(item.files).map(safePath);
  if (files.some((file) => !examples.some((example) => file.startsWith(`${example}/`)))) fail();
  return Object.freeze({ id, label: text(item.label), names, symbols: Object.freeze(symbols), idea: text(item.idea),
    examples: Object.freeze(examples), files: Object.freeze(files) });
};

const parseFrameworkDeck = (value: unknown, repositories: readonly CuratedRepository[]): FrameworkDeck => {
  const deck = exactRecord(value, ["rounds", "repository", "roundsPerFramework", "windowLines", "families", "templates"]);
  const rounds = integer(deck.rounds);
  const roundsPerFramework = integer(deck.roundsPerFramework);
  if (roundsPerFramework > 3 || rounds % (FRAMEWORK_FAMILY_SIZE * roundsPerFramework) !== 0 || rounds < 8 || rounds > 60) fail();
  const repository = text(deck.repository);
  if (repositories.find((known) => known.repository === repository) === undefined) fail();
  const windowLines = integer(deck.windowLines);
  if (windowLines < 8 || windowLines > 20) fail();
  const families = (Array.isArray(deck.families) && deck.families.length * FRAMEWORK_FAMILY_SIZE * roundsPerFramework >= rounds
    ? deck.families : fail()).map((entry: unknown) => {
    const family = exactRecord(entry, ["id", "note", "frameworks"]);
    const id = text(family.id);
    if (!ALGORITHM_ID.test(id)) fail();
    const frameworks = (Array.isArray(family.frameworks) && family.frameworks.length === FRAMEWORK_FAMILY_SIZE
      ? family.frameworks : fail()).map(parseFrameworkEntry);
    if (frameworks.some(({ files }) => files.length < roundsPerFramework)) fail();
    return Object.freeze({ id, note: text(family.note), frameworks: Object.freeze(frameworks) });
  });
  const all = families.flatMap(({ frameworks }) => frameworks);
  if (new Set(families.map(({ id }) => id)).size !== families.length || new Set(all.map(({ id }) => id)).size !== all.length
    || new Set(all.map(({ label }) => label)).size !== all.length) fail();
  // A hint or note that spells any framework of the deck would answer a round, or rule an option out.
  const copy = [...families.map(({ note }) => note), ...all.map(({ idea }) => idea)];
  if (copy.some((value) => all.some((framework) => spellsFramework(value, framework)))) fail();
  const templates = exactRecord(deck.templates, ["title", "description", "prompt", "evidence", "explanation"]);
  const prompt = placeholderText(templates.prompt, []);
  if (all.some((framework) => spellsFramework(prompt, framework))) fail();
  return Object.freeze({
    rounds, repository, roundsPerFramework, windowLines, families: Object.freeze(families),
    templates: Object.freeze({
      title: text(templates.title), description: text(templates.description), prompt,
      evidence: placeholderText(templates.evidence, ["path", "repository", "name"]),
      explanation: placeholderText(templates.explanation, []),
    }),
  });
};

const parseExerciseEntry = (value: unknown): ExerciseEntry => {
  const item = exactRecord(value, ["id", "label", "names", "symbols", "idea", "detail"]);
  const id = text(item.id);
  if (!ALGORITHM_ID.test(id)) fail();
  const names = uniqueTexts(item.names);
  const symbols = Array.isArray(item.symbols) ? item.symbols.map(text) : fail();
  if (names.some((name) => !FRAMEWORK_NAME.test(name)) || symbols.some((symbol) => !IDENTIFIER.test(symbol))
    || new Set(symbols).size !== symbols.length) fail();
  return Object.freeze({ id, label: text(item.label), names, symbols: Object.freeze(symbols), idea: text(item.idea), detail: text(item.detail) });
};

const parseExerciseDeck = (value: unknown, repositories: readonly CuratedRepository[]): ExerciseDeck => {
  const deck = exactRecord(value, ["rounds", "roundsPerExercise", "tracks", "families", "templates"]);
  const rounds = integer(deck.rounds);
  const roundsPerExercise = integer(deck.roundsPerExercise);
  if (rounds % (EXERCISE_FAMILY_SIZE * roundsPerExercise) !== 0 || rounds < 8 || rounds > 60) fail();
  const tracks = (Array.isArray(deck.tracks) && deck.tracks.length >= roundsPerExercise ? deck.tracks : fail()).map((entry: unknown) => {
    const track = exactRecord(entry, ["repository", "solution"]);
    const repository = text(track.repository);
    if (repositories.find((known) => known.repository === repository) === undefined) fail();
    // The exercise's directory is the truth, so the slug names it, once.
    const solution = text(track.solution);
    if (!solution.startsWith("exercises/practice/{slug}/") || solution.split("{slug}").length !== 2) fail();
    safePath(solution.replace("{slug}", "slug"));
    return Object.freeze({ repository, solution });
  });
  if (new Set(tracks.map(({ repository }) => repository)).size !== tracks.length) fail();
  const families = (Array.isArray(deck.families) && deck.families.length * EXERCISE_FAMILY_SIZE * roundsPerExercise >= rounds
    ? deck.families : fail()).map((entry: unknown) => {
    const family = exactRecord(entry, ["id", "note", "exercises"]);
    const id = text(family.id);
    if (!ALGORITHM_ID.test(id)) fail();
    const exercises = (Array.isArray(family.exercises) && family.exercises.length === EXERCISE_FAMILY_SIZE
      ? family.exercises : fail()).map(parseExerciseEntry);
    const note = text(family.note);
    // A hint or note that spells an exercise of the family would answer its round, or rule an option out.
    if ([note, ...exercises.flatMap(({ idea, detail }) => [idea, detail])].some((copy) => exercises.some((exercise) => copyNamesExercise(copy, exercise)))) fail();
    return Object.freeze({ id, note, exercises: Object.freeze(exercises) });
  });
  const all = families.flatMap(({ exercises }) => exercises);
  if (new Set(families.map(({ id }) => id)).size !== families.length || new Set(all.map(({ id }) => id)).size !== all.length
    || new Set(all.map(({ label }) => label)).size !== all.length) fail();
  const templates = exactRecord(deck.templates, ["title", "description", "prompt", "evidence", "explanation"]);
  const prompt = placeholderText(templates.prompt, []);
  if (all.some((exercise) => copyNamesExercise(prompt, exercise))) fail();
  return Object.freeze({
    rounds, roundsPerExercise, tracks: Object.freeze(tracks), families: Object.freeze(families),
    templates: Object.freeze({
      title: text(templates.title), description: text(templates.description), prompt,
      evidence: placeholderText(templates.evidence, ["path", "repository", "name"]),
      explanation: placeholderText(templates.explanation, []),
    }),
  });
};

const PROJECT_NAME = /^[A-Za-z0-9_.-]+$/u;
const parseFixDeck = (value: unknown, caps: CuratedCaps): FixDeck => {
  const deck = exactRecord(value, ["rounds", "datasets", "patchReads", "perRepository", "templates"]);
  const rounds = integer(deck.rounds);
  if (rounds % FIX_OPTIONS !== 0 || rounds < 8 || rounds > caps.rounds) fail();
  const datasets = (Array.isArray(deck.datasets) && deck.datasets.length > 0 ? deck.datasets : fail()).map((entry: unknown) => {
    const dataset = exactRecord(entry, ["id", "repository", "commit", "projects"]);
    if (!(FIX_DATASETS as readonly unknown[]).includes(dataset.id)) fail();
    const repository = text(dataset.repository);
    const commit = text(dataset.commit);
    if (!REPOSITORY_NAME.test(repository) || !/^[0-9a-f]{40}$/u.test(commit)) fail();
    const projects = (Array.isArray(dataset.projects) && dataset.projects.length > 0 ? dataset.projects : fail()).map((project: unknown) => {
      const item = exactRecord(project, ["name", "repository", "language"]);
      const name = text(item.name);
      if (!PROJECT_NAME.test(name) || !REPOSITORY_NAME.test(text(item.repository))
        || !(STACK_LANGUAGES as readonly unknown[]).includes(item.language)) fail();
      return Object.freeze({ name, repository: item.repository as string, language: item.language as StackLanguage });
    });
    if (new Set(projects.map(({ name }) => name)).size !== projects.length) fail();
    return Object.freeze({ id: dataset.id as FixDataset["id"], repository, commit, projects: Object.freeze(projects) });
  });
  if (new Set(datasets.map(({ id }) => id)).size !== datasets.length) fail();
  const patchReads = integer(deck.patchReads);
  const perRepository = integer(deck.perRepository);
  if (patchReads < rounds || patchReads > caps.reads || perRepository > rounds / 2) fail();
  const templates = exactRecord(deck.templates, ["title", "description", "prompt", "evidence", "explanation"]);
  return Object.freeze({
    rounds, datasets: Object.freeze(datasets), patchReads, perRepository,
    templates: Object.freeze({
      title: text(templates.title), description: text(templates.description), prompt: placeholderText(templates.prompt, []),
      evidence: placeholderText(templates.evidence, ["dataset", "bug", "repository", "line"]),
      explanation: placeholderText(templates.explanation, []),
    }),
  });
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;
/** A calendar day that survives a round trip, as its UTC midnight. */
const day = (value: string): number => {
  const match = DAY.exec(value) ?? fail();
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(time).toISOString().slice(0, 10) === value ? time : fail();
};

const parseVulnerableLineDeck = (value: unknown, caps: CuratedCaps): VulnerableLineDeck => {
  const deck = exactRecord(value, ["rounds", "ecosystems", "published", "commitReads", "cwes", "templates"]);
  const rounds = integer(deck.rounds);
  if (rounds % FIX_OPTIONS !== 0 || rounds < 8 || rounds > caps.rounds) fail();
  const ecosystems = uniqueTexts(deck.ecosystems);
  if (ecosystems.some((ecosystem) => !(ADVISORY_ECOSYSTEMS as readonly string[]).includes(ecosystem))) fail();
  const published = uniqueTexts(deck.published);
  let previous = -Infinity;
  for (const window of published) {
    const [from, to, extra] = window.split("..");
    if (from === undefined || to === undefined || extra !== undefined || day(from) > day(to) || day(from) <= previous) fail();
    previous = day(to!);
  }
  const commitReads = integer(deck.commitReads);
  if (commitReads < rounds || commitReads > VULNERABLE_COMMIT_READS_MAXIMUM) fail();
  const cwes = (Array.isArray(deck.cwes) && deck.cwes.length > 0 ? deck.cwes : fail()).map((entry: unknown) => {
    const cwe = exactRecord(entry, ["id", "hint"]);
    if (!CWE_ID.test(text(cwe.id))) fail();
    const hint = text(cwe.hint);
    // A hint is one plain sentence about the weakness, and says nothing of anyone's authorship.
    if (!/^[A-Z][^{}]*\.$/u.test(hint) || AUTHORSHIP_CLAIM.test(hint)) fail();
    return Object.freeze({ id: cwe.id as string, hint });
  });
  if (cwes.some(({ id }, index) => index > 0 && Number(id.slice(4)) <= Number(cwes[index - 1]!.id.slice(4)))) fail();
  const templates = exactRecord(deck.templates, ["title", "description", "prompt", "evidence", "explanation"]);
  return Object.freeze({
    rounds, ecosystems: Object.freeze(ecosystems as readonly AdvisoryEcosystem[]), published, commitReads, cwes: Object.freeze(cwes),
    templates: Object.freeze({
      title: text(templates.title), description: text(templates.description), prompt: placeholderText(templates.prompt, []),
      evidence: placeholderText(templates.evidence, ["advisory", "cwe", "repository", "line"]),
      explanation: placeholderText(templates.explanation, []),
    }),
  });
};

/** The curated pins, and each deck built from them that the profile configures, within its version's caps. */
const parseCurated = (value: unknown, version: ProfileVersion): CuratedProfile => {
  const decks = (["algorithm", "output", "fix", "missing-line", "name-function", "framework", "exercise", "vulnerable-line"] as const).filter((key) => isRecord(value) && Object.hasOwn(value, key));
  const curated = exactRecord(value, ["repositories", ...decks]);
  const repositories = parseCuratedRepositories(curated.repositories);
  const caps = CURATED_CAPS[version];
  return Object.freeze({
    repositories,
    ...(decks.includes("algorithm") ? { algorithm: parseAlgorithmDeck(curated.algorithm, repositories, version) } : {}),
    ...(decks.includes("output") ? { output: parseOutputDeck(curated.output, repositories, caps) } : {}),
    ...(decks.includes("fix") ? { fix: parseFixDeck(curated.fix, caps) } : {}),
    ...(decks.includes("missing-line") ? { "missing-line": parseMissingLineDeck(curated["missing-line"], repositories, caps) } : {}),
    ...(decks.includes("name-function") ? { "name-function": parseNameFunctionDeck(curated["name-function"], repositories, caps) } : {}),
    ...(decks.includes("framework") ? { framework: parseFrameworkDeck(curated.framework, repositories) } : {}),
    ...(decks.includes("exercise") ? { exercise: parseExerciseDeck(curated.exercise, repositories) } : {}),
    ...(decks.includes("vulnerable-line") ? { "vulnerable-line": parseVulnerableLineDeck(curated["vulnerable-line"], caps) } : {}),
  });
};

export const parseCrawlProfile = (value: unknown): CrawlProfile => {
  scanForbidden(value);
  // A profile reads curated repositories only when it says so; one without them hashes exactly as before.
  const curated = isRecord(value) && Object.hasOwn(value, "curated");
  const root = exactRecord(value, [
    "profileVersion", "github", "stack", "licenses", "templates", "deduplication", "capacity", "screening", "selection",
    ...(curated ? ["curated"] : []),
  ]);
  const profileVersion = PROFILE_VERSIONS.find((known) => known === root.profileVersion) ?? fail();
  const github = exactRecord(root.github, ["apiVersion", "queries"]);
  if (github.apiVersion !== "2022-11-28") fail();
  const stack = exactRecord(root.stack, ["release", "revision", "configurations"]);
  if (stack.release !== STACK_RELEASE || stack.revision !== STACK_REVISION) fail();
  return deepFreeze({
    profileVersion,
    github: Object.freeze({ apiVersion: "2022-11-28" as const, queries: parseQueries(github.queries) }),
    stack: Object.freeze({ release: STACK_RELEASE, revision: STACK_REVISION, configurations: parseConfigurations(stack.configurations) }),
    licenses: uniqueTexts(root.licenses),
    templates: parseTemplates(root.templates),
    deduplication: exactTexts(root.deduplication, [
      "repository", "commit", "path", "blob", "rawContentHash", "excerptHash",
    ] as const),
    capacity: parseCapacity(root.capacity),
    screening: parseScreening(root.screening),
    selection: parseSelection(root.selection, profileVersion),
    ...(curated ? { curated: parseCurated(root.curated, profileVersion) } : {}),
  });
};
