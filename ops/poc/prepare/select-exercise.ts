import { screenBlob } from "@codeguessr/content/local-poc-support";

import { CROSS_DECK_KEYS_BY_KIND, DEDUPLICATION_KEYS_BY_KIND, labelStems } from "../../../packages/artifact/src/index";
import { DECK_SHORT, noteRejection, rejectCandidate, type DeckAttempts, type DeckOutcome, type RunState } from "./diagnostics";
import { looksGenerated } from "./excerpt-window";
import { namesExercise, type ExerciseCandidate } from "./exercise-rounds";
import { exerciseWindow } from "./function-windows";
import type { ExerciseEntry, ExerciseFamily } from "./profile";
import { sha256 } from "./round-helpers";
import { addHashes, collidesWithSelected, revealsProtected, unreportable } from "./selection";
import type { Context, PreparationDependencies } from "./types";

/** An exercise round in waiting: everything but the final snapshot it is bound to. */
export type ExerciseSelection = Omit<ExerciseCandidate, "crawlSnapshotId">;

const fail = (code: string): never => { throw new Error(code); };

/**
 * Selects the exercise deck, one whole family at a time: each of a family's four exercises needs
 * `roundsPerExercise` reference solutions from different tracks that yield a masked window naming none of the
 * family. Tracks take turns being tried first, so the deck spreads across languages. A family that cannot fill is
 * dropped whole, so every published family answers each of its exercises equally often.
 */
export const selectExercise = async (
  context: Context,
  deps: PreparationDependencies,
  hashes: string[],
  state: RunState,
  attempt: DeckAttempts,
  otherDecks: () => readonly unknown[],
): Promise<DeckOutcome<ExerciseSelection>> => attempt<ExerciseSelection>(async () => {
  const { profile } = context;
  const curated = profile.curated!;
  const deck = curated.exercise!;
  const limits = { maxLines: profile.screening.excerptLines, maxBytes: profile.screening.excerptBytes, minBytes: profile.screening.minimumExcerptBytes };
  const keys = { deck: DEDUPLICATION_KEYS_BY_KIND.EXERCISE, cross: CROSS_DECK_KEYS_BY_KIND.EXERCISE };
  const seen = new Set<string>();
  const rounds: ExerciseSelection[] = [];

  const tryTrack = async (family: ExerciseFamily, entry: ExerciseEntry, track: (typeof deck.tracks)[number], picked: readonly ExerciseSelection[]) => {
    const pin = curated.repositories.find(({ repository }) => repository === track.repository)!;
    const path = track.solution.replace("{slug}", entry.id);
    let bound;
    try {
      const result = await deps.bindCuratedFile({ ...context, repository: pin.repository, commit: pin.commit, path });
      addHashes(hashes, result.acceptedResponseHashes);
      bound = result.value;
    } catch (error) {
      rejectCandidate(state, "ADMISSION", error);
      return undefined;
    }
    try {
      const screened = screenBlob({ path, bytes: bound.bytes }, seen);
      if (screened.rawSha256 !== bound.rawContentHash) fail("EXERCISE_SCREEN");
      if (looksGenerated(screened.text, profile.screening.generatedScanLines)) fail("GENERATED_CONTENT");
      // Every option's names and stems are masked alike, so a word left in view never rules a decoy out.
      const terms = {
        names: family.exercises.flatMap(({ label, names }) => [label, ...names]),
        symbols: family.exercises.flatMap(({ symbols }) => symbols),
        stems: family.exercises.flatMap(({ label }) => labelStems(label)),
      };
      const window = exerciseWindow(screened.text, pin.language, terms, limits, [entry.label, ...entry.names, ...entry.symbols])
        ?? fail("EXERCISE_WINDOW");
      if (namesExercise(window.excerpt, family.exercises, true)) fail("EXERCISE_NAME_IN_CODE");
      const selection: ExerciseSelection = Object.freeze({
        familyId: family.id, exercise: entry.id, language: pin.language, repository: pin.repository, commit: pin.commit, path,
        blob: bound.blob, rawContentHash: bound.rawContentHash, licenseName: bound.licenseName, licenseSpdx: bound.licenseSpdx,
        licenseFileUrl: bound.licenseFileUrl, authorName: bound.author.name, authorLogin: bound.author.login,
        authorCommit: bound.author.commit, windowStart: window.windowStart, excerpt: window.excerpt, excerptHash: sha256(window.excerpt),
      });
      if (collidesWithSelected(profile, selection, [...rounds, ...picked], otherDecks(), keys)) {
        state.duplicatesRejected += 1;
        fail("SOURCE_DUPLICATE");
      }
      if (revealsProtected(profile, selection, [...otherDecks(), ...rounds, ...picked])) fail("PUBLIC_CONTAINMENT_REJECTED");
      if (unreportable(selection)) fail("SOURCE_IDENTITY_UNREPORTABLE");
      state.screened += 1;
      return selection;
    } catch (error) {
      rejectCandidate(state, "SCREENING", error);
      return undefined;
    }
  };

  let turn = 0;
  for (const family of deck.families) {
    if (rounds.length >= deck.rounds) break;
    const picked: ExerciseSelection[] = [];
    for (const entry of family.exercises) {
      // Tracks take turns being tried first, so the deck spreads across languages.
      const order = deck.tracks.map((_, index) => deck.tracks[(turn + index) % deck.tracks.length]!);
      const own: ExerciseSelection[] = [];
      for (const track of order) {
        if (own.length >= deck.roundsPerExercise) break;
        const selection = await tryTrack(family, entry, track, [...picked, ...own]);
        if (selection) own.push(selection);
      }
      if (own.length < deck.roundsPerExercise) break;
      picked.push(...own);
      turn += 1;
    }
    if (picked.length === family.exercises.length * deck.roundsPerExercise) rounds.push(...picked);
    else noteRejection(state, "SELECTION", new Error("EXERCISE_FAMILY_SHORT"));
  }
  if (rounds.length < deck.rounds) return { skipped: DECK_SHORT };
  return { candidates: Object.freeze(rounds) };
});
