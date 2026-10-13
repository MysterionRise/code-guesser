const MEBIBYTE = 1024 * 1024;

/** Revision 12 ceilings: requests rose to 600 and Stack metadata to 96 MiB; the rest carry forward. */
export const SIGNED_CAPACITY_CEILINGS = Object.freeze({
  githubPages: 3,
  githubResults: 300,
  stackRowsPerLanguage: 10_000,
  stackMetadataBytes: 96 * MEBIBYTE,
  blobAttempts: 50,
  successfulBlobs: 50,
  perBlobBytes: 256 * 1024,
  totalBlobBytes: 16 * MEBIBYTE,
  concurrentRequests: 4,
  requestCount: 600,
  responseBytes: 8 * MEBIBYTE,
  waitMilliseconds: 15_000,
  totalWaitMilliseconds: 30_000,
  temporaryDiskBytes: 32 * MEBIBYTE,
} as const);

export type CapacityLimits = Readonly<Record<keyof typeof SIGNED_CAPACITY_CEILINGS, number>>;
export const PROFILE_VERSION = "local-real-rounds.v2";
export const STACK_LANGUAGES = Object.freeze(["Python", "TypeScript", "Go", "Rust", "Ruby"] as const);
export type StackLanguage = typeof STACK_LANGUAGES[number];
/** FR-025: the display languages a language round may offer as candidates. */
export const LANGUAGE_CANDIDATE_UNIVERSE = Object.freeze([
  "Python", "TypeScript", "JavaScript", "Go", "Rust", "Java", "Ruby", "C#", "Kotlin", "Swift", "PHP", "C++",
] as const);
export type QueryRole = "ai-credit" | "ordinary";

export interface ProfileQuery {
  readonly id: string;
  readonly role: QueryRole;
  readonly query: string;
  readonly sort: "committer-date";
  readonly order: "desc";
}

const query = (id: string, role: QueryRole, value: string): ProfileQuery =>
  Object.freeze({ id, role, query: value, sort: "committer-date", order: "desc" });

/** FR-020 as amended by revisions 12 and 13: the only query tuples this profile may carry, in order. */
export const AUTHORIZED_QUERIES: readonly ProfileQuery[] = Object.freeze([
  query("ai-copilot-github", "ai-credit", "\"Co-authored-by: Copilot\" org:github committer-date:2026-09-01 merge:false is:public"),
  query("ai-copilot-microsoft", "ai-credit", "\"Co-authored-by: Copilot\" org:microsoft committer-date:2026-09-06 merge:false is:public"),
  query("ai-claude-github", "ai-credit", "\"Co-Authored-By: Claude\" org:github committer-date:2026-09-02..2026-09-30 merge:false is:public"),
  query("ai-claude-vercel", "ai-credit", "\"Co-Authored-By: Claude\" org:vercel committer-date:2026-09-01..2026-09-30 merge:false is:public"),
  query("ordinary-facebook", "ordinary", "refactor org:facebook committer-date:2026-07-01..2026-07-31 merge:false is:public"),
  query("ordinary-google", "ordinary", "refactor org:google committer-date:2026-09-01..2026-09-07 merge:false is:public"),
  query("ordinary-vercel", "ordinary", "refactor org:vercel committer-date:2026-08-01..2026-08-31 merge:false is:public"),
  query("ordinary-github", "ordinary", "refactor org:github committer-date:2026-08-01..2026-08-31 merge:false is:public"),
]);

const STACK_CONFIGURATIONS = Object.freeze([
  ["Python", [".py"]], ["TypeScript", [".ts", ".tsx"]], ["Go", [".go"]], ["Rust", [".rs"]], ["Ruby", [".rb"]],
] as const);

/** FR-034: the exact AI-credit markers revision 12 defines. */
export const AUTHORIZED_AI_CREDITS = Object.freeze({
  trailers: Object.freeze([
    Object.freeze({
      assistant: "GitHub Copilot", key: "Co-authored-by",
      names: Object.freeze(["Copilot", "Copilot App", "GitHub Copilot"]), domain: "users.noreply.github.com",
    }),
    Object.freeze({ assistant: "Claude", key: "Co-authored-by", names: Object.freeze(["Claude"]), domain: "anthropic.com" }),
  ]),
  literals: Object.freeze([Object.freeze({ assistant: "GitHub Copilot", line: "Generated-by: Copilot" })]),
});

