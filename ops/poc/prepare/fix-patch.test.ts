import { bugsInPyRevisions, defects4jRevisions, FixRecordError, oneLineFix } from "./fix-patch";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const patch = (lines: readonly string[], path = "src/Calc.java"): string =>
  [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`, ...lines, ""].join("\n");
const id = (character: string) => character.repeat(40);

describe("bug dataset records", () => {
  it("reads the one line a patch changes, in the dataset's own direction", () => {
    const text = patch(["@@ -10,3 +10,3 @@", "     context", "-    return total + 2;", "+    return total + 3;", "     context"]);
    // Defects4J patches turn the fixed version into the buggy one; BugsInPy's run forward.
    expect(oneLineFix(text, "reverse")).toEqual({ path: "src/Calc.java", buggyLine: "    return total + 3;", fixedLine: "    return total + 2;" });
    expect(oneLineFix(text, "forward")).toEqual({ path: "src/Calc.java", buggyLine: "    return total + 2;", fixedLine: "    return total + 3;" });
    expect(oneLineFix(text.replaceAll("\n", "\r\n"), "forward")?.fixedLine).toBe("    return total + 3;");
  });

  it("rejects a patch that changes more than one line, a test, only whitespace, or two files", () => {
    for (const text of [
      patch(["@@ -10,3 +10,4 @@", "-    a = 1;", "+    a = 2;", "+    b = 3;"]),
      patch(["@@ -10,3 +10,3 @@", "-    a = 1;", "+    a = 2;", "@@ -20,3 +20,3 @@", " x"]),
      patch(["@@ -10,3 +10,3 @@", "-    a = 1;", "+    a = 2;"], "tests/test_calc.py"),
      patch(["@@ -10,3 +10,3 @@", "-    a = 1;", "+    a = 2;"], "src/test/java/CalcTest.java"),
      patch(["@@ -10,3 +10,3 @@", "-    a = 1;", "+        a = 1;"]),
      patch(["@@ -10,3 +10,3 @@", "-    a = 1;", "+"]),
      `${patch(["@@ -10,3 +10,3 @@", "-    a = 1;", "+    a = 2;"])}${patch(["@@ -1 +1 @@", " x"], "src/Other.java")}`,
      patch(["@@ -10,3 +10,3 @@", "-    a = 1;", "+    a = 2;"]).replace("--- a/src/Calc.java", "--- a/src/Old.java"),
    ]) {
      expect(oneLineFix(text, "forward")).toBeUndefined();
    }
  });

  it("reads Defects4J's bug table and BugsInPy's bug record, failing closed on anything malformed", () => {
    const header = "bug.id,revision.id.buggy,revision.id.fixed,report.id,report.url";
    const table = defects4jRevisions(`${header}\n1,${id("a")},${id("b")},LANG-1,https://example.org/1\n7,${id("c")},${id("d")},LANG-7,https://example.org/7\n`);
    expect(table.get("7")).toEqual({ buggy: id("c"), fixed: id("d") });
    for (const csv of [`bug.id,revision.id.fixed\n1,${id("a")}`, `${header}\n1,${id("a")},main,X,Y`, `${header}\n1,${id("a")},${id("b")},X,Y\n1,${id("c")},${id("d")},X,Y`]) {
      expect(() => defects4jRevisions(csv)).toThrow(FixRecordError);
    }
    // BugsInPy sometimes abbreviates the buggy commit; a round shows the fix's own parent, so only the fix must be whole.
    expect(bugsInPyRevisions(`python_version="3.8.3" \nbuggy_commit_id="fc100fe" \nfixed_commit_id="${id("e")}"  \ntest_file="t.py"\n`))
      .toEqual({ buggy: "fc100fe", fixed: id("e") });
    for (const info of [`buggy_commit_id="${id("a")}"\n`, `buggy_commit_id="${id("a")}"\nfixed_commit_id="main"\n`,
      `buggy_commit_id="${id("a")}"\nfixed_commit_id="${id("b")}"\nfixed_commit_id="${id("c")}"\n`, `buggy_commit_id=${id("a")}\nfixed_commit_id="${id("b")}"\n`]) {
      expect(() => bugsInPyRevisions(info)).toThrow(FixRecordError);
    }
  });
});
