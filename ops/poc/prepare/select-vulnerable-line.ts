import { screenBlob } from "@codeguessr/content/local-poc-support";

import { AUTHORSHIP_CLAIM, CROSS_DECK_KEYS_BY_KIND, DEDUPLICATION_KEYS_BY_KIND, namesAdvisory } from "../../../packages/artifact/src/index";
import { DECK_SHORT, noteRejection, rejectCandidate, type DeckAttempts, type DeckOutcome, type RunState } from "./diagnostics";
import { looksGenerated } from "./excerpt-window";
import { fixWindows, type FixWindow } from "./fix-window";
import type { AdvisoryPointer } from "./github-advisories";
import type { FixPointer } from "./github-fixes";
import { fixExtremeLimits, fixSlack } from "./model";
import { FIX_OPTIONS } from "./profile";
import { balancedChoice, sha256 } from "./round-helpers";
import { FIX_WINDOW_LINES } from "./select-fix";
import { addHashes, collidesWithSelected, revealsProtected, unreportable } from "./selection";
import type { Context, PreparationDependencies } from "./types";
import type { VulnerableLineCandidate } from "./vulnerable-line-rounds";

/** A vulnerable-line round in waiting: everything but the final snapshot it is bound to. */
export type VulnerableLineSelection = Omit<VulnerableLineCandidate, "crawlSnapshotId">;
/** A confirmed fix before the deck picks its window: every window the file allows. */
type PendingRound = Omit<VulnerableLineSelection, "windowStart" | "answer" | "decoys" | "excerpt" | "excerptHash">
  & Readonly<{ windows: readonly FixWindow[] }>;

const throughWindow = (pending: PendingRound, choice: number): VulnerableLineSelection => {
  const { windows, ...rest } = pending;
  const window = windows[choice]!;
  return Object.freeze({ ...rest, windowStart: window.windowStart, answer: window.answer, decoys: window.decoys,
    excerpt: window.excerpt, excerptHash: sha256(window.excerpt) });
};

