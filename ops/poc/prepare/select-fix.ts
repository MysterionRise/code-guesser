import { screenBlob } from "@codeguessr/content/local-poc-support";

import { CROSS_DECK_KEYS_BY_KIND, DEDUPLICATION_KEYS_BY_KIND } from "../../../packages/artifact/src/index";
import { DECK_SHORT, noteRejection, rejectCandidate, type DeckAttempts, type DeckOutcome, type RunState } from "./diagnostics";
import { looksGenerated } from "./excerpt-window";
import { bugsInPyRevisions, defects4jRevisions, oneLineFix, type BugRevisions } from "./fix-patch";
import type { FixCandidate } from "./fix-rounds";
import { fixSlack } from "./model";
import { changeKind, fixWindows, type FixWindow } from "./fix-window";
import type { DatasetBug, FixPointer } from "./github-fixes";
import { FIX_OPTIONS } from "./profile";
import { balancedChoice, sha256 } from "./round-helpers";
import { addHashes, collidesWithSelected, revealsProtected, unreportable } from "./selection";
import type { Context, PreparationDependencies } from "./types";

/** A fix round in waiting: everything but the final snapshot it is bound to. */
export type FixSelection = Omit<FixCandidate, "crawlSnapshotId">;
/** A confirmed fix before the deck picks its window: every window the file allows. */
type PendingFix = Omit<FixSelection, "windowStart" | "answer" | "decoys" | "excerpt" | "excerptHash">
  & Readonly<{ windows: readonly FixWindow[] }>;

/** A pending fix shown through one of its windows. */
const throughWindow = (pending: PendingFix, choice: number): FixSelection => {
  const { windows, ...rest } = pending;
  const window = windows[choice]!;
  return Object.freeze({ ...rest, windowStart: window.windowStart, answer: window.answer, decoys: window.decoys,
    excerpt: window.excerpt, excerptHash: sha256(window.excerpt) });
};

/** Lines in a fix round's pane. */
export const FIX_WINDOW_LINES = 14;
/** A dataset patch longer than this almost always changes more than one line, so it is never read. */
export const FIX_PATCH_BYTES = 800;

const fail = (code: string): never => { throw new Error(code); };
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Each dataset's bugs in its own hash order, taken in turn, so the deck draws on both datasets alike. */
const interleaved = <Item>(queues: readonly (readonly Item[])[]): readonly Item[] => {
  const longest = Math.max(0, ...queues.map((queue) => queue.length));
  return Array.from({ length: longest }, (_, index) => queues.flatMap((queue) => index < queue.length ? [queue[index]!] : [])).flat();
};

/**
 * Selects the fix deck: bugs the datasets list, short patches only, in hash order with the datasets taking turns,
 * at most `patchReads` patches and `perRepository` rounds per upstream repository. A patch that changes one line
 * is confirmed upstream and kept with every window its file allows; once the deck is full, one search picks each
 * round's window so the answers take every rank equally by position and centrality, and nearly so by length.
 */
