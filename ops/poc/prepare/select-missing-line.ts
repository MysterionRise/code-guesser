import { screenBlob } from "@codeguessr/content/local-poc-support";

import { CROSS_DECK_KEYS_BY_KIND, deduplicationKeys } from "../../../packages/artifact/src/index";
import { DECK_SHORT, noteRejection, rejectCandidate, type DeckAttempts, type DeckOutcome, type RunState } from "./diagnostics";
import { looksGenerated } from "./excerpt-window";
import { withoutCommentary } from "./function-windows";
import { GAP_ORDERS, gapChoices, gapSlack, type GapChoice } from "./missing-line-window";
import type { MissingLineCandidate } from "./missing-line-rounds";
import type { StackLanguage } from "./profile";
import { balancedChoice, sha256 } from "./round-helpers";
import { addHashes, collidesWithSelected, protectedScreen, unreportable } from "./selection";
import type { Context, PreparationDependencies } from "./types";

/** A missing-line round in waiting: everything but the final snapshot it is bound to. */
export type MissingLineSelection = Omit<MissingLineCandidate, "crawlSnapshotId">;

const fail = (code: string): never => { throw new Error(code); };

/** Each language's source files a round may come from; test modules and package markers aside. */
const SOURCE_FILE: Readonly<Partial<Record<StackLanguage, RegExp>>> = Object.freeze({
  Python: /^(?!test_|__init__\.py$).+(?<!_test)\.py$/u,
  Go: /^(?!.*_test\.go$).+\.go$/u,
  Java: /^(?!.*Test\.java$).+\.java$/u,
});

/** Each file offers at most this many choices to the balance, its first in seed order. */
const CHOICES_PER_FILE = 96;

type PendingRound = Omit<MissingLineSelection, keyof GapChoice | "excerptHash"> & Readonly<{ choices: readonly GapChoice[] }>;

const withChoice = (round: PendingRound, choice: GapChoice): MissingLineSelection => {
  const { choices: _choices, ...rest } = round;
  return Object.freeze({ ...rest, ...choice, excerptHash: sha256(choice.excerpt) });
};

/**
 * Selects the missing-line deck: files of the configured directories in hash order, at most `fileReads` of them,
 * skipping files another deck shows. Each file is read, its commentary removed so no comment describes the hidden
 * line, and only a file with a gap a round can hide has its licence and author bound. Once the deck is full, one
 * search picks every round's gap and decoys so the answer takes each rank about equally often in every order a
 * code-blind solver might rank four lines by: text, length, and names shared with the pane.
 */
export const selectMissingLine = async (
  context: Context,
  deps: PreparationDependencies,
  hashes: string[],
  state: RunState,
  attempt: DeckAttempts,
  otherDecks: () => readonly unknown[],
): Promise<DeckOutcome<MissingLineSelection>> => attempt<MissingLineSelection>(async () => {
  const { profile } = context;
  const deck = profile.curated!["missing-line"]!;
  const pin = profile.curated!.repositories.find(({ repository }) => repository === deck.repository)!;
  const language = pin.language;
  const target = { repository: pin.repository, commit: pin.commit };
  const keys = { deck: deduplicationKeys("MISSING_LINE", profile.profileVersion), cross: CROSS_DECK_KEYS_BY_KIND.MISSING_LINE };
  const sourceFile = SOURCE_FILE[language] ?? fail("MISSING_LINE_LANGUAGE");
  const paths: string[] = [];
  for (const directory of deck.directories) {
    try {
      const listed = await deps.listCuratedDirectory({ ...context, ...target, path: directory });
      addHashes(hashes, listed.acceptedResponseHashes);
      paths.push(...listed.value.filter((path) => sourceFile.test(path.slice(path.lastIndexOf("/") + 1))));
    } catch (error) {
      rejectCandidate(state, "ADMISSION", error);
    }
  }
  const taken = new Set(otherDecks().map((candidate) => {
    const { repository, path } = candidate as Readonly<{ repository?: unknown; path?: unknown }>;
    return `${String(repository)}:${String(path)}`;
  }));
  const order = paths.filter((path) => !taken.has(`${pin.repository}:${path}`))
    .map((path) => ({ path, key: sha256(`missing-line:${pin.repository}:${path}`) }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).map(({ path }) => path);
  const seen = new Set<string>();
  const rounds: PendingRound[] = [];

  for (const path of order.slice(0, deck.fileReads)) {
    if (rounds.length >= deck.rounds) break;
    let read;
    try {
      const result = await deps.readCuratedFile({ ...context, ...target, path });
      addHashes(hashes, result.acceptedResponseHashes);
      read = result.value;
    } catch (error) {
      rejectCandidate(state, "ADMISSION", error);
      continue;
    }
    let choices: readonly GapChoice[];
    try {
      const screened = screenBlob({ path, bytes: read.bytes }, seen);
      if (looksGenerated(screened.text, profile.screening.generatedScanLines)) fail("GENERATED_CONTENT");
      const plain = withoutCommentary(screened.text, language);
      choices = gapChoices(plain, `${pin.repository}:${path}`, deck.windowLines)
        .filter(({ excerpt }) => Buffer.byteLength(excerpt) <= profile.screening.excerptBytes).slice(0, CHOICES_PER_FILE);
      if (choices.length === 0) fail("MISSING_LINE_NO_GAP");
    } catch (error) {
      rejectCandidate(state, "SCREENING", error);
      continue;
    }
    let bound;
    try {
      const result = await deps.bindCuratedFile({ ...context, ...target, path });
      addHashes(hashes, result.acceptedResponseHashes);
      bound = result.value;
    } catch (error) {
      rejectCandidate(state, "ADMISSION", error);
      continue;
    }
    try {
      if (bound.blob !== read.blob) fail("MISSING_LINE_FILE_CHANGED");
      const pending: PendingRound = Object.freeze({
        repository: pin.repository, commit: pin.commit, path, blob: bound.blob, rawContentHash: bound.rawContentHash,
        licenseName: bound.licenseName, licenseSpdx: bound.licenseSpdx, licenseFileUrl: bound.licenseFileUrl,
        authorName: bound.author.name, authorLogin: bound.author.login, authorCommit: bound.author.commit, language, choices,
      });
      // Every pane this round could show is checked, since the deck picks its gap later.
      const panes = choices.map((choice) => withChoice(pending, choice));
      const chosen = rounds.map((other) => withChoice(other, other.choices[0]!));
      if (panes.some((pane) => collidesWithSelected(profile, pane, chosen, otherDecks(), keys))) {
        state.duplicatesRejected += 1;
        fail("SOURCE_DUPLICATE");
      }
      if (panes.some(protectedScreen(profile, [...otherDecks(), ...chosen]))) fail("PUBLIC_CONTAINMENT_REJECTED");
      if (unreportable(pending)) fail("SOURCE_IDENTITY_UNREPORTABLE");
      state.screened += 1;
      rounds.push(pending);
    } catch (error) {
      rejectCandidate(state, "SCREENING", error);
    }
  }
  if (rounds.length < deck.rounds) return { skipped: DECK_SHORT };
  const picks = balancedChoice(rounds.map(({ choices }) => choices.map(({ ranks }) => ranks)), 4, gapSlack(rounds.length));
  if (!picks || rounds.some(({ choices }) => choices.some(({ ranks }) => ranks.length !== GAP_ORDERS))) {
    noteRejection(state, "SELECTION", new Error("MISSING_LINE_RANKS_UNBALANCED"));
    return { skipped: DECK_SHORT };
  }
  return { candidates: Object.freeze(rounds.map((round, index) => withChoice(round, round.choices[picks[index]!]!))) };
});
