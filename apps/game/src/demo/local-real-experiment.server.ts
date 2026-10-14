import "server-only";

import type {
  AuthorizedReveal,
  GameRefusal,
  HintRequest,
  HintResponse,
  RevealRequest,
  RevealResponse,
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
  SessionRefusal,
  advanceGame,
  newGameId,
  recordStep,
  sealGame,
  type GameState,
} from "./local-real-experiment-session.server";
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
  /** A dealt session and the signed token that holds its progress on the server's terms. */
  readonly dealGame: (deckId: DeckId, random?: () => number, now?: number) => DealtGame;
  /** The next hint of the round being played, which lowers what a right answer scores. */
  readonly revealHint: (request: HintRequest, now?: number) => HintResponse;
  /** Locks in one answer for the round being played and reveals it, scored from the server's own state. */
  readonly answer: (request: RevealRequest, now?: number) => RevealResponse;
}

export interface DealtGame {
  readonly mode: PublicModeContract;
  readonly sessionToken: string;
}

interface DerivedRound {
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
      // Two options keep their natural A-then-B order and a fix round's lines their line order, which the deck
      // already balances; other four-option rounds are reshuffled every session.
      candidates: publicRound.mode.candidates.length > 2 && publicRound.mode.kind !== "fix"
        ? shuffle(publicRound.mode.candidates, random) : [...publicRound.mode.candidates],
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

const REJECTED: GameRefusal = Object.freeze({ ok: false, reason: "REJECTED" });
const SESSION_ENDED: GameRefusal = Object.freeze({ ok: false, reason: "SESSION_ENDED" });

/** A request's own fields, when it has exactly these and each is a non-empty string; anything else is refused. */
const strings = (value: unknown, keys: readonly string[]): Readonly<Record<string, string>> | null => {
  try {
    const request = record(value, keys);
    return keys.every((key) => typeof request[key] === "string" && (request[key] as string).length > 0)
      ? request as Record<string, string> : null;
  } catch {
    return null;
  }
};

/**
 * Runs one game transition and maps refusals to what the browser may learn: a token this server cannot continue
 * ends the session, and anything else that does not fit the game's state is rejected without detail.
 */
const transact = <Result>(
  token: string,
  artifactHash: string,
  now: number,
  transition: (state: GameState) => { next: GameState; result: Result },
): Readonly<{ ok: true; result: Result; sessionToken: string }> | GameRefusal => {
  try {
    const { result, token: sessionToken } = advanceGame(token, artifactHash, now, transition);
    return Object.freeze({ ok: true, result, sessionToken });
  } catch (error) {
    return error instanceof SessionRefusal && error.reason === "SESSION_ENDED" ? SESSION_ENDED : REJECTED;
  }
};

/** The round being played, when the request names it; a finished game has none. */
const currentRound = (rounds: ReadonlyMap<string, DerivedRound>, state: GameState, roundId: string): DerivedRound => {
  if (state.roundIndex >= ROUNDS_PER_SESSION || state.roundIds[state.roundIndex] !== roundId) fail();
  return rounds.get(roundId) ?? fail();
};

const revealFor = (
  round: DerivedRound,
  state: GameState,
  candidateId: string,
  artifactHash: string,
): { next: GameState; result: AuthorizedReveal } => {
  const { publicRound, privateReveal: reveal } = round;
  if (!publicRound.mode.candidates.some((candidate) => candidate.candidateId === candidateId)) fail();
  const correct = candidateId === reveal.correctCandidateId;
  const roundScore = correct ? publicRound.points[state.hints] ?? fail() : 0;
  const next: GameState = { ...state, step: state.step + 1, roundIndex: state.roundIndex + 1, hints: 0, score: state.score + roundScore };
  return {
    next,
    result: deepFreeze({
      roundId: publicRound.roundId,
      roundVersionId: publicRound.roundVersionId,
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
        score: next.score,
        attainableMaximum: ROUNDS_PER_SESSION * publicRound.points[0],
        completedRounds: next.roundIndex,
        resultVersionId: `local-experiment:${artifactHash}:round-${next.roundIndex}`,
      }),
    }),
  };
};

