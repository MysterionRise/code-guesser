import { readFileSync } from "node:fs";

import { LANGUAGE_PAIRS, RARE_LANGUAGES, STACK_LANGUAGES, isLanguageSelection } from "../../../packages/artifact/src/index";
import { codeWindow } from "./code-windows";
import { generateLanguageRounds } from "./language-rounds";
import { MAINSTREAM_LANGUAGES, STACK_EXTENSIONS, parseCrawlProfile, poolSizes, type CrawlProfile, type StackLanguage } from "./profile";
import { loadRareLanguageProfile, sha256, snapshotIdFor, stackCandidate } from "./testdata/deck-builders";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const raw = () => JSON.parse(readFileSync(new URL("../profiles/local-real-rounds.v5.json", import.meta.url), "utf8"));
const withConfigurations = (configurations: readonly unknown[]): CrawlProfile => {
  const profile = raw();
  return parseCrawlProfile({ ...profile, stack: { ...profile.stack, configurations } });
};
const rare = (language: StackLanguage, extra: Readonly<Record<string, unknown>> = { projectDeck: false }) =>
  ({ language, extensions: [...STACK_EXTENSIONS[language]], ...extra });
const deckFor = (profile: CrawlProfile, override?: (language: StackLanguage, variant: number) => Readonly<Record<string, unknown>> | undefined) => {
  const snapshotId = snapshotIdFor(profile);
  const candidates = profile.stack.configurations.flatMap(({ language }) =>
    [0, 1].map((variant) => stackCandidate(profile, snapshotId, language, variant, override?.(language, variant) ?? {})));
  return generateLanguageRounds({ profile, candidates });
};
const pairOf = (language: string) => LANGUAGE_PAIRS.find((pair) => (pair as readonly string[]).includes(language))!;
/** Pairs whose members read alike as families, by one language from each. */
const RESEMBLING = [["Elixir", "Python"], ["Crystal", "Ruby"], ["Julia", "Python"], ["Haskell", "OCaml"], ["Elm", "F#"], ["Erlang", "Elixir"]] as const;

