import { MASKED_NAME } from "../../../packages/artifact/src/index";
import { markerQuote, shownMarkers, tellsFrameworkApart } from "./framework-markers";

/**
 * Code a framework round can show (#62): one window of a TodoMVC example's file with its commentary removed, every
 * framework's name masked as `mystery`, and no import, module header, or style block in view. The window chosen is the
 * one that shows the most of its framework's idioms while showing none of another framework of its family.
 * Fetched code is only read, never run.
 */

/** Stands in for removed commentary, so a line that held nothing else can be dropped whole. */
const REMOVED = "\u0000";
const removed = (value: string): string => value.split("\n").map((line) => REMOVED.repeat(Math.max(1, line.length))).join("\n");

/**
 * Drops HTML and Handlebars comments, style blocks, and script comments, keeping strings and template literals
 * intact. A quote in markup text (`Don't`) runs to its line's end, so at worst one line keeps a comment.
 */
const stripCommentary = (text: string): string => {
  const markup = text
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gu, removed)
    .replace(/<!--[\s\S]*?-->/gu, removed)
    .replace(/\{\{!--[\s\S]*?--\}\}|\{\{![^}]*\}\}/gu, removed);
  let output = "";
  let index = 0;
  while (index < markup.length) {
    const character = markup[index]!;
    if (markup.startsWith("//", index) && markup[index - 1] !== ":" && markup[index - 1] !== "\\") {
      const end = markup.indexOf("\n", index);
      const stop = end < 0 ? markup.length : end;
      output += removed(markup.slice(index, stop));
      index = stop;
      continue;
    }
    if (markup.startsWith("/*", index)) {
      const end = markup.indexOf("*/", index + 2);
      const stop = end < 0 ? markup.length : end + 2;
      output += removed(markup.slice(index, stop));
      index = stop;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      let end = index + 1;
      while (end < markup.length && markup[end] !== character) {
        if (markup[end] === "\\") end += 1;
        else if (character !== "`" && markup[end] === "\n") break;
        end += 1;
      }
      output += markup.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
};

/**
 * The file with its commentary removed: a line that held only commentary goes, trailing spaces are trimmed, and runs
 * of blank lines collapse to one.
 */
export const frameworkCode = (text: string): string => {
  const stripped = stripCommentary(text.replace(/\r\n?/gu, "\n").replaceAll(REMOVED, ""));
  const kept = stripped.split("\n").filter((line) => !line.includes(REMOVED) || line.replaceAll(REMOVED, "").trim().length > 0)
    .map((line) => line.replaceAll(REMOVED, "").trimEnd());
  return kept.filter((line, index) => line.length > 0 || (index > 0 && kept[index - 1]!.length > 0)).join("\n").trim();
};

const fold = (value: string): string => value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, "");
const segments = (identifier: string) =>
  [...identifier.matchAll(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/gu)].map((match) => ({ start: match.index!, end: match.index! + match[0].length, text: match[0] }));

/** What a framework round's code must not show: names matched by words, and identifiers matched whole. */
export interface FrameworkNames {
  /** Spellings matched across an identifier's words: `LitElement`, `todos-jquery`, `ReactDOM`. */
  readonly names: readonly string[];
  /** Identifiers masked only whole, being words code uses for other things too (`can`, but not `canToggle`). */
  readonly symbols: readonly string[];
}

/**
 * Masks every run of an identifier's words that spells a name, longest first from the left, and every identifier that
 * is a symbol, in strings and markup too: `LitElement` becomes `mysteryElement` and `'todos-jquery'` becomes
 * `'todos-mystery'`. The mask is lower case where an identifier starts, so its case never tells a capitalised name
 * (`Backbone`) from a lower-case one (`can`).
 */
export const maskFrameworkNames = (text: string, terms: FrameworkNames): string => {
  const folded = new Set(terms.names.map(fold).filter((name) => name.length > 0));
  const symbols = new Set(terms.symbols);
  return text.replace(/[A-Za-z_][A-Za-z0-9_]*/gu, (identifier) => {
    if (symbols.has(identifier)) return MASKED_NAME;
    const words = segments(identifier);
    let output = "";
    let cursor = 0;
    let start = 0;
    while (start < words.length) {
      let end = words.length - 1;
      while (end >= start && !folded.has(words.slice(start, end + 1).map(({ text: word }) => fold(word)).join(""))) end -= 1;
      if (end < start) { start += 1; continue; }
      const at = words[start]!.start;
      output += identifier.slice(cursor, at) + (at === 0 || /[^A-Za-z0-9]$/u.test(identifier.slice(0, at)) ? MASKED_NAME : "Mystery");
      cursor = words[end]!.end;
      start = end + 1;
    }
    return output + identifier.slice(cursor);
  });
};

/**
 * A page's credits, links, and script or style tags: who wrote an example or which file a page loads can name its
 * framework without any of its code (a framework's author signs its example).
 */
const OFF_LIMITS = /https?:\/\/|\bwritten\s+by\b|\bcreated\s+by\b|\bpart\s+of\b|<script\b[^>]*\bsrc=|<link\b|<meta\b|<title\b/iu;

