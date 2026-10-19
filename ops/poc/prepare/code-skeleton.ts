/**
 * A file's code with its prose taken out, so two versions can be compared for a change to the code itself (#75):
 * comments and docstrings dropped, string literals emptied, blank lines left out. Comment syntax follows the file's
 * extension; a file of another kind is read as C-like.
 */

interface Syntax {
  readonly line: readonly string[];
  readonly blocks: readonly (readonly [string, string])[];
  /** Quotes that open a string; a single-line string that does not close on its line is read as code. */
  readonly quotes: readonly string[];
  /** Delimiters of strings that may span lines, such as `"""` and backticks. */
  readonly multiline: readonly string[];
}

const C_LIKE: Syntax = { line: ["//"], blocks: [["/*", "*/"]], quotes: ["\"", "'"], multiline: [] };
const SYNTAX: Readonly<Record<string, Syntax>> = Object.freeze({
  py: { line: ["#"], blocks: [], quotes: ["\"", "'"], multiline: ["\"\"\"", "'''"] },
  rb: { line: ["#"], blocks: [["=begin", "=end"]], quotes: ["\"", "'"], multiline: [] },
  sh: { line: ["#"], blocks: [], quotes: ["\"", "'"], multiline: [] },
  pl: { line: ["#"], blocks: [], quotes: ["\"", "'"], multiline: [] },
  ex: { line: ["#"], blocks: [], quotes: ["\""], multiline: ["\"\"\""] },
  exs: { line: ["#"], blocks: [], quotes: ["\""], multiline: ["\"\"\""] },
  cr: { line: ["#"], blocks: [], quotes: ["\""], multiline: [] },
  jl: { line: ["#"], blocks: [["#=", "=#"]], quotes: ["\""], multiline: ["\"\"\""] },
  js: { ...C_LIKE, multiline: ["`"] },
  jsx: { ...C_LIKE, multiline: ["`"] },
  ts: { ...C_LIKE, multiline: ["`"] },
  tsx: { ...C_LIKE, multiline: ["`"] },
  gjs: { ...C_LIKE, multiline: ["`"] },
  gts: { ...C_LIKE, multiline: ["`"] },
  vue: { ...C_LIKE, blocks: [["/*", "*/"], ["<!--", "-->"]], multiline: ["`"] },
  svelte: { ...C_LIKE, blocks: [["/*", "*/"], ["<!--", "-->"]], multiline: ["`"] },
  html: { line: [], blocks: [["<!--", "-->"]], quotes: ["\"", "'"], multiline: [] },
  go: { ...C_LIKE, multiline: ["`"] },
  kt: { ...C_LIKE, multiline: ["\"\"\""] },
  scala: { ...C_LIKE, multiline: ["\"\"\""] },
  swift: { ...C_LIKE, multiline: ["\"\"\""] },
  java: { ...C_LIKE, multiline: ["\"\"\""] },
  cs: { ...C_LIKE, multiline: ["\"\"\""] },
  php: { line: ["//", "#"], blocks: [["/*", "*/"]], quotes: ["\"", "'"], multiline: [] },
  rs: { line: ["//"], blocks: [["/*", "*/"]], quotes: ["\""], multiline: [] },
  sql: { line: ["--"], blocks: [["/*", "*/"]], quotes: ["'", "\""], multiline: [] },
  hs: { line: ["--"], blocks: [["{-", "-}"]], quotes: ["\""], multiline: [] },
  elm: { line: ["--"], blocks: [["{-", "-}"]], quotes: ["\""], multiline: ["\"\"\""] },
  adb: { line: ["--"], blocks: [], quotes: ["\""], multiline: [] },
  ml: { line: [], blocks: [["(*", "*)"]], quotes: ["\""], multiline: [] },
  fs: { line: ["//"], blocks: [["(*", "*)"]], quotes: ["\""], multiline: ["\"\"\""] },
  erl: { line: ["%"], blocks: [], quotes: ["\""], multiline: [] },
  pro: { line: ["%"], blocks: [["/*", "*/"]], quotes: ["\""], multiline: [] },
  m: { line: ["%", "//"], blocks: [["/*", "*/"]], quotes: ["\""], multiline: [] },
  clj: { line: [";"], blocks: [], quotes: ["\""], multiline: [] },
  cljc: { line: [";"], blocks: [], quotes: ["\""], multiline: [] },
  rkt: { line: [";"], blocks: [["#|", "|#"]], quotes: ["\""], multiline: [] },
  pas: { line: ["//"], blocks: [["{", "}"], ["(*", "*)"]], quotes: ["'"], multiline: [] },
  pp: { line: ["//"], blocks: [["{", "}"], ["(*", "*)"]], quotes: ["'"], multiline: [] },
});

