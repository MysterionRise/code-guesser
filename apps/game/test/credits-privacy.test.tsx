import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Credits and privacy (#99): the credits come from every round's source and name no round, and the privacy page lists
// every field of the event schema, from the same registry the page renders.
const ARTIFACT_PATH = fileURLToPath(new URL("../src/demo/generated/local-real-rounds.json", import.meta.url));
const { loadLocalRealExperiment } = await import("../src/demo/local-real-experiment-loader.server");
const loaded = loadLocalRealExperiment({ artifactPath: ARTIFACT_PATH });
if (!loaded.ok) throw new Error("committed artifact unavailable");
const experiment = loaded.experiment;
let active: typeof loaded = loaded;
vi.mock("../src/demo/local-real-experiment-loader.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/demo/local-real-experiment-loader.server")>();
  return { ...original, activeLocalRealExperiment: () => active };
});

const { EVENT_BASE_KEYS, EVENT_FIELDS } = await import("../src/experiment/events");
const { BASE_FIELD_DOCS, EVENT_DOCS } = await import("../src/experiment/event-docs");
const { DISCLOSURES, NEVER_RECORDED } = await import("../src/privacy/disclosures");
type Page = (props: { searchParams: Promise<Readonly<Record<string, string>>> }) => Promise<ReactElement>;
// Loaded by a computed path, so Next.js's own declarations stay out of the tests' typecheck.
const pages = ["../src/app/credits/page", "../src/app/privacy/page"];
const [{ default: CreditsPage }, { default: PrivacyPage }] = await Promise.all(pages.map((path) => import(path))) as [{ default: Page }, { default: Page }];
const render = async (page: Page): Promise<string> => renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) }));

interface Fixture {
  roundId: string;
  panes: { text: string }[];
  candidates: { id: string; label: string }[];
  source: Record<string, unknown> & { repository: string; path: string; commit: string; excerptHash: string };
}
const fixtures = (JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as { decks: { fixtures: Fixture[] }[] }).decks.flatMap(({ fixtures: own }) => own);
/** Text as the page's markup escapes it. */
const escaped = (text: string): string => text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;")
  .replace(/'/gu, "&#x27;");
const keyOf = ({ repository, path, commit }: { repository: string; path: string; commit: string }) => JSON.stringify([repository, path, commit]);

describe("credits (#99)", () => {
  it("credit every round's file once, from its source, sorted by licence, then repository, then path", () => {
    const { credits } = experiment;
    expect(new Set(credits.map(keyOf))).toEqual(new Set(fixtures.map(({ source }) => keyOf(source))));
    expect(credits).toHaveLength(new Set(fixtures.map(({ source }) => keyOf(source))).size);
    const sortKey = ({ license, repository, path }: (typeof credits)[number]) => [license.spdx, repository, path];
    for (const [index, credit] of credits.entries()) {
      if (index > 0) expect(JSON.stringify(sortKey(credits[index - 1]!)) <= JSON.stringify(sortKey(credit)), credit.path).toBe(true);
      // Exactly the source's public provenance: no round id, deck, excerpt hash, or anything a round could be found by.
      expect(Object.keys(credit).sort()).toEqual(["author", "commit", "fileUrl", "license", "path", "repository", "repositoryUrl"]);
      const { source } = fixtures.find((fixture) => keyOf(fixture.source) === keyOf(credit))!;
      expect(credit).toEqual({
        repository: source.repository, repositoryUrl: source.repositoryUrl, path: source.path, commit: source.commit, fileUrl: source.blobUrl,
        license: { spdx: source.licenseSpdx, name: source.licenseName, fileUrl: source.licenseFileUrl }, author: source.authorName,
      });
    }
  });

  it("render every credit, with no round id, excerpt hash, pane line, or option label of any round", async () => {
    const html = await render(CreditsPage);
    for (const credit of experiment.credits) {
      for (const text of [credit.repository, credit.path, credit.fileUrl, credit.license.fileUrl, credit.author]) expect(html).toContain(escaped(text));
    }
    for (const { roundId, source } of fixtures) {
      expect(html).not.toContain(roundId);
      expect(html).not.toContain(source.excerptHash);
    }
    for (const { panes } of fixtures) {
      for (const line of panes.flatMap(({ text }) => text.split("\n")).map((own) => own.trim()).filter((own) => own.length >= 20)) {
        expect(html, line).not.toContain(escaped(line));
      }
    }
    // An option may share its words with a credit, as a project round's options are repositories, or with the page's own
    // words; any other option's label would have come from a round, and none is on the page. A label of a few characters,
    // or of no letters, such as an output's `10`, is left out, since any hash or count may hold it.
    active = { ...loaded, experiment: { ...experiment, credits: [] } };
    const chrome = await render(CreditsPage);
    active = loaded;
    const own = [chrome, ...experiment.credits.flatMap(({ license, ...credit }) => [...Object.values(credit), ...Object.values(license)])];
    const labels = [...new Set(fixtures.flatMap(({ candidates }) => candidates.map(({ label }) => label)))]
      .filter((label) => label.length >= 4 && /\p{L}/u.test(label) && !own.some((text) => text.includes(label)));
    expect(labels.length).toBeGreaterThan(100);
    for (const label of labels) expect(html, label).not.toContain(escaped(label));
  });
});

describe("privacy (#99)", () => {
  it("describe exactly the event schema's fields: every base key, and every event's own", () => {
    expect(Object.keys(BASE_FIELD_DOCS)).toEqual([...EVENT_BASE_KEYS]);
    expect(Object.keys(EVENT_DOCS).sort()).toEqual(Object.keys(EVENT_FIELDS).sort());
    for (const [type, fields] of Object.entries(EVENT_FIELDS)) expect(Object.keys(EVENT_DOCS[type as keyof typeof EVENT_DOCS].fields).sort(), type).toEqual([...fields].sort());
  });

  it("render every field of the event log, every disclosure, and what is never recorded", async () => {
    const html = await render(PrivacyPage);
    for (const key of EVENT_BASE_KEYS) expect(html).toContain(`<dt><code>${key}</code></dt>`);
    for (const [type, fields] of Object.entries(EVENT_FIELDS)) {
      expect(html).toContain(`<h3><code>${type}</code></h3>`);
      for (const field of fields) expect(html, `${type}.${field}`).toContain(`<dt><code>${field}</code></dt>`);
    }
    for (const { title, summary } of DISCLOSURES) {
      expect(html).toContain(escaped(title));
      for (const paragraph of summary) expect(html).toContain(escaped(paragraph));
    }
    for (const never of NEVER_RECORDED) expect(html).toContain(escaped(never));
    // The page reads nothing about a game: no round, and none of the artifact's sources.
    expect(html).not.toMatch(/local-[a-z-]+-[0-9a-f]{8,}/u);
    expect(html).not.toContain("github.com");
  });

  it("keep a slot for this browser's storage, which holds no key yet", () => {
    const storage = DISCLOSURES.find(({ id }) => id === "browser")!;
    expect(storage.items).toEqual([]);
    expect(storage.empty).toMatch(/No keys yet/u);
  });
});
