import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * The README media's size budgets (#65). `pnpm demo:record` writes these files into git, and a clone downloads every
 * version of each, so each file has a ceiling it must stay under.
 *
 * One unit: a megabyte here is 1,000,000 bytes, as in the README's "under 10 MB". The recorder's log prints
 * mebibytes (bytes / 1,048,576) under the label "MB" (`megabytes` in `ops/demo/record/index.ts`), so its numbers
 * read about 5% low: a GIF it reports as "3.85 MB" is 4.04 MB here and over its budget. In the recorder's unit the
 * budgets below are about 9.54, 3.81, and 5.72.
 */
const MEGABYTE = 1_000_000;
const HEADLINE = "demo.gif";
const HEADLINE_GIF_MEGABYTES = 10;
const OTHER_GIF_MEGABYTES = 4;
/**
 * The MP4 is the full run of today's five, so its length changes with the recording date. The committed one is
 * 3.72 MB, and the nine recorded up to 2026-10-27 ran from 2.45 to 4.77 MB; 6 MB is a quarter above the largest.
 */
const MP4_MEGABYTES = 6;

const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "media");
/** The media as committed: the ignored `.work/` screencasts and other dot entries are not files of the README. */
const media = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();

/** A file's budget in megabytes, or none for a kind of file nothing here names. */
const budgetOf = (name) => name === HEADLINE ? HEADLINE_GIF_MEGABYTES
  : extname(name) === ".gif" ? OTHER_GIF_MEGABYTES
  : extname(name) === ".mp4" ? MP4_MEGABYTES
  : undefined;

test("docs/media holds the headline clip and only kinds of file that have a budget", () => {
  assert.ok(media.includes(HEADLINE), `docs/media/${HEADLINE} must exist: the README opens with it`);
  assert.deepEqual(media.filter((name) => budgetOf(name) === undefined), [], "give a new kind of media a budget in this file");
});

test("every media file is under its budget: demo.gif 10 MB, any other GIF 4 MB, the MP4 6 MB", () => {
  const over = media.flatMap((name) => {
    const budget = budgetOf(name);
    const { size } = statSync(join(directory, name));
    return budget === undefined || size < budget * MEGABYTE ? []
      : [`${name}: ${size.toLocaleString("en-US")} bytes, not under ${budget} MB (${(budget * MEGABYTE).toLocaleString("en-US")} bytes)`];
  });
  assert.deepEqual(over, [], "record again with a shorter scene or smaller `gif` options in ops/demo/record/scenes.ts");
});
