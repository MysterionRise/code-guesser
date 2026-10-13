import type { CapacitySnapshot } from "./capacity";
import {
  DECK_SHORT, PreparationError, noteRejection, rejectCandidate, type DeckAttempts, type DeckOutcome, type DiagnosticStage, type RunState,
} from "./diagnostics";
import { ROUNDS_PER_LANGUAGE } from "../../../packages/artifact/src/index";
import type { CrawlProfile, StackLanguage } from "./profile";
import { namedByTemplates, projectRoundAllowed, type RepositoryOption } from "./project-rounds";
import {
  addHashes, collidesWithSelected, provisionalSnapshot, revealsProtected, unreportable, view, type RepositoryScreen,
} from "./selection";
import type { BlobLimits, Context, PreparationDependencies, StackSelection } from "./types";

/** What one blob worker may still spend: the run's remaining ceilings, each at least one. */
export const remainingBlobLimits = (profile: CrawlProfile, snapshot: CapacitySnapshot): BlobLimits => {
  const totalBlobBytes = Math.max(1, profile.capacity.totalBlobBytes - snapshot.totalBlobBytes);
  return Object.freeze({
    blobAttempts: Math.max(1, profile.capacity.blobAttempts - snapshot.blobAttempts + 1),
    successfulBlobs: Math.max(1, profile.capacity.successfulBlobs - snapshot.successfulBlobs),
    perBlobBytes: profile.capacity.perBlobBytes,
    totalBlobBytes,
    temporaryDiskBytes: Math.max(1, profile.capacity.temporaryDiskBytes - snapshot.temporaryDiskBytes),
    requestLimit: Math.max(1, profile.capacity.requestCount - snapshot.requestCount),
    networkByteLimit: Math.min(profile.capacity.perBlobBytes, totalBlobBytes),
  });
};

/** Licence screening precedes any blob download. A row without a licence list is left to revalidation. */
const licensesAllowed = (profile: CrawlProfile, row: unknown): boolean => {
  const licenses = view(row).detectedLicenses;
  if (!Array.isArray(licenses)) return true;
  return licenses.length > 0 && licenses.every((identifier) => profile.licenses.includes(identifier));
};

