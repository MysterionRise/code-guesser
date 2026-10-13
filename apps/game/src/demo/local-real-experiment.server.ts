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
  LocalRealExperimentError,
  MODE_KINDS,
  ROUNDS_PER_SESSION,
  RULE_SEMANTICS,
  fail,
  roundPoints,
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

/** One playable deck as the chooser shows it; sessions are dealt from its pool on request. */
export interface LocalRealDeck {
  readonly id: DeckId;
  readonly title: string;
  readonly description: string;
  readonly poolSize: number;
}

export interface LocalRealExperiment {
  readonly kind: "LOCAL_UNREVIEWED_EXPERIMENT";
  readonly artifactHash: string;
  readonly decks: readonly LocalRealDeck[];
  readonly privateReveals: Readonly<Record<string, PrivateReveal>>;
  /** Five rounds drawn at random from the deck's pool, each four-option round's options in a fresh order. */
  readonly dealSession: (deckId: DeckId, random?: () => number) => PublicModeContract;
  readonly createReveal: (request: RevealRequest) => AuthorizedReveal;
}

interface DerivedRound {
  readonly publicRound: PublicRoundInput;
  readonly privateReveal: PrivateReveal;
}

interface DerivedDeck {
  readonly deck: LocalRealDeck;
  readonly rounds: readonly DerivedRound[];
}

const SCORING = canonicalHash({ scheme: "local-experiment-chance-equal-points.v1" });

const pointsFor = (fixture: ParsedFixture): [number, number, number] => {
  const count = fixture.candidates.length;
  return [roundPoints(count, 0), roundPoints(count, 1), roundPoints(count, 2)];
};

const deriveRound = (fixture: ParsedFixture, artifact: JsonRecord): DerivedRound => {
  const candidates = fixture.candidates.map(({ id, label, detail }) => ({ candidateId: id, label, detail }));
  const clues = fixture.clues.map((label, index) => ({ order: index + 1 as 1 | 2, label }));
  const panes = fixture.panes.map(({ label, text }) => ({ label, text }));
  const versions = {
    // Order-free, so a session's shuffled options keep the round's version.
    candidateSet: canonicalHash([...candidates].sort((left, right) => left.candidateId < right.candidateId ? -1 : 1)),
    clueSet: canonicalHash(clues),
    scoring: SCORING,
    rules: canonicalHash({ kind: fixture.kind, prompt: fixture.prompt, semantics: RULE_SEMANTICS[fixture.kind] }),
  };
  const content = canonicalHash(panes);
  const publicRound: PublicRoundInput = {
    roundId: fixture.roundId,
    roundVersionId: fixture.roundVersion,
    content: { versionId: content, panes },
    mode: {
      kind: MODE_KINDS[fixture.kind],
      contractVersionId: canonicalHash({ candidates: versions.candidateSet, prompt: fixture.prompt }),
      calibrationVersionId: canonicalHash({ profileHash: artifact.profileHash, profileVersion: fixture.source.profileVersion, kind: fixture.kind }),
      prompt: fixture.prompt,
      candidates,
      clues,
    },
    points: pointsFor(fixture),
    versions,
  };
  const privateReveal: PrivateReveal = deepFreeze({
    roundId: fixture.roundId,
    roundVersionId: fixture.roundVersion,
    correctCandidateId: fixture.correctCandidateId,
    evidence: fixture.evidence,
    explanation: fixture.explanation,
    attribution: fixture.attribution,
    helpfulSignals: Object.freeze([...fixture.helpfulSignals]),
    misleadingSignals: Object.freeze([...fixture.misleadingSignals]),
    versions: Object.freeze({
      content,
      candidateSet: versions.candidateSet,
      scoring: versions.scoring,
      rules: versions.rules,
      evidence: canonicalHash({ evidence: fixture.evidence }),
      reveal: canonicalHash({ explanation: fixture.explanation, attribution: fixture.attribution, correctCandidateId: fixture.correctCandidateId }),
    }),
  });
  return Object.freeze({ publicRound, privateReveal });
};

const deriveDecks = (parsedDecks: readonly ParsedDeck[], artifact: JsonRecord): readonly DerivedDeck[] =>
  Object.freeze(parsedDecks.map((deck) => Object.freeze({
    deck: Object.freeze({ id: deck.id, title: deck.title, description: deck.description, poolSize: deck.fixtures.length }),
    rounds: Object.freeze(deck.fixtures.map((fixture) => deriveRound(fixture, artifact))),
  })));

/** Fisher-Yates with an injectable source of randomness, so tests can deal a known session. */
const shuffle = <Item>(items: readonly Item[], random: () => number): Item[] => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
};

