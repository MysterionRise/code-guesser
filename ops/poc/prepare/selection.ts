import { canonicalHash } from "./canonical";
import { PROTECTED_SOURCE_KEYS } from "./compose";
import { noteRejection, PreparationError, rejectCandidate, type DiagnosticStage, type RunState } from "./diagnostics";
import { AUTHORSHIP_CLAIM, containsProtected, protectedIndex, wordRuns } from "../../../packages/artifact/src/index";
import { CROSS_DECK_KEYS } from "./model";
import { isReportableSourceIdentity } from "./model-run";
import type { CrawlProfile } from "./profile";
import type { Context, PreparationDependencies } from "./types";

/**
 * The fields selection reads from a candidate. Dependencies hand back richer records (and tests fake
 * partial ones), so selection reads them through this view instead of trusting their full types.
 */
export interface CandidateView {
  readonly repository?: unknown;
  readonly path?: unknown;
  readonly queryId?: unknown;
  readonly excerpt?: unknown;
  readonly detectedLanguage?: unknown;
  readonly detectedLicenses?: unknown;
  readonly lineage?: Readonly<{ excerpt?: unknown; beforeExcerpt?: unknown; afterExcerpt?: unknown; commitMessage?: unknown }>;
  readonly subject?: unknown;
  readonly source?: Readonly<Record<string, unknown>>;
}
export const view = (value: unknown): CandidateView =>
  (typeof value === "object" && value !== null ? value : {}) as CandidateView;
/** The provenance record of an admitted GitHub candidate, or a revalidated Stack candidate itself. */
const sourceOf = (value: unknown): Readonly<Record<string, unknown>> => view(value).source ?? view(value) as Readonly<Record<string, unknown>>;

const SHA256 = /^[0-9a-f]{64}$/u;
export const addHashes = (target: string[], values: readonly string[]): void => {
  for (const value of values) {
    if (!SHA256.test(value)) throw new PreparationError();
    if (!target.includes(value)) target.push(value);
  }
};

export const provisionalSnapshot = (profileHash: string, hashes: readonly string[]): string =>
  canonicalHash({ profileHash, acceptedResponseHashes: hashes.length > 0 ? hashes : [canonicalHash("capture")] });

/** Every pane of code a candidate's round would show, and for a commit the subject its first hint quotes. */
const excerptOf = (candidate: unknown): string => {
  const { lineage, excerpt } = view(candidate);
  if (!lineage) return String(excerpt ?? "");
  const subject = String(lineage.commitMessage ?? "").split(/\r?\n/u)[0] ?? "";
  return [lineage.beforeExcerpt, lineage.afterExcerpt ?? lineage.excerpt, subject].map((part) => String(part ?? "")).join("\n");
};

/** A candidate's protected values; a whole-file excerpt makes its raw content hash the excerpt's, a hash of public text. */
const protectedOf = (candidate: unknown): readonly string[] => {
  const source = sourceOf(candidate);
  return PROTECTED_SOURCE_KEYS.flatMap((key) => {
    const value = source[key];
    return typeof value === "string" && value.length > 0 && !(key === "rawContentHash" && value === source.excerptHash) ? [value] : [];
  });
};

/**
 * FR-009 applied per candidate: the public text the five rounds would expose (fixed templates plus every
 * selected excerpt) may not contain any selected source's protected values as a whole token. Checking at
 * selection time lets the run move to the next candidate instead of failing at composition.
 */
export const revealsProtected = (profile: CrawlProfile, candidate: unknown, selected: readonly unknown[]): boolean =>
  protectedScreen(profile, selected)(candidate);

/**
 * `revealsProtected` against one selection, for every pane a file could show. The public text is the selection's text
 * and the candidate's excerpt joined by a line break. A value without a line break cannot cross it, and the break stands
 * between words as a text's ends do, so such a value shows in the whole text exactly when it shows in one of the two.
 * The selection's text is indexed once (#166): a selected value it shows reveals every candidate, and a candidate's
 * value is looked up there once. Each candidate indexes only its excerpt, where a selected value is looked for only
 * when the excerpt has the value's longest word run. A value with a line break takes the whole text.
 */
