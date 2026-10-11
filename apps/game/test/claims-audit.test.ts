import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Literal = Readonly<{ file: string; text: string }>;
type ClaimPattern = Readonly<{ id: string; expression: RegExp }>;

const ROOT = resolve(process.cwd());
const SOURCE_ROOTS = ["apps/game/app", "apps/game/src", "packages/domain/src", "packages/measurement/src", "packages/artifact/src", "docs/operations"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".md", ".mdx"]);
const EXCLUDED = /(?:^|\/)(?:docs\/gangsta|test|tests|support|fixtures|node_modules|\.next|coverage|reports|artifacts)(?:\/|$)/;
const PERMITTED_RECORDED_SOURCE_PHRASES = new Set([
  "project owned human sample",
  "recorded model output",
  "recorded stack overflow publication",
  "created for this project",
  "which recorded source produced this code",
]);

const CLAIM_PATTERNS: readonly ClaimPattern[] = Object.freeze([
  { id: "ai-detection", expression: /\b(?:detect(?:s|ed|ing|ion)?|classif(?:y|ies|ied|ication)|identif(?:y|ies|ied|ication))\b.{0,48}\b(?:ai|human|model)(?: generated| written| output)?\b/ },
  { id: "ai-detector", expression: /\b(?:ai|human|model)(?: generated| written| output)?\b.{0,48}\b(?:detector|detection|classifier|classification)\b/ },
  { id: "authorship", expression: /\b(?:ai generated|human written|written by (?:a |an )?(?:ai|human|model)|authored by (?:a |an )?(?:ai|human|model)|created by (?:a |an )?(?:ai|human|model))\b/ },
  { id: "identity", expression: /\b(?:original authorship|human (?:identity|author)|ai (?:identity|author)|human (?:versus|vs) ai identity)\b/ },
  { id: "quality", expression: /\b(?:ai|human|model)(?: generated| written| output)? code\b.{0,40}\b(?:better|worse|cleaner|superior|inferior|higher quality|lower quality)\b/ },
  { id: "quality-reverse", expression: /\b(?:better|worse|cleaner|superior|inferior|higher quality|lower quality)\b.{0,40}\b(?:ai|human|model)(?: generated| written| output)? code\b/ },
  { id: "quality-evaluation", expression: /\b(?:this (?:game|mode|experiment)|codeguessr|the (?:game|mode|report|results?))\b.{0,56}\b(?:evaluates?|measures?|assesses?|determines?|proves?)\b.{0,32}\bcode quality\b/ },
  { id: "equal-ability", expression: /\b(?:equal|same|comparable|equivalent) (?:cross mode |across modes )?(?:ability|skill|difficulty)\b/ },
  { id: "causality", expression: /\b(?:this (?:mode|game|experiment)|codeguessr|the results?|playing)\b.{0,56}\b(?:causes?|proves?|leads? to|results? in)\b/ },
  { id: "statistical-causality", expression: /\b(?:statistical causality|causal (?:effect|impact|relationship|inference)|establishes? causality)\b/ },
  { id: "guaranteed-recall", expression: /\b(?:guarantees?|always|permanently)\b.{0,48}\b(?:recall|remove|removal|delete|deletion)\b.{0,48}\b(?:displayed|shown|public)\b/ },
  { id: "acquisition", expression: /\b(?:customer acquisition|user acquisition|acquisition)\b.{0,48}\b(?:will|proves?|validated|rate|cost|growth)\b/ },
  { id: "monetization", expression: /\b(?:monetization|revenue|paid conversion)\b.{0,48}\b(?:will|proves?|validated|rate|growth)\b/ },
  { id: "market-size", expression: /\b(?:market size|tam|sam|som)\b.{0,48}\b(?:is|equals|proves?|validated)\b/ },
  { id: "public-retention", expression: /\b(?:public|user|player|beta) retention\b.{0,48}\b(?:will|is|proves?|validated|rate|improves?)\b/ },
]);

const normalize = (value: string): string => value
  .normalize("NFKC")
  .toLocaleLowerCase("en-US")
  .replace(/[\p{Cf}\p{P}\p{Z}\s]+/gu, " ")
  .trim();

const walk = (directory: string): string[] => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).sort().flatMap((name) => {
    const path = join(directory, name);
    const projectPath = relative(ROOT, path).replaceAll("\\", "/");
    if (EXCLUDED.test(projectPath)) return [];
    return statSync(path).isDirectory() ? walk(path) : SOURCE_EXTENSIONS.has(extname(path)) ? [path] : [];
  });
};