/** The pinned hash, when the artifact matches it; a pin that is not a hash, or an artifact that does not match it, is a hash mismatch. */
const pinnedHash = (artifactInput: unknown, trustedArtifactHash: string): string => {
  try {
    const expected = sha256(trustedArtifactHash);
    if (canonicalHash(artifactInput) === expected) return expected;
  } catch {
    // A malformed pin falls through to the mismatch.
  }
  return fail("HASH_MISMATCH");
};

export const createLocalRealExperiment = (
  artifactInput: unknown,
  trustedArtifactHash: string,
): LocalRealExperiment => {
  const expectedArtifactHash = pinnedHash(artifactInput, trustedArtifactHash);
  // Anything an artifact that matches its pin then fails is the schema's.
  try {
    const artifact = record(artifactInput, ARTIFACT_KEYS);
    const decks = deriveDecks(parseArtifact(artifact), artifact);
    const privateReveals = deepFreeze(Object.fromEntries(decks.flatMap(({ rounds }) =>
      rounds.map(({ privateReveal }) => [privateReveal.roundId, privateReveal]))));
    if (Object.keys(privateReveals).length !== decks.reduce((total, { rounds }) => total + rounds.length, 0)) fail();
    const rounds = new Map(decks.flatMap((derived) => derived.rounds.map((round) => [round.publicRound.roundId, round] as const)));
    const dealSession = (deckId: DeckId, random: () => number = Math.random) => {
      const derived = decks.find(({ deck }) => deck.id === deckId) ?? fail();
      return dealFrom(derived, artifact, random);
    };
    return Object.freeze({
      kind: "LOCAL_UNREVIEWED_EXPERIMENT",
      artifactHash: expectedArtifactHash,
      decks: Object.freeze(decks.map(({ deck }) => deck)),
      privateReveals,
      dealSession,
      dealGame: (deckId: DeckId, random: () => number = Math.random, now = Date.now()) => {
        const mode = dealSession(deckId, random);
        const state: GameState = {
          version: 1, gameId: newGameId(), artifactHash: expectedArtifactHash, deck: deckId,
          roundIds: mode.rounds.map(({ roundId }) => roundId), step: 0, roundIndex: 0, hints: 0, score: 0, dealtAt: now,
        };
        const sessionToken = sealGame(state);
        recordStep(state, now);
        return Object.freeze({ mode, sessionToken });
      },
      revealHint: (value: HintRequest, now = Date.now()): HintResponse => {
        const request = strings(value, ["sessionToken", "roundId"]);
        if (request === null) return REJECTED;
        const outcome = transact(request.sessionToken!, expectedArtifactHash, now, (state) => {
          const round = currentRound(rounds, state, request.roundId!);
          const hint = round.hints[state.hints] ?? fail();
          return { next: { ...state, step: state.step + 1, hints: state.hints + 1 }, result: hint };
        });
        return outcome.ok ? Object.freeze({ ok: true, hint: outcome.result, sessionToken: outcome.sessionToken }) : outcome;
      },
      answer: (value: RevealRequest, now = Date.now()): RevealResponse => {
        const request = strings(value, ["sessionToken", "roundId", "candidateId"]);
        if (request === null) return REJECTED;
        const outcome = transact(request.sessionToken!, expectedArtifactHash, now, (state) =>
          revealFor(currentRound(rounds, state, request.roundId!), state, request.candidateId!, expectedArtifactHash));
        return outcome.ok ? Object.freeze({ ok: true, reveal: outcome.result, sessionToken: outcome.sessionToken }) : outcome;
      },
    });
  } catch {
    return fail("SCHEMA");
  }
};
