import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(fileURLToPath(new URL("../src/app/globals.css", import.meta.url)), "utf8");
const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/giu;

/** The token blocks: the first `:root` (the Terminal theme) and any `[data-theme="…"]` override. */
const tokenBlocks = (): ReadonlyMap<string, ReadonlyMap<string, string>> => {
  const blocks = new Map<string, Map<string, string>>();
  for (const [, selector, body] of CSS.matchAll(/^(:root|\[data-theme="[a-z-]+"\])\s*\{([^}]*)\}/gmu)) {
    const tokens = new Map([...body!.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gu)].map(([, name, value]) => [name!, value!.trim()]));
    if (tokens.size > 0) blocks.set(selector!, tokens);
  }
  return blocks;
};

/** The stylesheet with its token blocks and comments removed: the rules that must read tokens. */
const rules = (): string => CSS.replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/^(?::root|\[data-theme="[a-z-]+"\])\s*\{[^}]*?--[a-z0-9-]+\s*:[^}]*\}/gmu, "");

describe("theme tokens (#125)", () => {
  it("defines the Terminal theme on :root", () => {
    expect(tokenBlocks().get(":root")?.size).toBeGreaterThan(40);
  });

  it("keeps every colour in a token block, so a theme can change it", () => {
    expect(rules().match(COLOUR) ?? []).toEqual([]);
  });

  it("reads only tokens the Terminal theme defines", () => {
    const defined = tokenBlocks().get(":root")!;
    const used = new Set([...rules().matchAll(/var\(--([a-z0-9-]+)\)/gu)].map(([, name]) => name!));
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
    expect([...defined.keys()].filter((name) => !used.has(name))).toEqual([]);
  });

  it("has every other theme override only tokens that exist", () => {
    const blocks = tokenBlocks();
    const defined = blocks.get(":root")!;
    for (const [selector, tokens] of blocks) {
      if (selector === ":root") continue;
      expect([...tokens.keys()].filter((name) => !defined.has(name)), selector).toEqual([]);
    }
  });
});