const STACK_ORDER_KEYS = ["stableRowId", "repository", "swhRevisionId", "path", "swhContentId"] as const;
const stackOrder = (left: unknown, right: unknown): number => {
  for (const key of STACK_ORDER_KEYS) {
    const a = String((left as Record<string, unknown>)[key]);
    const b = String((right as Record<string, unknown>)[key]);
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
};
const starEvents = (row: unknown): number => Number((row as { starEventsCount?: unknown }).starEventsCount ?? 0);
const languageOf = (row: unknown): unknown => view(row).detectedLanguage;

/** A project round in waiting: its revalidated file, and the four repositories every round of its language offers. */
export interface ProjectSelection extends StackSelection {
  readonly description: string | null;
  readonly distractors: readonly RepositoryOption[];
}

interface StackDecks {
  readonly project: DeckOutcome<ProjectSelection>;
  readonly language: DeckOutcome<StackSelection>;
}

/** Ranks a language's repositories by their most star events (ties by name), keeping each one's files in stable order. */
const popularRepositories = (rows: readonly unknown[], minimumStarEvents: number): readonly Readonly<{ repository: string; rows: readonly unknown[] }>[] => {
  const byRepository = new Map<string, unknown[]>();
  for (const row of [...rows].sort(stackOrder)) {
    if (starEvents(row) < minimumStarEvents) continue;
    const repository = String(view(row).repository);
    byRepository.set(repository, [...(byRepository.get(repository) ?? []), row]);
  }
  const stars = (files: readonly unknown[]): number => Math.max(...files.map(starEvents));
  return [...byRepository].map(([repository, files]) => Object.freeze({ repository, rows: Object.freeze(files) }))
    .sort((left, right) => stars(right.rows) - stars(left.rows) || (left.repository < right.repository ? -1 : 1));
};

const OPTIONS_PER_ROUND = 4;

/**
 * Selects the two Stack decks, two rounds per language each. Project rounds come from the most popular
 * repositories of each language, one file each; every round of a language offers the same four repositories
 * (its answers plus decoys), so no option shows up more often than another. Language rounds come from
 * repositories below the popularity bar, in stable order.
 */
export const selectStack = async (
  context: Context,
  deps: PreparationDependencies,
  hashes: string[],
  rows: readonly unknown[],
  state: RunState,
  screenRepository: RepositoryScreen,
  attempt: DeckAttempts,
  otherDecks: () => readonly unknown[],
): Promise<StackDecks> => {
  const { profile } = context;
  const languages = profile.stack.configurations.map(({ language }) => language);
  const chosen: StackSelection[] = [];
  const chosenCandidates = (): unknown[] => chosen.map(({ candidate }) => candidate);

  /** Fetches, revalidates, and screens one row; undefined when any check rejects it. */
  const tryRow = async (row: unknown, language: StackLanguage, deck: readonly StackSelection[], screen: (candidate: unknown) => void) => {
    if (!licensesAllowed(profile, row)) { noteRejection(state, "SCREENING", new Error("LICENSE_REJECTED")); return undefined; }
    if (!(await screenRepository(row, "GITHUB_REVALIDATION"))) return undefined;
    let lease: ReturnType<typeof context.capacity.beginBlob>;
    try {
      lease = context.capacity.beginBlob();
    } catch (error) {
      // A spent blob budget ends this deck and every later one; rejectCandidate turns it into that skip.
      rejectCandidate(state, "BLOB_RETRIEVAL", error);
      return undefined;
    }
    let stage: DiagnosticStage = "BLOB_RETRIEVAL";
    try {
      const fetched = await deps.fetchStackBlob({ ...context, row, limits: remainingBlobLimits(profile, context.capacity.snapshot()) });
      addHashes(hashes, fetched.acceptedResponseHashes);
      lease.addBytes(fetched.value.byteLength);
      stage = "GITHUB_REVALIDATION";
      const checked = await deps.revalidateStackCandidate({ ...context, row, blob: fetched.value,
        crawlSnapshotId: provisionalSnapshot(context.profileHash, hashes) });
      addHashes(hashes, checked.acceptedResponseHashes);
      state.githubRevalidations += 1;
      if (view(checked.value).detectedLanguage !== language) throw new PreparationError();
      stage = "SCREENING";
      state.screened += 1;
      if (unreportable(checked.value)) throw new Error("SOURCE_IDENTITY_UNREPORTABLE");
      screen(checked.value);
      stage = "DEDUPLICATION";
      if (collidesWithSelected(profile, checked.value, deck.map(({ candidate }) => candidate), [...chosenCandidates(), ...otherDecks()])) {
        state.duplicatesRejected += 1;
        throw new Error("SOURCE_DUPLICATE");
      }
      stage = "SCREENING";
      if (revealsProtected(profile, checked.value, [...otherDecks(), ...chosenCandidates()])) throw new Error("PUBLIC_CONTAINMENT_REJECTED");
      lease.accept();
      const selection = Object.freeze({ row, blob: fetched.value, candidate: checked.value });
      chosen.push(selection);
      return selection;
    } catch (error) {
      lease.release();
      rejectCandidate(state, stage, error);
      return undefined;
    }
  };

  const describe = async (repository: string) => {
    try {
      const described = await deps.describeRepository({ ...context, repository });
      addHashes(hashes, described.acceptedResponseHashes);
      return described.value;
    } catch (error) {
      rejectCandidate(state, "SCREENING", error);
      return undefined;
    }
  };

  const project = await attempt<ProjectSelection>(async () => {
    const rounds: ProjectSelection[] = [];
    // A repository is an option in one language's rounds only: one that recurred across languages (next.js has
    // JavaScript, TypeScript, and Rust files) would appear more often than the rest and point to a decoy.
    const offered = new Set<string>();
    for (const language of languages) {
      // A repository the deck's own wording names (`github/…` in "GitHub star events") can be no option.
      const ranked = popularRepositories(rows.filter((row) => languageOf(row) === language), profile.selection.minimumStarEvents)
        .filter(({ repository }) => {
          if (offered.has(repository)) return false;
          if (!namedByTemplates(profile, repository)) return true;
          noteRejection(state, "SCREENING", new Error("PROJECT_NAMED_BY_TEMPLATE"));
          return false;
        });
      const answers: StackSelection[] = [];
      const answered = new Set<string>();
      for (const { repository, rows: files } of ranked) {
        if (answers.length >= ROUNDS_PER_LANGUAGE) break;
        for (const row of files.slice(0, profile.selection.filesPerRepository)) {
          const selection = await tryRow(row, language, answers, (candidate) => {
            if (!projectRoundAllowed(String(view(candidate).excerpt), String(view(candidate).path), [repository])) throw new Error("PROJECT_NAME_IN_EXCERPT");
          });
          if (selection) { answers.push(selection); answered.add(repository); break; }
        }
      }
      if (answers.length < ROUNDS_PER_LANGUAGE) return { skipped: DECK_SHORT };
      // Decoys fill the language's four options; none may be named by any of its rounds' code or file names.
      const options: RepositoryOption[] = [];
      for (const answer of answers) {
        const description = await describe(String(view(answer.candidate).repository));
        if (description === undefined) return { skipped: DECK_SHORT };
        options.push({ repository: String(view(answer.candidate).repository), description: description.description });
      }
      for (const { repository } of ranked) {
        if (options.length >= OPTIONS_PER_ROUND) break;
        if (answered.has(repository) || !answers.every(({ candidate }) =>
          projectRoundAllowed(String(view(candidate).excerpt), String(view(candidate).path), [repository]))) continue;
        const description = await describe(repository);
        if (description === undefined || description.fork || description.archived) continue;
        options.push({ repository, description: description.description });
      }
      if (options.length < OPTIONS_PER_ROUND) return { skipped: DECK_SHORT };
      for (const option of options) offered.add(option.repository);
      for (const answer of answers) {
        const own = String(view(answer.candidate).repository);
        rounds.push(Object.freeze({ ...answer, description: options.find((option) => option.repository === own)!.description,
          distractors: Object.freeze(options.filter((option) => option.repository !== own)) }));
      }
    }
    return { candidates: Object.freeze(rounds) };
  });

  const projectRepositories = new Set((project.candidates ?? []).map(({ candidate }) => String(view(candidate).repository)));
  const language = await attempt<StackSelection>(async () => {
    const rounds: StackSelection[] = [];
    for (const configured of languages) {
      const ordered = rows.filter((row) => languageOf(row) === configured && starEvents(row) < profile.selection.minimumStarEvents
        && !projectRepositories.has(String(view(row).repository))).sort(stackOrder);
      const deck: StackSelection[] = [];
      for (const row of ordered) {
        if (deck.length >= ROUNDS_PER_LANGUAGE) break;
        if (rounds.some(({ candidate }) => view(candidate).repository === view(row).repository)) {
          noteRejection(state, "DEDUPLICATION", new Error("REPOSITORY_REPEATED"));
          continue;
        }
        const selection = await tryRow(row, configured, rounds, (candidate) => { deps.validateLanguageCandidate({ ...context, candidate }); });
        if (selection) deck.push(selection);
      }
      if (deck.length < ROUNDS_PER_LANGUAGE) return { skipped: DECK_SHORT };
      rounds.push(...deck);
    }
    return { candidates: Object.freeze(rounds) };
  });
  return Object.freeze({ project, language });
};