const syntaxOf = (path: string): Syntax => SYNTAX[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? C_LIKE;
const startsAt = (line: string, at: number, token: string): boolean => line.startsWith(token, at);

/** The file's code lines with comments and docstrings dropped and every string literal emptied, blank lines left out. */
export const codeSkeleton = (text: string, path: string): readonly string[] => {
  const syntax = syntaxOf(path);
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const skeleton: string[] = [];
  // What a line began inside: a block comment's closing token, or a multi-line string's delimiter.
  let open: Readonly<{ close: string; comment: boolean }> | undefined;
  for (const line of lines) {
    let code = "";
    let at = 0;
    while (at < line.length) {
      if (open) {
        const end = line.indexOf(open.close, at);
        if (end === -1) { at = line.length; break; }
        if (!open.comment) code += "\"\"";
        at = end + open.close.length;
        open = undefined;
        continue;
      }
      const block = syntax.blocks.find(([start]) => startsAt(line, at, start));
      if (block) { open = { close: block[1], comment: true }; at += block[0].length; continue; }
      if (syntax.line.some((marker) => startsAt(line, at, marker))) break;
      const long = syntax.multiline.find((delimiter) => startsAt(line, at, delimiter));
      if (long) { open = { close: long, comment: false }; at += long.length; continue; }
      const quote = syntax.quotes.find((mark) => line[at] === mark);
      if (quote) {
        let end = at + 1;
        while (end < line.length && line[end] !== quote) end += line[end] === "\\" ? 2 : 1;
        if (end < line.length) { code += "\"\""; at = end + 1; continue; }
      }
      code += line[at];
      at += 1;
    }
    // A docstring is a string on a line of its own; with its text emptied, only its quotes would be left.
    const kept = code.trim();
    if (kept.length > 0 && kept !== "\"\"") skeleton.push(kept);
  }
  return Object.freeze(skeleton);
};

/** Whether a change between two versions of a file touches only prose: comments, docstrings, or string text. */
export const changesOnlyProse = (before: string, after: string, path: string): boolean => {
  const [left, right] = [codeSkeleton(before, path), codeSkeleton(after, path)];
  return left.length === right.length && left.every((line, index) => line === right[index]);
};

/**
 * Whether every line a patch adds or removes, blank ones aside, is a line comment or a block comment's line, read
 * from the patch alone: a cheap first look before the file's versions are read. Docstrings and strings need the
 * whole file, so `changesOnlyProse` decides those.
 */
export const patchOnlyComments = (patch: string, path: string): boolean => {
  const syntax = syntaxOf(path);
  const changed = patch.split("\n").filter((line) => /^[-+](?![-+]{2} )/u.test(line)).map((line) => line.slice(1).trim())
    .filter((line) => line.length > 0);
  const comment = (line: string): boolean => syntax.line.some((marker) => line.startsWith(marker))
    || syntax.blocks.some(([start, end]) => line.startsWith(start) || line.endsWith(end))
    || (syntax.blocks.some(([start]) => start === "/*") && line.startsWith("*"));
  return changed.length > 0 && changed.every(comment);
};