export const selectFix = async (
  context: Context,
  deps: PreparationDependencies,
  hashes: string[],
  state: RunState,
  attempt: DeckAttempts,
  otherDecks: () => readonly unknown[],
): Promise<DeckOutcome<FixSelection>> => attempt<FixSelection>(async () => {
  const { profile } = context;
  const deck = profile.curated!.fix!;
  const keys = { deck: DEDUPLICATION_KEYS_BY_KIND.FIX, cross: CROSS_DECK_KEYS_BY_KIND.FIX };
  const queues: DatasetBug[][] = [];
  for (const dataset of deck.datasets) {
    try {
      const listed = await deps.readDatasetBugs({ ...context, dataset });
      addHashes(hashes, listed.acceptedResponseHashes);
      queues.push(listed.value.filter(({ patchSize }) => patchSize > 0 && patchSize <= FIX_PATCH_BYTES)
        .map((bug) => ({ bug, key: sha256(`${bug.dataset}:${bug.bug}`) }))
        .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).map(({ bug }) => bug));
    } catch (error) {
      rejectCandidate(state, "ADMISSION", error);
    }
  }
  const text = async (repository: string, blob: string): Promise<string> => {
    const result = await deps.readDatasetBlob({ ...context, repository, blob });
    addHashes(hashes, result.acceptedResponseHashes);
    return decoder.decode(result.value);
  };
  const tables = new Map<string, ReadonlyMap<string, BugRevisions>>();
  const perRepository = new Map<string, number>();
  const seen = new Set<string>();
  const rounds: PendingFix[] = [];
  let reads = 0;

  for (const bug of interleaved(queues)) {
    if (rounds.length >= deck.rounds || reads >= deck.patchReads) break;
    const dataset = deck.datasets.find(({ id }) => id === bug.dataset)!;
    const project = dataset.projects.find(({ name }) => name === bug.project)!;
    if ((perRepository.get(project.repository) ?? 0) >= deck.perRepository) continue;
    reads += 1;
    let bound;
    try {
      const fix = oneLineFix(await text(dataset.repository, bug.patchBlob), dataset.id === "defects4j" ? "reverse" : "forward");
      if (!fix) {
        noteRejection(state, "SCREENING", new Error("FIX_PATCH_WIDE"));
        continue;
      }
      let revisions: BugRevisions;
      if (dataset.id === "defects4j") {
        const table = tables.get(bug.revisionsBlob) ?? defects4jRevisions(await text(dataset.repository, bug.revisionsBlob));
        tables.set(bug.revisionsBlob, table);
        revisions = table.get(bug.bug.slice(bug.project.length + 1)) ?? fail("FIX_RECORD_MISSING");
      } else {
        revisions = bugsInPyRevisions(await text(dataset.repository, bug.revisionsBlob));
      }
      const pointer: FixPointer = Object.freeze({ dataset: dataset.id, bug: bug.bug, repository: project.repository,
        language: project.language, fixCommit: revisions.fixed, fix });
      const result = await deps.bindFixCommit({ ...context, pointer });
      addHashes(hashes, result.acceptedResponseHashes);
      bound = result.value;
    } catch (error) {
      rejectCandidate(state, "ADMISSION", error);
      continue;
    }
    try {
      const screened = screenBlob({ path: bound.fix.path, bytes: bound.bytes }, seen);
      if (looksGenerated(screened.text, profile.screening.generatedScanLines)) fail("GENERATED_CONTENT");
      const windows = fixWindows(screened.text, bound.changedLine, `${bug.dataset}:${bug.bug}`, FIX_WINDOW_LINES)
        .filter(({ excerpt }) => Buffer.byteLength(excerpt) <= profile.screening.excerptBytes);
      if (windows.length === 0) fail("FIX_WINDOW");
      const pending: PendingFix = Object.freeze({
        dataset: dataset.id, bugId: bug.bug, repository: project.repository, language: project.language,
        commit: bound.commit, fixCommit: bound.fixCommit, path: bound.fix.path, blob: bound.buggyBlob,
        fixBlob: bound.fixBlob, rawContentHash: screened.rawSha256, licenseName: bound.licenseName,
        licenseSpdx: bound.licenseSpdx, licenseFileUrl: bound.licenseFileUrl, authorName: bound.author.name,
        authorLogin: bound.author.login, buggyLine: bound.fix.buggyLine, fixedLine: bound.fix.fixedLine,
        changedLine: bound.changedLine, changeKind: changeKind(bound.fix.buggyLine, bound.fix.fixedLine), windows,
      });
      // Every excerpt this round could show is checked, since the deck picks its window later.
      const shown = windows.flatMap((window, choice) => windows.findIndex(({ excerpt }) => excerpt === window.excerpt) === choice
        ? [throughWindow(pending, choice)] : []);
      const chosen = rounds.map((other) => throughWindow(other, 0));
      if (shown.some((selection) => collidesWithSelected(profile, selection, chosen, otherDecks(), keys))) {
        state.duplicatesRejected += 1;
        fail("SOURCE_DUPLICATE");
      }
      if (shown.some((selection) => revealsProtected(profile, selection, [...otherDecks(), ...chosen]))) fail("PUBLIC_CONTAINMENT_REJECTED");
      if (unreportable(pending)) fail("SOURCE_IDENTITY_UNREPORTABLE");
      state.screened += 1;
      perRepository.set(project.repository, (perRepository.get(project.repository) ?? 0) + 1);
      rounds.push(pending);
    } catch (error) {
      rejectCandidate(state, "SCREENING", error);
    }
  }
  if (rounds.length < deck.rounds) return { skipped: DECK_SHORT };
  const choices = balancedChoice(rounds.map(({ windows }) => windows.map(({ ranks }) => ranks)), FIX_OPTIONS, fixSlack(rounds.length));
  if (!choices) {
    noteRejection(state, "SELECTION", new Error("FIX_RANKS_UNBALANCED"));
    return { skipped: DECK_SHORT };
  }
  return { candidates: Object.freeze(rounds.map((round, index) => throughWindow(round, choices[index]!))) };
});
