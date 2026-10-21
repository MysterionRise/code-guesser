import type { CapacitySnapshot } from "./capacity";
import {
  DECK_SHORT, PreparationError, noteRejection, rejectCandidate, type DeckAttempts, type DeckOutcome, type DiagnosticStage, type RunState,
} from "./diagnostics";
import { ROUNDS_PER_LANGUAGE, profileAtLeast, sharedOptionWords } from "../../../packages/artifact/src/index";
import { dataOnly, generatedPath } from "./excerpt-window";
import { PROJECT_GROUP_ANSWERS, projectLanguages, projectRoundsPerLanguage, type CrawlProfile, type StackLanguage } from "./profile";
import { namedByTemplates, optionDetail, projectRoundAllowed, type RepositoryOption } from "./project-rounds";
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

/** A project round in waiting: its revalidated file, and the four repositories both rounds of its group offer. */
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
 * Selects the two Stack decks, two rounds per language each unless a v7 profile gives the project deck more. Project
 * rounds come from the most popular repositories of each language, one file each, in groups of two: both rounds of a
 * group offer the same four repositories (its answers plus decoys), and no repository is offered in two groups, so
 * no option shows up more often than another. Language rounds come from repositories below the popularity bar, in
 * stable order.
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
  // Rules added for the v1.0 run (#77, #84) hold from profile v6 on.
  const strict = profileAtLeast(profile.profileVersion, "local-real-rounds.v6");
  const languages = profile.stack.configurations.map(({ language }) => language);
  const chosen: StackSelection[] = [];
  const chosenCandidates = (): unknown[] => chosen.map(({ candidate }) => candidate);

  /** Fetches, revalidates, and screens one row; undefined when any check rejects it. */
  const tryRow = async (row: unknown, language: StackLanguage, deck: readonly StackSelection[], screen: (candidate: unknown) => void) => {
    if (!licensesAllowed(profile, row)) { noteRejection(state, "SCREENING", new Error("LICENSE_REJECTED")); return undefined; }
    // A file a generator wrote, such as a fuzzer's `someGen/test789.js`, is no round (#84); its path says so before any read.
    if (strict && generatedPath(String(view(row).path))) { noteRejection(state, "SCREENING", new Error("GENERATED_PATH")); return undefined; }
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
      // A window that only declares data, such as a table of string constants, shows no idiom to recognise (#84).
      if (strict && dataOnly(String(view(checked.value).excerpt))) throw new Error("DATA_ONLY_CONTENT");
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

  // From v6 on, no pane shares a distinctive word with any of its round's options as shown (#77). A repository is then
  // described before its files are tried, so a pane can be held to its own words; each description is read once.
  const descriptions = new Map<string, Awaited<ReturnType<typeof describe>>>();
  const described = async (repository: string) => {
    if (!descriptions.has(repository)) descriptions.set(repository, await describe(repository));
    return descriptions.get(repository);
  };
  const echoes = (pane: string, option: RepositoryOption): boolean =>
    sharedOptionWords(pane, option.repository, optionDetail(option.description)).length > 0;

  // A repository is an option in one group's rounds only: one that recurred across languages (next.js has JavaScript,
  // TypeScript, and Rust files) or across a language's groups would appear more often than the rest and point to a decoy.
  const offered = new Set<string>();
  const paneOf = (selection: StackSelection) => String(view(selection.candidate).excerpt);
  const pathOf = (selection: StackSelection) => String(view(selection.candidate).path);

  /**
   * One group of a language's project rounds: two answers from the repositories still open, then two decoys, so the
   * group's two rounds offer the same four repositories. A repository whose files were tried as an answer is not tried
   * again in a later group; `deck` holds the rounds already chosen.
   */
  const projectGroup = async (
    language: StackLanguage,
    open: ReturnType<typeof popularRepositories>,
    tried: Set<string>,
    deck: readonly StackSelection[],
  ): Promise<readonly ProjectSelection[] | undefined> => {
    const answers: StackSelection[] = [];
    const answered = new Set<string>();
    const answerOptions: RepositoryOption[] = [];
    for (const { repository, rows: files } of open) {
      if (answers.length >= PROJECT_GROUP_ANSWERS) break;
      if (tried.has(repository)) continue;
      tried.add(repository);
      const own = strict ? await described(repository) : undefined;
      if (strict && own === undefined) continue;
      const option: RepositoryOption = { repository, description: own?.description ?? null };
      for (const row of files.slice(0, profile.selection.filesPerRepository)) {
        const selection = await tryRow(row, language, [...deck, ...answers], (candidate) => {
          if (!projectRoundAllowed(String(view(candidate).excerpt), String(view(candidate).path), [repository])) throw new Error("PROJECT_NAME_IN_EXCERPT");
          // The group's other answer is an option of this round, and this repository one of that round's: neither
          // round's code or file name may name the other's repository, as the generator requires of every option.
          if (strict && (!projectRoundAllowed(String(view(candidate).excerpt), String(view(candidate).path), answerOptions.map((other) => other.repository))
            || answers.some((other) => !projectRoundAllowed(paneOf(other), pathOf(other), [repository])))) throw new Error("PROJECT_NAME_IN_EXCERPT");
          if (strict && ([option, ...answerOptions].some((other) => echoes(String(view(candidate).excerpt), other))
            || answers.some((other) => echoes(paneOf(other), option)))) throw new Error("PROJECT_WORDS_IN_EXCERPT");
        });
        if (selection) { answers.push(selection); answered.add(repository); answerOptions.push(option); break; }
      }
    }
    if (answers.length < PROJECT_GROUP_ANSWERS) return undefined;
    // Decoys fill the group's four options; none may be named by any of its rounds' code or file names.
    const options: RepositoryOption[] = [];
    for (const answer of answers) {
      const description = strict ? answerOptions[answers.indexOf(answer)] : await describe(String(view(answer.candidate).repository));
      if (description === undefined) return undefined;
      options.push({ repository: String(view(answer.candidate).repository), description: description.description });
    }
    for (const { repository } of open) {
      if (options.length >= OPTIONS_PER_ROUND) break;
      if (answered.has(repository) || !answers.every(({ candidate }) =>
        projectRoundAllowed(String(view(candidate).excerpt), String(view(candidate).path), [repository]))) continue;
      const description = strict ? await described(repository) : await describe(repository);
      if (description === undefined || description.fork || description.archived) continue;
      const option = { repository, description: description.description };
      if (strict && answers.some((answer) => echoes(paneOf(answer), option))) {
        noteRejection(state, "SCREENING", new Error("PROJECT_WORDS_IN_EXCERPT"));
        continue;
      }
      options.push(option);
    }
    if (options.length < OPTIONS_PER_ROUND) return undefined;
    for (const option of options) offered.add(option.repository);
    return answers.map((answer) => {
      const own = String(view(answer.candidate).repository);
      return Object.freeze({ ...answer, description: options.find((option) => option.repository === own)!.description,
        distractors: Object.freeze(options.filter((option) => option.repository !== own)) });
    });
  };

  const project = await attempt<ProjectSelection>(async () => {
    const rounds: ProjectSelection[] = [];
    for (const language of projectLanguages(profile)) {
      // A repository the deck's own wording names (`github/…` in "GitHub star events") can be no option.
      const ranked = popularRepositories(rows.filter((row) => languageOf(row) === language), profile.selection.minimumStarEvents)
        .filter(({ repository }) => {
          if (offered.has(repository)) return false;
          if (!namedByTemplates(profile, repository)) return true;
          noteRejection(state, "SCREENING", new Error("PROJECT_NAMED_BY_TEMPLATE"));
          return false;
        });
      const tried = new Set<string>();
      // A language's rounds come in groups, each from repositories no earlier group offered (#167).
      for (let group = 0; group < projectRoundsPerLanguage(profile) / PROJECT_GROUP_ANSWERS; group += 1) {
        const selected = await projectGroup(language, ranked.filter(({ repository }) => !offered.has(repository)), tried, rounds);
        if (selected === undefined) return { skipped: DECK_SHORT };
        rounds.push(...selected);
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
