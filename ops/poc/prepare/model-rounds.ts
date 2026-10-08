import {
  deepFreeze,
  codeText,
  fail,
  isRecord,
  record,
  text,
  texts,
  type RecordValue,
} from "./model-validation";

const ROUNDS_PER_DECK = 5;
const DECK_MODE_KINDS = ["project", "language", "ai"] as const;
const CLUES_PER_ROUND = 2;
export type RoundModeKind = typeof DECK_MODE_KINDS[number];

export interface PublicRoundRecord {
  readonly roundId: string;
  readonly roundVersionId: string;
  readonly excerpt: Readonly<{ versionId: string; text: string }>;
  readonly mode: Readonly<{
    kind: RoundModeKind;
    contractVersionId: string;
    calibrationVersionId: string;
    prompt: string;
    candidates: readonly Readonly<{ candidateId: string; label: string }>[];
    clues: readonly Readonly<{ order: 1 | 2; label: string }>[];
  }>;
  readonly versions: Readonly<{
    candidateSet: string;
    clueSet: string;
    scoring: string;
    rules: string;
  }>;
}

export interface PrivateRevealRecord {
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

export interface RoundRecordSet {
  readonly sessionContractVersionId: string;
  /** Fifteen rounds in deck order: five project, five language, five AI. */
  readonly publicRounds: readonly PublicRoundRecord[];
  readonly privateReveals: Readonly<Record<string, PrivateRevealRecord>>;
}

const parseCandidates = (value: unknown, kind: RoundModeKind): void => {
  if (!Array.isArray(value) || value.length !== (kind === "ai" ? 2 : 4)) return fail();
  const ids = value.map((candidate) => {
    const item = record(candidate, ["candidateId", "label"]);
    text(item.label);
    return text(item.candidateId);
  });
  if (new Set(ids).size !== ids.length) fail();
};

const parseClues = (value: unknown): void => {
  if (!Array.isArray(value) || value.length !== CLUES_PER_ROUND) return fail();
  value.forEach((clue, index) => {
    const item = record(clue, ["order", "label"]);
    if (item.order !== index + 1) fail();
    text(item.label);
  });
};

const parsePublicMode = (value: unknown): void => {
  const mode = record(value, [
    "kind", "contractVersionId", "calibrationVersionId", "prompt", "candidates", "clues",
  ]);
  if (!(DECK_MODE_KINDS as readonly unknown[]).includes(mode.kind)) fail();
  for (const key of ["contractVersionId", "calibrationVersionId", "prompt"]) text(mode[key]);
  parseCandidates(mode.candidates, mode.kind as RoundModeKind);
  parseClues(mode.clues);
};

export const parsePublicRound = (value: unknown): PublicRoundRecord => {
  const round = record(value, ["roundId", "roundVersionId", "excerpt", "mode", "versions"]);
  text(round.roundId);
  text(round.roundVersionId);
  const excerpt = record(round.excerpt, ["versionId", "text"]);
  text(excerpt.versionId);
  codeText(excerpt.text);
  parsePublicMode(round.mode);
  const versions = record(round.versions, ["candidateSet", "clueSet", "scoring", "rules"]);
  Object.values(versions).forEach(text);
  return deepFreeze(structuredClone(round)) as unknown as PublicRoundRecord;
};

export const parsePrivateReveal = (value: unknown): PrivateRevealRecord => {
  const reveal = record(value, [
    "roundId", "roundVersionId", "correctCandidateId", "evidence", "explanation",
    "attribution", "helpfulSignals", "misleadingSignals", "versions",
  ]);
  for (const key of [
    "roundId", "roundVersionId", "correctCandidateId", "evidence", "explanation", "attribution",
  ]) text(reveal[key]);
  texts(reveal.helpfulSignals);
  texts(reveal.misleadingSignals);
  const versions = record(reveal.versions, [
    "content", "candidateSet", "scoring", "rules", "evidence", "reveal",
  ]);
  Object.values(versions).forEach(text);
  return deepFreeze(structuredClone(reveal)) as unknown as PrivateRevealRecord;
};

const parsePrivateMap = (value: unknown, total: number): Record<string, PrivateRevealRecord> => {
  if (!isRecord(value) || Object.keys(value).length !== total) return fail();
  return Object.fromEntries(Object.entries(value as RecordValue).map(([roundId, reveal]) => {
    text(roundId);
    const parsed = parsePrivateReveal(reveal);
    if (parsed.roundId !== roundId) fail();
    return [roundId, parsed];
  }));
};

const requireRoundBinding = (
  round: PublicRoundRecord,
  reveal: PrivateRevealRecord,
): void => {
  if (round.roundVersionId !== reveal.roundVersionId) fail();
  if (round.excerpt.versionId !== reveal.versions.content) fail();
  for (const key of ["candidateSet", "scoring", "rules"] as const) {
    if (round.versions[key] !== reveal.versions[key]) fail();
  }
  if (!round.mode.candidates.some(({ candidateId }) => candidateId === reveal.correctCandidateId)) fail();
};

const requireComposition = (rounds: readonly PublicRoundRecord[]): void => {
  const expected = DECK_MODE_KINDS.flatMap((kind) => Array.from({ length: ROUNDS_PER_DECK }, () => kind));
  if (rounds.map(({ mode }) => mode.kind).join("|") !== expected.join("|")) fail();
  const ids = rounds.map(({ roundId }) => roundId);
  if (new Set(ids).size !== ids.length) fail();
};

export const parseRoundRecordSet = (value: unknown): RoundRecordSet => {
  const set = record(value, ["sessionContractVersionId", "publicRounds", "privateReveals"]);
  text(set.sessionContractVersionId);
  const total = DECK_MODE_KINDS.length * ROUNDS_PER_DECK;
  if (!Array.isArray(set.publicRounds) || set.publicRounds.length !== total) return fail();
  const publicRounds = set.publicRounds.map(parsePublicRound);
  requireComposition(publicRounds);
  const privateReveals = parsePrivateMap(set.privateReveals, total);
  const publicIds = publicRounds.map(({ roundId }) => roundId).sort();
  if (publicIds.join("|") !== Object.keys(privateReveals).sort().join("|")) fail();
  for (const round of publicRounds) requireRoundBinding(round, privateReveals[round.roundId]!);
  return deepFreeze({
    sessionContractVersionId: set.sessionContractVersionId as string,
    publicRounds,
    privateReveals,
  });
};