export const protectedScreen = (profile: CrawlProfile, selected: readonly unknown[]): ((candidate: unknown) => boolean) => {
  const head = [JSON.stringify(profile.templates), ...selected.map(excerptOf)].join("\n");
  const inHead = protectedIndex(head);
  const values = [...new Set(selected.flatMap(protectedOf))];
  if (values.some(inHead)) return () => true;
  const spanning = values.filter((value) => value.includes("\n"));
  // A value with no word run is keyed by "", which every excerpt is searched for.
  const byWord = new Map<string, string[]>();
  for (const value of values.filter((value) => !value.includes("\n"))) {
    const word = wordRuns(value).reduce((longest, run) => run.length > longest.length ? run : longest, "");
    const keyed = byWord.get(word);
    if (keyed) keyed.push(value);
    else byWord.set(word, [value]);
  }
  const headShows = new Map<string, boolean>();
  return (candidate) => {
    const tail = excerptOf(candidate);
    const inTail = protectedIndex(tail);
    let whole: string | undefined;
    const inWhole = (value: string): boolean => containsProtected(whole ??= `${head}\n${tail}`, value);
    const shows = (value: string): boolean => {
      if (value.includes("\n")) return inWhole(value);
      let shown = headShows.get(value);
      if (shown === undefined) headShows.set(value, shown = inHead(value));
      return shown || inTail(value);
    };
    return protectedOf(candidate).some(shows) || spanning.some(inWhole)
      || ["", ...new Set(wordRuns(tail))].some((word) => byWord.get(word)?.some(inTail) ?? false);
  };
};

const sameIdentity = (keys: readonly string[], candidate: unknown, selected: readonly unknown[]): boolean => {
  const source = sourceOf(candidate);
  return keys.some((key) => selected.some((value) => typeof source[key] === "string" && source[key] === sourceOf(value)[key]));
};
/**
 * FR-026 as amended: full deduplication within a deck; commit, blob, raw content, and excerpt across decks. A deck
 * of curated files passes its kind's own keys, since its rounds share a repository and a pinned commit.
 */
export const collidesWithSelected = (
  profile: CrawlProfile,
  candidate: unknown,
  sameDeck: readonly unknown[],
  otherDecks: readonly unknown[] = [],
  keys: Readonly<{ deck: readonly string[]; cross: readonly string[] }> = { deck: profile.deduplication, cross: CROSS_DECK_KEYS },
): boolean => sameIdentity(keys.deck, candidate, sameDeck) || sameIdentity(keys.cross, candidate, otherDecks);

/** A selected source must fit the run report's identity pattern, or publication would fail after every request was spent. */
export const unreportable = (value: unknown): boolean => {
  const { repository, commit, path } = (value ?? {}) as Record<string, unknown>;
  return typeof repository === "string" && typeof commit === "string" && typeof path === "string"
    && !isReportableSourceIdentity(`${repository}@${commit}:${path}`);
};

export type RepositoryScreen = (candidate: unknown, stage: DiagnosticStage) => Promise<boolean>;
/**
 * The repository check is the cheapest gate and repositories repeat, so each repository is screened
 * once per run, before any lineage request or blob fetch; every later candidate of a rejected one is skipped.
 */
export const repositoryScreen = (context: Context, deps: PreparationDependencies, hashes: string[], state: RunState): RepositoryScreen => {
  const verdicts = new Map<string, boolean>();
  return async (candidate, stage) => {
    const repository = String(view(candidate).repository ?? "");
    const known = verdicts.get(repository);
    if (known !== undefined) {
      if (!known) noteRejection(state, stage, new Error("REPOSITORY_SCREENED_OUT"));
      return known;
    }
    let verdict = false;
    try {
      addHashes(hashes, (await deps.screenGitHubRepository({ ...context, repository })).acceptedResponseHashes);
      verdict = true;
    } catch (error) { rejectCandidate(state, stage, error); }
    verdicts.set(repository, verdict);
    return verdict;
  };
};

/** Every protected value of the given candidates, for screening text that will be public. */
export const protectedValuesOf = (candidates: readonly unknown[]): readonly string[] => [...new Set(candidates.flatMap((candidate) => {
  const source = sourceOf(candidate);
  return PROTECTED_SOURCE_KEYS.map((key) => source[key]).filter((value): value is string => typeof value === "string" && value.length > 0);
}))];

/** A description is shown only when it names no protected value of any selected source and claims nothing about authorship. */
export const safeDescription = (description: string | null, protectedValues: readonly string[]): string | null => {
  if (description === null) return null;
  const shows = protectedIndex(description);
  return protectedValues.some((value) => shows(value)) || AUTHORSHIP_CLAIM.test(description) ? null : description;
};
