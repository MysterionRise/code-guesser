import { readdirSync, readFileSync } from "node:fs";

import { RUN_BUDGETS } from "./diagnostics";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const read = (url: URL): string => readFileSync(url, "utf8");
const here = new URL("./", import.meta.url);
/** Every preparer source, the blob screen it applies, and the shared parser's one error. */
const SOURCES: readonly URL[] = [
  ...readdirSync(here).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "command-test-harness.ts")
    .sort().map((name) => new URL(name, here)),
  new URL("../../../packages/content/src/acquisition/github/blob-screen.ts", import.meta.url),
  new URL("../../../packages/artifact/src/errors.ts", import.meta.url),
];

/**
 * Codes the sources throw that never reach the failure line or the rejection aggregates, each with the reason.
 * Keep it short: a code an operator can see belongs in CLAUDE.md instead.
 */
const NEVER_REPORTED: Readonly<Record<string, string>> = Object.freeze({
  PREPARATION_FAILED: "PreparationError's message; it is reported as INVARIANT_REJECTED",
  RETRY_REQUESTED: "RetryRequestError's message; the retry controller consumes it",
  REQUEST_POLICY_REJECTED: "the transport reports a refused request as POLICY",
  GITHUB_ADMISSION_REJECTED: "a message shadowed by the specific code every throw carries",
  GITHUB_FILE_REJECTED: "a message shadowed by the specific code every throw carries",
  GITHUB_FIX_REJECTED: "a message shadowed by the specific code every throw carries",
  GITHUB_LINEAGE_REJECTED: "a message shadowed by the specific code every throw carries",
  GITHUB_SEARCH_REJECTED: "a message shadowed by the specific code every throw carries",
  STACK_REVALIDATION_REJECTED: "a message shadowed by the specific code every throw carries",
  BLOB: "a git check name; callers report it as FILE_, FIX_, FIX_DATASET_, or LINEAGE_",
  COMMIT: "a git check name; callers report it as FILE_, FIX_, FIX_DATASET_, or LINEAGE_",
  PATH: "a git check name; callers report it as FILE_, FIX_, FIX_DATASET_, or LINEAGE_",
  SHAPE: "a git check name; callers report it as FILE_, FIX_, FIX_DATASET_, or LINEAGE_",
  TREE: "a git check name; callers report it as FILE_, FIX_, FIX_DATASET_, or LINEAGE_",
  RETRY_COUNT: "a capacity guard; the retry controller refuses first with RUN_RETRY_LIMIT",
  TOTAL_WAIT: "a capacity guard; the retry controller refuses first with TOTAL_WAIT_LIMIT",
  STACK_ROWS: "metered inside the metadata stage, which reports METADATA_CAPACITY",
  STACK_METADATA_BYTES: "metered inside the metadata stage, which reports METADATA_CAPACITY",
});

const CODE = "[A-Z][A-Z0-9_]*";
/**
 * Coded throws: `fail("CODE")`, `new SomeError("CODE")`, `super("CODE")`, a capacity check's last argument, and a
 * template such as `fail(`PREFIX_${check}`)`, collected as `PREFIX_*`.
 */
const THROWN = new RegExp(String.raw`\b(?:fail|super|new (?:[A-Z][A-Za-z]*)?Error|addWithin|nonNegative|positive)\((?:[^()"\x60]*?,\s*)?(["\x60])(${CODE})(\$\{|\1)`, "gu");
/** An error class's default code: `constructor(code = "CODE")`. */
const DEFAULT_CODE = new RegExp(String.raw`\bcode = "(${CODE})"`, "gu");
/** The transport's failure codes, declared once as a union. */
const TRANSPORT_CODES = /export type TransportErrorCode =([^;]+);/u;

/** Every code a source can throw, exact or as a `PREFIX_*` template. */
const thrownCodes = (sources: readonly string[]): ReadonlySet<string> => {
  const codes = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(THROWN)) codes.add(match[3] === "${" ? `${match[2]}*` : match[2]!);
    for (const match of source.matchAll(DEFAULT_CODE)) codes.add(match[1]!);
    for (const match of TRANSPORT_CODES.exec(source)?.[1]?.matchAll(/"([A-Z][A-Z0-9_]*)"/gu) ?? []) codes.add(match[1]!);
  }
  return codes;
};

/** The "Reading failures" section, up to the next second-level heading. */
const readingFailures = (markdown: string): string => {
  const start = markdown.indexOf("\n## Reading failures\n");
  if (start < 0) throw new Error("READING_FAILURES_MISSING");
  const end = markdown.indexOf("\n## ", start + 1);
  return markdown.slice(start, end < 0 ? undefined : end);
};

