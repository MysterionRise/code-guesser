import { beforeAfterSubject } from "./before-after-rounds";
import { DECK_SHORT, noteRejection, rejectCandidate, type DeckAttempts, type DeckOutcome, type RunState } from "./diagnostics";
import {
  addHashes, collidesWithSelected, provisionalSnapshot, revealsProtected, unreportable, view, type RepositoryScreen,
} from "./selection";
import type { Context, PreparationDependencies, StageResult } from "./types";

/**
 * Interleaves the search results query by query, newest first within each, so one organisation's
 * commits cannot fill the whole deck before another's are considered.
 */
export const interleaved = (pool: readonly unknown[]): readonly unknown[] => {
  const byQuery = new Map<unknown, unknown[]>();
  for (const candidate of pool) {
    const key = view(candidate).queryId;
    byQuery.set(key, [...(byQuery.get(key) ?? []), candidate]);
  }
  const queues = [...byQuery.values()];
  const order: unknown[] = [];
  for (let rank = 0; order.length < pool.length; rank += 1) {
    for (const queue of queues) if (rank < queue.length) order.push(queue[rank]);
  }
  return order;
};

/**
 * The before-or-after pool: commits whose message gives a usable hint and whose one changed file has a
 * single change that fits a window, from distinct repositories, until the pool is full.
 */
export const selectBeforeAfter = async (
  context: Context,
  deps: PreparationDependencies,
  hashes: string[],
  pool: readonly unknown[],
  state: RunState,
  screenRepository: RepositoryScreen,
  attempt: DeckAttempts,
  otherDecks: () => readonly unknown[],
): Promise<DeckOutcome> => attempt(async () => {
  const { profile } = context;
  const target = profile.selection.beforeAfterPool;
  const chosen: unknown[] = [];
  for (const candidate of interleaved(pool)) {
    if (chosen.length >= target) break;
    const repository = String(view(candidate).repository ?? "");
    // A repository repeated within the deck, or a subject no hint could quote, is skipped before any request.
    if (chosen.some((admitted) => view(admitted).source?.repository === repository)) {
      noteRejection(state, "DEDUPLICATION", new Error("REPOSITORY_REPEATED"));
      continue;
    }
    if (beforeAfterSubject(String(view(candidate).subject ?? ""), repository, profile.screening.subjectMaxLength) === undefined) {
      noteRejection(state, "SCREENING", new Error("SUBJECT_UNUSABLE"));
      continue;
    }
    if (!(await screenRepository(candidate, "ADMISSION"))) continue;
    let lineage: StageResult<unknown>;
    try {
      lineage = await deps.bindGitHubLineage({ ...context, candidate });
      addHashes(hashes, lineage.acceptedResponseHashes);
    } catch (error) { rejectCandidate(state, "DISCOVERY", error); continue; }
    let admitted: unknown;
    try {
      const result = await deps.admitGitHubCandidate({ ...context, candidate: lineage.value,
        crawlSnapshotId: provisionalSnapshot(context.profileHash, hashes) });
      addHashes(hashes, result.acceptedResponseHashes);
      state.repositoriesAdmitted += 1;
      state.screened += 1;
      admitted = result.value;
    } catch (error) { rejectCandidate(state, "ADMISSION", error); continue; }
    if (unreportable(view(admitted).source)) { noteRejection(state, "SCREENING", new Error("SOURCE_IDENTITY_UNREPORTABLE")); continue; }
    if (beforeAfterSubject(String(view(admitted).lineage?.commitMessage ?? ""), repository, profile.screening.subjectMaxLength) === undefined) {
      noteRejection(state, "SCREENING", new Error("SUBJECT_UNUSABLE"));
      continue;
    }
    if (collidesWithSelected(profile, admitted, chosen, otherDecks())) {
      state.duplicatesRejected += 1;
      noteRejection(state, "DEDUPLICATION", new Error("SOURCE_DUPLICATE"));
      continue;
    }
    if (revealsProtected(profile, admitted, [...chosen, ...otherDecks()])) {
      noteRejection(state, "SCREENING", new Error("PUBLIC_CONTAINMENT_REJECTED"));
      continue;
    }
    chosen.push(admitted);
  }
  return chosen.length < target ? { skipped: DECK_SHORT } : { candidates: Object.freeze(chosen) };
});
