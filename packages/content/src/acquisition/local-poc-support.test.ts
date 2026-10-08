import { readFile } from "node:fs/promises";

import * as blobScreen from "./github/blob-screen";
import * as changedLines from "./github/changed-lines";
import * as licenseEvidence from "./github/license-evidence";
import * as treeWalk from "./github/tree-walk";
import * as support from "./local-poc-support";

const testModuleName: string = "vitest";
interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
}
interface TestApi {
  describe(name: string, callback: () => unknown): void;
  expect(actual: unknown): Expectation;
  it(name: string, callback: () => unknown): void;
}
const { describe, expect, it } = await import(testModuleName) as TestApi;

describe("local experiment content support boundary", () => {
  it("re-exports the existing low-level implementations unchanged", () => {
    expect(support.screenBlob).toBe(blobScreen.screenBlob);
    expect(support.BlobScreenError).toBe(blobScreen.BlobScreenError);
    expect(support.reconstructChangedLines).toBe(changedLines.reconstructChangedLines);
    expect(support.ChangedLinesError).toBe(changedLines.ChangedLinesError);
    expect(support.screenLicenseEvidence).toBe(licenseEvidence.screenLicenseEvidence);
    expect(support.LicenseEvidenceError).toBe(licenseEvidence.LicenseEvidenceError);
    expect(support.resolveApprovedSubtree).toBe(treeWalk.resolveApprovedSubtree);
    expect(support.walkApprovedTree).toBe(treeWalk.walkApprovedTree);
    expect(support.TreeWalkError).toBe(treeWalk.TreeWalkError);
  });

  it("has an exact runtime surface without controlled workflow capabilities", () => {
    expect(Object.keys(support).sort()).toEqual([
      "BlobScreenError",
      "ChangedLinesError",
      "LicenseEvidenceError",
      "TreeWalkError",
      "isScreenablePath",
      "reconstructChangedLines",
      "resolveApprovedSubtree",
      "screenBlob",
      "screenLicenseEvidence",
      "walkApprovedTree",
    ]);
  });

  it("publishes a Node-only package subpath", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { readonly exports: Readonly<Record<string, unknown>> };

    expect(packageJson.exports["./local-poc-support"]).toEqual({
      browser: null,
      node: "./src/acquisition/local-poc-support.ts",
      default: null,
    });
  });
});
