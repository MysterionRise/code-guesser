import { screenBlob } from "@codeguessr/content/local-poc-support";

import {
  CROSS_DECK_KEYS_BY_KIND, deduplicationKeys, labelStems, namesAlgorithm, showsLabelStem,
} from "../../../packages/artifact/src/index";
import type { AlgorithmCandidate } from "./algorithm-rounds";
import { DECK_SHORT, noteRejection, rejectCandidate, type DeckAttempts, type DeckOutcome, type RunState } from "./diagnostics";
import { looksGenerated } from "./excerpt-window";
import { algorithmWindow } from "./function-windows";
import type { AlgorithmEntry, AlgorithmFamily } from "./profile";
import { sha256 } from "./round-helpers";
import { addHashes, collidesWithSelected, revealsProtected, unreportable } from "./selection";
import type { Context, PreparationDependencies } from "./types";

/** An algorithm round in waiting: everything but the final snapshot it is bound to. */
export type AlgorithmSelection = Omit<AlgorithmCandidate, "crawlSnapshotId">;

const fail = (code: string): never => { throw new Error(code); };

/**
 * Selects the algorithm deck, one whole family at a time: each of a family's four algorithms needs a file that
 * yields a masked window naming none of the four, read in the language whose turn it is first, then in the others;
 * from v7 on (#167) it needs `roundsPerAlgorithm` of them, each in another language. A family that cannot fill is
 * dropped whole, so every published family answers each of its algorithms equally often.
 */
export const selectAlgorithm = async (
  context: Context,
  deps: PreparationDependencies,
  hashes: string[],
  state: RunState,
  attempt: DeckAttempts,
  otherDecks: () => readonly unknown[],
): Promise<DeckOutcome<AlgorithmSelection>> => attempt<AlgorithmSelection>(async () => {
  const { profile } = context;
  const curated = profile.curated!;
  const deck = curated.algorithm!;
  const repositories = curated.repositories;
  const limits = { maxLines: profile.screening.excerptLines, maxBytes: profile.screening.excerptBytes, minBytes: profile.screening.minimumExcerptBytes };
  const keys = { deck: deduplicationKeys("ALGORITHM", profile.profileVersion), cross: CROSS_DECK_KEYS_BY_KIND.ALGORITHM };
  const seen = new Set<string>();
  const rounds: AlgorithmSelection[] = [];

  const tryFile = async (family: AlgorithmFamily, entry: AlgorithmEntry, repository: string, picked: readonly AlgorithmSelection[]) => {
    const pin = repositories.find((known) => known.repository === repository)!;
    const file = entry.files[repository]!;
    let bound;
    try {
      const result = await deps.bindCuratedFile({ ...context, repository, commit: pin.commit, path: file.path });
      addHashes(hashes, result.acceptedResponseHashes);
      bound = result.value;
    } catch (error) {
      rejectCandidate(state, "ADMISSION", error);
      return undefined;
    }
    try {
      const screened = screenBlob({ path: file.path, bytes: bound.bytes }, seen);
      if (screened.rawSha256 !== bound.rawContentHash) fail("ALGORITHM_SCREEN");
      if (looksGenerated(screened.text, profile.screening.generatedScanLines)) fail("GENERATED_CONTENT");
      // Every option's stems are masked alike, so a word left in view never rules a decoy out.
      const stems = family.algorithms.flatMap(({ label }) => labelStems(label));
      const window = algorithmWindow(screened.text, pin.language,
        { names: [entry.label, ...entry.names], symbols: file.symbols, stems }, limits) ?? fail("ALGORITHM_WINDOW");
      if (family.algorithms.some((option) => namesAlgorithm(window.excerpt, option) || showsLabelStem(window.excerpt, option.label))) {
        fail("ALGORITHM_NAME_IN_CODE");
      }
      const selection: AlgorithmSelection = Object.freeze({
        familyId: family.id, algorithmId: entry.id, language: pin.language, repository, commit: pin.commit, path: file.path,
        blob: bound.blob, rawContentHash: bound.rawContentHash, licenseName: bound.licenseName, licenseSpdx: bound.licenseSpdx,
        licenseFileUrl: bound.licenseFileUrl, authorName: bound.author.name, authorLogin: bound.author.login,
        authorCommit: bound.author.commit, excerpt: window.excerpt, excerptHash: sha256(window.excerpt), functionName: window.functionName,
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

  const answers = deck.roundsPerAlgorithm ?? 1;
  const languageOf = (repository: string) => repositories.find((known) => known.repository === repository)!.language;
  let turn = 0;
  for (const family of deck.families) {
    if (rounds.length >= deck.rounds) break;
    const picked: AlgorithmSelection[] = [];
    for (const entry of family.algorithms) {
      // Languages take turns being tried first, so the deck spreads across them; each answer is in another language.
      const order = repositories.map((_, index) => repositories[(turn + index) % repositories.length]!.repository)
        .filter((repository) => entry.files[repository] !== undefined);
      const selections: AlgorithmSelection[] = [];
      for (const repository of order) {
        if (selections.length >= answers) break;
        if (selections.some(({ language }) => language === languageOf(repository))) continue;
        const selection = await tryFile(family, entry, repository, [...picked, ...selections]);
        if (selection) selections.push(selection);
      }
      if (selections.length < answers) break;
      picked.push(...selections);
      turn += 1;
    }
    if (picked.length === family.algorithms.length * answers) rounds.push(...picked);
    else noteRejection(state, "SELECTION", new Error("ALGORITHM_FAMILY_SHORT"));
  }
  if (rounds.length < deck.rounds) return { skipped: DECK_SHORT };
  return { candidates: Object.freeze(rounds) };
});
