import { createHash } from "node:crypto";
import { BlobScreenError, isScreenablePath, screenBlob } from "./blob-screen";

const testModuleName: string = "vitest";
interface Expectation {
  toBe(expected: unknown): void;
  toBeInstanceOf(expected: unknown): void;
  toThrow(expected?: unknown): void;
}
interface TestApi {
  describe(name: string, callback: () => unknown): void;
  expect(actual: unknown): Expectation;
  it(name: string, callback: () => unknown): void;
}
const { describe, expect, it } = await import(testModuleName) as TestApi;
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("deterministic source blob screening", () => {
  it("answers path eligibility without content: safe, supported, and not excluded", () => {
    for (const path of ["src/value.ts", "lib/alpha.go", "a/b/c.py", "Main.java", "x.sh"]) expect(isScreenablePath(path)).toBe(true);
    for (const path of [
      "/src/value.ts", "src/../value.ts", "src\\value.ts", "src/notes.md", "docs/guide.ts", ".github/workflows/ci.ts",
      "vendor/lib.js", "app.min.js", "package-lock.json", "src/sp ace.ts", "",
    ]) expect(isScreenablePath(path)).toBe(false);
  });
  it("normalizes line endings while preserving distinct raw and normalized hashes", () => {
    const raw = bytes("const x = 1;\r\nconst y = 2;\r");
    const result = screenBlob({ path: "src/code.ts", bytes: raw }, new Set());
    expect(result.text).toBe("const x = 1;\nconst y = 2;\n");
    expect(result.rawSha256).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(result.normalizedSha256).toBe(
      createHash("sha256").update(result.text).digest("hex"),
    );
  });

  it("rejects malformed UTF-8, NUL binary, and decoded blobs over 256 KiB", () => {
    for (const value of [
      new Uint8Array([0xff]),
      bytes("const x = '\\0';\0"),
      bytes("a".repeat(256 * 1024 + 1)),
    ]) expect(() => screenBlob({ path: "src/code.ts", bytes: value }, new Set())).toThrow();
  });

  it("rejects unsupported, generated, vendor, minified, lockfile, docs, and metadata paths", () => {
    for (const path of [
      "src/code.exe", "generated/code.ts", "vendor/code.ts", "node_modules/code.ts",
      "src/code.min.js", "package-lock.json", "docs/example.ts", ".github/workflow.yml",
    ]) expect(() => screenBlob({ path, bytes: bytes("const x = 1;") }, new Set())).toThrow();
    expect(() => screenBlob({
      path: "src/code.ts",
      bytes: bytes("// Code generated. DO NOT EDIT.\nconst x = 1;"),
    }, new Set())).toThrow("GENERATED_CONTENT");
  });

  it("rejects absolute, escaping, and backslash paths with one reason", () => {
    for (const path of [
      "../code.ts",
      "src/../code.ts",
      "/src/code.ts",
      "src\\code.ts",
      "C:\\src\\code.ts",
    ]) {
      expect(() => screenBlob({ path, bytes: bytes("const x = 1;") }, new Set()))
        .toThrow("INVALID_PATH");
    }
  });

  it("rejects deceptive controls, secret-like material, and suspicious personal data", () => {
    const cases = [
      ["const safe = 1;\u202E", "DECEPTIVE_CONTROL"],
      ["api_key = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890'", "SECRET_LIKE"],
      ["contact = 'person@example.com'", "PERSONAL_DATA"],
    ] as const;
    for (const [text, reason] of cases) {
      expect(() => screenBlob({ path: "src/code.ts", bytes: bytes(text) }, new Set()))
        .toThrow(reason);
    }
  });

  it("rejects duplicate normalized content and exposes only a reason code", () => {
    const normalizedHash = createHash("sha256").update("const x = 1;\n").digest("hex");
    try {
      screenBlob(
        { path: "src/code.ts", bytes: bytes("const x = 1;\r\n") },
        new Set([normalizedHash]),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(BlobScreenError);
      expect((error as Error).message).toBe("DUPLICATE_CONTENT");
    }
  });

  it("rejects minified content by bounded deterministic structure", () => {
    expect(() => screenBlob({
      path: "src/code.js",
      bytes: bytes(`const value="${"a".repeat(1_100)}";`),
    }, new Set())).toThrow("MINIFIED_CONTENT");
  });
});
