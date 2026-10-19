import { describe, expect, it } from "vitest";

import { growthFits, paneGrowth } from "../src/index";

describe("before-after pane sizes (#75)", () => {
  it("compares the later pane with the earlier one by characters, lines, and the longest changed line", () => {
    expect(paneGrowth("a = 1\nb = 2", "a = 1\nb = 22\nc = 3")).toEqual([1, 1, 1]);
    expect(paneGrowth("a = compute(1)\nb = a", "b = compute(1)")).toEqual([-1, -1, 0]);
    expect(paneGrowth("x = 1", "y = 2")).toEqual([0, 0, 0]);
  });

  it("fits a deck whose later pane is the bigger one in half the deck, give or take one", () => {
    const grows = [1, 1, 1] as const;
    const shrinks = [-1, -1, -1] as const;
    // Today's committed deck: bigger in 8 of 10.
    expect(growthFits([...Array(8).fill(grows), ...Array(2).fill(shrinks)], 10)).toBe(false);
    expect(growthFits([...Array(6).fill(grows), ...Array(4).fill(shrinks)], 10)).toBe(true);
    expect(growthFits([...Array(4).fill(grows), ...Array(6).fill(shrinks)], 10)).toBe(true);
    expect(growthFits([...Array(7).fill(grows), ...Array(3).fill(shrinks)], 10)).toBe(false);
    // A deck filling up: the bigger side is full at six of ten.
    expect(growthFits(Array(6).fill(grows), 10)).toBe(true);
    expect(growthFits(Array(7).fill(grows), 10)).toBe(false);
    // Balanced by characters, but by lines the later pane is longer in 8 of 10: picking it wins 80%.
    const longer = [1, 1, 0] as const;
    const shorterByCharacters = [-1, 1, 0] as const;
    expect(growthFits([...Array(5).fill(longer), ...Array(3).fill(shorterByCharacters), ...Array(2).fill([-1, -1, 0])], 10)).toBe(false);
  });
});
