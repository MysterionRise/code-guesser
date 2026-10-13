import type { CapacitySnapshot } from "./capacity";
import {
  DECK_SHORT, PreparationError, rejectCandidate, noteRejection, type DeckAttempts, type DeckOutcome, type DiagnosticStage, type RunState,
} from "./diagnostics";
import type { CrawlProfile } from "./profile";
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

/** FR-029: licence screening precedes any blob download. A row without a licence list is left to revalidation. */
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

/**
 * One language round per configured language: the first row, in stable order, that survives every check.
 * A language with no surviving row leaves the deck short, so the remaining languages are not fetched.
 */
export const selectStack = async (
  context: Context,
  deps: PreparationDependencies,
  hashes: string[],
  rows: readonly unknown[],
  github: readonly unknown[],
  state: RunState,
  screenRepository: RepositoryScreen,
  attempt: DeckAttempts,
): Promise<DeckOutcome<StackSelection>> => attempt(async () => {
  const selected: StackSelection[] = [];
  const chosen = (): unknown[] => selected.map(({ candidate }) => candidate);
  for (const configuration of context.profile.stack.configurations) {
    const ordered = rows.filter((item) => view(item).detectedLanguage === configuration.language).sort(stackOrder);
    const before = selected.length;
    for (const row of ordered) {
      if (!licensesAllowed(context.profile, row)) { noteRejection(state, "SCREENING", new Error("LICENSE_REJECTED")); continue; }
      if (!(await screenRepository(row, "GITHUB_REVALIDATION"))) continue;
      const lease = context.capacity.beginBlob();
      let stage: DiagnosticStage = "BLOB_RETRIEVAL";
      try {
        const fetched = await deps.fetchStackBlob({ ...context, row,
          limits: remainingBlobLimits(context.profile, context.capacity.snapshot()) });
        addHashes(hashes, fetched.acceptedResponseHashes);
        lease.addBytes(fetched.value.byteLength);
        stage = "GITHUB_REVALIDATION";
        const checked = await deps.revalidateStackCandidate({ ...context, row, blob: fetched.value,
          crawlSnapshotId: provisionalSnapshot(context.profileHash, hashes) });
        addHashes(hashes, checked.acceptedResponseHashes);
        state.githubRevalidations += 1;
        if (view(checked.value).detectedLanguage !== configuration.language) throw new PreparationError();
        stage = "SCREENING";
        state.screened += 1;
        if (unreportable(checked.value)) throw new Error("SOURCE_IDENTITY_UNREPORTABLE");
        const eligible = deps.validateLanguageCandidate({ ...context, candidate: checked.value });
        stage = "DEDUPLICATION";
        if (collidesWithSelected(context.profile, eligible, chosen(), github)) {
          state.duplicatesRejected += 1;
          throw new Error("SOURCE_DUPLICATE");
        }
        stage = "SCREENING";
        if (revealsProtected(context.profile, eligible, [...github, ...chosen()])) throw new Error("PUBLIC_CONTAINMENT_REJECTED");
        lease.accept();
        selected.push(Object.freeze({ row, blob: fetched.value, candidate: eligible }));
        break;
      } catch (error) { lease.release(); rejectCandidate(state, stage, error); }
    }
    if (selected.length === before) return { skipped: DECK_SHORT };
  }
  if (selected.length !== context.profile.selection.languageRounds) throw new PreparationError();
  return { candidates: Object.freeze(selected) };
});