const dealFrom = (derived: DerivedDeck, artifact: JsonRecord, random: () => number): PublicModeContract => {
  const rounds = shuffle(derived.rounds, random).slice(0, ROUNDS_PER_SESSION).map(({ publicRound }) => ({
    ...publicRound,
    mode: {
      ...publicRound.mode,
      // Two options keep their natural A-then-B order; four are reshuffled every session.
      candidates: publicRound.mode.candidates.length > 2 ? shuffle(publicRound.mode.candidates, random) : [...publicRound.mode.candidates],
    },
  }));
  return createPublicModeContract({
    sessionContractVersionId: canonicalHash({
      schemaVersion: artifact.schemaVersion,
      profileHash: artifact.profileHash,
      crawlSnapshotId: (artifact.crawlSnapshot as JsonRecord).id,
      deck: derived.deck.id,
      rounds: rounds.map(({ roundId }) => roundId),
    }),
    rounds,
  });
};

/** Whether a total is a sum of exactly `completedRounds` round scores from this points table. */
const scoreIsReachable = (score: number, completedRounds: number, points: readonly number[]): boolean => {
  let reachable = new Set([0]);
  for (let round = 0; round < completedRounds; round += 1) {
    reachable = new Set([...reachable].flatMap((subtotal) => [0, ...points].map((value) => subtotal + value)));
  }
  return reachable.has(score);
};

const revealFor = (
  decks: readonly DerivedDeck[],
  privateReveals: Readonly<Record<string, PrivateReveal>>,
  artifactHash: string,
  value: RevealRequest,
): AuthorizedReveal => {
  const request = record(value, ["roundId", "roundVersionId", "candidateId", "completedRounds", "currentScore", "cluesUsed"]);
  if (!Number.isInteger(request.completedRounds) || (request.completedRounds as number) < 0
    || (request.completedRounds as number) >= ROUNDS_PER_SESSION) fail();
  const completed = request.completedRounds as number;
  // The deck comes from the round's identity; the score and clue checks apply within it.
  const derived = decks.find(({ rounds }) => rounds.some(({ publicRound }) => publicRound.roundId === request.roundId)) ?? fail();
  const round = derived.rounds.find(({ publicRound }) => publicRound.roundId === request.roundId)!.publicRound;
  if (request.roundVersionId !== round.roundVersionId
    || !round.mode.candidates.some(({ candidateId }) => candidateId === request.candidateId)
    || !Number.isInteger(request.cluesUsed) || (request.cluesUsed as number) < 0
    || (request.cluesUsed as number) > round.mode.clues.length
    || !Number.isSafeInteger(request.currentScore) || (request.currentScore as number) < 0
    || !scoreIsReachable(request.currentScore as number, completed, round.points)) fail();
  const reveal = privateReveals[round.roundId] ?? fail();
  const correct = request.candidateId === reveal.correctCandidateId;
  const roundScore = correct ? round.points[request.cluesUsed as number] ?? fail() : 0;
  const completedRounds = completed + 1;
  return deepFreeze({
    roundId: round.roundId,
    roundVersionId: round.roundVersionId,
    correct,
    answerCandidateId: reveal.correctCandidateId,
    score: roundScore,
    evidence: reveal.evidence,
    explanation: reveal.explanation,
    attribution: reveal.attribution,
    helpfulSignals: reveal.helpfulSignals,
    misleadingSignals: reveal.misleadingSignals,
    versions: reveal.versions,
    result: Object.freeze({
      score: (request.currentScore as number) + roundScore,
      attainableMaximum: ROUNDS_PER_SESSION * round.points[0],
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
    const decks = deriveDecks(parseArtifact(artifact), artifact);
    const privateReveals = deepFreeze(Object.fromEntries(decks.flatMap(({ rounds }) =>
      rounds.map(({ privateReveal }) => [privateReveal.roundId, privateReveal]))));
    if (Object.keys(privateReveals).length !== decks.reduce((total, { rounds }) => total + rounds.length, 0)) fail();
    return Object.freeze({
      kind: "LOCAL_UNREVIEWED_EXPERIMENT",
      artifactHash: expectedArtifactHash,
      decks: Object.freeze(decks.map(({ deck }) => deck)),
      privateReveals,
      dealSession: (deckId: DeckId, random: () => number = Math.random) => {
        const derived = decks.find(({ deck }) => deck.id === deckId) ?? fail();
        return dealFrom(derived, artifact, random);
      },
      createReveal: (request: RevealRequest) => {
        try {
          return revealFor(decks, privateReveals, expectedArtifactHash, request);
        } catch {
          return fail();
        }
      },
    });
  } catch {
    return fail();
  }
};
