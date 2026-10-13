import { screenBlob } from "@codeguessr/content/local-poc-support";

import { CROSS_DECK_KEYS_BY_KIND, DEDUPLICATION_KEYS_BY_KIND } from "../../../packages/artifact/src/index";
import { DECK_SHORT, noteRejection, rejectCandidate, type DeckAttempts, type DeckOutcome, type RunState } from "./diagnostics";
import { doctestFunctions, roundExamples, type DoctestExample, type DoctestFunction } from "./doctest-parse";
import { looksGenerated } from "./excerpt-window";
import { balancedAnswers, outputPane, type OutputCandidate } from "./output-rounds";
import { sha256 } from "./round-helpers";
import { addHashes, collidesWithSelected, revealsProtected, unreportable } from "./selection";
import type { Context, PreparationDependencies } from "./types";

/** An output round in waiting: everything but the final snapshot it is bound to. */
export type OutputSelection = Omit<OutputCandidate, "crawlSnapshotId">;

const fail = (code: string): never => { throw new Error(code); };

/** A Python module a round may come from: not a package marker or a test module. */
const roundModule = (path: string): boolean => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.endsWith(".py") && name !== "__init__.py" && !name.startsWith("test_") && !name.endsWith("_test.py");
};

/** What two copies of one function share: their examples' arguments and outputs, whatever the function is called. */
const examplesKey = (name: string, examples: readonly DoctestExample[]): string =>
  examples.map(({ call, output }) => `${call.slice(name.length)}\u0000${output}`).sort().join("\n");

/** The file's first function with four askable examples not already in the deck. */
const roundFrom = (functions: readonly DoctestFunction[], seen: ReadonlySet<string>) => {
  for (const candidate of functions) {
    const examples = roundExamples(candidate.examples);
    if (examples && !seen.has(examplesKey(candidate.name, examples))) return { function: candidate, examples, key: examplesKey(candidate.name, examples) };
  }
  return undefined;
};

/** A round with its function and four examples, before the deck picks which example it asks about. */
type PendingRound = Omit<OutputSelection, "answer" | "decoys" | "excerpt" | "excerptHash"> & Readonly<{ examples: readonly DoctestExample[] }>;

/** A pending round asking about one of its examples: the pane ends in that example's call. */
const askAbout = (round: PendingRound, index: number): OutputSelection => {
  const { examples, ...rest } = round;
  const answer = examples[index]!;
  const excerpt = outputPane(round.code, answer.call);
  return Object.freeze({ ...rest, answer, decoys: Object.freeze(examples.filter((example) => example !== answer)), excerpt, excerptHash: sha256(excerpt) });
};

/**
 * Selects the output deck: files of the configured directories in hash order, at most `fileReads` of them. Each is
 * read first, and only a file holding a function a round can ask about has its licence and author bound. Files
 * another deck shows are skipped before any read. Once the deck is full, one search picks every round's answer so
 * the answers fill each rank equally in both orders a solver might rank options by.
 */
export const selectOutput = async (
  context: Context,
  deps: PreparationDependencies,
  hashes: string[],
  state: RunState,
  attempt: DeckAttempts,
  otherDecks: () => readonly unknown[],
): Promise<DeckOutcome<OutputSelection>> => attempt<OutputSelection>(async () => {
  const { profile } = context;
  const deck = profile.curated!.output!;
  const pin = profile.curated!.repositories.find(({ repository }) => repository === deck.repository)!;
  const target = { repository: pin.repository, commit: pin.commit };
  const keys = { deck: DEDUPLICATION_KEYS_BY_KIND.OUTPUT, cross: CROSS_DECK_KEYS_BY_KIND.OUTPUT };
  const paths: string[] = [];
  for (const directory of deck.directories) {
    try {
      const listed = await deps.listCuratedDirectory({ ...context, ...target, path: directory });
      addHashes(hashes, listed.acceptedResponseHashes);
      paths.push(...listed.value.filter(roundModule));
    } catch (error) {
      rejectCandidate(state, "ADMISSION", error);
    }
  }
  const taken = new Set(otherDecks().map((candidate) => {
    const { repository, path } = candidate as Readonly<{ repository?: unknown; path?: unknown }>;
    return `${String(repository)}:${String(path)}`;
  }));
  const order = paths.filter((path) => !taken.has(`${pin.repository}:${path}`))
    .map((path) => ({ path, key: sha256(`${pin.repository}:${path}`) }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).map(({ path }) => path);
  const seen = new Set<string>();
  const examplesSeen = new Set<string>();
  const rounds: PendingRound[] = [];
  const limits = { maxLines: profile.screening.excerptLines };

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
    let round;
    try {
      const screened = screenBlob({ path, bytes: read.bytes }, seen);
      if (looksGenerated(screened.text, profile.screening.generatedScanLines)) fail("GENERATED_CONTENT");
      round = roundFrom(doctestFunctions(screened.text, limits), examplesSeen) ?? fail("OUTPUT_NO_DOCTEST");
      const longest = Math.max(...round.examples.map(({ call }) => Buffer.byteLength(outputPane(round!.function.code, call))));
      if (longest > profile.screening.excerptBytes) fail("OUTPUT_PANE_SIZE");
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
      if (bound.blob !== read.blob) fail("OUTPUT_FILE_CHANGED");
      const pending: PendingRound = Object.freeze({
        repository: pin.repository, commit: pin.commit, path, blob: bound.blob, rawContentHash: bound.rawContentHash,
        licenseName: bound.licenseName, licenseSpdx: bound.licenseSpdx, licenseFileUrl: bound.licenseFileUrl,
        authorName: bound.author.name, authorLogin: bound.author.login, authorCommit: bound.author.commit,
        functionName: round.function.name, code: round.function.code, examples: round.examples,
      });
      // Every pane this round could show is checked, since the deck picks its answer later.
      const panes = round.examples.map((_, index) => askAbout(pending, index));
      const chosen = rounds.map((other) => askAbout(other, 0));
      if (panes.some((pane) => collidesWithSelected(profile, pane, chosen, otherDecks(), keys))) {
        state.duplicatesRejected += 1;
        fail("SOURCE_DUPLICATE");
      }
      if (panes.some((pane) => revealsProtected(profile, pane, [...otherDecks(), ...chosen]))) fail("PUBLIC_CONTAINMENT_REJECTED");
      if (unreportable(pending)) fail("SOURCE_IDENTITY_UNREPORTABLE");
      state.screened += 1;
      examplesSeen.add(round.key);
      rounds.push(pending);
    } catch (error) {
      rejectCandidate(state, "SCREENING", error);
    }
  }
  if (rounds.length < deck.rounds) return { skipped: DECK_SHORT };
  const answers = balancedAnswers(rounds.map(({ examples }) => examples));
  if (!answers) {
    noteRejection(state, "SELECTION", new Error("OUTPUT_RANKS_UNBALANCED"));
    return { skipped: DECK_SHORT };
  }
  return { candidates: Object.freeze(rounds.map((round, index) => askAbout(round, answers[index]!))) };
});
