import {
  SIGNED_CAPACITY_CEILINGS,
  STACK_LANGUAGES,
  type CapacityLimits,
  type StackLanguage,
} from "./profile";

export class CapacityError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "CapacityError";
  }
}

type Usage = { pages: number; results: number };

export interface CapacityOptions {
  readonly limits: CapacityLimits;
  readonly githubQueryIds: readonly string[];
  readonly stackLanguages: readonly StackLanguage[];
}

export interface BlobCapacityLease {
  addBytes(bytes: number): void;
  accept(): void;
  release(): void;
}

export interface RequestCapacityLease {
  complete(responseBytes: number): void;
  release(): void;
}

export interface CapacitySnapshot {
  readonly github: Readonly<Record<string, Readonly<Usage>>>;
  readonly stackRows: Readonly<Record<StackLanguage, number>>;
  readonly stackMetadataBytes: number;
  readonly blobAttempts: number;
  readonly successfulBlobs: number;
  readonly totalBlobBytes: number;
  readonly activeRequests: number;
  readonly requestCount: number;
  readonly responseBytes: number;
  readonly retryWaits: number;
  readonly waitedMilliseconds: number;
  readonly temporaryDiskBytes: number;
  readonly peakTemporaryDiskBytes: number;
}

export interface CapacityMeter {
  recordGitHubPage(queryId: string, results: number): void;
  recordStackRows(language: StackLanguage, rows: number, metadataBytes: number): void;
  beginBlob(): BlobCapacityLease;
  beginRequest(): RequestCapacityLease;
  /** Charges requests a locked worker reports having made against the shared request ceiling. */
  recordWorkerRequests(count: number): void;
  recordRetryWait(milliseconds: number): void;
  reserveTemporaryDisk(bytes: number): () => void;
  snapshot(): CapacitySnapshot;
}

interface CapacityState {
  github: Record<string, Usage>;
  stackRows: Record<StackLanguage, number>;
  stackMetadataBytes: number;
  blobAttempts: number;
  successfulBlobs: number;
  totalBlobBytes: number;
  activeRequests: number;
  requestCount: number;
  responseBytes: number;
  retryWaits: number;
  waitedMilliseconds: number;
  temporaryDiskBytes: number;
  peakTemporaryDiskBytes: number;
}

const fail = (code: string): never => { throw new CapacityError(code); };

const nonNegative = (value: number, code: string): number =>
  Number.isSafeInteger(value) && value >= 0 ? value : fail(code);

const positive = (value: number, code: string): number =>
  Number.isSafeInteger(value) && value > 0 ? value : fail(code);

const addWithin = (current: number, increment: number, maximum: number, code: string): number => {
  const next = current + nonNegative(increment, code);
  return Number.isSafeInteger(next) && next <= maximum ? next : fail(code);
};

const validateLimits = (limits: CapacityLimits): void => {
  const signedKeys = Object.keys(SIGNED_CAPACITY_CEILINGS) as (keyof CapacityLimits)[];
  const actualKeys = Object.keys(limits).sort();
  if (actualKeys.join("|") !== [...signedKeys].sort().join("|")) fail("LIMIT_SHAPE");
  for (const key of signedKeys) {
    const value = positive(limits[key], "LIMIT_VALUE");
    if (value > SIGNED_CAPACITY_CEILINGS[key]) fail("LIMIT_RAISED");
  }
};

const validateDimensions = (options: CapacityOptions): void => {
  const queries = options.githubQueryIds;
  if (queries.length === 0 || new Set(queries).size !== queries.length
    || queries.some((id) => typeof id !== "string" || id.trim() !== id || id.length === 0)) {
    fail("QUERY_DIMENSIONS");
  }
  if (options.stackLanguages.join("|") !== STACK_LANGUAGES.join("|")) fail("STACK_DIMENSIONS");
};

const initialState = (queryIds: readonly string[]): CapacityState => ({
  github: Object.fromEntries(queryIds.map((id) => [id, { pages: 0, results: 0 }])),
  stackRows: Object.fromEntries(STACK_LANGUAGES.map((language) => [language, 0])) as Record<StackLanguage, number>,
  stackMetadataBytes: 0,
  blobAttempts: 0,
  successfulBlobs: 0,
  totalBlobBytes: 0,
  activeRequests: 0,
  requestCount: 0,
  responseBytes: 0,
  retryWaits: 0,
  waitedMilliseconds: 0,
  temporaryDiskBytes: 0,
  peakTemporaryDiskBytes: 0,
});

const freezeSnapshot = (state: CapacityState): CapacitySnapshot => {
  const github = Object.freeze(Object.fromEntries(Object.entries(state.github).map(([id, usage]) => [
    id,
    Object.freeze({ ...usage }),
  ])));
  return Object.freeze({
    github,
    stackRows: Object.freeze({ ...state.stackRows }),
    stackMetadataBytes: state.stackMetadataBytes,
    blobAttempts: state.blobAttempts,
    successfulBlobs: state.successfulBlobs,
    totalBlobBytes: state.totalBlobBytes,
    activeRequests: state.activeRequests,
    requestCount: state.requestCount,
    responseBytes: state.responseBytes,
    retryWaits: state.retryWaits,
    waitedMilliseconds: state.waitedMilliseconds,
    temporaryDiskBytes: state.temporaryDiskBytes,
    peakTemporaryDiskBytes: state.peakTemporaryDiskBytes,
  });
};

