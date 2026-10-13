import "server-only";

import type {
  AuthorizedReveal,
  RevealRequest,
} from "../components/arcade/arcade-shell";
import {
  createPublicModeContract,
  type PublicModeContract,
  type PublicRoundInput,
} from "../components/arcade/mode-contract";
import { ARTIFACT_KEYS, parseArtifact } from "./local-real-experiment-artifact.server";
import {
  CORRECT_ROUND_SCORES,
  LocalRealExperimentError,
  MAXIMUM_SCORE,
  MODE_KINDS,
  ROUND_COUNT,
  ROUND_SCORES,
  RULE_SEMANTICS,
  fail,
  type DeckId,
  type JsonRecord,
  type ParsedDeck,
  type ParsedFixture,
  type PrivateReveal,
} from "./local-real-experiment-domain.server";
import {
  canonicalHash,
  deepFreeze,
  record,
  sha256,
} from "./local-real-experiment-validation.server";

export { LocalRealExperimentError };

/** One playable deck: public text and the public mode contract only. */
export interface LocalRealDeck {
  readonly id: DeckId;
  readonly title: string;
  readonly description: string;
  readonly notice: string | null;
  readonly mode: PublicModeContract;
}

export interface LocalRealExperiment {
  readonly kind: "LOCAL_UNREVIEWED_EXPERIMENT";
  readonly artifactHash: string;
  readonly decks: readonly LocalRealDeck[];
  readonly privateReveals: Readonly<Record<string, PrivateReveal>>;
  readonly createReveal: (request: RevealRequest) => AuthorizedReveal;
}

interface DerivedRound {
  readonly publicRound: PublicRoundInput;
  readonly privateReveal: PrivateReveal;
}

interface RoundVersions {
  readonly candidateSet: string;
  readonly clueSet: string;
  readonly scoring: string;
  readonly rules: string;
}

const derivePublicRound = (
  fixture: ParsedFixture,
  artifact: JsonRecord,
  versions: RoundVersions,
): PublicRoundInput => {
  const candidates = fixture.candidates.map(({ id, label }) => ({ candidateId: id, label }));
  const clues = fixture.clues.map((label, index) => ({ order: index + 1 as 1 | 2, label }));
  return {
    roundId: fixture.roundId,
    roundVersionId: fixture.roundVersion,
    excerpt: { versionId: fixture.source.excerptHash, text: fixture.excerpt },
    mode: {
      kind: MODE_KINDS[fixture.kind],
      contractVersionId: canonicalHash({ candidates, prompt: fixture.prompt }),
      calibrationVersionId: canonicalHash({
        profileHash: artifact.profileHash,
        profileVersion: fixture.source.profileVersion,
        kind: fixture.kind,
      }),
      prompt: fixture.prompt,
      candidates,
      clues,
    },
    versions,
  };
};

const derivePrivateReveal = (
  fixture: ParsedFixture,
  versions: RoundVersions,
): PrivateReveal => deepFreeze({
  roundId: fixture.roundId,
  roundVersionId: fixture.roundVersion,
  correctCandidateId: fixture.correctCandidateId,
  evidence: fixture.evidence,
  explanation: fixture.explanation,
  attribution: fixture.attribution,
  helpfulSignals: Object.freeze([...fixture.helpfulSignals]),
  misleadingSignals: Object.freeze([...fixture.misleadingSignals]),
  versions: Object.freeze({
    content: fixture.source.excerptHash,
    candidateSet: versions.candidateSet,
    scoring: versions.scoring,
    rules: versions.rules,
    evidence: canonicalHash({ evidence: fixture.evidence }),
    reveal: canonicalHash({
      explanation: fixture.explanation,
      attribution: fixture.attribution,
      correctCandidateId: fixture.correctCandidateId,
    }),
  }),
});

const deriveRound = (
  fixture: ParsedFixture,
  artifact: JsonRecord,
  scoring: string,
): DerivedRound => {
  const candidates = fixture.candidates.map(({ id, label }) => ({ candidateId: id, label }));
  const clues = fixture.clues.map((label, index) => ({ order: index + 1 as 1 | 2, label }));
  const versions = {
    candidateSet: canonicalHash(candidates),
    clueSet: canonicalHash(clues),
    scoring,
    rules: canonicalHash({
      kind: fixture.kind,
      prompt: fixture.prompt,
      semantics: RULE_SEMANTICS[fixture.kind],
    }),
  };
  return {
    publicRound: derivePublicRound(fixture, artifact, versions),
    privateReveal: derivePrivateReveal(fixture, versions),
  };
};

