import { describe, expect, it } from "vitest";

import { COMPOSER_BLOCKS, ComposerRejected, composerInputSchema, parseComposerSpec } from "../src/genui/composer-spec";

const limits = { paneLineCounts: [12, 8] };
const valid = () => ({
  root: "panel",
  elements: [
    { id: "panel", type: "Stack", props: { gap: "medium" }, children: ["verdict", "pair", "quiz"] },
    { id: "verdict", type: "Callout", props: { tone: "tip", title: "Verdict", text: "Indentation decides it." }, children: [] },
    { id: "pair", type: "Row", props: {}, children: ["code", "card"] },
    { id: "code", type: "CodeExcerpt", props: { pane: 2, from: 2, to: 6, highlights: [{ line: 3, kind: "helpful", note: "A def line." }] }, children: [] },
    { id: "card", type: "Card", props: { title: "Signals" }, children: ["list", "meter"] },
    { id: "list", type: "List", props: { ordered: false, items: ["def", "colons"] }, children: [] },
    { id: "meter", type: "Meter", props: { label: "How strongly def points to Python", value: 90 }, children: [] },
    { id: "quiz", type: "Quiz", props: { question: "What decided it?", choices: [
      { label: "def", correct: true, feedback: "Yes." }, { label: "braces", correct: false, feedback: "There are none." },
    ] }, children: [] },
  ],
});
const rejects = (mutate: (spec: any) => void, code: RegExp) => {
  const spec = valid() as any;
  mutate(spec);
  let caught: unknown;
  try { parseComposerSpec(spec, limits); } catch (error) { caught = error; }
  expect(caught, JSON.stringify(spec).slice(0, 120)).toBeInstanceOf(ComposerRejected);
  expect((caught as ComposerRejected).code).toMatch(code);
};
const at = (spec: any, id: string) => spec.elements.find((item: any) => item.id === id);

describe("composer specs (#114)", () => {
  it("turns a plain tree of known blocks into a frozen json-render spec", () => {
    const spec = parseComposerSpec(valid(), limits);
    expect(spec.root).toBe("panel");
    expect(Object.keys(spec.elements)).toHaveLength(8);
    expect(spec.elements.code).toEqual({ type: "CodeExcerpt", props: { pane: 2, from: 2, to: 6, highlights: [{ line: 3, kind: "helpful", note: "A def line." }] }, children: [] });
    expect(Object.isFrozen(spec.elements.code!.props)).toBe(true);
  });

  it("refuses anything beyond plain layout: unknown blocks, extra keys, state, actions, and expressions", () => {
    rejects((spec) => { at(spec, "list").type = "Script"; }, /^SCHEMA/u);
    rejects((spec) => { at(spec, "list").visible = { $state: "/shown" }; }, /^SCHEMA/u);
    rejects((spec) => { at(spec, "list").on = { press: { action: "setState" } }; }, /^SCHEMA/u);
    rejects((spec) => { spec.state = { shown: true }; }, /^SCHEMA/u);
    rejects((spec) => { at(spec, "verdict").props.text = { $state: "/answer" }; }, /^SCHEMA/u);
    rejects((spec) => { at(spec, "verdict").props.html = "<b>bold</b>"; }, /^SCHEMA/u);
    rejects((spec) => { at(spec, "list").children = ["verdict"]; }, /^SCHEMA/u);
  });

  it("refuses unsafe or oversized text", () => {
    rejects((spec) => { at(spec, "verdict").props.text = "Claim it at https://example.test"; }, /^SCHEMA/u);
    rejects((spec) => { at(spec, "verdict").props.text = "<script>alert(1)</script>"; }, /^SCHEMA/u);
    rejects((spec) => { at(spec, "verdict").props.text = "x".repeat(301); }, /^SCHEMA/u);
    rejects((spec) => { at(spec, "verdict").props.title = "   "; }, /^SCHEMA/u);
  });

  it("refuses anything that is not one tree hanging from the root", () => {
    rejects((spec) => { spec.root = "nowhere"; }, /^ROOT_MISSING$/u);
    rejects((spec) => { at(spec, "card").children.push("ghost"); }, /^CHILD_MISSING$/u);
    rejects((spec) => { at(spec, "card").children.push("verdict"); }, /^NOT_A_TREE$/u);
    rejects((spec) => { at(spec, "card").children.push("panel"); }, /^NOT_A_TREE$/u);
    rejects((spec) => { spec.elements.push({ id: "verdict", type: "Divider", props: {}, children: [] }); }, /^DUPLICATE_ID$/u);
    rejects((spec) => { spec.elements.push({ id: "stray", type: "Divider", props: {}, children: [] }); }, /^ORPHAN$/u);
    rejects((spec) => {
      const chain = Array.from({ length: 7 }, (_, index) => ({ id: `level-${index}`, type: "Stack", props: { gap: "small" }, children: index < 6 ? [`level-${index + 1}`] : [] }));
      spec.elements.push(...chain);
      at(spec, "panel").children.push("level-0");
    }, /^TOO_DEEP$/u);
    rejects((spec) => {
      spec.elements.push(...Array.from({ length: 40 }, (_, index) => ({ id: `extra-${index}`, type: "Divider", props: {}, children: [] })));
    }, /^SCHEMA elements$/u);
  });

  it("keeps code excerpts, tables, and quizzes within the round", () => {
    rejects((spec) => { at(spec, "code").props.to = 9; }, /^EXCERPT_RANGE$/u);
    rejects((spec) => { at(spec, "code").props.from = 7; }, /^EXCERPT_RANGE$/u);
    rejects((spec) => { at(spec, "code").props.pane = 1; at(spec, "code").props.to = 13; }, /^EXCERPT_RANGE$/u);
    rejects((spec) => { at(spec, "code").props.highlights[0].line = 7; }, /^EXCERPT_HIGHLIGHT$/u);
    expect(() => parseComposerSpec(valid(), { paneLineCounts: [12] })).toThrow(/EXCERPT_PANE/u);
    rejects((spec) => {
      spec.elements.push({ id: "table", type: "Table", props: { caption: "Options", columns: ["Option", "For"], rows: [["Python", "def", "extra"]] }, children: [] });
      at(spec, "card").children.push("table");
    }, /^TABLE_SHAPE$/u);
    rejects((spec) => { at(spec, "quiz").props.choices[1].correct = true; }, /^QUIZ_ANSWER$/u);
    rejects((spec) => { at(spec, "quiz").props.choices[0].correct = false; }, /^QUIZ_ANSWER$/u);
  });

  it("offers the model a closed schema for every block", () => {
    const schema = composerInputSchema() as any;
    const variants = schema.properties.elements.items.oneOf as any[];
    expect(variants.map((variant) => variant.properties.type.const).sort()).toEqual(Object.keys(COMPOSER_BLOCKS).sort());
    expect(variants.every((variant) => variant.additionalProperties === false && variant.properties.props.additionalProperties === false)).toBe(true);
    expect(schema.properties.elements.maxItems).toBe(40);
  });
});