export interface AiCreditTrailer {
  readonly assistant: string;
  readonly key: string;
  readonly names: readonly string[];
  readonly domain: string;
}

export interface LanguageTemplate {
  readonly language: StackLanguage;
  readonly clues: readonly [string, string];
  readonly distractors: readonly [string, string, string];
}

export interface CrawlProfile {
  readonly profileVersion: typeof PROFILE_VERSION;
  readonly github: Readonly<{ apiVersion: "2022-11-28"; queries: readonly ProfileQuery[] }>;
  readonly stack: Readonly<{
    release: "v2.2.0";
    revision: "e565caa3a78c2423bd374333a472b049eb090e47";
    configurations: readonly Readonly<{
      language: StackLanguage;
      configuration: StackLanguage;
      extensions: readonly string[];
    }>[];
  }>;
  readonly aiCredits: Readonly<{
    trailers: readonly AiCreditTrailer[];
    literals: readonly Readonly<{ assistant: string; line: string }>[];
  }>;
  readonly licenses: readonly string[];
  readonly templates: Readonly<{
    project: Readonly<{
      title: string; description: string; prompt: string; extensionClue: string; ownerClue: string;
      evidence: string; explanation: string;
    }>;
    language: Readonly<{
      title: string; description: string; prompt: string; evidence: string; explanation: string;
      languages: readonly LanguageTemplate[];
    }>;
    ai: Readonly<{
      title: string; description: string; notice: string; prompt: string; recordedCandidate: string;
      absentCandidate: string; fileClue: string; subjectClue: string; linesClue: string;
      recordedEvidence: string; absentEvidence: string; explanation: string;
    }>;
  }>;
  readonly ordering: Readonly<{
    github: readonly ["queryIndex", "committerDateDescending", "repository", "commit", "path", "blob"];
    stack: readonly ["configurationIndex", "stableRowId", "repository", "revision", "path", "blob"];
  }>;
  readonly deduplication: readonly [
    "repository", "commit", "path", "blob", "rawContentHash", "excerptHash",
  ];
  readonly capacity: CapacityLimits;
  readonly screening: Readonly<{
    excerptBytes: number; minimumExcerptBytes: number; languageExcerptLines: number;
    generatedScanLines: number; subjectMaxLength: number;
  }>;
  readonly selection: Readonly<{
    projectRounds: 5; languageRounds: 5; aiRounds: 5;
    projectCandidates: 4; languageCandidates: 4; aiMinimumPerOutcome: 2;
  }>;
}

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

const HUMAN_AUTHORSHIP_CLAIM = /\b(?:human[- ]written|written by (?:a |an )?human|a human wrote|human-only|detector|detection|code style (?:shows|proves|indicates))\b/iu;

const parseQueries = (value: unknown): readonly ProfileQuery[] => {
  if (!Array.isArray(value) || value.length !== AUTHORIZED_QUERIES.length) return fail();
  return Object.freeze(value.map((entry, index) => {
    const item = exactRecord(entry, ["id", "role", "query", "sort", "order"]);
    const authorized = AUTHORIZED_QUERIES[index]!;
    if (item.id !== authorized.id || item.role !== authorized.role || item.query !== authorized.query
      || item.sort !== authorized.sort || item.order !== authorized.order) fail();
    return authorized;
  }));
};

const parseConfigurations = (value: unknown): CrawlProfile["stack"]["configurations"] => {
  if (!Array.isArray(value) || value.length !== STACK_CONFIGURATIONS.length) return fail();
  return Object.freeze(value.map((entry, index) => {
    const item = exactRecord(entry, ["language", "configuration", "extensions"]);
    const [language, extensions] = STACK_CONFIGURATIONS[index]!;
    if (item.language !== language || item.configuration !== language) fail();
    return Object.freeze({ language, configuration: language, extensions: exactTexts(item.extensions, extensions) });
  }));
};