const deriveDecks = (
  parsedDecks: readonly ParsedDeck[],
  artifact: JsonRecord,
): Readonly<{
  decks: readonly LocalRealDeck[];
  privateReveals: Readonly<Record<string, PrivateReveal>>;
}> => {
  const scoring = canonicalHash({ scheme: "local-experiment-zero-one-two-clues.v1" });
  const reveals: PrivateReveal[] = [];
  const decks = parsedDecks.map((deck) => {
    const records = deck.fixtures.map((fixture) => deriveRound(fixture, artifact, scoring));
    const mode = createPublicModeContract({
      sessionContractVersionId: canonicalHash({
        schemaVersion: artifact.schemaVersion,
        profileHash: artifact.profileHash,
        crawlSnapshotId: (artifact.crawlSnapshot as JsonRecord).id,
        deck: deck.id,
      }),
      rounds: records.map(({ publicRound }) => publicRound),
    });
    const deckReveals = records.map(({ privateReveal }) => privateReveal);
    // Within each deck the five public identities equal the five private reveal identities.
    if (mode.rounds.map(({ roundId }) => roundId).sort().join("|")
      !== deckReveals.map(({ roundId }) => roundId).sort().join("|")) fail();
    reveals.push(...deckReveals);
    return Object.freeze({
      id: deck.id, title: deck.title, description: deck.description, notice: deck.notice, mode,
    });
  });
  const privateReveals = deepFreeze(Object.fromEntries(reveals.map((reveal) => [reveal.roundId, reveal])));
  if (Object.keys(privateReveals).length !== reveals.length) fail();
  return Object.freeze({ decks: Object.freeze(decks), privateReveals });
};

const scoreIsReachable = (score: number, completedRounds: number): boolean => {
  let reachable = new Set([0]);
  for (let round = 0; round < completedRounds; round += 1) {
    reachable = new Set([...reachable].flatMap((subtotal) =>
      ROUND_SCORES.map((points) => subtotal + points)));
  }
  return reachable.has(score);
};

const revealFor = (
  decks: readonly LocalRealDeck[],
  privateReveals: Readonly<Record<string, PrivateReveal>>,
  artifactHash: string,
  value: RevealRequest,
): AuthorizedReveal => {
  const request = record(value, [
    "roundId", "roundVersionId", "candidateId", "completedRounds", "currentScore", "cluesUsed",
  ]);
  if (!Number.isInteger(request.completedRounds) || (request.completedRounds as number) < 0
    || (request.completedRounds as number) >= ROUND_COUNT) fail();
  const completed = request.completedRounds as number;
  // The deck is derived from the round identity; order, score, and clue checks apply within it.
  const deck = decks.find(({ mode }) => mode.rounds.some(({ roundId }) => roundId === request.roundId)) ?? fail();
  const round = deck.mode.rounds[completed] ?? fail();
  if (request.roundId !== round.roundId || request.roundVersionId !== round.roundVersionId
    || !round.mode.candidates.some(({ candidateId }) => candidateId === request.candidateId)
    || !Number.isInteger(request.cluesUsed) || (request.cluesUsed as number) < 0
    || (request.cluesUsed as number) > round.mode.clues.length
    || !Number.isSafeInteger(request.currentScore) || (request.currentScore as number) < 0
    || !scoreIsReachable(request.currentScore as number, completed)) fail();
  const reveal = privateReveals[round.roundId] ?? fail();
  const correct = request.candidateId === reveal.correctCandidateId;
  const roundScore = correct
    ? CORRECT_ROUND_SCORES[request.cluesUsed as number] ?? fail()
    : 0;
  const completedRounds = completed + 1;
  return deepFreeze({
    roundId: round.roundId,
    roundVersionId: round.roundVersionId,
    correct,
    score: roundScore,
    evidence: reveal.evidence,
    explanation: reveal.explanation,
    attribution: reveal.attribution,
    helpfulSignals: reveal.helpfulSignals,
    misleadingSignals: reveal.misleadingSignals,
    versions: reveal.versions,
    result: Object.freeze({
      score: (request.currentScore as number) + roundScore,
      attainableMaximum: MAXIMUM_SCORE,
      completedRounds,
      resultVersionId: `local-experiment:${artifactHash}:round-${completedRounds}`,
    }),
  });
};

export const createLocalRealExperiment = (
  artifactInput: unknown,
  trustedArtifactHash: string,
): LocalRealExperiment => {
  try {
    const expectedArtifactHash = sha256(trustedArtifactHash);
    if (canonicalHash(artifactInput) !== expectedArtifactHash) fail();
    const artifact = record(artifactInput, ARTIFACT_KEYS);
    const { decks, privateReveals } = deriveDecks(parseArtifact(artifact), artifact);
    return Object.freeze({
      kind: "LOCAL_UNREVIEWED_EXPERIMENT",
      artifactHash: expectedArtifactHash,
      decks,
      privateReveals,
      createReveal: (request: RevealRequest) =>
        revealFor(decks, privateReveals, expectedArtifactHash, request),
    });
  } catch {
    return fail();
  }
};
