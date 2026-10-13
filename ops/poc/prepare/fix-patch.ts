/**
 * Bug datasets' own records, read as text and never run: a patch that changes one line, and the commits a bug's
 * buggy and fixed versions come from.
 */

export class FixRecordError extends Error {
  public constructor(code = "FIX_RECORD") {
    super(code);
    this.name = "FixRecordError";
  }
}

const fail = (code?: string): never => { throw new FixRecordError(code); };
const GIT_ID = /^[0-9a-f]{40}$/u;
/** Test code is not what a fix round asks about. */
const TEST_PATH = /(?:^|\/)(?:tests?|testing)(?:\/|$)|(?:^|\/)test_[^/]*\.py$|_test\.py$|Test\.java$/u;

/** One line a dataset records a fix changing: in which file, what it read before, and what the fix made it. */
export interface DatasetFix {
  readonly path: string;
  readonly buggyLine: string;
  readonly fixedLine: string;
}

/** The buggy and fixed commits a dataset names for one bug. A round shows the fix's own parent, so `buggy` may be abbreviated. */
export interface BugRevisions {
  readonly buggy: string;
  readonly fixed: string;
}

/**
 * The one line a patch changes, when it changes exactly one line of one file outside tests, in one hunk, and the
 * line's text changes beyond whitespace. Defects4J's patches turn the fixed version into the buggy one
 * (`reverse`); BugsInPy's run from buggy to fixed (`forward`). Undefined for any other patch.
 */
export const oneLineFix = (patch: string, direction: "forward" | "reverse"): DatasetFix | undefined => {
  const lines = patch.replace(/\r\n?/gu, "\n").split("\n");
  const headers = lines.filter((line) => line.startsWith("diff --git "));
  const hunks = lines.filter((line) => line.startsWith("@@ "));
  const removed = lines.filter((line) => line.startsWith("-") && !line.startsWith("--- "));
  const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++ "));
  if (headers.length !== 1 || hunks.length !== 1 || removed.length !== 1 || added.length !== 1) return undefined;
  const files = /^diff --git a\/(\S+) b\/(\S+)$/u.exec(headers[0]!);
  if (!files || files[1] !== files[2] || TEST_PATH.test(files[1]!)) return undefined;
  if (!lines.includes(`--- a/${files[1]}`) || !lines.includes(`+++ b/${files[1]}`)) return undefined;
  const [before, after] = direction === "forward" ? [removed[0]!.slice(1), added[0]!.slice(1)] : [added[0]!.slice(1), removed[0]!.slice(1)];
  if (before.trim().length === 0 || after.trim().length === 0 || before.trim() === after.trim()) return undefined;
  return Object.freeze({ path: files[1]!, buggyLine: before, fixedLine: after });
};

const DEFECTS4J_HEADER = "bug.id,revision.id.buggy,revision.id.fixed,report.id,report.url";

/** Defects4J's `active-bugs.csv`: each bug id's buggy and fixed commits. A malformed row rejects the table. */
export const defects4jRevisions = (csv: string): ReadonlyMap<string, BugRevisions> => {
  const [header, ...rows] = csv.replace(/\r\n?/gu, "\n").trimEnd().split("\n");
  if (header !== DEFECTS4J_HEADER) fail("FIX_RECORD_TABLE");
  const revisions = new Map<string, BugRevisions>();
  for (const row of rows) {
    const [id, buggy, fixed] = row.split(",");
    if (!/^[1-9][0-9]*$/u.test(id ?? "") || !GIT_ID.test(buggy ?? "") || !GIT_ID.test(fixed ?? "") || revisions.has(id!)) fail("FIX_RECORD_TABLE");
    revisions.set(id!, Object.freeze({ buggy: buggy!, fixed: fixed! }));
  }
  return revisions;
};

/** BugsInPy's `bug.info`: `key="value"` lines naming the buggy commit (sometimes abbreviated) and the fixed commit. */
export const bugsInPyRevisions = (info: string): BugRevisions => {
  const fields = new Map<string, string>();
  for (const line of info.replace(/\r\n?/gu, "\n").split("\n").filter((entry) => entry.trim().length > 0)) {
    const field = /^([a-z_]+)="([^"]*)"\s*$/u.exec(line) ?? fail("FIX_RECORD_INFO");
    if (fields.has(field[1]!)) fail("FIX_RECORD_INFO");
    fields.set(field[1]!, field[2]!);
  }
  const buggy = fields.get("buggy_commit_id") ?? "";
  const fixed = fields.get("fixed_commit_id") ?? "";
  if (!/^[0-9a-f]{7,40}$/u.test(buggy) || !GIT_ID.test(fixed) || fixed.startsWith(buggy)) fail("FIX_RECORD_INFO");
  return Object.freeze({ buggy, fixed });
};
