import { createHash } from "node:crypto";

interface DiffBlob {
  readonly blobSha: string;
  readonly rawSha256: string;
  readonly normalizedSha256: string;
  readonly text: string;
  readonly kind: string;
  readonly binary: boolean;
}
export interface ChangedLinesInput {
  readonly parentCommits: readonly string[];
  readonly changeKind: string;
  readonly parentPath: string;
  readonly childPath: string;
  readonly parent: DiffBlob;
  readonly child: DiffBlob;
  readonly displayedPatch?: string;
}
export interface ChangedLinesResult {
  readonly algorithmVersion: "line-sequence-v1";
  readonly changedLines: readonly { readonly line: number; readonly text: string }[];
  readonly coordinates: { readonly startLine: number; readonly endLine: number };
  readonly excerpt: string;
  readonly excerptSha256: string;
  readonly parentBlobSha: string;
  readonly childBlobSha: string;
  readonly parentRawSha256: string;
  readonly childRawSha256: string;
  readonly parentNormalizedSha256: string;
  readonly childNormalizedSha256: string;
}
export class ChangedLinesError extends Error {
  public constructor(code: string) {
    super(code);
    this.name = "ChangedLinesError";
  }
}
const fail = (code: string): never => {
  throw new ChangedLinesError(code);
};
const FULL_SHA = /^[0-9a-f]{40}$/u;
const NON_CODE_PATH = /(?:^|\/)(?:docs?|\.github)(?:\/|$)|(?:^|\/)package\.json$/iu;
const INELIGIBLE_LINE =
  /^(?:\s*$|\s*(?:\/\/|#|\/\*|\*|--)|\s*(?:import\b|export\s+.*\s+from\b|from\s+\S+\s+import\b|require\s*\(|use\s+\S+))/u;
const CONTEXT_LINES = 2;
const MAX_DIFF_LINES = 2_000;
const MAX_EXCERPT_LINES = 21;

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

/**
 * Cheap, deterministic pre-screen on the provider's recorded unified patch: true only when
 * the added or modified child lines that would count as eligible changed lines fit the
 * bounded excerpt window and touch no line beyond the diff ceiling. A patch that fails here
 * could never pass reconstruction, so a caller may reject it before any further fetch; a
 * patch that passes is still subject to the authoritative reconstruction from pinned blobs.
 */
export const patchFitsExcerptWindow = (patch: string): boolean => {
  const eligible: number[] = [];
  let childLine = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      childLine = Number(header[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk) return false;
    if (line.startsWith("+")) {
      if (!INELIGIBLE_LINE.test(line.slice(1))) eligible.push(childLine);
      childLine += 1;
    } else if (line.startsWith(" ") || line === "") {
      childLine += 1;
    } else if (!line.startsWith("-") && !line.startsWith("\\")) {
      return false;
    }
  }
  if (eligible.length === 0) return false;
  const first = Math.min(...eligible);
  const last = Math.max(...eligible);
  return last <= MAX_DIFF_LINES && last - first + 1 + 2 * CONTEXT_LINES <= MAX_EXCERPT_LINES;
};

const changedChildIndexes = (
  parentLines: readonly string[],
  childLines: readonly string[],
): number[] => {
  if (parentLines.length > MAX_DIFF_LINES || childLines.length > MAX_DIFF_LINES) {
    fail("DIFF_LINE_LIMIT");
  }
  const lengths = Array.from(
    { length: parentLines.length + 1 },
    () => new Uint16Array(childLines.length + 1),
  );
  for (let parentIndex = parentLines.length - 1; parentIndex >= 0; parentIndex -= 1) {
    for (let childIndex = childLines.length - 1; childIndex >= 0; childIndex -= 1) {
      lengths[parentIndex]![childIndex] = parentLines[parentIndex] === childLines[childIndex]
        ? 1 + lengths[parentIndex + 1]![childIndex + 1]!
        : Math.max(
          lengths[parentIndex + 1]![childIndex]!,
          lengths[parentIndex]![childIndex + 1]!,
        );
    }
  }
  const changed: number[] = [];
  let parentIndex = 0;
  let childIndex = 0;
  while (childIndex < childLines.length) {
    if (parentIndex >= parentLines.length) {
      changed.push(childIndex);
      childIndex += 1;
    } else if (parentLines[parentIndex] === childLines[childIndex]) {
      parentIndex += 1;
      childIndex += 1;
    } else if (
      lengths[parentIndex + 1]![childIndex]! >= lengths[parentIndex]![childIndex + 1]!
    ) {
      parentIndex += 1;
    } else {
      changed.push(childIndex);
      childIndex += 1;
    }
  }
  return changed;
};

const validateShape = (input: ChangedLinesInput): void => {
  if (input.parentCommits.length !== 1 || !FULL_SHA.test(input.parentCommits[0] ?? "")) {
    fail("SINGLE_PARENT_REQUIRED");
  }
  if (input.changeKind !== "modified") fail("CHANGE_KIND_REJECTED");
  if (input.parentPath !== input.childPath) fail("SAME_PATH_REQUIRED");
  if (
    input.parent.kind !== "regular"
    || input.child.kind !== "regular"
    || input.parent.binary
    || input.child.binary
  ) fail("REGULAR_TEXT_REQUIRED");
  if (input.parent.text === input.child.text) fail("UNCHANGED_CONTENT");
};

export const reconstructChangedLines = (
  input: ChangedLinesInput,
): ChangedLinesResult => {
  validateShape(input);
  const childLines = input.child.text.split("\n");
  const changedIndexes = changedChildIndexes(input.parent.text.split("\n"), childLines);
  const eligibleIndexes = changedIndexes.filter((index) =>
    !INELIGIBLE_LINE.test(childLines[index] ?? ""));
  if (NON_CODE_PATH.test(input.childPath) || eligibleIndexes.length === 0) {
    fail("NO_ELIGIBLE_CODE_CHANGE");
  }
  const first = Math.max(0, Math.min(...eligibleIndexes) - CONTEXT_LINES);
  const last = Math.min(childLines.length - 1, Math.max(...eligibleIndexes) + CONTEXT_LINES);
  if (last - first + 1 > MAX_EXCERPT_LINES) fail("EXCERPT_SPAN_LIMIT");
  const excerpt = childLines.slice(first, last + 1).join("\n");
  return Object.freeze({
    algorithmVersion: "line-sequence-v1",
    changedLines: Object.freeze(eligibleIndexes.map((index) =>
      Object.freeze({ line: index + 1, text: childLines[index] ?? "" }))),
    coordinates: Object.freeze({ startLine: first + 1, endLine: last + 1 }),
    excerpt,
    excerptSha256: createHash("sha256").update(excerpt).digest("hex"),
    parentBlobSha: input.parent.blobSha,
    childBlobSha: input.child.blobSha,
    parentRawSha256: input.parent.rawSha256,
    childRawSha256: input.child.rawSha256,
    parentNormalizedSha256: input.parent.normalizedSha256,
    childNormalizedSha256: input.child.normalizedSha256,
  });
};