interface Documented { readonly token: string; readonly head: string; readonly pattern: RegExp }
/** Every code-shaped word in backticks: `CODE`, or a pattern such as `FIX_*`, `WORKER_EXIT_<CODE>`, or `*_RELEASED`. */
const documentedCodes = (section: string): readonly Documented[] =>
  [...section.matchAll(/`([^`]+)`/gu)].flatMap(([, span]) => span!.split(/\s+/u))
    .filter((token) => /^[A-Z0-9_*<>]+$/u.test(token) && /[A-Z]/u.test(token.replace(/<[A-Z_]+>/gu, "")))
    .map((token) => {
      const wildcard = token.replace(/<[A-Z_]+>/gu, "*");
      const pattern = new RegExp(`^${wildcard.split("*").join("[A-Z0-9_]+")}$`, "u");
      return Object.freeze({ token, head: wildcard.split("*")[0]!, pattern });
    });

/** Thrown codes neither documented nor listed as never reported. */
const undocumentedCodes = (sources: readonly string[], markdown: string, neverReported: Readonly<Record<string, string>> = NEVER_REPORTED): readonly string[] => {
  const documented = documentedCodes(readingFailures(markdown));
  const covered = (code: string): boolean => code.endsWith("*")
    // A template is covered by a documented pattern whose literal head it extends: `FIX_DATASET_*` by `FIX_*`.
    ? documented.some(({ token, head }) => token !== head && head.length > 0 && code.slice(0, -1).startsWith(head))
    : documented.some(({ pattern }) => pattern.test(code));
  return [...thrownCodes(sources)].filter((code) => !(code in neverReported) && !covered(code)).sort();
};

const sources = (): readonly string[] => SOURCES.map(read);
const handoff = (): string => read(new URL("../../../CLAUDE.md", import.meta.url));

describe("failure codes in CLAUDE.md", () => {
  it("names every code the preparer throws, exactly or by its pattern", () => {
    expect(undocumentedCodes(sources(), handoff())).toEqual([]);
  });

  it("finds a new coded throw, a new template, and a new error class that the section does not name", () => {
    const markdown = handoff();
    const added = [
      'const check = () => fail("BRAND_NEW_CODE");',
      "const nested = (part: string) => fail(`BRAND_NEW_PREFIX_${part}`);",
      'export class BrandNewError extends Error { public constructor(code = "BRAND_NEW_DEFAULT") { super(code); } }',
      'throw new BrandNewError("BRAND_NEW_THROWN");',
    ].join("\n");
    expect(undocumentedCodes([...sources(), added], markdown))
      .toEqual(["BRAND_NEW_CODE", "BRAND_NEW_DEFAULT", "BRAND_NEW_PREFIX_*", "BRAND_NEW_THROWN"]);
    // Documenting a code, or a pattern over it, clears it.
    const documented = markdown.replace("\n## Reading failures\n", "\n## Reading failures\n\n`BRAND_NEW_*`\n");
    expect(undocumentedCodes([...sources(), added], documented)).toEqual([]);
  });

  it("collects the codes it must, so an empty result means something", () => {
    const thrown = thrownCodes(sources());
    for (const code of ["JOURNAL_MISS", "REVALIDATION_AUTHOR_CONTACT", "PERSONAL_DATA", "UNSUPPORTED_STATUS", "NETWORK",
      "EXPERIMENT_RECORD_REJECTED", "FIX_DATASET_*", "BLOB_ATTEMPTS", "LANGUAGE_ROUNDS_REJECTED", "COMMAND_ARGUMENTS_REJECTED",
      "RATE_LIMIT_CHECKPOINT", "RUN_INTERRUPTED", "JOURNAL_EXISTS"]) {
      expect(thrown.has(code), code).toBe(true);
    }
  });

  it("lists as never reported only codes the sources still throw", () => {
    const thrown = thrownCodes(sources());
    expect(Object.keys(NEVER_REPORTED).filter((code) => !thrown.has(code))).toEqual([]);
  });

  it("documents no exact code the sources never mention", () => {
    const text = [...sources(), ...readdirSync(new URL("../stack/", import.meta.url))
      .filter((name) => name.endsWith(".py") && !name.startsWith("test_")).map((name) => read(new URL(`../stack/${name}`, import.meta.url)))].join("\n");
    // Examples the preparer composes at run time, by the parts it composes them from.
    const composed: Readonly<Record<string, readonly string[]>> = {
      UNCODED_TYPEERROR: ["UNCODED_${", "error.constructor.name"],
      WORKER_EXIT_SAMPLE_REJECTED: ["WORKER_EXIT_${", "SAMPLE_REJECTED"],
    };
    const mentioned = (code: string): boolean => (composed[code] ?? [code]).every((part) => text.includes(part));
    const exact = documentedCodes(readingFailures(handoff())).filter(({ token, head }) => token === head).map(({ token }) => token);
    expect([...new Set(exact)].filter((code) => !mentioned(code)).sort()).toEqual([]);
  });

  it("names exactly the run-wide budgets a candidate can exhaust, and no retry or wait budget", () => {
    const section = readingFailures(handoff());
    const start = section.indexOf("- `BUDGET_EXHAUSTED_<BUDGET>`");
    const bullet = section.slice(start, section.indexOf("\n- ", start + 1));
    const named = [...bullet.slice(0, bullet.indexOf(")")).matchAll(/`([A-Z][A-Z0-9_]*)`/gu)].map(([, code]) => code);
    expect(start).toBeGreaterThan(0);
    expect(named.sort()).toEqual([...RUN_BUDGETS].sort());
    expect(section).not.toMatch(/BUDGET_EXHAUSTED_(?:RETRY_COUNT|TOTAL_WAIT)\b/u);
  });
});
