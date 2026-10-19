import { changesOnlyProse, codeSkeleton, patchOnlyComments } from "./code-skeleton";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

describe("code skeletons (#75)", () => {
  it("drops comments and docstrings and empties strings, by the file's syntax", () => {
    expect(codeSkeleton("def f():\n    \"\"\"Doc\n    more doc.\n    \"\"\"\n    return 'x'  # note\n", "a.py")).toEqual(["def f():", "return \"\""]);
    expect(codeSkeleton("/* one\n * two */\nconst a = `multi\nline ${b}`; // tail\n", "a.ts")).toEqual(["const a =", "\"\";"]);
    expect(codeSkeleton("-- note\nSELECT 'x' FROM t;", "q.sql")).toEqual(["SELECT \"\" FROM t;"]);
  });

  it("reads a change to comments, a docstring, or string text alone as prose, and a change to code as code", () => {
    // The three rounds #75 found: a Go comment rewrite, a Python docstring tree, and a prompt string.
    expect(changesOnlyProse("// Runs the workflow.\nfunc main() {}\n", "// Starts the workflow.\nfunc main() {}\n", "main.go")).toBe(true);
    expect(changesOnlyProse("\"\"\"Integrations.\n  provider_04/\n\"\"\"\nimport os\n", "\"\"\"Integrations.\n  provider_06/\n\"\"\"\nimport os\n", "__init__.py")).toBe(true);
    expect(changesOnlyProse("const prompt = `Send a digest\nevery day`;\n", "const prompt = `Send a digest\nevery week`;\n", "CASE.ts")).toBe(true);
    expect(changesOnlyProse("x = total(items)\n", "x = sum(items)\n", "a.py")).toBe(false);
    expect(changesOnlyProse("x = 1\n", "x = 1\ny = 2\n", "a.py")).toBe(false);
    // A lifetime is no string: Rust code around it still counts.
    expect(changesOnlyProse("fn f<'a>(x: &'a str) {}\n", "fn f<'a>(x: &'a str) -> usize { 0 }\n", "a.rs")).toBe(false);
  });

  it("reads a patch whose every changed line is a comment as comments alone", () => {
    expect(patchOnlyComments("@@ -2 +2 @@\n-  // one\n+  // two", "a.ts")).toBe(true);
    expect(patchOnlyComments("@@ -2,2 +2,2 @@\n- * one\n+ * two\n context", "a.java")).toBe(true);
    expect(patchOnlyComments("@@ -2 +2 @@\n-# one\n+# two", "a.py")).toBe(true);
    expect(patchOnlyComments("@@ -2 +2 @@\n-  // one\n+  return 2;", "a.ts")).toBe(false);
    expect(patchOnlyComments("@@ -2 +2 @@\n-#include <a.h>\n+#include <b.h>", "a.c")).toBe(false);
  });
});
