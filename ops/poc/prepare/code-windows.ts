import { firstCodeLine, type ExcerptLimits } from "./excerpt-window";
import type { StackLanguage } from "./profile";

/**
 * Lines that announce a language before any code is read: package clauses, imports, `use`, `require`.
 * A language round that showed them would be solved without reading the code, so windows skip them.
 */
const C_PREAMBLE = /^(?:#\s*(?:include|import)\b|#\s*pragma\s+once\b|#\s*(?:ifndef|define)\s+\w*_H(?:PP)?_?\w*$)/u;
const PREAMBLE: Readonly<Record<StackLanguage, RegExp>> = Object.freeze({
  Python: /^(?:import\s|from\s+\S+\s+import\b|__all__\s*=|# -\*-|#\s*(?:type|mypy|pylint|noqa|fmt)\b)/u,
  Ruby: /^(?:require(?:_relative)?\b|load\s|# frozen_string_literal:|# (?:encoding|coding):)/u,
  TypeScript: /^(?:import\b|export\s+(?:\*|\{[^}]*\})\s+from\b|export\s+type\s+\{|["']use (?:strict|client|server)["'];?$|\/\/\/\s*<reference\b|\/\/\s*@ts-)/u,
  JavaScript: /^(?:import\b|export\s+(?:\*|\{[^}]*\})\s+from\b|["']use (?:strict|client|server)["'];?$|(?:const|let|var)\s+[\w${},\s]+=\s*require\([^)]*\)[\w.]*;?$|\/\/\s*@flow\b|\/\*\s*@flow\b)/u,
  Go: /^(?:package\s|import\b|\/\/go:build\b|\/\/\s*\+build\b)/u,
  Rust: /^(?:use\s|pub\s+use\s|extern\s+crate\b|mod\s+\w+;|pub\s+mod\s+\w+;|#!\[)/u,
  Java: /^(?:package\s|import\s)/u,
  // File-scoped namespaces end in a semicolon; a namespace block stays, since its braces hold the code.
  "C#": /^(?:using\s+(?:static\s+)?[\w.]+\s*;|using\s+\w+\s*=\s*[\w.<>]+\s*;|global\s+using\b|namespace\s+[\w.]+\s*;|#\s*(?:nullable|pragma|region|endregion)\b)/u,
  Kotlin: /^(?:package\s|import\s|@file:)/u,
  Swift: /^(?:import\s|@testable\s+import\s|@_exported\s+import\s)/u,
  C: C_PREAMBLE,
  "C++": new RegExp(`${C_PREAMBLE.source}|^using\\s+namespace\\s+[\\w:]+\\s*;`, "u"),
});
/** A statement that opens a bracketed block continues until the bracket closes. */
const OPENERS: Readonly<Record<string, string>> = Object.freeze({ "(": ")", "{": "}" });

/** Lines that start a definition, where a reader can see the shape of the code. */
const C_DEFINITION = /^(?:typedef\s|(?:struct|enum|union)\s+\w+\s*\{|(?:(?:static|inline|extern|const|unsigned|signed|struct|enum)\s+)*[A-Za-z_]\w*[\s*]+\**[A-Za-z_]\w*\s*\([^;]*$)/u;
const DEFINITION: Readonly<Record<StackLanguage, RegExp>> = Object.freeze({
  Python: /^(?:@\w|(?:async\s+)?def\s|class\s)/u,
  Ruby: /^(?:def\s|class\s|module\s)/u,
  TypeScript: /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\b|class\s|interface\s|enum\s|type\s+\w+(?:<[^>]*>)?\s*=|const\s+\w+\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>)/u,
  JavaScript: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\b|class\s|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|\w+\s*=>)|module\.exports\b)/u,
  Go: /^(?:func\s|type\s+\w+\s+(?:struct|interface)\b)/u,
  Rust: /^(?:#\[|(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:fn\s|impl\b|struct\s|enum\s|trait\s))/u,
  Java: /^(?:@[A-Z]\w*|(?:(?:public|protected|private|abstract|final|static|sealed|non-sealed|strictfp)\s+)*(?:class|interface|enum|record|@interface)\s)/u,
  "C#": /^(?:\[[A-Z]|(?:(?:public|internal|protected|private|abstract|sealed|static|partial|readonly|unsafe)\s+)*(?:class|interface|struct|enum|record)\s)/u,
  Kotlin: /^(?:@[A-Z]\w*|(?:(?:public|private|internal|protected|open|abstract|sealed|data|enum|inline|value|annotation|suspend|override|inner)\s+)*(?:fun\s|class\s|interface\s|object\s|typealias\s))/u,
  Swift: /^(?:@\w|(?:(?:public|private|fileprivate|internal|open|final|static)\s+)*(?:func\s|class\s|struct\s|enum\s|protocol\s|extension\s|actor\s))/u,
  C: C_DEFINITION,
  "C++": new RegExp(`${C_DEFINITION.source}|^(?:template\\s*<|class\\s|namespace\\s|[\\w:<>*&\\s]+\\s\\w+::~?\\w+\\s*\\()`, "u"),
});
/** Languages whose types often sit one level inside a namespace block; a definition there may be indented once. */
const NESTED_DEFINITIONS: ReadonlySet<StackLanguage> = new Set(["C#"]);
const DEFINITION_LOOKAHEAD = 60;

const isComment = (line: string, language: StackLanguage): boolean =>
  language === "Python" || language === "Ruby" ? line.startsWith("#") : line.startsWith("//") || line.startsWith("*") || line.startsWith("/*");
const atTopLevel = (line: string, language: StackLanguage): boolean =>
  line.trimStart() === line || (NESTED_DEFINITIONS.has(language) && /^(?: {4}|\t)\S/u.test(line));

/** Index of the first line after the preamble: package clauses, imports, and the blank lines between them. */
export const afterPreamble = (lines: readonly string[], language: StackLanguage, start: number): number => {
  let index = start;
  while (index < lines.length) {
    const line = lines[index]!.trim();
    if (line.length === 0 || isComment(line, language)) { index += 1; continue; }
    if (!PREAMBLE[language].test(line)) return index;
    // A bracketed import group (`import (`, `use a::{`, `from a import (`) runs until its bracket closes.
    const opener = [...line].reverse().find((character) => character in OPENERS || character === ")" || character === "}");
    if (opener !== undefined && opener in OPENERS) {
      const closer = OPENERS[opener]!;
      const end = lines.findIndex((candidate, at) => at > index && candidate.includes(closer));
      if (end < 0) return lines.length;
      index = end + 1;
    } else {
      index += 1;
    }
  }
  return index;
};

const fitWindow = (lines: readonly string[], start: number, limits: ExcerptLimits): string | undefined => {
  const window: string[] = [];
  let bytes = 0;
  for (const line of lines.slice(start, start + limits.maxLines)) {
    const added = Buffer.byteLength(line) + (window.length > 0 ? 1 : 0);
    if (bytes + added > limits.maxBytes) break;
    window.push(line);
    bytes += added;
  }
  while (window.length > 0 && window.at(-1)!.trim().length === 0) window.pop();
  const excerpt = window.join("\n");
  return Buffer.byteLength(excerpt) < limits.minBytes || excerpt.trim().length === 0 ? undefined : excerpt;
};

/**
 * A window of real code: past any licence header and the import preamble, starting at the first
 * definition within reach (or the first statement when none is near), on whole lines within the limits.
 */
export const codeWindow = (text: string, language: StackLanguage, limits: ExcerptLimits): string | undefined => {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const first = firstCodeLine(lines, language);
  if (first === undefined) return undefined;
  const body = afterPreamble(lines, language, first);
  if (body >= lines.length) return undefined;
  const definition = lines.slice(body, body + DEFINITION_LOOKAHEAD)
    .findIndex((line) => DEFINITION[language].test(line.trim()) && atTopLevel(line, language));
  return fitWindow(lines, definition >= 0 ? body + definition : body, limits);
};

export interface ChangeWindowLimits {
  readonly maxLines: number;
  readonly maxBytes: number;
  /** The most lines either side of the change may differ by. */
  readonly maxChangedLines: number;
  /** Unchanged lines kept around the change on each side. */
  readonly contextLines: number;
}

export interface ChangeWindows {
  readonly before: string;
  readonly after: string;
  /** Lines only in the earlier and only in the later window. */
  readonly removed: number;
  readonly added: number;
}

const significant = (lines: readonly string[]): string => lines.join("\n").replace(/\s+/gu, "");

/**
 * The same stretch of a file before and after one commit: the single block between the longest common
 * prefix and suffix, with matching context. A commit that changed distant places, only whitespace, or
 * more than the limits allow has no window.
 */
export const changeWindows = (beforeText: string, afterText: string, limits: ChangeWindowLimits): ChangeWindows | undefined => {
  const before = beforeText.replace(/\r\n?/gu, "\n").split("\n");
  const after = afterText.replace(/\r\n?/gu, "\n").split("\n");
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  const removed = before.slice(prefix, before.length - suffix);
  const added = after.slice(prefix, after.length - suffix);
  if (removed.length + added.length === 0 || significant(removed) === significant(added)) return undefined;
  if (removed.length > limits.maxChangedLines || added.length > limits.maxChangedLines) return undefined;
  const from = Math.max(0, prefix - limits.contextLines);
  const window = (lines: readonly string[]): string | undefined => {
    const slice = lines.slice(from, Math.min(lines.length, lines.length - suffix + limits.contextLines));
    while (slice.length > 0 && slice[0]!.trim().length === 0) slice.shift();
    while (slice.length > 0 && slice.at(-1)!.trim().length === 0) slice.pop();
    const text = slice.join("\n");
    return slice.length === 0 || slice.length > limits.maxLines || Buffer.byteLength(text) > limits.maxBytes ? undefined : text;
  };
  const beforeWindow = window(before);
  const afterWindow = window(after);
  if (beforeWindow === undefined || afterWindow === undefined || beforeWindow === afterWindow) return undefined;
  return Object.freeze({ before: beforeWindow, after: afterWindow, removed: removed.length, added: added.length });
};
