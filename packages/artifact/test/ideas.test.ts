import { describe, expect, it } from "vitest";

import { ideaWords, sameFile, sameIdea } from "../src/index";

describe("rounds that repeat an idea (#84)", () => {
  it("ties two names when every word of the shorter, of two or more, is a word of the other", () => {
    expect([...ideaWords("get_1s_count")]).toEqual(["1s", "count"]);
    expect([...ideaWords("binaryCountSetbits")]).toEqual(["binary", "count", "setbits"]);
    for (const version of ["local-real-rounds.v6", "local-real-rounds.v7"] as const) {
      const same = (left: string, right: string) => sameIdea(left, right, version);
      expect(same("count_vowels", "count_vowels_and_consonants")).toBe(true);
      expect(same("git_push_force", "git_push")).toBe(true);
      expect(same("HtmlTreeBuilder", "HtmlTreeBuilderState")).toBe(true);
      expect(same("recursive_lucas_number", "lucas_number")).toBe(false);
      // One word says too little, and sharing a word is not enough.
      expect(same("power", "next_power_of_two")).toBe(false);
      expect(same("binary_count_setbits", "get_1s_count")).toBe(false);
      expect(same("add_10", "add_20")).toBe(false);
    }
  });

  it("from v7 on, ties names by synonyms and a conversion to its inverse (#200)", () => {
    const both = (left: string, right: string) => [sameIdea(left, right, "local-real-rounds.v6"), sameIdea(left, right, "local-real-rounds.v7")];
    // The three output rounds #200 found: one conversion to base -2 under two names, and its inverse.
    expect(both("decimal_to_negative_base_2", "decimal_to_negative_binary")).toEqual([false, true]);
    expect(both("decimal_to_negative_binary", "negative_binary_to_int")).toEqual([false, true]);
    expect(both("negative_binary_to_int", "decimal_to_negative_base_2")).toEqual([false, true]);
    // Short forms read as their word, and `from` turns a name around.
    expect(both("bin_to_decimal", "decimal_to_binary")).toEqual([false, true]);
    expect(both("hex_to_bin", "binary_to_hexadecimal")).toEqual([false, true]);
    expect(both("int_from_bin", "binary_to_int")).toEqual([false, true]);
    expect(both("int_from_bin", "int_to_binary")).toEqual([false, true]);
    expect(both("count_bin_ones", "count_binary_ones")).toEqual([false, true]);
    // Other conversions stay apart, and a conversion's words alone tie it to no other name.
    expect(both("bin_to_decimal", "binary_coded_decimal")).toEqual([false, false]);
    expect(both("bin_to_decimal", "decimal_to_negative_binary")).toEqual([false, false]);
    expect(both("bin_to_decimal", "oct_to_decimal")).toEqual([false, false]);
    expect(both("decimal_to_binary", "decimal_to_octal")).toEqual([false, false]);
    expect(both("excess_3_code", "binary_coded_decimal")).toEqual([false, false]);
    expect(both("roman_to_int", "int_to_bytes")).toEqual([false, false]);
  });

  it("ties two fixes of one repository in one file, or in files side by side named alike", () => {
    const at = (path: string, repository = "nvbn/thefuck") => ({ repository, path });
    expect(sameFile(at("luigi/scheduler.py", "spotify/luigi"), at("luigi/scheduler.py", "Spotify/luigi"))).toBe(true);
    expect(sameFile(at("thefuck/rules/git_push.py"), at("thefuck/rules/git_push_force.py"))).toBe(true);
    expect(sameFile(at("thefuck/rules/git_push.py"), at("thefuck/specific/git_push_force.py"))).toBe(false);
    expect(sameFile(at("thefuck/rules/git_push.py"), at("thefuck/rules/git_push.py", "other/thefuck"))).toBe(false);
    expect(sameFile(at("scrapy/utils/request.py", "scrapy/scrapy"), at("scrapy/http/request/__init__.py", "scrapy/scrapy"))).toBe(false);
    // File names keep the v6 reading.
    expect(sameFile(at("conversions/bin_to_decimal.py"), at("conversions/decimal_to_binary.py"))).toBe(false);
  });
});
