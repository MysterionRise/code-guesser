import { CAPACITY_CEILINGS, STACK_RELEASE, STACK_REVISION, type CeilingKey } from "../limits";
import {
  AUTHORSHIP_CLAIM, PROFILE_VERSION, ROUNDS_PER_LANGUAGE, STACK_LANGUAGES, type DeckId, type StackLanguage,
} from "../../../packages/artifact/src/index";

/** The hard ceilings from `ops/poc/limits.json`; a profile may lower any of them, never raise one. */
export { CAPACITY_CEILINGS, PROFILE_VERSION, STACK_LANGUAGES, type StackLanguage };

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
});

export interface CrawlProfile {
  readonly profileVersion: typeof PROFILE_VERSION;
  /** Commit searches that feed the before-or-after deck. */
  readonly github: Readonly<{ apiVersion: "2022-11-28"; queries: readonly ProfileQuery[] }>;
  readonly stack: Readonly<{
    release: string;
    revision: string;
    configurations: readonly Readonly<{
      language: StackLanguage;
      configuration: StackLanguage;
      extensions: readonly string[];
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
    /** Rounds in the before-or-after pool; the Stack decks hold two rounds per language. */
    beforeAfterPool: number;
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

/** A repository read at one pinned commit, in one language. */
export interface CuratedRepository {
  readonly repository: string;
  readonly commit: string;
  readonly language: StackLanguage;
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
/** Four algorithms offered together; each family's rounds answer each of them once. */
export interface AlgorithmFamily {
  readonly id: string;
  /** What the reveal says the family shares, so the wrong options were tempting. */
  readonly note: string;
  readonly algorithms: readonly AlgorithmEntry[];
}
export interface CuratedProfile {
  readonly repositories: readonly CuratedRepository[];
  readonly algorithm?: Readonly<{
    rounds: number;
    templates: Readonly<{ title: string; description: string; prompt: string; evidence: string; explanation: string }>;
    families: readonly AlgorithmFamily[];
  }>;
}

/** Options per algorithm round: one whole family. */
export const ALGORITHM_FAMILY_SIZE = 4;

/** Rounds in each deck's pool; a session deals five of them. A deck the profile does not configure holds none. */
export const poolSizes = (profile: CrawlProfile): Readonly<Record<DeckId, number>> => Object.freeze({
  project: ROUNDS_PER_LANGUAGE * profile.stack.configurations.length,
  language: ROUNDS_PER_LANGUAGE * profile.stack.configurations.length,
  "before-after": profile.selection.beforeAfterPool,
  algorithm: profile.curated?.algorithm?.rounds ?? 0,
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

const parseConfigurations = (value: unknown): CrawlProfile["stack"]["configurations"] => {
  if (!Array.isArray(value) || value.length !== STACK_LANGUAGES.length) return fail();
  return Object.freeze(value.map((entry, index) => {
    const item = exactRecord(entry, ["language", "extensions"]);
    const language = STACK_LANGUAGES[index]!;
    if (item.language !== language) fail();
    return Object.freeze({ language, configuration: language, extensions: exactTexts(item.extensions, STACK_EXTENSIONS[language]) });
  }));
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

const parseSelection = (value: unknown): CrawlProfile["selection"] => {
  const selection = exactRecord(value, ["beforeAfterPool", "minimumStarEvents", "popularRepositories", "filesPerRepository", "ordinaryRows"]);
  const parsed = Object.fromEntries(Object.entries(selection).map(([key, entry]) => [key, integer(entry)])) as CrawlProfile["selection"];
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

const parseCuratedRepositories = (value: unknown): readonly CuratedRepository[] => {
  if (!Array.isArray(value) || value.length === 0) return fail();
  const repositories = value.map((entry) => {
    const item = exactRecord(entry, ["repository", "commit", "language"]);
    const repository = text(item.repository);
    const commit = text(item.commit);
    if (!REPOSITORY_NAME.test(repository) || !/^[0-9a-f]{40}$/u.test(commit)
      || !(STACK_LANGUAGES as readonly unknown[]).includes(item.language)) fail();
    return Object.freeze({ repository, commit, language: item.language as StackLanguage });
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

const parseCurated = (value: unknown): CuratedProfile => {
  const keys = isRecord(value) && Object.hasOwn(value, "algorithm") ? ["repositories", "algorithm"] : ["repositories"];
  const curated = exactRecord(value, keys);
  const repositories = parseCuratedRepositories(curated.repositories);
  if (!keys.includes("algorithm")) return Object.freeze({ repositories });
  const algorithm = exactRecord(curated.algorithm, ["rounds", "templates", "families"]);
  const rounds = integer(algorithm.rounds);
  if (rounds % ALGORITHM_FAMILY_SIZE !== 0 || rounds < 8 || rounds > 40) fail();
  const templates = exactRecord(algorithm.templates, ["title", "description", "prompt", "evidence", "explanation"]);
  const known = new Set(repositories.map(({ repository }) => repository));
  const families = (Array.isArray(algorithm.families) && algorithm.families.length * ALGORITHM_FAMILY_SIZE >= rounds
    ? algorithm.families : fail()).map((entry: unknown) => {
    const family = exactRecord(entry, ["id", "note", "algorithms"]);
    const algorithms = (Array.isArray(family.algorithms) && family.algorithms.length === ALGORITHM_FAMILY_SIZE
      ? family.algorithms : fail()).map((item: unknown) => parseAlgorithmEntry(item, known));
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
    repositories,
    algorithm: Object.freeze({
      rounds,
      templates: Object.freeze({
        title: text(templates.title), description: text(templates.description), prompt: placeholderText(templates.prompt, []),
        evidence: placeholderText(templates.evidence, ["path", "repository", "name"]),
        explanation: placeholderText(templates.explanation, []),
      }),
      families: Object.freeze(families),
    }),
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
  if (root.profileVersion !== PROFILE_VERSION) fail();
  const github = exactRecord(root.github, ["apiVersion", "queries"]);
  if (github.apiVersion !== "2022-11-28") fail();
  const stack = exactRecord(root.stack, ["release", "revision", "configurations"]);
  if (stack.release !== STACK_RELEASE || stack.revision !== STACK_REVISION) fail();
  return deepFreeze({
    profileVersion: PROFILE_VERSION,
    github: Object.freeze({ apiVersion: "2022-11-28" as const, queries: parseQueries(github.queries) }),
    stack: Object.freeze({ release: STACK_RELEASE, revision: STACK_REVISION, configurations: parseConfigurations(stack.configurations) }),
    licenses: uniqueTexts(root.licenses),
    templates: parseTemplates(root.templates),
    deduplication: exactTexts(root.deduplication, [
      "repository", "commit", "path", "blob", "rawContentHash", "excerptHash",
    ] as const),
    capacity: parseCapacity(root.capacity),
    screening: parseScreening(root.screening),
    selection: parseSelection(root.selection),
    ...(curated ? { curated: parseCurated(root.curated) } : {}),
  });
};