const fail = (code: string): never => { throw new Error(code); };
const order = (advisories: readonly AdvisoryPointer[]): readonly AdvisoryPointer[] =>
  advisories.map((advisory) => ({ advisory, key: sha256(`advisory:${advisory.advisory}`) }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).map(({ advisory }) => advisory);
/** Each ecosystem's advisories in their own hash order, taken in turn, so the deck draws on every ecosystem alike. */
const interleaved = <Item>(queues: readonly (readonly Item[])[]): readonly Item[] => {
  const longest = Math.max(0, ...queues.map((queue) => queue.length));
  return Array.from({ length: longest }, (_, index) => queues.flatMap((queue) => index < queue.length ? [queue[index]!] : [])).flat();
};

/**
 * Selects the vulnerable-line deck (#59): each ecosystem's reviewed advisories, listed once per publication window, in
 * hash order with the ecosystems taking turns, one round per repository, and at most `commitReads` fix commits read.
 * An advisory qualifies when it is not withdrawn, links exactly one fix commit, and names a CWE the profile gives a
 * hint for; its commit qualifies when it replaces one line of code, which the fix binder then confirms against the
 * file at the commit and its parent, with the repository's licence and the fix's author. Once the deck is full, one
 * search picks each round's window as the fix deck's does.
 */
export const selectVulnerableLine = async (
  context: Context,
  deps: PreparationDependencies,
  hashes: string[],
  state: RunState,
  attempt: DeckAttempts,
  otherDecks: () => readonly unknown[],
): Promise<DeckOutcome<VulnerableLineSelection>> => attempt<VulnerableLineSelection>(async () => {
  const { profile } = context;
  const deck = profile.curated!["vulnerable-line"]!;
  const hints = new Map(deck.cwes.map(({ id, hint }) => [id, hint]));
  const keys = { deck: DEDUPLICATION_KEYS_BY_KIND.VULNERABLE_LINE, cross: CROSS_DECK_KEYS_BY_KIND.VULNERABLE_LINE };
  const queues: AdvisoryPointer[][] = [];
  for (const ecosystem of deck.ecosystems) {
    const listed: AdvisoryPointer[] = [];
    for (const published of deck.published) {
      try {
        const page = await deps.readAdvisories({ ...context, ecosystem, published });
        addHashes(hashes, page.acceptedResponseHashes);
        listed.push(...page.value);
      } catch (error) {
        rejectCandidate(state, "ADMISSION", error);
      }
    }
    queues.push([...order(listed)]);
  }
  const advisories = new Set<string>();
  const repositories = new Set<string>();
  const seen = new Set<string>();
  const rounds: PendingRound[] = [];
  let reads = 0;

  for (const advisory of interleaved(queues)) {
    if (rounds.length >= deck.rounds || reads >= deck.commitReads) break;
    // An advisory for packages in two ecosystems is listed under both.
    if (advisories.has(advisory.advisory)) continue;
    advisories.add(advisory.advisory);
    const cwe = advisory.cwes.find((id) => hints.has(id));
    const skip = advisory.withdrawn ? "VULNERABLE_WITHDRAWN" : advisory.commits.length !== 1 ? "VULNERABLE_REFERENCES"
      : cwe === undefined ? "VULNERABLE_CWE" : repositories.has(advisory.commits[0]!.repository.toLowerCase()) ? "REPOSITORY_REPEATED" : undefined;
    if (skip !== undefined) {
      noteRejection(state, "SCREENING", new Error(skip));
      continue;
    }
    const { repository, commit } = advisory.commits[0]!;
    reads += 1;
    let bound;
    try {
      const change = await deps.readAdvisoryFix({ ...context, repository, commit });
      addHashes(hashes, change.acceptedResponseHashes);
      const pointer: FixPointer = Object.freeze({ dataset: "advisory", bug: advisory.advisory, repository: change.value.repository,
        language: change.value.language, fixCommit: commit, fix: change.value.fix });
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
      // The fix's lines are quoted in the reveal, so one that claims anything about authorship is refused here.
      if (AUTHORSHIP_CLAIM.test(`${bound.fix.buggyLine}\n${bound.fix.fixedLine}`)) fail("FIX_CLAIM");
      const fitting = fixWindows(screened.text, bound.changedLine, `advisory:${advisory.advisory}`, FIX_WINDOW_LINES, bound.language)
        .filter(({ excerpt }) => Buffer.byteLength(excerpt) <= profile.screening.excerptBytes);
      if (fitting.length === 0) fail("FIX_WINDOW");
      // No window, nor the prompt or the hint, may name the advisory's package: a player could look the advisory up.
      const named = (value: string) => advisory.packages.some((name) => namesAdvisory(value, name));
      const windows = fitting.filter(({ excerpt }) => !named(excerpt));
      if (windows.length === 0 || named(deck.templates.prompt) || named(hints.get(cwe!)!)) fail("VULNERABLE_PACKAGE_SHOWN");
      // A security fix often sits on the busiest or longest line around it, a regular expression or a long condition. A
      // round whose changed line is the longest, busiest, most indented, or most rarely worded option in every window
      // would hand that pick a sure point, so it is refused; the deck search balances the rest.
      if (!windows.some(({ extremes }) => extremes.every((score) => score < 1))) fail("VULNERABLE_STANDS_OUT");
      const pending: PendingRound = Object.freeze({
        advisory: advisory.advisory, ecosystem: advisory.ecosystem, packageName: advisory.packages[0]!, cwe: cwe!,
        repository: bound.repository, language: bound.language, commit: bound.commit, fixCommit: bound.fixCommit, path: bound.fix.path,
        blob: bound.buggyBlob, fixBlob: bound.fixBlob, rawContentHash: screened.rawSha256, licenseName: bound.licenseName,
        licenseSpdx: bound.licenseSpdx, licenseFileUrl: bound.licenseFileUrl, authorName: bound.author.name,
        authorLogin: bound.author.login, buggyLine: bound.fix.buggyLine, fixedLine: bound.fix.fixedLine,
        changedLine: bound.changedLine, windows,
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
      repositories.add(bound.repository.toLowerCase());
      rounds.push(pending);
    } catch (error) {
      rejectCandidate(state, "SCREENING", error);
    }
  }
  if (rounds.length < deck.rounds) return { skipped: DECK_SHORT };
  const choices = balancedChoice(rounds.map(({ windows }) => windows.map(({ ranks }) => ranks)), FIX_OPTIONS, fixSlack(rounds.length),
    { costs: rounds.map(({ windows }) => windows.map(({ extremes }) => extremes)), limits: fixExtremeLimits(rounds.length) });
  if (!choices) {
    noteRejection(state, "SELECTION", new Error("VULNERABLE_RANKS_UNBALANCED"));
    return { skipped: DECK_SHORT };
  }
  return { candidates: Object.freeze(rounds.map((round, index) => throughWindow(round, choices[index]!))) };
});
