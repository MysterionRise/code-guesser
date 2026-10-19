import { describe, expect, it } from "vitest";

import { ideaWords, sameFile, sameIdea } from "../src/index";

describe("rounds that repeat an idea (#84)", () => {
  it("ties two names when every word of the shorter, of two or more, is a word of the other", () => {
    expect([...ideaWords("get_1s_count")]).toEqual(["1s", "count"]);
    expect([...ideaWords("binaryCountSetbits")]).toEqual(["binary", "count", "setbits"]);
    expect(sameIdea("count_vowels", "count_vowels_and_consonants")).toBe(true);
    expect(sameIdea("git_push_force", "git_push")).toBe(true);
    expect(sameIdea("HtmlTreeBuilder", "HtmlTreeBuilderState")).toBe(true);
    expect(sameIdea("recursive_lucas_number", "lucas_number")).toBe(false);
    // One word says too little, and sharing a word is not enough.
    expect(sameIdea("power", "next_power_of_two")).toBe(false);
    expect(sameIdea("binary_count_setbits", "get_1s_count")).toBe(false);
    expect(sameIdea("add_10", "add_20")).toBe(false);
  });

  it("ties two fixes of one repository in one file, or in files side by side named alike", () => {
    const at = (path: string, repository = "nvbn/thefuck") => ({ repository, path });
    expect(sameFile(at("luigi/scheduler.py", "spotify/luigi"), at("luigi/scheduler.py", "Spotify/luigi"))).toBe(true);
    expect(sameFile(at("thefuck/rules/git_push.py"), at("thefuck/rules/git_push_force.py"))).toBe(true);
    expect(sameFile(at("thefuck/rules/git_push.py"), at("thefuck/specific/git_push_force.py"))).toBe(false);
    expect(sameFile(at("thefuck/rules/git_push.py"), at("thefuck/rules/git_push.py", "other/thefuck"))).toBe(false);
    expect(sameFile(at("scrapy/utils/request.py", "scrapy/scrapy"), at("scrapy/http/request/__init__.py", "scrapy/scrapy"))).toBe(false);
  });
});
