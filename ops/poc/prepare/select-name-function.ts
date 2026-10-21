import { screenBlob } from "@codeguessr/content/local-poc-support";

import { CROSS_DECK_KEYS_BY_KIND, deduplicationKeys } from "../../../packages/artifact/src/index";
import { DECK_SHORT, noteRejection, rejectCandidate, type DeckAttempts, type DeckOutcome, type RunState } from "./diagnostics";
import { looksGenerated } from "./excerpt-window";
import { withoutCommentary } from "./function-windows";
import { NAME_ORDERS, nameChoices, nameExtremeLimits, nameSlack, type NameChoice } from "./name-function-window";
import type { NameFunctionCandidate } from "./name-function-rounds";
import type { StackLanguage } from "./profile";
import { balancedChoice, sha256 } from "./round-helpers";
import { addHashes, collidesWithSelected, revealsProtected, unreportable } from "./selection";
import type { Context, PreparationDependencies } from "./types";

/** A name-the-function round in waiting: everything but the final snapshot it is bound to. */
export type NameFunctionSelection = Omit<NameFunctionCandidate, "crawlSnapshotId">;

const fail = (code: string): never => { throw new Error(code); };

/** Each language's source files a round may come from; test modules and package markers aside. */
const SOURCE_FILE: Readonly<Partial<Record<StackLanguage, RegExp>>> = Object.freeze({
  Python: /^(?!test_|__init__\.py$).+(?<!_test)\.py$/u,
  Go: /^(?!.*_test\.go$).+\.go$/u,
  Java: /^(?!.*Test\.java$).+\.java$/u,
});

/** Each file offers at most this many choices to the balance, its first in seed order. */
const CHOICES_PER_FILE = 96;

type PendingRound = Omit<NameFunctionSelection, keyof NameChoice | "excerptHash"> & Readonly<{ choices: readonly NameChoice[] }>;

const withChoice = (round: PendingRound, choice: NameChoice): NameFunctionSelection => {
  const { choices: _choices, ...rest } = round;
  return Object.freeze({ ...rest, ...choice, excerptHash: sha256(choice.excerpt) });
};

/**
 * Selects the name-the-function deck: files of every source's directories in one hash order, at most `fileReads` of
 * them, skipping files another deck shows. Each file is read and its commentary removed, so no comment names the
 * function; only a file with a function a round can ask about has its licence and author bound. Once the deck is
 * full, one search picks every round's function and decoys so the answer takes each rank equally often in text and
 * length order, and no solver that picks the name with the most or fewest of a feature scores past its limit.
 */
