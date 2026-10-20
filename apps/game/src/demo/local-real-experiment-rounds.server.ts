import "server-only";

import {
  LINE_KINDS,
  createPublicModeContract,
  type PublicModeContract,
  type PublicRoundInput,
} from "../components/arcade/mode-contract";
import {
  MODE_KINDS,
  ROUNDS_PER_SESSION,
  RULE_SEMANTICS,
  roundPoints,
  type DeckId,
  type SessionDeckId,
  type JsonRecord,
  type ParsedDeck,
  type ParsedFixture,
  type PrivateReveal,
} from "./local-real-experiment-domain.server";
import { shuffle } from "./local-real-experiment-deal.server";
import { canonicalHash, deepFreeze } from "./local-real-experiment-validation.server";

/** One playable deck as the chooser shows it; sessions are dealt from its pool on request. */
export interface LocalRealDeck {
  readonly id: DeckId;
  readonly title: string;
  readonly description: string;
  readonly poolSize: number;
}

export interface DerivedRound {
  readonly publicRound: PublicRoundInput;
  /** Hint text stays on the server until a player buys it; the public round carries only each hint's place. */
  readonly hints: readonly string[];
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
  const hints = Object.freeze([...fixture.clues]);
  const clues = hints.map((_, index) => ({ order: index + 1 as 1 | 2 }));
  const panes = fixture.panes.map(({ label, text }) => ({ label, text }));
  const versions = {
    // Order-free, so a session's shuffled options keep the round's version.
    candidateSet: canonicalHash([...candidates].sort((left, right) => left.candidateId < right.candidateId ? -1 : 1)),
    clueSet: canonicalHash(hints.map((label, index) => ({ order: index + 1, label }))),
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
  return Object.freeze({ publicRound, hints, privateReveal });
};

/** Each parsed deck as the chooser lists it, and its rounds as the server holds them. */
export const deriveDecks = (parsedDecks: readonly ParsedDeck[], artifact: JsonRecord): readonly DerivedDeck[] =>
  Object.freeze(parsedDecks.map((deck) => Object.freeze({
    deck: Object.freeze({ id: deck.id, title: deck.title, description: deck.description, poolSize: deck.fixtures.length }),
    rounds: Object.freeze(deck.fixtures.map((fixture) => deriveRound(fixture, artifact))),
  })));

/** A session of the pool's first five rounds, versioned by the artifact, the deck that dealt them, and their ids. */
export const dealFrom = (deck: SessionDeckId, pool: readonly DerivedRound[], artifact: JsonRecord, random: () => number): PublicModeContract => {
  const rounds = pool.slice(0, ROUNDS_PER_SESSION).map(({ publicRound }) => ({
    ...publicRound,
    mode: {
      ...publicRound.mode,
      // Two options keep their natural A-then-B order and a fix or vulnerable-line round's lines their line order,
      // which the deck already balances; other four-option rounds are reshuffled every session.
      candidates: publicRound.mode.candidates.length > 2 && !LINE_KINDS.has(publicRound.mode.kind)
        ? shuffle(publicRound.mode.candidates, random) : [...publicRound.mode.candidates],
    },
  }));
  return createPublicModeContract({
    sessionContractVersionId: canonicalHash({
      schemaVersion: artifact.schemaVersion,
      profileHash: artifact.profileHash,
      crawlSnapshotId: (artifact.crawlSnapshot as JsonRecord).id,
      deck,
      rounds: rounds.map(({ roundId }) => roundId),
    }),
    rounds,
  });
};
