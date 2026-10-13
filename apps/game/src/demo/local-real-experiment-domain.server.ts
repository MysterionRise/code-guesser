import "server-only";

export {
  DECK_IDS,
  DECK_KINDS,
  MODE_KINDS,
  ROUNDS_PER_DECK as ROUND_COUNT,
  type DeckId,
  type FixtureKind,
  type JsonRecord,
  type ParsedDeck,
  type ParsedFixture,
  type ParsedSource,
} from "../../../../packages/artifact/src/index";
import type { FixtureKind } from "../../../../packages/artifact/src/index";

/** Every score one round can award. */
export const ROUND_SCORES = [0, 500, 800, 1000] as const;
/** Points for a correct answer after zero, one, or two clues; a wrong answer scores nothing. */
export const CORRECT_ROUND_SCORES = [1000, 800, 500] as const;
export const MAXIMUM_SCORE = 5000;
export const RULE_SEMANTICS: Readonly<Record<FixtureKind, string>> = Object.freeze({
  PROJECT: "pinned-repository-record.v2",
  LANGUAGE: "pinned-extension-language.v2",
  AI_CREDIT: "commit-message-ai-credit.v2",
});

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