export const selectNameFunction = async (
  context: Context,
  deps: PreparationDependencies,
  hashes: string[],
  state: RunState,
  attempt: DeckAttempts,
  otherDecks: () => readonly unknown[],
): Promise<DeckOutcome<NameFunctionSelection>> => attempt<NameFunctionSelection>(async () => {
  const { profile } = context;
  const deck = profile.curated!["name-function"]!;
  const keys = { deck: deduplicationKeys("NAME_FUNCTION", profile.profileVersion), cross: CROSS_DECK_KEYS_BY_KIND.NAME_FUNCTION };
  const files: Readonly<{ repository: string; commit: string; language: StackLanguage; path: string; key: string }>[] = [];
  for (const { repository, directories } of deck.sources) {
    const pin = profile.curated!.repositories.find((known) => known.repository === repository)!;
    const sourceFile = SOURCE_FILE[pin.language] ?? fail("NAME_FUNCTION_LANGUAGE");
    for (const directory of directories) {
      try {
        const listed = await deps.listCuratedDirectory({ ...context, repository, commit: pin.commit, path: directory });
        addHashes(hashes, listed.acceptedResponseHashes);
        files.push(...listed.value.filter((path) => sourceFile.test(path.slice(path.lastIndexOf("/") + 1)))
          .map((path) => ({ repository, commit: pin.commit, language: pin.language, path, key: sha256(`name-function:${repository}:${path}`) })));
      } catch (error) {
        rejectCandidate(state, "ADMISSION", error);
      }
    }
  }
  const taken = new Set(otherDecks().map((candidate) => {
    const { repository, path } = candidate as Readonly<{ repository?: unknown; path?: unknown }>;
    return `${String(repository)}:${String(path)}`;
  }));
  const order = files.filter(({ repository, path }) => !taken.has(`${repository}:${path}`))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  const seen = new Set<string>();
  const rounds: PendingRound[] = [];

  for (const { repository, commit, language, path } of order.slice(0, deck.fileReads)) {
    if (rounds.length >= deck.rounds) break;
    const target = { repository, commit, path };
    let read;
    try {
      const result = await deps.readCuratedFile({ ...context, ...target });
      addHashes(hashes, result.acceptedResponseHashes);
      read = result.value;
    } catch (error) {
      rejectCandidate(state, "ADMISSION", error);
      continue;
    }
    let choices: readonly NameChoice[];
    try {
      const screened = screenBlob({ path, bytes: read.bytes }, seen);
      if (looksGenerated(screened.text, profile.screening.generatedScanLines)) fail("GENERATED_CONTENT");
      const plain = withoutCommentary(screened.text, language);
      choices = nameChoices(plain, language, `${repository}:${path}`, deck.functionLines)
        .filter(({ excerpt }) => Buffer.byteLength(excerpt) <= profile.screening.excerptBytes).slice(0, CHOICES_PER_FILE);
      if (choices.length === 0) fail("NAME_FUNCTION_NONE");
    } catch (error) {
      rejectCandidate(state, "SCREENING", error);
      continue;
    }
    let bound;
    try {
      const result = await deps.bindCuratedFile({ ...context, ...target });
      addHashes(hashes, result.acceptedResponseHashes);
      bound = result.value;
    } catch (error) {
      rejectCandidate(state, "ADMISSION", error);
      continue;
    }
    try {
      if (bound.blob !== read.blob) fail("NAME_FUNCTION_FILE_CHANGED");
      const pending: PendingRound = Object.freeze({
        repository, commit, path, blob: bound.blob, rawContentHash: bound.rawContentHash,
        licenseName: bound.licenseName, licenseSpdx: bound.licenseSpdx, licenseFileUrl: bound.licenseFileUrl,
        authorName: bound.author.name, authorLogin: bound.author.login, authorCommit: bound.author.commit, language, choices,
      });
      // Every pane this round could show is checked, since the deck picks its function later.
      const panes = choices.map((choice) => withChoice(pending, choice));
      const chosen = rounds.map((other) => withChoice(other, other.choices[0]!));
      if (panes.some((pane) => collidesWithSelected(profile, pane, chosen, otherDecks(), keys))) {
        state.duplicatesRejected += 1;
        fail("SOURCE_DUPLICATE");
      }
      if (panes.some((pane) => revealsProtected(profile, pane, [...otherDecks(), ...chosen]))) fail("PUBLIC_CONTAINMENT_REJECTED");
      if (unreportable(pending)) fail("SOURCE_IDENTITY_UNREPORTABLE");
      state.screened += 1;
      rounds.push(pending);
    } catch (error) {
      rejectCandidate(state, "SCREENING", error);
    }
  }
  if (rounds.length < deck.rounds) return { skipped: DECK_SHORT };
  const picks = balancedChoice(rounds.map(({ choices }) => choices.map(({ ranks }) => ranks)), 4, nameSlack(rounds.length),
    { costs: rounds.map(({ choices }) => choices.map(({ extremes }) => extremes)), limits: nameExtremeLimits(rounds.length) });
  if (!picks || rounds.some(({ choices }) => choices.some(({ ranks }) => ranks.length !== NAME_ORDERS))) {
    noteRejection(state, "SELECTION", new Error("NAME_FUNCTION_RANKS_UNBALANCED"));
    return { skipped: DECK_SHORT };
  }
  return { candidates: Object.freeze(rounds.map((round, index) => withChoice(round, round.choices[picks[index]!]!))) };
});
