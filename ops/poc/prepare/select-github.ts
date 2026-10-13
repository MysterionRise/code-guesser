import { DECK_SHORT, noteRejection, rejectCandidate, type DeckAttempts, type DeckOutcome, type RunState } from "./diagnostics";
import { projectExcerptAllowed } from "./project-rounds";
import {
  addHashes, aiCredited, collidesWithSelected, provisionalSnapshot, queryRole, revealsProtected, unreportable, view,
  type RepositoryScreen,
} from "./selection";
import type { Context, PreparationDependencies, StageResult } from "./types";

export type GitHubDecks = Readonly<{ project: DeckOutcome; ai: DeckOutcome }>;

/**
 * Five project rounds from `ordinary` queries with distinct repositories; five AI rounds with up to three
 * credited commits from `ai-credit` queries and the rest uncredited from `ordinary` queries, at least two
 * of each. Admitted ordinary candidates the project deck cannot use stay available to the AI deck, and so
 * does a whole project deck that fell short. Each deck that cannot fill is skipped with its reason.
 */
export const selectGitHub = async (
  context: Context,
  deps: PreparationDependencies,
  hashes: string[],
  pool: readonly unknown[],
  state: RunState,
  screenRepository: RepositoryScreen,
  attempt: DeckAttempts,
): Promise<GitHubDecks> => {
  const { profile } = context;
  const { projectRounds, aiRounds, aiMinimumPerOutcome } = profile.selection;
  const ordinary = pool.filter((candidate) => queryRole(profile, candidate) === "ordinary");
  const credited = pool.filter((candidate) => queryRole(profile, candidate) === "ai-credit");
  const project: unknown[] = [];
  const aiYes: unknown[] = [];
  const aiNo: unknown[] = [];
  const spare: unknown[] = [];
  const all = (): unknown[] => [...project, ...aiYes, ...aiNo];
  const admit = async (candidate: unknown): Promise<unknown | undefined> => {
    if (!(await screenRepository(candidate, "ADMISSION"))) return undefined;
    let lineage: StageResult<unknown>;
    try {
      lineage = await deps.bindGitHubLineage({ ...context, candidate });
      addHashes(hashes, lineage.acceptedResponseHashes);
    } catch (error) { rejectCandidate(state, "DISCOVERY", error); return undefined; }
    try {
      const admitted = await deps.admitGitHubCandidate({ ...context, candidate: lineage.value,
        crawlSnapshotId: provisionalSnapshot(context.profileHash, hashes) });
      addHashes(hashes, admitted.acceptedResponseHashes);
      state.repositoriesAdmitted += 1;
      state.screened += 1;
      if (unreportable(view(admitted.value).source)) {
        noteRejection(state, "SCREENING", new Error("SOURCE_IDENTITY_UNREPORTABLE"));
        return undefined;
      }
      return admitted.value;
    } catch (error) { rejectCandidate(state, "ADMISSION", error); return undefined; }
  };
  const accepts = (admitted: unknown, deck: readonly unknown[], others: readonly unknown[]): boolean => {
    if (collidesWithSelected(profile, admitted, deck, others)) {
      state.duplicatesRejected += 1;
      noteRejection(state, "DEDUPLICATION", new Error("SOURCE_DUPLICATE"));
      return false;
    }
    if (revealsProtected(profile, admitted, all())) {
      noteRejection(state, "SCREENING", new Error("PUBLIC_CONTAINMENT_REJECTED"));
      return false;
    }
    return true;
  };
  // Stable ordering for the project deck: once an excerpt names its own project, later commits
  // from that repository are skipped before lineage, because their files tend to name it too.
  const selfNamed = new Set<string>();
  const projectEligible = (admitted: unknown): boolean => {
    const repository = String(view(admitted).source?.repository ?? "");
    if (!projectExcerptAllowed(String(view(admitted).lineage?.excerpt ?? ""), repository)) {
      selfNamed.add(repository);
      noteRejection(state, "SCREENING", new Error("PROJECT_NAME_IN_EXCERPT"));
      return false;
    }
    return accepts(admitted, project, [...aiYes, ...aiNo]);
  };
  const absentEligible = (admitted: unknown): boolean => !aiCredited(admitted, profile) && accepts(admitted, [...aiYes, ...aiNo], project);
  // FR-026 rejects a repository repeated within a deck; the search record already names it, so skip before any lineage request.
  const repeatsRepository = (candidate: unknown, deck: readonly unknown[]): boolean => {
    const { repository } = view(candidate);
    if (typeof repository !== "string" || !deck.some((admitted) => view(admitted).source?.repository === repository)) return false;
    // A diagnostic only: the run report bounds duplicatesRejected by screened candidates, and this one was never screened.
    noteRejection(state, "DEDUPLICATION", new Error("REPOSITORY_REPEATED"));
    return true;
  };
  let cursor = 0;
  const projectDeck = await attempt(async () => {
    while (project.length < projectRounds && cursor < ordinary.length) {
      const candidate = ordinary[cursor++];
      if (repeatsRepository(candidate, project)) continue;
      if (selfNamed.has(String(view(candidate).repository))) {
        noteRejection(state, "SCREENING", new Error("PROJECT_REPOSITORY_SKIPPED"));
        continue;
      }
      const admitted = await admit(candidate);
      if (admitted === undefined) continue;
      if (projectEligible(admitted)) project.push(admitted); else spare.push(admitted);
    }
    return project.length < projectRounds ? { skipped: DECK_SHORT } : { candidates: Object.freeze([...project]) };
  });
  // A project deck that cannot publish keeps nothing; its admitted candidates may still serve the AI deck.
  if (projectDeck.skipped !== undefined) spare.unshift(...project.splice(0));
  const aiDeck = await attempt(async () => {
    const creditedTarget = aiRounds - aiMinimumPerOutcome;
    for (const candidate of credited) {
      if (aiYes.length >= creditedTarget) break;
      if (repeatsRepository(candidate, aiYes)) continue;
      const admitted = await admit(candidate);
      if (admitted === undefined) continue;
      if (!aiCredited(admitted, profile)) { noteRejection(state, "SCREENING", new Error("AI_CREDIT_ABSENT")); continue; }
      if (accepts(admitted, [...aiYes, ...aiNo], project)) aiYes.push(admitted);
    }
    if (aiYes.length < aiMinimumPerOutcome) return { skipped: DECK_SHORT };
    const absentTarget = aiRounds - aiYes.length;
    for (const admitted of spare) {
      if (aiNo.length >= absentTarget) break;
      if (absentEligible(admitted)) aiNo.push(admitted);
    }
    while (aiNo.length < absentTarget && cursor < ordinary.length) {
      const candidate = ordinary[cursor++];
      if (repeatsRepository(candidate, [...aiYes, ...aiNo])) continue;
      const admitted = await admit(candidate);
      if (admitted === undefined) continue;
      if (absentEligible(admitted)) aiNo.push(admitted);
    }
    return aiNo.length < absentTarget ? { skipped: DECK_SHORT } : { candidates: Object.freeze([...aiYes, ...aiNo]) };
  });
  return Object.freeze({ project: projectDeck, ai: aiDeck });
};
