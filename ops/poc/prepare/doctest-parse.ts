import { outputShape } from "../../../packages/artifact/src/index";
import { withoutCommentary } from "./function-windows";

/**
 * Static reading of Python doctests: the examples a function's docstring shows and the outputs it records.
 * Nothing here runs code; the answer is the output as the author wrote it, which the repository's CI checks.
 */

/** One example: a single call of the function itself, with literal arguments, and its one-line output. */
export interface DoctestExample {
  readonly call: string;
  readonly output: string;
}

/** A function a round can ask about: its code without docstring or comments, and its usable examples. */
export interface DoctestFunction {
  readonly name: string;
  /** The standard-library import lines the body needs, a blank line, then the function; or the function alone. */
  readonly code: string;
  readonly examples: readonly DoctestExample[];
}

const KEYWORDS: ReadonlySet<string> = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
  "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or",
  "pass", "raise", "return", "try", "while", "with", "yield", "match", "case", "_",
]);
const BUILTINS: ReadonlySet<string> = new Set([
  "abs", "all", "any", "bin", "bool", "bytes", "callable", "chr", "dict", "divmod", "enumerate", "filter", "float",
  "format", "frozenset", "hash", "hex", "int", "isinstance", "issubclass", "iter", "len", "list", "map", "max", "min",
  "next", "oct", "ord", "pow", "range", "repr", "reversed", "round", "set", "slice", "sorted", "str", "sum", "tuple",
  "type", "zip", "ValueError", "TypeError", "IndexError", "KeyError", "ZeroDivisionError", "ArithmeticError",
  "Exception", "NotImplementedError", "object",
]);
/** Names an annotation may use from `typing`; the shown code keeps the annotation without the import. */
const TYPING_NAMES: ReadonlySet<string> = new Set(["Any", "Optional", "Union", "List", "Dict", "Tuple", "Iterable", "Sequence", "Callable"]);
/** Standard-library modules a round's code may import. */
const STANDARD_MODULES: ReadonlySet<string> = new Set([
  "math", "itertools", "functools", "collections", "string", "re", "heapq", "bisect", "operator", "statistics",
  "fractions", "decimal", "typing", "cmath",
]);
/** Calls a round's code may not make: they print, read input, or reach outside the function. */
const EFFECTS = /\b(?:print|input|open|exec|eval|compile|__import__|globals|locals|vars|setattr|delattr)\s*\(/u;
const STATEFUL = /\b(?:yield|global|nonlocal|async|await)\b/u;
const DIRECTIVE = /#\s*doctest:/u;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/gu;
const STRING = /(?:[rRbBuU]{0,2})(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/gu;
/** Outputs a player can be asked to predict: one line, short, and a float only to four decimal places. */
const MAXIMUM_OUTPUT_LENGTH = 40;
const ASKABLE_SHAPES: ReadonlySet<string> = new Set(["int", "float", "str", "list", "tuple", "mapping"]);

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** The docstring right after a `def` line's signature, as its lines. */
const docstringAfter = (lines: readonly string[], signatureEnd: number): readonly string[] | undefined => {
  let index = signatureEnd + 1;
  while (index < lines.length && lines[index]!.trim().length === 0) index += 1;
  const opening = /^\s*[rRuU]?("""|''')/u.exec(lines[index] ?? "");
  if (!opening) return undefined;
  const quote = opening[1]!;
  const first = lines[index]!.slice(lines[index]!.indexOf(quote) + 3);
  if (first.includes(quote)) return [first.slice(0, first.indexOf(quote))];
  const text = [first];
  for (let at = index + 1; at < lines.length; at += 1) {
    const line = lines[at]!;
    if (line.includes(quote)) return [...text, line.slice(0, line.indexOf(quote))];
    text.push(line);
  }
  return undefined;
};

/** Arguments made only of literals: numbers, strings, brackets, operators, and True, False, None. */
const literalArguments = (call: string, name: string): boolean => {
  if (!call.startsWith(`${name}(`) || !call.endsWith(")")) return false;
  const inner = call.slice(name.length + 1, -1).replace(STRING, "0");
  if (/[;=]|\blambda\b|:=/u.test(inner)) return false;
  return (inner.match(IDENTIFIER) ?? []).every((identifier) => ["True", "False", "None"].includes(identifier)
    || /^[0-9_]+[eEjJ]?$/u.test(identifier) || /^0[xXoObB][0-9a-fA-F_]+$/u.test(identifier) || /^e[0-9]+$/u.test(identifier));
};

const askable = (output: string): boolean => output.length <= MAXIMUM_OUTPUT_LENGTH && ASKABLE_SHAPES.has(outputShape(output))
  && !(outputShape(output) === "float" && /\.\d{5,}/u.test(output));

/** The examples a docstring shows: single-line calls of `name` with one-line outputs, no directives or tracebacks. */
export const doctestExamples = (docstring: readonly string[], name: string): readonly DoctestExample[] => {
  const examples: DoctestExample[] = [];
  for (let index = 0; index < docstring.length; index += 1) {
    const line = docstring[index]!.trim();
    if (!line.startsWith(">>> ")) continue;
    const call = line.slice(4).trim();
    const output = docstring[index + 1]?.trim() ?? "";
    const after = docstring[index + 2]?.trim() ?? "";
    if (output.length === 0 || output.startsWith(">>>") || output.startsWith("...")) continue;
    // Exactly one output line: a second line that is neither blank nor a new example would make it multi-line.
    if (after.length > 0 && !after.startsWith(">>>")) continue;
    if (DIRECTIVE.test(call) || output.includes("...") || output.includes("<BLANKLINE>") || output.startsWith("Traceback")) continue;
    if (!literalArguments(call, name) || !askable(output)) continue;
    examples.push(Object.freeze({ call, output }));
  }
  return Object.freeze(examples);
};

/**
 * Four examples a round can offer: distinct outputs of one shape, the first of each output in docstring order,
 * from the shape with the most distinct outputs. Undefined when no shape has four.
 */
export const roundExamples = (examples: readonly DoctestExample[]): readonly DoctestExample[] | undefined => {
  const byShape = new Map<string, DoctestExample[]>();
  for (const example of examples) {
    const group = byShape.get(outputShape(example.output)) ?? [];
    if (!group.some(({ output }) => output === example.output)) group.push(example);
    byShape.set(outputShape(example.output), group);
  }
  const best = [...byShape.values()].sort((left, right) => right.length - left.length)[0];
  return best !== undefined && best.length >= 4 ? Object.freeze(best.slice(0, 4)) : undefined;
};

/** Names a body uses but never binds: parameters, assignments, loop, `as` and lambda targets, and nested definitions are bound. */
export const freeNames = (code: string, name: string): ReadonlySet<string> => {
  const text = code.replace(STRING, "\"\"");
  const bound = new Set<string>([name]);
  const signature = /def\s+\w+(?:\[[^\]]*\])?\(([^)]*)\)/u.exec(text)?.[1] ?? "";
  for (const parameter of signature.split(",")) {
    const match = /^\s*\**([A-Za-z_][A-Za-z0-9_]*)/u.exec(parameter);
    if (match) bound.add(match[1]!);
  }
  for (const match of text.matchAll(/(?:^|[\s,(])([A-Za-z_][A-Za-z0-9_]*)\s*(?:[-+*/%&|^]|\/\/|\*\*|<<|>>)?=(?!=)/gmu)) bound.add(match[1]!);
  for (const match of text.matchAll(/\b(?:for|as)\s+([A-Za-z_][A-Za-z0-9_,\s()]*?)\s+(?:in\b|:|$)/gmu)) {
    for (const target of match[1]!.match(IDENTIFIER) ?? []) bound.add(target);
  }
  for (const match of text.matchAll(/\blambda\s+([^:]*):/gu)) for (const target of match[1]!.match(IDENTIFIER) ?? []) bound.add(target);
  for (const match of text.matchAll(/\b(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/gu)) bound.add(match[1]!);
  const free = new Set<string>();
  for (const match of text.matchAll(/(?<![.\w])([A-Za-z_][A-Za-z0-9_]*)/gu)) {
    const identifier = match[1]!;
    if (!bound.has(identifier) && !KEYWORDS.has(identifier) && !BUILTINS.has(identifier)) free.add(identifier);
  }
  return free;
};

/** The file's standard-library imports: each name they bind, and the import line that binds it. */
const standardImports = (lines: readonly string[]): ReadonlyMap<string, string> => {
  const imported = new Map<string, string>();
  for (const line of lines) {
    const plain = /^import\s+([a-z][\w.]*)(?:\s+as\s+(\w+))?\s*$/u.exec(line);
    if (plain && STANDARD_MODULES.has(plain[1]!.split(".")[0]!)) imported.set(plain[2] ?? plain[1]!.split(".")[0]!, line.trim());
    const from = /^from\s+([a-z][\w.]*)\s+import\s+([\w\s,]+)$/u.exec(line);
    if (from && STANDARD_MODULES.has(from[1]!.split(".")[0]!)) {
      for (const part of from[2]!.split(",")) imported.set(part.trim().split(/\s+as\s+/u).at(-1)!, line.trim());
    }
  }
  return imported;
};

/** Where a signature that opens on `start` ends: the first line after which its brackets are balanced and that ends in `:`. */
const signatureEnd = (lines: readonly string[], start: number): number | undefined => {
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    for (const character of lines[index]!.replace(STRING, "\"\"")) {
      if ("([{".includes(character)) depth += 1;
      if (")]}".includes(character)) depth -= 1;
    }
    if (depth === 0 && /:\s*$/u.test(lines[index]!)) return index;
  }
  return undefined;
};

/**
 * The lines of the top-level function `name` in a file: its signature, then its body up to the last indented line,
 * without the blank line a removed docstring leaves.
 */
const definitionOf = (lines: readonly string[], name: string): readonly string[] | undefined => {
  const header = new RegExp(`^def ${name}\\s*[[(]`, "u");
  const starts = lines.flatMap((line, index) => header.test(line) ? [index] : []);
  if (starts.length !== 1) return undefined;
  const signature = signatureEnd(lines, starts[0]!);
  if (signature === undefined) return undefined;
  let body = signature + 1;
  while (body < lines.length && lines[body]!.trim().length === 0) body += 1;
  let end = body;
  while (end < lines.length && (lines[end]!.trim().length === 0 || indentOf(lines[end]!) > 0)) end += 1;
  while (end > body && lines[end - 1]!.trim().length === 0) end -= 1;
  return end > body ? [...lines.slice(starts[0]!, signature + 1), ...lines.slice(body, end)] : undefined;
};

/**
 * Every top-level function of a file that a round could ask about: its examples, and its code with docstring and
 * comments removed, within `maxLines` lines. A function is left out when it is decorated, prints, reads input,
 * keeps state, or needs anything beyond itself, the builtins, and the standard-library imports the file makes.
 */
export const doctestFunctions = (source: string, limits: Readonly<{ maxLines: number }>): readonly DoctestFunction[] => {
  const original = source.replace(/\r\n?/gu, "\n").split("\n");
  const stripped = withoutCommentary(source, "Python").split("\n");
  const imported = standardImports(original);
  const functions: DoctestFunction[] = [];
  original.forEach((line, index) => {
    const header = /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*[[(]/u.exec(line);
    if (!header) return;
    const name = header[1]!;
    // A decorator can change what a call returns, and the round would not show it.
    const previous = original.slice(0, index).reverse().find((before) => before.trim().length > 0);
    if (previous?.startsWith("@")) return;
    const end = signatureEnd(original.map((text) => text.replace(/\s+#.*$/u, "")), index);
    const docstring = end === undefined ? undefined : docstringAfter(original, end);
    if (!docstring) return;
    const examples = doctestExamples(docstring, name);
    const definition = definitionOf(stripped, name);
    if (examples.length === 0 || !definition) return;
    const text = definition.join("\n");
    if (EFFECTS.test(text) || STATEFUL.test(text)) return;
    const free = [...freeNames(text, name)];
    if (free.some((identifier) => !imported.has(identifier) && !TYPING_NAMES.has(identifier))) return;
    const needed = [...new Set(free.filter((identifier) => !TYPING_NAMES.has(identifier)).map((identifier) => imported.get(identifier)!))].sort();
    const code = needed.length > 0 ? [...needed, "", ...definition] : definition;
    // The pane adds a blank line and the `>>>` call.
    if (code.length + 2 > limits.maxLines) return;
    functions.push(Object.freeze({ name, code: code.join("\n"), examples }));
  });
  return Object.freeze(functions);
};
