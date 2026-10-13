import { afterPreamble, fitWindow, isTopLevelDefinition } from "./code-windows";
import { firstCodeLine, type ExcerptLimits } from "./excerpt-window";
import type { StackLanguage } from "./profile";

/**
 * Code an algorithm round can show: the file past its imports with its commentary removed (comments, docstrings,
 * and a script's `main`), and every identifier that names the algorithm masked as `mystery` / `Mystery`.
 * Fetched code is only read, never run.
 */

const HASH_COMMENTS: ReadonlySet<StackLanguage> = new Set(["Python", "Ruby"]);
/** Stands in for removed commentary, so a line that held nothing else can be dropped whole. */
const REMOVED = "\u0000";
/** Removed commentary, marked on every line it spans, the empty lines of a docstring too. */
const removed = (value: string): string => value.split("\n").map((line) => REMOVED.repeat(Math.max(1, line.length))).join("\n");

/**
 * Python: drops `#` comments and docstrings: a string literal alone on its line that opens the file or follows a
 * header ending in `:`. A string alone on its line inside a call is an argument and stays.
 */
const stripPython = (text: string): string => {
  let output = "";
  let index = 0;
  let lineStart = true;
  const lastSignificant = (): string | undefined => output.replaceAll(REMOVED, "").trimEnd().at(-1);
  while (index < text.length) {
    const character = text[index]!;
    if (character === "\n") { output += character; index += 1; lineStart = true; continue; }
    if (lineStart && (character === " " || character === "\t")) { output += character; index += 1; continue; }
    if (character === "#") {
      const end = text.indexOf("\n", index);
      const stop = end < 0 ? text.length : end;
      output += removed(text.slice(index, stop));
      index = stop;
      continue;
    }
    const literal = /^([rRuUbBfF]{0,2})("""|'''|"|')/u.exec(text.slice(index, index + 5));
    if (literal) {
      const quote = literal[2]!;
      let end = index + literal[0].length;
      while (end < text.length && !text.startsWith(quote, end)) {
        if (text[end] === "\\") end += 1;
        else if (quote.length === 1 && text[end] === "\n") break;
        end += 1;
      }
      end = Math.min(text.length, end + quote.length);
      // A string that opens its own line and ends it is a docstring or a bare comment; code keeps every other string.
      const rest = text.slice(end, text.indexOf("\n", end) < 0 ? text.length : text.indexOf("\n", end));
      const previous = lastSignificant();
      if (lineStart && rest.trim().length === 0 && (previous === undefined || previous === ":")) {
        output += removed(text.slice(index, end));
      } else {
        output += text.slice(index, end);
      }
      index = end;
      lineStart = false;
      continue;
    }
    output += character;
    index += 1;
    lineStart = false;
  }
  return output;
};

/** Brace languages: drops line and block comments, keeping strings, characters, and Go's raw strings intact. */
const stripBraces = (text: string, language: StackLanguage): string => {
  let output = "";
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (text.startsWith("//", index)) {
      const end = text.indexOf("\n", index);
      const stop = end < 0 ? text.length : end;
      output += removed(text.slice(index, stop));
      index = stop;
      continue;
    }
    if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      const stop = end < 0 ? text.length : end + 2;
      output += removed(text.slice(index, stop));
      index = stop;
      continue;
    }
    if (character === "\"" || character === "'" || (character === "`" && language === "Go")) {
      let end = index + 1;
      while (end < text.length && text[end] !== character) {
        if (character !== "`" && text[end] === "\\") end += 1;
        if (character !== "`" && text[end] === "\n") break;
        end += 1;
      }
      output += text.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
};

/** The block a line opens, by brace depth: the line's index and the index after the closing brace's line. */
const braceBlockEnd = (lines: readonly string[], start: number): number => {
  let depth = 0;
  let opened = false;
  for (let index = start; index < lines.length; index += 1) {
    for (const character of lines[index]!) {
      if (character === "{") { depth += 1; opened = true; }
      if (character === "}") depth -= 1;
    }
    if (opened && depth <= 0) return index + 1;
  }
  return lines.length;
};

/** A script's entry point is about running the code, not the algorithm, and often prints its name. */
const withoutMain = (lines: readonly string[], language: StackLanguage): readonly string[] => {
  if (language === "Python") {
    const main = lines.findIndex((line) => /^if\s+__name__\s*==\s*["']__main__["']\s*:/u.test(line));
    return main < 0 ? lines : lines.slice(0, main);
  }
  const main = lines.findIndex((line) => (language === "Go" ? /^func\s+main\s*\(/u : /\bstatic\s+void\s+main\s*\(/u).test(line.trim()));
  return main < 0 ? lines : [...lines.slice(0, main), ...lines.slice(braceBlockEnd(lines, main))];
};

/**
 * The file with its commentary removed: a line that held only commentary goes, trailing spaces are trimmed, and
 * runs of blank lines collapse to one.
 */
export const withoutCommentary = (text: string, language: StackLanguage): string => {
  const normalized = text.replace(/\r\n?/gu, "\n").replaceAll(REMOVED, "");
  const stripped = HASH_COMMENTS.has(language) ? stripPython(normalized) : stripBraces(normalized, language);
  const kept = stripped.split("\n").filter((line) => !line.includes(REMOVED) || line.replaceAll(REMOVED, "").trim().length > 0)
    .map((line) => line.replaceAll(REMOVED, "").trimEnd());
  const lines = withoutMain(kept, language);
  return lines.filter((line, index) => line.length > 0 || (index > 0 && lines[index - 1]!.length > 0)).join("\n").trim();
};

const fold = (value: string): string => value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, "");
/** An identifier's words: `quick_sort` is quick, sort; `QuicksortRange` is Quicksort, Range; `HTTPServer` is HTTP, Server. */
const segments = (identifier: string): readonly Readonly<{ text: string; start: number; end: number }>[] =>
  [...identifier.matchAll(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/gu)].map((match) =>
    ({ text: match[0], start: match.index!, end: match.index! + match[0].length }));
const styled = (original: string): string =>
  /^[A-Z0-9]{2,}$/u.test(original) ? "MYSTERY" : /^[A-Z]/u.test(original) ? "Mystery" : "mystery";

/**
 * One identifier with each run of its words that spells a name replaced (longest first from the left), and then
 * each remaining word that starts with one of `prefixes` (`buckets` for the prefix `bucket`).
 */
const maskIdentifier = (identifier: string, names: ReadonlySet<string>, prefixes: readonly string[]): Readonly<{ text: string; named: boolean }> => {
  const words = segments(identifier);
  const pieces: string[] = [];
  let cursor = 0;
  let start = 0;
  let named = false;
  while (start < words.length) {
    let end = words.length - 1;
    while (end >= start && !names.has(words.slice(start, end + 1).map(({ text }) => fold(text)).join(""))) end -= 1;
    if (end >= start) {
      named = true;
      pieces.push(identifier.slice(cursor, words[start]!.start), styled(identifier.slice(words[start]!.start, words[end]!.end)));
      cursor = words[end]!.end;
      start = end + 1;
      continue;
    }
    // A label word masks only its own letters, so `coin` and `coins` stay distinct as `mystery` and `mysterys`.
    const word = words[start]!;
    const prefix = prefixes.find((candidate) => fold(word.text).startsWith(candidate));
    if (prefix !== undefined) {
      pieces.push(identifier.slice(cursor, word.start), styled(word.text.slice(0, prefix.length)));
      cursor = word.start + prefix.length;
    }
    start += 1;
  }
  pieces.push(identifier.slice(cursor));
  return Object.freeze({ text: pieces.join(""), named });
};

export interface MaskedCode {
  readonly text: string;
  /** The identifiers masked because they name the algorithm, in order of first appearance. */
  readonly masked: readonly string[];
}

/** What a round's code must not show: the algorithm's spellings, exact identifiers, and its label's own words. */
export interface MaskTerms {
  /** Spellings matched across an identifier's words: `quick_sort`, `QuicksortRange`, `QuickSort`. */
  readonly names: readonly string[];
  /** Identifiers masked whole, for a file whose names are too short to match by spelling (`Count`). */
  readonly symbols: readonly string[];
  /** The label's words, masked as word prefixes: `counting_arr` would answer "Counting sort" by its wording alone. */
  readonly words: readonly string[];
}

/** Masks every identifier that names the algorithm, and every word of its label, as `mystery` / `Mystery`. */
export const maskNames = (text: string, terms: MaskTerms): MaskedCode => {
  const folded = new Set(terms.names.map(fold).filter((name) => name.length > 0));
  const prefixes = terms.words.map(fold).filter((word) => word.length > 0);
  const exact = new Set(terms.symbols);
  const masked: string[] = [];
  const output = text.replace(/[A-Za-z_][A-Za-z0-9_]*/gu, (identifier) => {
    const result = exact.has(identifier) ? { text: styled(identifier), named: true } : maskIdentifier(identifier, folded, prefixes);
    if (result.named && !masked.includes(identifier)) masked.push(identifier);
    return result.text;
  });
  return Object.freeze({ text: output, masked: Object.freeze(masked) });
};

/** Words too common in labels to mask: every sort sorts and every search searches. */
const COMMON_LABEL_WORDS: ReadonlySet<string> = new Set(["sort", "search", "algorithm", "first", "with", "from", "by", "of"]);
/** A label's distinctive words, four letters or more: "Counting sort" gives `counting`. */
export const labelWords = (label: string): readonly string[] =>
  Object.freeze(label.toLocaleLowerCase("en-US").split(/[^a-z]+/u).filter((word) => word.length >= 4 && !COMMON_LABEL_WORDS.has(word)));

const MASK = /mystery/iu;
/** A window that starts at the masked definition but shows fewer lines than this starts at the first definition. */
const MINIMUM_FOCUSED_LINES = 8;

/** Whether a line defines a masked name: the name appears before the definition's parameters or body. */
const definesMask = (line: string): boolean => {
  const head = line.trim().split(/[({=:]/u)[0] ?? "";
  return MASK.test(head) && /^(?:@\w+\s+)*(?:(?:public|private|protected|internal|static|final|abstract|sealed|async|export|default)\s+)*(?:def|func|class|interface|record|enum|struct|type|fn)\b|^(?:public|private|protected|static|final)\b/u.test(line.trim());
};

/**
 * The window an algorithm round shows: the masked file past its preamble, from the definition of the masked
 * name, on whole lines within the limits. When that leaves too little code, it starts at the file's first
 * top-level definition instead. Undefined when the code never masks a name or no window shows one.
 */
export const algorithmWindow = (
  text: string,
  language: StackLanguage,
  terms: MaskTerms,
  limits: ExcerptLimits,
): Readonly<{ excerpt: string; functionName: string }> | undefined => {
  const masked = maskNames(withoutCommentary(text, language), terms);
  if (masked.masked.length === 0) return undefined;
  const lines = masked.text.split("\n");
  const first = firstCodeLine(lines, language);
  if (first === undefined) return undefined;
  const body = afterPreamble(lines, language, first);
  const focused = lines.findIndex((line, index) => index >= body && definesMask(line));
  const opening = lines.findIndex((line, index) => index >= body && isTopLevelDefinition(line, language));
  const windows = [focused, opening, body].filter((start, index, all) => start >= 0 && all.indexOf(start) === index)
    .map((start) => fitWindow(lines, start, limits)).filter((excerpt): excerpt is string => excerpt !== undefined && MASK.test(excerpt));
  const excerpt = windows.find((window, index) => index === windows.length - 1 || window.split("\n").length >= MINIMUM_FOCUSED_LINES);
  return excerpt === undefined ? undefined : Object.freeze({ excerpt, functionName: masked.masked[0]! });
};
