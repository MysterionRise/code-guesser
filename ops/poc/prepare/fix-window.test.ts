import { changeKind, fixWindows, optionLine } from "./fix-window";
import { commentaryLines } from "./function-windows";
import { fixRanks } from "./model";
import { syntheticFixes } from "./testdata/deck-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

describe("fix windows", () => {
  it("names the kind of change without saying where it is", () => {
    expect(changeKind("if (x <= 1) {", "if (x < 1) {")).toBe("OPERATOR");
    expect(changeKind("total = step * 2;", "total = step * 3;")).toBe("LITERAL");
    expect(changeKind("        prompt, default=False", "        prompt, default=True")).toBe("LITERAL");
    expect(changeKind("continue;", "break;")).toBe("NAME");
    expect(changeKind("return anyResultsMatch(n);", "return allResultsMatch(n);")).toBe("NAME");
    expect(changeKind("docs = _pipe(pipe, docs, kwargs)", "docs = _pipe(docs, pipe, kwargs)")).toBe("STRUCTURE");
    expect(changeKind("result = result.unstack(val)", "result = result.unstack(val, fill_value=fill_value)")).toBe("STRUCTURE");
  });

  it("offers only lines with some substance", () => {
    for (const line of ["        return total;", "    for (int i = 0; i < n; i++) {", "        result.append(x)"]) expect(optionLine(line)).toBe(true);
    for (const line of ["", "    }", "    } else {", "    // total = step;", "    # note", "import java.util.List;", "    @Override", "    break;"]) {
      expect(optionLine(line)).toBe(false);
    }
  });

  it("holds the changed line in every window and can place it at every rank", () => {
    for (const fix of syntheticFixes()) {
      const windows = fixWindows(fix.text, fix.changedLine, `${fix.dataset}:${fix.bug}`, 14, fix.language);
      expect(windows.length).toBeGreaterThan(0);
      for (const window of windows) {
        const pane = window.excerpt.split("\n");
        expect(pane).toHaveLength(14);
        expect(pane[0]!.trim()).not.toBe("");
        expect(pane.at(-1)!.trim()).not.toBe("");
        expect(pane[window.answer - 1]).toBe(fix.buggyLine);
        expect(window.windowStart + window.answer - 1).toBe(fix.changedLine);
        expect(window.decoys).toHaveLength(3);
        for (const line of window.decoys) {
          expect(optionLine(pane[line - 1]!)).toBe(true);
          expect(Math.abs(pane[line - 1]!.trim().length - fix.buggyLine.trim().length)).toBeLessThanOrEqual(Math.max(fix.buggyLine.trim().length / 2, 8));
        }
        expect(window.ranks).toEqual(fixRanks(window.answer, [window.answer, ...window.decoys], pane));
      }
      expect(new Set(windows.map(({ ranks }) => ranks[0])).size).toBe(4);
    }
    expect(fixWindows("a\nb\nc", 2, "seed", 14, "Python")).toEqual([]);
  });

  it("never offers a line of a comment, block comment, or docstring, read over the whole file", () => {
    const python = [
      "def build(context_file, default_context):", '    """Generate the context for a project.', "",
      "    :param context_file: JSON file holding the project's variables.", "    :param default_context: Dictionary of defaults to use.",
      "    result = merge_values(context_file, default_context)", '    """', "    context = OrderedDict([])",
      "    with open(context_file) as file_handle:", "        obj = json.load(file_handle, object_pairs_hook=OrderedDict)",
      "    full_path = os.path.abspath(context_file)", "    context[file_stem] = obj", "    total_count = len(context) + 1",
      "    if default_context is not None:", "        apply_overwrites_to_context(obj, default_context)", "    return context",
    ].join("\n");
    // The docstring's own lines, its code-like one too, are never options; every window still offers four code lines.
    const docstring = commentaryLines(python, "Python");
    expect([...docstring]).toEqual([1, 2, 3, 4, 5, 6]);
    const windows = fixWindows(python, 13, "seed", 14, "Python");
    expect(windows.length).toBeGreaterThan(0);
    for (const window of windows) {
      for (const line of window.decoys) expect(docstring.has(window.windowStart + line - 2)).toBe(false);
    }
    // Without the whole file, the line that looks like code would have been offered.
    expect(optionLine(python.split("\n")[5]!)).toBe(true);
    const java = "class A {\n  /* a block comment\n     total = total + step * 2;\n  */\n  int total = step * 3;\n}";
    expect([...commentaryLines(java, "Java")]).toEqual([1, 2, 3]);
  });
});
