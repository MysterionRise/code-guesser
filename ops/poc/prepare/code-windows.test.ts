import { afterPreamble, changeWindows, codeWindow } from "./code-windows";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const limits = { maxLines: 8, maxBytes: 600, minBytes: 20 };
const firstLine = (excerpt: string | undefined): string | undefined => excerpt?.split("\n")[0];

describe("code windows", () => {
  it("skips licence headers and each language's import preamble, then starts at a definition", () => {
    const go = ["// Copyright 2024 The Authors.", "", "package server", "", "import (", "\t\"fmt\"", "\t\"net/http\"", ")", "",
      "var started = false", "", "func Serve(addr string) error {", "\treturn http.ListenAndServe(addr, nil)", "}"].join("\n");
    expect(firstLine(codeWindow(go, "Go", limits))).toBe("func Serve(addr string) error {");

    const python = ["#!/usr/bin/env python", "# -*- coding: utf-8 -*-", '"""Module docs."""', "from __future__ import annotations",
      "import os", "from typing import (", "    Any,", ")", "", "@cache", "def load(path: str) -> Any:", "    return os.stat(path)"].join("\n");
    expect(firstLine(codeWindow(python, "Python", limits))).toBe("@cache");

    const rust = ["//! Crate docs", "use std::collections::{", "    HashMap,", "};", "extern crate alloc;", "", "#[derive(Debug)]",
      "pub struct Cache {", "    entries: HashMap<String, u32>,", "}"].join("\n");
    expect(firstLine(codeWindow(rust, "Rust", limits))).toBe("#[derive(Debug)]");

    const typescript = ["'use strict';", "import { readFile } from \"node:fs\";", "import type {", "  Stats,", "} from \"node:fs\";",
      "export * from \"./types\";", "", "export async function load(path: string): Promise<string> {", "  return readFile(path, \"utf8\");", "}"].join("\n");
    expect(firstLine(codeWindow(typescript, "TypeScript", limits))).toBe("export async function load(path: string): Promise<string> {");

    const ruby = ["# frozen_string_literal: true", "", "require \"json\"", "require_relative \"base\"", "", "module Shop", "  class Cart",
      "    def total = items.sum(&:price)", "  end", "end"].join("\n");
    expect(firstLine(codeWindow(ruby, "Ruby", limits))).toBe("module Shop");
  });

  it("starts at the first statement when no definition is near, and rejects a file that is only preamble", () => {
    const script = ["import sys", "", "print(sys.argv)", "for arg in sys.argv[1:]:", "    print(arg.upper())"].join("\n");
    expect(firstLine(codeWindow(script, "Python", limits))).toBe("print(sys.argv)");
    expect(codeWindow("package main\n\nimport \"fmt\"\n", "Go", limits)).toBeUndefined();
    expect(afterPreamble(["use a::{", "  b,", "};", "fn main() {}"], "Rust", 0)).toBe(3);
  });

  it("keeps the window on whole lines within its line and byte limits", () => {
    const long = Array.from({ length: 30 }, (_, index) => `def f${index}():\n    return ${index}`).join("\n");
    const window = codeWindow(long, "Python", limits)!;
    expect(window.split("\n")).toHaveLength(8);
    expect(codeWindow(long, "Python", { ...limits, maxBytes: 40 })!.split("\n").length).toBeLessThan(8);
    expect(codeWindow("def f():\n    pass", "Python", { ...limits, minBytes: 200 })).toBeUndefined();
  });
});

describe("change windows", () => {
  const changeLimits = { maxLines: 12, maxBytes: 800, maxChangedLines: 4, contextLines: 2 };
  const file = (middle: readonly string[]): string =>
    ["header 1", "header 2", "header 3", "def total(items):", ...middle, "footer 1", "footer 2", "footer 3"].join("\n");

  it("shows the same stretch before and after one change, with matching context", () => {
    const windows = changeWindows(file(["    t = 0", "    for i in items:", "        t += i", "    return t"]),
      file(["    return sum(items)"]), changeLimits)!;
    expect(windows.before.split("\n")).toEqual(["header 3", "def total(items):", "    t = 0", "    for i in items:", "        t += i",
      "    return t", "footer 1", "footer 2"]);
    expect(windows.after.split("\n")).toEqual(["header 3", "def total(items):", "    return sum(items)", "footer 1", "footer 2"]);
    expect({ removed: windows.removed, added: windows.added }).toEqual({ removed: 4, added: 1 });
  });

  it("has no window for identical, whitespace-only, too-large, or scattered changes", () => {
    expect(changeWindows(file(["x = 1"]), file(["x = 1"]), changeLimits)).toBeUndefined();
    expect(changeWindows(file(["x = 1"]), file(["x  =  1 "]), changeLimits)).toBeUndefined();
    expect(changeWindows(file(["a", "b", "c", "d", "e"]), file(["z"]), changeLimits)).toBeUndefined();
    const scattered = (first: string, last: string) => [first, ...Array.from({ length: 20 }, (_, index) => `line ${index}`), last].join("\n");
    expect(changeWindows(scattered("a", "b"), scattered("A", "B"), changeLimits)).toBeUndefined();
  });

  it("handles a pure insertion", () => {
    const windows = changeWindows(file([]), file(["    validate(items)"]), changeLimits)!;
    expect(windows.removed).toBe(0);
    expect(windows.after).toContain("validate(items)");
    expect(windows.before).not.toContain("validate");
  });
});