const parseAiCredits = (value: unknown): CrawlProfile["aiCredits"] => {
  const credits = exactRecord(value, ["trailers", "literals"]);
  const trailers = Array.isArray(credits.trailers) ? credits.trailers : fail();
  const literals = Array.isArray(credits.literals) ? credits.literals : fail();
  if (trailers.length !== AUTHORIZED_AI_CREDITS.trailers.length || literals.length !== AUTHORIZED_AI_CREDITS.literals.length) fail();
  trailers.forEach((entry, index) => {
    const item = exactRecord(entry, ["assistant", "key", "names", "domain"]);
    const authorized = AUTHORIZED_AI_CREDITS.trailers[index]!;
    if (item.assistant !== authorized.assistant || item.key !== authorized.key || item.domain !== authorized.domain) fail();
    exactTexts(item.names, authorized.names);
  });
  literals.forEach((entry, index) => {
    const item = exactRecord(entry, ["assistant", "line"]);
    const authorized = AUTHORIZED_AI_CREDITS.literals[index]!;
    if (item.assistant !== authorized.assistant || item.line !== authorized.line) fail();
  });
  return AUTHORIZED_AI_CREDITS;
};

const parseCapacity = (value: unknown): CapacityLimits => {
  const keys = Object.keys(SIGNED_CAPACITY_CEILINGS) as (keyof CapacityLimits)[];
  const item = exactRecord(value, keys);
  return Object.freeze(Object.fromEntries(keys.map((key) => {
    const parsed = integer(item[key]);
    if (parsed > SIGNED_CAPACITY_CEILINGS[key]) fail();
    return [key, parsed];
  })) as Record<keyof CapacityLimits, number>);
};

const parseLanguageTemplates = (value: unknown): readonly LanguageTemplate[] => {
  if (!Array.isArray(value) || value.length !== STACK_LANGUAGES.length) return fail();
  return Object.freeze(value.map((entry, index) => {
    const item = exactRecord(entry, ["language", "clues", "distractors"]);
    const language = STACK_LANGUAGES[index]!;
    if (item.language !== language) fail();
    const clues = uniqueTexts(item.clues);
    const distractors = uniqueTexts(item.distractors);
    if (clues.length !== 2 || distractors.length !== 3) fail();
    if (distractors.some((label) => label === language
      || !(LANGUAGE_CANDIDATE_UNIVERSE as readonly string[]).includes(label))) fail();
    const extensions = STACK_CONFIGURATIONS[index]![1];
    for (const clue of clues) {
      if ([language, ...distractors].some((label) => mentionsLabel(clue, label))) fail();
      if (extensions.some((extension) => mentionsExtension(clue, extension))) fail();
    }
    return Object.freeze({
      language,
      clues: Object.freeze([clues[0]!, clues[1]!]) as readonly [string, string],
      distractors: Object.freeze([distractors[0]!, distractors[1]!, distractors[2]!]) as readonly [string, string, string],
    });
  }));
};

const parseTemplates = (value: unknown): CrawlProfile["templates"] => {
  const templates = exactRecord(value, ["project", "language", "ai"]);
  const project = exactRecord(templates.project, [
    "title", "description", "prompt", "extensionClue", "ownerClue", "evidence", "explanation",
  ]);
  const language = exactRecord(templates.language, [
    "title", "description", "prompt", "evidence", "explanation", "languages",
  ]);
  const ai = exactRecord(templates.ai, [
    "title", "description", "notice", "prompt", "recordedCandidate", "absentCandidate", "fileClue",
    "subjectClue", "linesClue", "recordedEvidence", "absentEvidence", "explanation",
  ]);
  const aiTemplate = Object.freeze({
    title: text(ai.title), description: text(ai.description), notice: text(ai.notice), prompt: text(ai.prompt),
    recordedCandidate: text(ai.recordedCandidate), absentCandidate: text(ai.absentCandidate),
    fileClue: placeholderText(ai.fileClue, ["files"]), subjectClue: placeholderText(ai.subjectClue, ["subject"]),
    linesClue: placeholderText(ai.linesClue, ["added", "removed"]),
    recordedEvidence: placeholderText(ai.recordedEvidence, ["assistant"]),
    absentEvidence: placeholderText(ai.absentEvidence, []), explanation: placeholderText(ai.explanation, []),
  });
  // FR-012 as amended: the no answer never claims human authorship and nothing claims detection from code.
  if ([aiTemplate.absentCandidate, aiTemplate.absentEvidence, aiTemplate.explanation, aiTemplate.recordedCandidate,
    aiTemplate.recordedEvidence, aiTemplate.notice, aiTemplate.description].some((value) => HUMAN_AUTHORSHIP_CLAIM.test(value))) fail();
  if (!/\bno ai credit\b/iu.test(aiTemplate.absentCandidate) || !/\bcredit/iu.test(aiTemplate.recordedCandidate)) fail();
  return Object.freeze({
    project: Object.freeze({
      title: text(project.title), description: text(project.description),
      prompt: placeholderText(project.prompt, []),
      extensionClue: placeholderText(project.extensionClue, ["extension"]),
      ownerClue: placeholderText(project.ownerClue, ["owner"]),
      evidence: placeholderText(project.evidence, ["repository"]),
      explanation: placeholderText(project.explanation, []),
    }),
    language: Object.freeze({
      title: text(language.title), description: text(language.description),
      prompt: placeholderText(language.prompt, []), evidence: placeholderText(language.evidence, ["language"]),
      explanation: placeholderText(language.explanation, []),
      languages: parseLanguageTemplates(language.languages),
    }),
    ai: aiTemplate,
  });
};