const typescriptLiterals = (file: string, source: string): Literal[] => {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const values: Literal[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
      values.push({ file, text: node.text });
    } else if (ts.isTemplateExpression(node)) {
      values.push({ file, text: [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ") });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return values;
};

const markdownLiterals = (file: string, source: string): Literal[] => {
  let fenced = false;
  const prose: string[] = [];
  for (const line of source.split(/\r?\n/u)) {
    if (/^\s*```/u.test(line)) { fenced = !fenced; continue; }
    if (!fenced) prose.push(line);
  }
  return [{ file, text: prose.join("\n") }];
};

const extract = (file: string, source: string): Literal[] => file.endsWith(".ts") || file.endsWith(".tsx")
  ? typescriptLiterals(file, source)
  : markdownLiterals(file, source);

const violations = (literals: readonly Literal[]) => literals.flatMap(({ file, text }) => {
  const normalized = normalize(text);
  if (PERMITTED_RECORDED_SOURCE_PHRASES.has(normalized)) return [];
  return CLAIM_PATTERNS
    .filter(({ expression }) => expression.test(normalized))
    .map(({ id }) => ({ file, literal: text, pattern: id }));
});

const projectFiles = (): string[] => {
  const files = SOURCE_ROOTS.flatMap((path) => walk(resolve(ROOT, path)));
  for (const readme of ["README.md", "README.mdx"]) if (existsSync(resolve(ROOT, readme))) files.push(resolve(ROOT, readme));
  return [...new Set(files)].sort();
};

describe("product claims audit", () => {
  it("extracts communication literals through the TypeScript AST and ignores comments and identifiers", () => {
    const source = `// "AI detection proves authorship"\nconst aiDetectorProvesAuthorship = true;\nconst safe = "Recorded model output";\nconst bad = \`This detects AI-generated code\`;\nconst view = <p>Human-written code is better</p>;`;
    const literals = typescriptLiterals("synthetic.tsx", source);
    expect(literals.map(({ text }) => text)).toEqual(["Recorded model output", "This detects AI-generated code", "Human-written code is better"]);
    expect(violations(literals).map(({ pattern }) => pattern)).toEqual(["ai-detection", "authorship", "authorship", "quality"]);
  });

  it("audits Markdown prose outside fenced examples", () => {
    const literals = markdownLiterals("synthetic.md", "Recorded model output.\n```ts\nAI-generated code is better\n```\nCodeGuessr causes retention.");
    expect(violations(literals)).toEqual([{ file: "synthetic.md", literal: "Recorded model output.\nCodeGuessr causes retention.", pattern: "causality" }]);
  });

  it.each([
    ["Our classifier identifies human-written code", "ai-detection"],
    ["An AI detector decides the source", "ai-detector"],
    ["This was written by a human", "authorship"],
    ["We determine original authorship", "identity"],
    ["Human-written code is cleaner", "authorship"],
    ["Human-written code is cleaner", "quality"],
    ["This game evaluates code quality", "quality-evaluation"],
    ["Both modes have equal ability", "equal-ability"],
    ["Playing CodeGuessr causes better recall", "causality"],
    ["The report establishes statistical causality", "statistical-causality"],
    ["The report proves a causal effect", "statistical-causality"],
    ["We guarantee removal of displayed code", "guaranteed-recall"],
    ["User acquisition growth is validated", "acquisition"],
    ["Monetization growth is validated", "monetization"],
    ["Market size is validated", "market-size"],
    ["Beta retention rate is validated", "public-retention"],
  ])("rejects contextual claim %s", (text, pattern) => {
    expect(violations([{ file: "synthetic.ts", text }])).toContainEqual({ file: "synthetic.ts", literal: text, pattern });
  });

  it("permits exact recorded-source framing and entertainment-only, chance-aware mode copy", () => {
    expect(violations([
      { file: "a.ts", text: "Project-owned human sample" },
      { file: "b.ts", text: "Recorded model output" },
      { file: "c.ts", text: "Recorded Stack Overflow publication" },
      { file: "d.ts", text: "Which recorded source produced this code?" },
      { file: "e.ts", text: "For entertainment only. Two candidates means a one-in-two chance baseline." },
    ])).toEqual([]);
  });

  it("recursively audits a non-vacuous, project-controlled product source set", () => {
    const files = projectFiles();
    const projectPaths = files.map((file) => relative(ROOT, file).replaceAll("\\", "/"));
    expect(files.length).toBeGreaterThan(0);
    expect(projectPaths).toContain("apps/game/src/app/page.tsx");
    expect(projectPaths).toContain("apps/game/src/components/arcade/arcade-shell.tsx");
    expect(projectPaths).toContain("packages/artifact/src/artifact.ts");
    expect(projectPaths).toContain("packages/domain/src/provenance/index.ts");
    expect(projectPaths).toContain("packages/measurement/src/events/index.ts");
    expect(projectPaths.every((path) => !EXCLUDED.test(path) && !path.startsWith("docs/gangsta/"))).toBe(true);
    const literals = files.flatMap((file) => extract(relative(ROOT, file).replaceAll("\\", "/"), readFileSync(file, "utf8")));
    expect(literals.length).toBeGreaterThan(0);
    const found = violations(literals);
    expect(found, found.map(({ file, literal, pattern }) => `${file}: ${pattern}: ${JSON.stringify(literal)}`).join("\n")).toEqual([]);
  });
});
