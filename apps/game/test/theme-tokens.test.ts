import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { FACTORS } from "../src/experiment/arms";

const CSS = readFileSync(fileURLToPath(new URL("../src/app/globals.css", import.meta.url)), "utf8");
const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/giu;
/** A token block: the Terminal theme on `:root`, or another theme's override on `:root:has([data-theme="…"])`. */
const TOKEN_BLOCK = /^(:root|:root:has\(\[data-theme="([a-z-]+)"\]\))\s*\{([^}]*)\}/gmu;

/** Each theme's tokens, by theme name; Terminal is `:root`. */
const themes = (): ReadonlyMap<string, ReadonlyMap<string, string>> => {
  const blocks = new Map<string, Map<string, string>>();
  for (const [, , name, body] of CSS.matchAll(TOKEN_BLOCK)) {
    const tokens = new Map([...body!.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gu)].map(([, token, value]) => [token!, value!.trim()]));
    if (tokens.size > 0) blocks.set(name ?? "terminal", tokens);
  }
  return blocks;
};

/** The stylesheet with its token blocks and comments removed: the rules that must read tokens. */
const rules = (): string => CSS.replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/^(?::root|:root:has\(\[data-theme="[a-z-]+"\]\))\s*\{[^}]*?--[a-z0-9-]+\s*:[^}]*\}/gmu, "");

/** WCAG relative luminance contrast between two opaque colours, `#rgb`, `#rrggbb`, `#rrggbbaa` (alpha over the second), or `rgba()`. */
const parse = (value: string): readonly number[] => {
  const hex = /^#([0-9a-f]{3,8})$/iu.exec(value);
  if (hex) {
    const digits = hex[1]!.length <= 4 ? [...hex[1]!].map((digit) => digit + digit).join("") : hex[1]!;
    return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)).concat(digits.length === 8 ? [parseInt(digits.slice(6), 16) / 255] : [1]);
  }
  const parts = /^rgba?\(([^)]+)\)$/u.exec(value)![1]!.split(",").map(Number.parseFloat);
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
};
const over = (top: readonly number[], under: readonly number[]): readonly number[] => top.slice(0, 3).map((channel, at) => channel * top[3]! + under[at]! * (1 - top[3]!));
const luminance = (colour: readonly number[]): number => {
  const [red, green, blue] = colour.map((channel) => { const unit = channel / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
};
const contrast = (tokens: ReadonlyMap<string, string>, foreground: string, background: string): number => {
  const back = over(parse(tokens.get(background)!), parse(tokens.get("bg")!));
  const [lighter, darker] = [luminance(over(parse(tokens.get(foreground)!), back)), luminance(back)].sort((left, right) => right - left);
  return (lighter! + 0.05) / (darker! + 0.05);
};

/** Text the game draws, on the backgrounds it draws it on. */
const TEXT_PAIRS = [
  ["text", "bg"], ["text", "surface"], ["text-soft", "surface"], ["text-soft", "panel"], ["text-soft", "panel-card"], ["text-soft", "chip"],
  ["muted", "surface"], ["muted", "panel"], ["muted", "bg"], ["muted-light", "bg"], ["subtle", "surface"],
  ["accent", "bg"], ["accent", "surface"], ["accent", "panel"], ["accent", "chip"], ["accent", "surface-hover"], ["accent", "track-done-bg"],
  ["on-accent", "accent"], ["code-text", "code-bg"], ["faint", "code-bg"], ["code-text", "highlight-bg"], ["code-text", "win-bg"], ["code-text", "warn-bg"],
  // A marked line's number is drawn in muted on the line's fill.
  ["muted", "highlight-bg"], ["muted", "win-bg"], ["muted", "warn-bg"],
  ["win", "surface"], ["win", "panel"], ["warn", "surface"], ["warn", "panel"], ["error-text", "surface"], ["error-text", "panel"],
  ["notice-text", "notice-bg"], ["deck-notice-text", "deck-notice-bg"], ["track-text", "track-bg"],
  ["text", "player-bg"], ["text", "surface-hover"], ["text", "win-bg"], ["text", "miss-bg"],
  // A missed round's dot, and a missed pick in the game's summary (#43).
  ["miss", "miss-bg"], ["miss", "surface"],
] as const;

describe("theme tokens (#125)", () => {
  it("defines the Terminal theme on :root and one block per other theme the experiment can draw", () => {
    expect(themes().get("terminal")?.size).toBeGreaterThan(40);
    expect([...themes().keys()].sort()).toEqual([...FACTORS.theme].sort());
  });

  it("keeps every colour in a token block, so a theme can change it", () => {
    expect(rules().match(COLOUR) ?? []).toEqual([]);
  });

  it("reads only tokens the Terminal theme defines", () => {
    const defined = themes().get("terminal")!;
    const used = new Set([...rules().matchAll(/var\(--([a-z0-9-]+)\)/gu)].map(([, name]) => name!));
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
    expect([...defined.keys()].filter((name) => !used.has(name))).toEqual([]);
  });

  it("has every other theme define every token, so none inherits a colour picked for another", () => {
    const defined = [...themes().get("terminal")!.keys()].sort();
    for (const [name, tokens] of themes()) expect([...tokens.keys()].sort(), name).toEqual(defined);
  });

  it("gives every text at least 4.5:1 contrast on its background, in every theme", () => {
    for (const [name, tokens] of themes()) {
      const failing = TEXT_PAIRS.filter(([foreground, background]) => contrast(tokens, foreground, background) < 4.5);
      expect(failing, name).toEqual([]);
    }
  });

  it("gives the focus ring 3:1 against the page, and the new themes' option borders 3:1 against their cards", () => {
    for (const [name, tokens] of themes()) {
      expect(contrast(tokens, "focus", "bg"), name).toBeGreaterThanOrEqual(3);
      expect(contrast(tokens, "focus", "surface"), name).toBeGreaterThanOrEqual(3);
      // Terminal keeps its original 2:1 border, which the option's label and radio already mark.
      if (name !== "terminal") expect(contrast(tokens, "border-strong", "surface"), name).toBeGreaterThanOrEqual(3);
    }
  });
});