/**
 * Lines no window may show: imports and requires, an AMD module's dependency header, Closure's `goog.provide` and
 * `goog.require`, and `'use strict'`, which name packages, not idioms; and any line `OFF_LIMITS` matches.
 */
const preambleLines = (lines: readonly string[]): ReadonlySet<number> => {
  const preamble = new Set<number>();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    // A style sheet in a tagged template literal is markup for the page, not the framework's code.
    const style = /\bcss`[^`]*$/u.exec(line);
    if (style) {
      let end = index + 1;
      while (end < lines.length && !lines[end]!.includes("`")) end += 1;
      for (let at = index + 1; at <= Math.min(end, lines.length - 1); at += 1) preamble.add(at);
      index = end + 1;
      continue;
    }
    const until = (closes: (text: string) => boolean): void => {
      let end = index;
      while (end < lines.length - 1 && !closes(lines[end]!)) end += 1;
      for (let at = index; at <= end; at += 1) preamble.add(at);
      index = end + 1;
    };
    if (/^\s*import\b(?!\s*\()/u.test(line)) {
      until((text) => /\bfrom\s*['"][^'"]+['"]\s*;?\s*$|^\s*import\s*['"][^'"]+['"]\s*;?\s*$/u.test(text));
      continue;
    }
    if (/^\s*define\(\s*(?:['"][^'"]*['"]\s*,\s*)?\[/u.test(line)) {
      until((text) => /\)\s*\{\s*$/u.test(text));
      continue;
    }
    if (/\brequire\(\s*['"]|^\s*goog\.(?:provide|require|module)\(|^\s*['"]use strict['"];?\s*$|^\s*export\s+\*\s+from\b/u.test(line)
      || OFF_LIMITS.test(line)) preamble.add(index);
    index += 1;
  }
  return preamble;
};

export interface FrameworkWindow {
  readonly excerpt: string;
  /** The window's first line in the file with its commentary removed, from one. */
  readonly windowStart: number;
  /** What each of its own framework's markers it shows matched, as a hint quotes it, most telling first. */
  readonly markers: readonly string[];
}

export interface FrameworkWindowLimits {
  readonly maxLines: number;
  readonly maxBytes: number;
  readonly minBytes: number;
}

/** A window shows at least this many lines that hold code. */
const MINIMUM_CODE_LINES = 6;
const indentOf = (line: string): number => /^\s*/u.exec(line)![0].length;
/** A line that only closes what an earlier line opened: `}`, `});`, `</div>`, `{/if}`. */
const CLOSING = /^\s*(?:[}\])]+[;,)]*|<\/[\w.-]+>|\{\/\w+\})\s*$/u;
/** A line no window starts on: one that closes something first, such as `]), m('input.edit', {`. */
const CONTINUES = /^\s*[}\])]/u;
/** A single-file component's top-level section tag, which no window crosses: `<script setup>`, `</template>`. */
const SECTION = /^<\/?(?:script|template|style)\b[^>]*>\s*$/u;

/**
 * The window a framework round shows from one file: up to `maxLines` lines that start on a line which closes nothing,
 * never climb out to a line indented less than their first, and cross no preamble line or component section. Among the
 * windows that tell `framework` apart from the rest of `family`, the one showing the most of its markers wins, the
 * earliest on a tie. The window loses its first line's indentation. Undefined when none tells it apart.
 */
export const frameworkWindow = (
  text: string,
  framework: string,
  family: readonly string[],
  terms: FrameworkNames,
  limits: FrameworkWindowLimits,
): FrameworkWindow | undefined => {
  const lines = maskFrameworkNames(frameworkCode(text), terms).split("\n");
  const preamble = preambleLines(lines);
  let best: FrameworkWindow | undefined;
  for (let start = 0; start < lines.length; start += 1) {
    const first = lines[start]!;
    if (preamble.has(start) || first.trim().length === 0 || CLOSING.test(first) || CONTINUES.test(first) || SECTION.test(first)) continue;
    const indent = indentOf(first);
    const taken: string[] = [];
    for (let at = start; at < lines.length && taken.length < limits.maxLines; at += 1) {
      const line = lines[at]!;
      if (preamble.has(at) || SECTION.test(line) || (line.trim().length > 0 && indentOf(line) < indent)) break;
      taken.push(line);
    }
    while (taken.length > 0 && taken.at(-1)!.trim().length === 0) taken.pop();
    if (taken.filter((line) => line.trim().length > 0 && !CLOSING.test(line)).length < MINIMUM_CODE_LINES) continue;
    const excerpt = taken.map((line) => line.slice(Math.min(indent, indentOf(line)))).join("\n");
    const bytes = Buffer.byteLength(excerpt);
    if (bytes < limits.minBytes || bytes > limits.maxBytes || !tellsFrameworkApart(excerpt, framework, family)) continue;
    const markers = [...new Set(shownMarkers(excerpt, framework).map((marker) => markerQuote(excerpt, marker)))];
    if (best === undefined || markers.length > best.markers.length) {
      best = Object.freeze({ excerpt, windowStart: start + 1, markers: Object.freeze(markers) });
    }
  }
  return best;
};
