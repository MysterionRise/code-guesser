export interface Candidate { candidateId: string; label: string }
export interface PublicClue { order: 1 | 2; label: string }
/** Rehearsal sessions mix provenance and language; contract revision 12 decks are one kind each. */
export type RoundModeKind = "provenance" | "language" | "project" | "ai";
const DECK_KINDS: readonly RoundModeKind[] = ["project", "language", "ai"];
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
  excerpt: { versionId: string; text: string };
  mode: RoundModeInput;
  versions: { candidateSet: string; clueSet: string; scoring: string; rules: string };
}
export interface PublicRound extends Omit<PublicRoundInput, "mode"> {
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
export function createPublicModeContract(input: PublicModeContractInput): PublicModeContract {
  if (input.rounds.length !== 5) throw new ArcadeShellRuleError("mode contract must define exactly five rounds");
  const roundIds = input.rounds.map((round) => canonical(round.roundId));
  if (new Set(roundIds).size !== roundIds.length) throw new ArcadeShellRuleError("round ids must be unique after canonicalization");
  if (input.rounds.some((round) => !["provenance", "language", "project", "ai"].includes(round.mode.kind))) throw new ArcadeShellRuleError("unsupported round mode");
  const provenance = input.rounds.filter((round) => round.mode.kind === "provenance").length;
  const language = input.rounds.filter((round) => round.mode.kind === "language").length;
  const singleDeck = DECK_KINDS.some((kind) => input.rounds.every((round) => round.mode.kind === kind));
  if (!singleDeck && (provenance !== 3 || language !== 2)) {
    throw new ArcadeShellRuleError("session must be one five-round deck or exactly three provenance and two language rounds");
  }
  const rounds = input.rounds.map((round) => {
    const { mode } = round;
    if (mode.clues.length > 2) throw new ArcadeShellRuleError("a round may expose at most two clues");
    if (mode.candidates.length < 2) throw new ArcadeShellRuleError("a round must define at least two candidates");
    const candidateIds = mode.candidates.map((candidate) => canonical(candidate.candidateId));
    if (new Set(candidateIds).size !== candidateIds.length) throw new ArcadeShellRuleError("candidate ids must be unique after canonicalization");
    const candidates = Object.freeze(mode.candidates.map((candidate) => Object.freeze({ candidateId: requirePublicText(candidate.candidateId, "candidate id"), label: requirePublicText(candidate.label, "candidate label") })));
    const clues = Object.freeze(mode.clues.map((clue, index) => {
      if (clue.order !== index + 1) throw new ArcadeShellRuleError("clues must be consecutively ordered");
      return Object.freeze({ order: clue.order, label: requirePublicText(clue.label, "clue label") });
    }));
    return Object.freeze({
      roundId: requirePublicText(round.roundId, "round id"), roundVersionId: requirePublicText(round.roundVersionId, "round version id"),
      excerpt: Object.freeze({ versionId: requirePublicText(round.excerpt.versionId, "excerpt version id"), text: requirePublicText(round.excerpt.text, "excerpt") }),
      mode: Object.freeze({ kind: mode.kind, contractVersionId: requirePublicText(mode.contractVersionId, "mode contract version"),
        calibrationVersionId: requirePublicText(mode.calibrationVersionId, "mode calibration version"), prompt: requirePublicText(mode.prompt, "mode prompt"), candidates, clues }),
      versions: Object.freeze({ candidateSet: requirePublicText(round.versions.candidateSet, "candidate set version"), clueSet: requirePublicText(round.versions.clueSet, "clue set version"),
        scoring: requirePublicText(round.versions.scoring, "scoring version"), rules: requirePublicText(round.versions.rules, "rules version") }),
    });
  });
  return Object.freeze({ sessionContractVersionId: requirePublicText(input.sessionContractVersionId, "session contract version"), rounds: Object.freeze(rounds) });
}
