export interface Candidate { candidateId: string; label: string; detail: string | null }
export interface PublicClue { order: 1 | 2; label: string }
export interface Pane { label: string | null; text: string }
export type RoundModeKind = "project" | "language" | "before-after";
const ROUND_KINDS: readonly RoundModeKind[] = ["project", "language", "before-after"];
/** A session deals this many rounds from one deck. */
export const SESSION_ROUNDS = 5;
export interface RoundModeInput {
  kind: RoundModeKind;
  contractVersionId: string;
  calibrationVersionId: string;
  prompt: string;
  candidates: Candidate[];
  clues: PublicClue[];
}
export interface PublicRoundInput {
  roundId: string;
  roundVersionId: string;
  /** The code the round shows: one pane, or two labelled panes to compare. */
  content: { versionId: string; panes: Pane[] };
  mode: RoundModeInput;
  /** Points for a correct answer after zero, one, or two hints. */
  points: [number, number, number];
  versions: { candidateSet: string; clueSet: string; scoring: string; rules: string };
}
export interface PublicRound extends Omit<PublicRoundInput, "mode" | "content" | "points"> {
  readonly content: Readonly<{ versionId: string; panes: readonly Readonly<Pane>[] }>;
  readonly points: readonly [number, number, number];
  readonly mode: Readonly<Omit<RoundModeInput, "candidates" | "clues">> & {
    readonly candidates: readonly Readonly<Candidate>[];
    readonly clues: readonly Readonly<PublicClue>[];
  };
}
export interface PublicModeContractInput { sessionContractVersionId: string; rounds: PublicRoundInput[] }
export interface PublicModeContract { readonly sessionContractVersionId: string; readonly rounds: readonly Readonly<PublicRound>[] }
export class ArcadeShellRuleError extends Error { override readonly name = "ArcadeShellRuleError" }
export const requirePublicText = (value: string, label: string): string => {
  if (value.trim().length === 0) throw new ArcadeShellRuleError(`${label} must not be blank`);
  return value.trim();
};
const canonical = (value: string) => value.trim().toLocaleLowerCase("en-US");
const points = (value: readonly number[]): readonly [number, number, number] => {
  if (value.length !== 3 || value.some((item) => !Number.isSafeInteger(item) || item <= 0) || !(value[0]! > value[1]! && value[1]! > value[2]!)) {
    throw new ArcadeShellRuleError("points must fall with each hint");
  }
  return Object.freeze([value[0]!, value[1]!, value[2]!]) as readonly [number, number, number];
};
/** A session is five rounds of one deck; every round keeps its code, options, hints, and points. */
export function createPublicModeContract(input: PublicModeContractInput): PublicModeContract {
  if (input.rounds.length !== SESSION_ROUNDS) throw new ArcadeShellRuleError("a session deals exactly five rounds");
  const roundIds = input.rounds.map((round) => canonical(round.roundId));
  if (new Set(roundIds).size !== roundIds.length) throw new ArcadeShellRuleError("round ids must be unique after canonicalization");
  if (input.rounds.some((round) => !ROUND_KINDS.includes(round.mode.kind))) throw new ArcadeShellRuleError("unsupported round mode");
  if (new Set(input.rounds.map((round) => round.mode.kind)).size !== 1) throw new ArcadeShellRuleError("a session deals from one deck");
  const rounds = input.rounds.map((round) => {
    const { mode } = round;
    if (mode.clues.length > 2) throw new ArcadeShellRuleError("a round may expose at most two clues");
    if (mode.candidates.length < 2) throw new ArcadeShellRuleError("a round must define at least two candidates");
    const candidateIds = mode.candidates.map((candidate) => canonical(candidate.candidateId));
    if (new Set(candidateIds).size !== candidateIds.length) throw new ArcadeShellRuleError("candidate ids must be unique after canonicalization");
    if (round.content.panes.length < 1 || round.content.panes.length > 2) throw new ArcadeShellRuleError("a round shows one or two panes of code");
    const candidates = Object.freeze(mode.candidates.map((candidate) => Object.freeze({
      candidateId: requirePublicText(candidate.candidateId, "candidate id"), label: requirePublicText(candidate.label, "candidate label"),
      detail: candidate.detail === null ? null : requirePublicText(candidate.detail, "candidate detail"),
    })));
    const clues = Object.freeze(mode.clues.map((clue, index) => {
      if (clue.order !== index + 1) throw new ArcadeShellRuleError("clues must be consecutively ordered");
      return Object.freeze({ order: clue.order, label: requirePublicText(clue.label, "clue label") });
    }));
    const panes = Object.freeze(round.content.panes.map((pane) => Object.freeze({
      label: pane.label === null ? null : requirePublicText(pane.label, "pane label"), text: requirePublicText(pane.text, "pane"),
    })));
    return Object.freeze({
      roundId: requirePublicText(round.roundId, "round id"), roundVersionId: requirePublicText(round.roundVersionId, "round version id"),
      content: Object.freeze({ versionId: requirePublicText(round.content.versionId, "content version id"), panes }),
      mode: Object.freeze({ kind: mode.kind, contractVersionId: requirePublicText(mode.contractVersionId, "mode contract version"),
        calibrationVersionId: requirePublicText(mode.calibrationVersionId, "mode calibration version"), prompt: requirePublicText(mode.prompt, "mode prompt"), candidates, clues }),
      points: points(round.points),
      versions: Object.freeze({ candidateSet: requirePublicText(round.versions.candidateSet, "candidate set version"), clueSet: requirePublicText(round.versions.clueSet, "clue set version"),
        scoring: requirePublicText(round.versions.scoring, "scoring version"), rules: requirePublicText(round.versions.rules, "rules version") }),
    });
  });
  return Object.freeze({ sessionContractVersionId: requirePublicText(input.sessionContractVersionId, "session contract version"), rounds: Object.freeze(rounds) });
}