const createBlobLease = (state: CapacityState, limits: CapacityLimits): BlobCapacityLease => {
  state.blobAttempts = addWithin(state.blobAttempts, 1, limits.blobAttempts, "BLOB_ATTEMPTS");
  let active = true;
  let blobBytes = 0;
  const requireActive = (): void => { if (!active) fail("BLOB_RELEASED"); };
  return Object.freeze({
    addBytes: (bytes: number): void => {
      requireActive();
      const nextBlob = addWithin(blobBytes, bytes, limits.perBlobBytes, "BLOB_BYTES");
      const nextTotal = addWithin(state.totalBlobBytes, bytes, limits.totalBlobBytes, "TOTAL_BLOB_BYTES");
      blobBytes = nextBlob;
      state.totalBlobBytes = nextTotal;
    },
    accept: (): void => {
      requireActive();
      if (blobBytes === 0) fail("EMPTY_BLOB");
      const successful = addWithin(state.successfulBlobs, 1, limits.successfulBlobs, "SUCCESSFUL_BLOBS");
      state.successfulBlobs = successful;
      active = false;
    },
    release: (): void => { active = false; },
  });
};

const createRequestLease = (state: CapacityState, limits: CapacityLimits): RequestCapacityLease => {
  const requestCount = addWithin(state.requestCount, 1, limits.requestCount, "REQUEST_COUNT");
  const activeRequests = addWithin(state.activeRequests, 1, limits.concurrentRequests, "CONCURRENCY");
  state.requestCount = requestCount;
  state.activeRequests = activeRequests;
  let active = true;
  const release = (): void => {
    if (!active) return;
    active = false;
    state.activeRequests -= 1;
  };
  return Object.freeze({
    complete: (bytes: number): void => {
      if (!active) fail("REQUEST_RELEASED");
      release();
      const parsed = nonNegative(bytes, "RESPONSE_BYTES");
      if (parsed > limits.responseBytes) fail("RESPONSE_BYTES");
      state.responseBytes += parsed;
    },
    release,
  });
};

export const createCapacityMeter = (options: CapacityOptions): CapacityMeter => {
  validateLimits(options.limits);
  validateDimensions(options);
  const state = initialState(options.githubQueryIds);
  const { limits } = options;
  return Object.freeze({
    recordGitHubPage: (queryId: string, results: number): void => {
      const usage = state.github[queryId] ?? fail("UNKNOWN_QUERY");
      const pages = addWithin(usage.pages, 1, limits.githubPages, "GITHUB_PAGES");
      const resultCount = addWithin(usage.results, results, limits.githubResults, "GITHUB_RESULTS");
      usage.pages = pages;
      usage.results = resultCount;
    },
    recordStackRows: (language: StackLanguage, rows: number, metadataBytes: number): void => {
      if (!(language in state.stackRows)) fail("UNKNOWN_LANGUAGE");
      const rowCount = addWithin(state.stackRows[language], rows, limits.stackRowsPerLanguage, "STACK_ROWS");
      const byteCount = addWithin(state.stackMetadataBytes, metadataBytes, limits.stackMetadataBytes, "STACK_METADATA_BYTES");
      state.stackRows[language] = rowCount;
      state.stackMetadataBytes = byteCount;
    },
    beginBlob: (): BlobCapacityLease => createBlobLease(state, limits),
    beginRequest: (): RequestCapacityLease => createRequestLease(state, limits),
    recordWorkerRequests: (count: number): void => {
      state.requestCount = addWithin(state.requestCount, count, limits.requestCount, "REQUEST_COUNT");
    },
    recordRetryWait: (milliseconds: number): void => {
      const wait = positive(milliseconds, "WAIT_VALUE");
      if (wait > limits.waitMilliseconds) fail("WAIT_VALUE");
      const retries = addWithin(state.retryWaits, 1, 3, "RETRY_COUNT");
      const total = addWithin(state.waitedMilliseconds, wait, limits.totalWaitMilliseconds, "TOTAL_WAIT");
      state.retryWaits = retries;
      state.waitedMilliseconds = total;
    },
    reserveTemporaryDisk: (bytes: number): (() => void) => {
      const reservation = positive(bytes, "TEMPORARY_DISK");
      const next = addWithin(state.temporaryDiskBytes, reservation, limits.temporaryDiskBytes, "TEMPORARY_DISK");
      state.temporaryDiskBytes = next;
      state.peakTemporaryDiskBytes = Math.max(state.peakTemporaryDiskBytes, next);
      let active = true;
      return (): void => {
        if (!active) return;
        active = false;
        state.temporaryDiskBytes -= reservation;
      };
    },
    snapshot: (): CapacitySnapshot => freezeSnapshot(state),
  });
};
