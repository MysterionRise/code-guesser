import "server-only";

export {
  CANDIDATE_COUNTS,
  DECK_IDS,
  DECK_KINDS,
  MODE_KINDS,
  ROUNDS_PER_SESSION,
  roundPoints,
  type DeckId,
  type FixtureKind,
  type JsonRecord,
  type ParsedDeck,
  type ParsedFixture,
  type ParsedSource,
} from "../../../../packages/artifact/src/index";
import type { FixtureKind } from "../../../../packages/artifact/src/index";

/** What decides each kind's answer; part of every round's rules version. */
export const RULE_SEMANTICS: Readonly<Record<FixtureKind, string>> = Object.freeze({
  PROJECT: "stack-repository-record.v3",
  LANGUAGE: "stack-recorded-language.v3",
  BEFORE_AFTER: "commit-parent-lineage.v3",
  ALGORITHM: "curated-algorithm-path.v3",
  OUTPUT: "curated-doctest-output.v3",
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