describe("rarer languages (v1.0)", () => {
  it("lets a profile, a run, or an artifact read whole look-alike pairs in their fixed order", () => {
    expect(isLanguageSelection(MAINSTREAM_LANGUAGES)).toBe(true);
    expect(isLanguageSelection(STACK_LANGUAGES)).toBe(true);
    expect(isLanguageSelection(["Python", "Ruby", "Haskell", "Elm"])).toBe(true);
    expect(isLanguageSelection(["Ruby", "Python"])).toBe(false);
    expect(isLanguageSelection(["Python", "Ruby", "Haskell"])).toBe(false);
    expect(isLanguageSelection(["Python", "Ruby", "Cobol"])).toBe(false);
    expect(isLanguageSelection([])).toBe(false);
  });

  it("reads a rarer pair for the language deck alone, and refuses half a pair or a project deck of rare languages", () => {
    const profile = loadRareLanguageProfile();
    expect(profile.stack.configurations).toHaveLength(STACK_LANGUAGES.length);
    expect(poolSizes(profile)).toMatchObject({ project: 24, language: 2 * STACK_LANGUAGES.length });
    // The v5 profile carries no `projectDeck` key, so it parses, and hashes, as before.
    expect(parseCrawlProfile(raw()).stack.configurations.every((configuration) => !("projectDeck" in configuration))).toBe(true);
    const twelve = raw().stack.configurations;
    expect(() => withConfigurations([...twelve, rare("Haskell")])).toThrow();
    expect(() => withConfigurations([...twelve, rare("Haskell", { projectDeck: true }), rare("Elm")])).toThrow();
    expect(() => withConfigurations([rare("Haskell"), rare("Elm")])).toThrow();
    expect(() => withConfigurations([...twelve, rare("Elm"), rare("Haskell")])).toThrow();
  });

  it("keeps the worker's languages, shard directories, and extensions in step with the preparer's", () => {
    const worker = readFileSync(new URL("../stack/stream_metadata.py", import.meta.url), "utf8");
    const table = /^EXTENSIONS = \{\n([\s\S]*?)\n\}/mu.exec(worker)![1]!;
    const extensions = Object.fromEntries([...table.matchAll(/"([^"]+)": \(([^)]*)\)/gu)]
      .map(([, language, list]) => [language, [...list!.matchAll(/"([^"]+)"/gu)].map(([, extension]) => extension)]));
    expect(extensions).toEqual(STACK_EXTENSIONS);
    const parquet = readFileSync(new URL("../stack/bounded_parquet.py", import.meta.url), "utf8");
    const directories = [.../^DIRECTORIES = \{\n([\s\S]*?)\n\}/mu.exec(parquet)![1]!.matchAll(/"([^"]+)": "[^"]+"/gu)].map(([, language]) => language);
    expect(directories).toEqual([...STACK_LANGUAGES]);
  });

  it("starts a window past each rarer language's licence header and preamble", () => {
    const limits = { maxLines: 18, maxBytes: 4096, minBytes: 10 };
    const starts = (text: string, language: StackLanguage) => codeWindow(text, language, limits)?.split("\n")[0];
    expect(starts("{- Licence text\n   spanning lines -}\nmodule Ledger\n  ( total\n  , average\n  ) where\n\nimport Data.List (foldl')\n\ntotal :: [Int] -> Int\ntotal = foldl' (+) 0", "Haskell"))
      .toBe("total :: [Int] -> Int");
    expect(starts("(ns demo.core\n  (:require [demo.text :as text]\n            [demo.util :refer [helper]]))\n\n(defn total [xs]\n  (reduce + xs))", "Clojure"))
      .toBe("(defn total [xs]");
    expect(starts("unit Ledger;\n\ninterface\n\nuses\n  SysUtils,\n  Classes;\n\nfunction Total(const X: array of Integer): Integer;", "Pascal"))
      .toBe("function Total(const X: array of Integer): Integer;");
    expect(starts("defmodule Ledger do\n  @moduledoc \"\"\"\n  Keeps entries.\n  \"\"\"\n  alias Ledger.Entry\n\n  def total(entries) do\n    Enum.sum(entries)\n  end\nend", "Elixir"))
      .toBe("  def total(entries) do");
    expect(starts("(* Copyright\n   notice *)\nopen Printf\n\nlet total xs = List.fold_left ( + ) 0 xs", "OCaml")).toBe("let total xs = List.fold_left ( + ) 0 xs");
    expect(starts("%% Licence\n-module(ledger).\n-export([total/1,\n         average/1]).\n\ntotal(Xs) -> lists:sum(Xs).", "Erlang")).toBe("total(Xs) -> lists:sum(Xs).");
    expect(starts("#lang racket/base\n(require racket/list)\n(provide total)\n\n(define (total xs) (apply + xs))", "Racket")).toBe("(define (total xs) (apply + xs))");
  });

  it("deals a deck of every language, each round two whole pairs, no option set twice, and none offered a pair its code resembles", () => {
    const profile = loadRareLanguageProfile();
    const { fixtures } = deckFor(profile);
    expect(fixtures).toHaveLength(2 * STACK_LANGUAGES.length);
    const sets = new Map<string, number>();
    const second = new Map<string, number>();
    for (const fixture of fixtures) {
      const answer = String(fixture.source.configuration);
      const labels = fixture.candidates.map(({ label }) => label);
      const own = pairOf(answer);
      const other = pairOf(labels.find((label) => !(own as readonly string[]).includes(label))!);
      expect([...labels].sort()).toEqual([...own, ...other].sort());
      const key = [...labels].sort().join("|");
      sets.set(key, (sets.get(key) ?? 0) + 1);
      second.set(other.join("|"), (second.get(other.join("|")) ?? 0) + 1);
      // No round offers two pairs that read alike as families (Crystal and Elixir borrowed Ruby's syntax).
      for (const [left, right] of RESEMBLING) {
        expect(labels.includes(left) && labels.includes(right), `${answer} offered ${left} and ${right}`).toBe(false);
      }
    }
    // Thirteen pairs: a pair takes four second pairs along the cycle, so no two pairs meet twice.
    expect(Math.max(...sets.values())).toBe(1);
    expect(new Set(second.values())).toEqual(new Set([4]));
    expect(second.size).toBe(LANGUAGE_PAIRS.length);
  });

  it("refuses a deck no cycle of second pairs can keep from offering two pairs that read alike", () => {
    const languages = ["Python", "Ruby", "TypeScript", "JavaScript", "Go", "Rust", "C", "C++", "Julia", "MATLAB", "Elixir", "Crystal"] as const;
    const profile = withConfigurations(languages.map((language) => RARE_LANGUAGES.has(language)
      ? rare(language) : { language, extensions: [...STACK_EXTENSIONS[language]] }));
    // With six pairs each takes all but one of the others, and Python/Ruby resembles two of them.
    expect(() => deckFor(profile)).toThrow("LANGUAGE_PAIRING_CONFLICT");
  });

  it("refuses a window that names a rarer language in any case", () => {
    const profile = loadRareLanguageProfile();
    const named = "(ns demo.core\n  (:require [clojure.string :as text]))\n\n(defn total [entries]\n  (reduce + 0 entries))\n\n(defn label [entry]\n  (text/upper-case (:note entry)))";
    const plain = named.replace("clojure.string", "demo.string");
    const override = (text: string) => (language: StackLanguage, variant: number) =>
      language === "Clojure" && variant === 0 ? { excerpt: text, excerptHash: sha256(text) } : undefined;
    expect(() => deckFor(profile, override(plain))).not.toThrow();
    expect(() => deckFor(profile, override(named))).toThrow("LANGUAGE_ROUNDS_REJECTED");
  });
});
