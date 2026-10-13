import "server-only";

/** Contract revision 12: three decks of five rounds, scored independently. */
export const DECK_IDS = ["project", "language", "ai"] as const;
export type DeckId = typeof DECK_IDS[number];
export type FixtureKind = "PROJECT" | "LANGUAGE" | "AI_CREDIT";
export const DECK_KINDS: Readonly<Record<DeckId, FixtureKind>> = Object.freeze({
  project: "PROJECT", language: "LANGUAGE", ai: "AI_CREDIT",
});
export const MODE_KINDS: Readonly<Record<FixtureKind, DeckId>> = Object.freeze({
  PROJECT: "project", LANGUAGE: "language", AI_CREDIT: "ai",
});
export const ROUND_COUNT = 5;
export const ROUND_SCORES = [0, 500, 800, 1000] as const;
export const CORRECT_ROUND_SCORES = [1000, 800, 500] as const;
export const MAXIMUM_SCORE = 5000;
export const STACK_REVISION = "e565caa3a78c2423bd374333a472b049eb090e47";
export const PROFILE_VERSION = "local-real-rounds.v2";
export const STACK_LANGUAGES = ["Python", "TypeScript", "Go", "Rust", "Ruby"] as const;
export const AI_CANDIDATES = [
  "local-experiment.ai-credit-recorded.v2",
  "local-experiment.ai-credit-absent.v2",
] as const;
/** FR-025 candidate universe: the five answers and every signed distractor, with identifier slugs. */
export const LANGUAGE_SLUGS: Readonly<Record<string, string>> = Object.freeze({
  Python: "python", TypeScript: "typescript", JavaScript: "javascript", Go: "go", Rust: "rust", Java: "java",
  Ruby: "ruby", "C#": "csharp", Kotlin: "kotlin", Swift: "swift", PHP: "php", "C++": "cpp",
});
export const RULE_SEMANTICS: Readonly<Record<FixtureKind, string>> = Object.freeze({
  PROJECT: "pinned-repository-record.v2",
  LANGUAGE: "pinned-extension-language.v2",
  AI_CREDIT: "commit-message-ai-credit.v2",
});

export type JsonRecord = Record<string, unknown>;

export interface ParsedSource extends JsonRecord {
  readonly discoverySource: "GITHUB_COMMIT_SEARCH" | "STACK_V2";
  readonly repository: string;
  readonly authorName: string;
  readonly path: string;
  readonly commit: string;
  readonly blob: string;
  readonly excerptHash: string;
  readonly licenseName: string;
  readonly licenseSpdx: string;
  readonly blobUrl: string;
  readonly profileVersion: string;
  readonly crawlSnapshotId: string;
  readonly aiCreditRecorded?: boolean;
  readonly configuration?: typeof STACK_LANGUAGES[number];
}

export interface ParsedFixture {
  readonly kind: FixtureKind;
  readonly roundId: string;
  readonly roundVersion: string;
  readonly excerpt: string;
  readonly prompt: string;
  readonly candidates: readonly Readonly<{ id: string; label: string }>[];
  readonly clues: readonly string[];
  readonly correctCandidateId: string;
  readonly evidence: string;
  readonly explanation: string;
  readonly attribution: string;
  readonly helpfulSignals: readonly string[];
  readonly misleadingSignals: readonly string[];
  readonly source: Readonly<ParsedSource>;
}

export interface ParsedDeck {
  readonly id: DeckId;
  readonly title: string;
  readonly description: string;
  readonly notice: string | null;
  readonly fixtures: readonly ParsedFixture[];
}

export interface PrivateReveal {
  readonly roundId: string;
  readonly roundVersionId: string;
  readonly correctCandidateId: string;
  readonly evidence: string;
  readonly explanation: string;
  readonly attribution: string;
  readonly helpfulSignals: readonly string[];
  readonly misleadingSignals: readonly string[];
  readonly versions: Readonly<{
    content: string;
    candidateSet: string;
    scoring: string;
    rules: string;
    evidence: string;
    reveal: string;
  }>;
}

export class LocalRealExperimentError extends Error {
  public constructor() {
    super("LOCAL_REAL_EXPERIMENT_REJECTED");
    this.name = "LocalRealExperimentError";
  }
}

export const fail = (): never => { throw new LocalRealExperimentError(); };
