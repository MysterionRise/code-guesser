import { CapacityError } from "./capacity";

/** Where a rejected candidate failed; rejection aggregates are keyed by stage and reason code. */
export type DiagnosticStage = "DISCOVERY" | "ADMISSION" | "BLOB_RETRIEVAL" | "GITHUB_REVALIDATION" | "SCREENING" | "DEDUPLICATION" | "SELECTION";
/** The stage a run was in when it failed, as named on the `PREPARATION_STAGE_FAILED` line. */
export type FailureStage = "PREFLIGHT" | "DISCOVERY" | "ADMISSION" | "STACK_METADATA" | "BLOB_RETRIEVAL" | "SELECTION" | "PUBLICATION";

export interface RunState {
  readonly diagnostics: Map<string, number>;
  discovered: number;
  repositoriesAdmitted: number;
  githubRevalidations: number;
  screened: number;
  duplicatesRejected: number;
}

export const createRunState = (): RunState => ({
  diagnostics: new Map(), discovered: 0, repositoriesAdmitted: 0, githubRevalidations: 0, screened: 0, duplicatesRejected: 0,
});

export class PreparationError extends Error {
  public constructor() { super("PREPARATION_FAILED"); this.name = "PreparationError"; }
}

export const REASON_CODE = /^[A-Z][A-Z0-9_]*$/u;
const STATUS_CLASS = /^(?:none|[1-5]xx)$/u;
const FAILURE_CAUSE_DEPTH = 4;
export type FailureDiagnostic = Readonly<{ code: string; statusClass: string }>;

/** Retains only a stable reason code and status class from a failure chain; anything else is dropped before logging. */
export const failureDiagnostic = (error: unknown): FailureDiagnostic | undefined => {
  let code: string | undefined;
  let statusClass = "none";
  let current: unknown = error;
  for (let depth = 0; depth < FAILURE_CAUSE_DEPTH && typeof current === "object" && current !== null; depth += 1) {
    const { code: candidate, diagnostic, cause } = current as Record<string, unknown>;
    if (code === undefined && typeof candidate === "string" && REASON_CODE.test(candidate)) code = candidate;
    const observed = typeof diagnostic === "object" && diagnostic !== null ? (diagnostic as Record<string, unknown>).statusClass : undefined;
    if (statusClass === "none" && typeof observed === "string" && STATUS_CLASS.test(observed)) statusClass = observed;
    current = cause;
  }
  return code === undefined ? undefined : Object.freeze({ code, statusClass });
};

/** Names an uncoded failure by its code-shaped message or its class, never by any other detail. */
export const uncodedDiagnostic = (error: unknown): FailureDiagnostic => {
  if (error instanceof PreparationError) return Object.freeze({ code: "INVARIANT_REJECTED", statusClass: "none" });
  const message = error instanceof Error && REASON_CODE.test(error.message) ? error.message : undefined;
  const name = error instanceof Error ? error.constructor.name.replace(/[^A-Za-z0-9]/gu, "").toUpperCase() : "";
  return Object.freeze({ code: message ?? `UNCODED_${name || "ERROR"}`, statusClass: "none" });
};

const STACK_FRAME = /^\s*at (?:async )?([^\s(]+) \((.*?):\d+:\d+\)$/u;
/** The first named frame outside the throw helpers: a function and file name only, never a line, URL, or value. */
export const failureSite = (error: unknown): string | undefined => {
  const lines = error instanceof Error && typeof error.stack === "string" ? error.stack.split("\n") : [];
  for (const line of lines) {
    const match = STACK_FRAME.exec(line);
    if (!match) continue;
    const name = match[1]!;
    const file = match[2]!.split("/").at(-1)!.replace(/\?.*$/u, "");
    if (name === "fail" || name.endsWith(".fail") || name.startsWith("new ") || name.startsWith("node:")) continue;
    if (!/^[A-Za-z0-9_.-]+\.[cm]?[jt]sx?$/u.test(file)) continue;
    return `${name.replace(/[^A-Za-z0-9_$.<>]/gu, "")}@${file}`;
  }
  return undefined;
};

/** The stable code of a candidate rejection: a wrapped retry failure reports its transport cause instead of the wrapper. */
const rejectionCode = (error: unknown): string => {
  const codeOf = (value: unknown): string | undefined => {
    if (!(value instanceof Error)) return undefined;
    const { code } = value as Error & { code?: unknown };
    if (typeof code === "string" && REASON_CODE.test(code)) return code;
    return REASON_CODE.test(value.message) ? value.message : undefined;
  };
  const own = codeOf(error);
  if (own === "RETRY_SIGNAL_MISSING") return codeOf((error as Error).cause) ?? own;
  return own ?? "CANDIDATE_REJECTED";
};

export const noteRejection = (state: RunState, stage: DiagnosticStage, error: unknown): void => {
  const key = `${stage}\0${rejectionCode(error)}`;
  state.diagnostics.set(key, (state.diagnostics.get(key) ?? 0) + 1);
};

/** Rejection aggregates as `STAGE:CODE=count`, sorted; counts and stable codes only. */
export const rejectionSummary = (state: RunState): readonly string[] =>
  [...state.diagnostics].map(([key, count]) => `${key.replace("\0", ":")}=${count}`).sort();

/** Run-wide budgets: once one is spent every later candidate would fail the same way, so the run stops. */
const RUN_BUDGETS = new Set(["REQUEST_COUNT", "BLOB_ATTEMPTS", "SUCCESSFUL_BLOBS", "TOTAL_BLOB_BYTES",
  "STACK_METADATA_BYTES", "RETRY_COUNT", "TOTAL_WAIT", "TEMPORARY_DISK"]);

export class BudgetExhaustedError extends Error {
  public constructor(public readonly code: string, cause: unknown) { super(code, { cause }); this.name = "BudgetExhaustedError"; }
}

const spentBudget = (error: unknown): string | undefined => {
  let current: unknown = error;
  for (let depth = 0; depth < FAILURE_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (current instanceof CapacityError && RUN_BUDGETS.has(current.code)) return current.code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
};

/** Records one rejected candidate, or ends the run when the rejection is a spent run-wide budget. */
export const rejectCandidate = (state: RunState, stage: DiagnosticStage, error: unknown): void => {
  const budget = spentBudget(error);
  if (budget !== undefined) throw new BudgetExhaustedError(`BUDGET_EXHAUSTED_${budget}`, error);
  noteRejection(state, stage, error);
};

/** One deck's selection: its candidates, or the code that kept it from filling. */
export type DeckOutcome<Candidate = unknown> =
  | Readonly<{ candidates: readonly Candidate[]; skipped?: undefined }>
  | Readonly<{ skipped: string; candidates?: undefined }>;
/** A deck that ran out of qualifying candidates before it held a full set of rounds. */
export const DECK_SHORT = "DECK_SHORT";

/**
 * Runs one deck's selection. A spent run-wide budget skips this deck and every later one with the same
 * code instead of failing the run, so the decks already filled can still be published.
 */
export const createDeckAttempts = () => {
  let exhausted: string | undefined;
  return async <Candidate>(fill: () => Promise<DeckOutcome<Candidate>>): Promise<DeckOutcome<Candidate>> => {
    if (exhausted !== undefined) return Object.freeze({ skipped: exhausted });
    try {
      return await fill();
    } catch (error) {
      if (!(error instanceof BudgetExhaustedError)) throw error;
      exhausted = error.code;
      return Object.freeze({ skipped: error.code });
    }
  };
};
export type DeckAttempts = ReturnType<typeof createDeckAttempts>;