const parseOrdering = (value: unknown): CrawlProfile["ordering"] => {
  const ordering = exactRecord(value, ["github", "stack"]);
  return Object.freeze({
    github: exactTexts(ordering.github, [
      "queryIndex", "committerDateDescending", "repository", "commit", "path", "blob",
    ] as const),
    stack: exactTexts(ordering.stack, [
      "configurationIndex", "stableRowId", "repository", "revision", "path", "blob",
    ] as const),
  });
};

const parseScreening = (value: unknown): CrawlProfile["screening"] => {
  const screening = exactRecord(value, [
    "excerptBytes", "minimumExcerptBytes", "languageExcerptLines", "generatedScanLines", "subjectMaxLength",
  ]);
  const parsed = {
    excerptBytes: integer(screening.excerptBytes), minimumExcerptBytes: integer(screening.minimumExcerptBytes),
    languageExcerptLines: integer(screening.languageExcerptLines), generatedScanLines: integer(screening.generatedScanLines),
    subjectMaxLength: integer(screening.subjectMaxLength),
  };
  // FR-025, FR-023, and FR-024 as amended fix these values exactly.
  if (parsed.excerptBytes !== 4096 || parsed.minimumExcerptBytes !== 64 || parsed.languageExcerptLines !== 20
    || parsed.generatedScanLines !== 30 || parsed.subjectMaxLength !== 100) fail();
  return Object.freeze(parsed);
};

const parseSelection = (value: unknown): CrawlProfile["selection"] => {
  const selection = exactRecord(value, [
    "projectRounds", "languageRounds", "aiRounds", "projectCandidates", "languageCandidates", "aiMinimumPerOutcome",
  ]);
  if (selection.projectRounds !== 5 || selection.languageRounds !== 5 || selection.aiRounds !== 5
    || selection.projectCandidates !== 4 || selection.languageCandidates !== 4 || selection.aiMinimumPerOutcome !== 2) fail();
  return Object.freeze({
    projectRounds: 5, languageRounds: 5, aiRounds: 5, projectCandidates: 4, languageCandidates: 4, aiMinimumPerOutcome: 2,
  });
};

export const parseCrawlProfile = (value: unknown): CrawlProfile => {
  scanForbidden(value);
  const root = exactRecord(value, [
    "profileVersion", "github", "stack", "aiCredits", "licenses", "templates",
    "ordering", "deduplication", "capacity", "screening", "selection",
  ]);
  if (root.profileVersion !== PROFILE_VERSION) fail();
  const github = exactRecord(root.github, ["apiVersion", "queries"]);
  if (github.apiVersion !== "2022-11-28") fail();
  const stack = exactRecord(root.stack, ["release", "revision", "configurations"]);
  if (stack.release !== "v2.2.0" || stack.revision !== "e565caa3a78c2423bd374333a472b049eb090e47") fail();
  return deepFreeze({
    profileVersion: PROFILE_VERSION,
    github: Object.freeze({ apiVersion: "2022-11-28" as const, queries: parseQueries(github.queries) }),
    stack: Object.freeze({
      release: "v2.2.0" as const,
      revision: "e565caa3a78c2423bd374333a472b049eb090e47" as const,
      configurations: parseConfigurations(stack.configurations),
    }),
    aiCredits: parseAiCredits(root.aiCredits),
    licenses: uniqueTexts(root.licenses),
    templates: parseTemplates(root.templates),
    ordering: parseOrdering(root.ordering),
    deduplication: exactTexts(root.deduplication, [
      "repository", "commit", "path", "blob", "rawContentHash", "excerptHash",
    ] as const),
    capacity: parseCapacity(root.capacity),
    screening: parseScreening(root.screening),
    selection: parseSelection(root.selection),
  });
};
