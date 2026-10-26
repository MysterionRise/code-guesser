import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../src/app/globals.css", () => ({}));

// The public pages (#168): About, the not-found page, an unknown deck's note, robots, and the layout's metadata.
const ARTIFACT_PATH = fileURLToPath(new URL("../src/demo/generated/local-real-rounds.json", import.meta.url));
const { loadLocalRealExperiment } = await import("../src/demo/local-real-experiment-loader.server");
const loaded = loadLocalRealExperiment({ artifactPath: ARTIFACT_PATH });
if (!loaded.ok) throw new Error("committed artifact unavailable");
vi.mock("../src/demo/local-real-experiment-loader.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/demo/local-real-experiment-loader.server")>();
  return { ...original, activeLocalRealExperiment: () => loaded };
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "127.0.0.1:3000" }) }));

/** What the tests read of a page's metadata. */
type Metadata = Readonly<Record<string, unknown> & { metadataBase?: URL }>;
type PageProps = { searchParams: Promise<Readonly<Record<string, string>>> };
// Loaded by computed paths, so Next.js's own declarations stay out of the tests' typecheck, where they break
// `node:child_process` for the preparer's sources.
const load = async <T,>(path: string): Promise<T> => await import(path) as T;
const { default: AboutPage, metadata: aboutMetadata } = await load<{ default: (props: PageProps) => Promise<ReactElement>; metadata: Metadata }>(
  "../src/app/about/page");
const { default: NotFound, metadata: notFoundMetadata } = await load<{ default: () => ReactElement; metadata: Metadata }>("../src/app/not-found");
const { default: Page } = await load<{ default: (props: PageProps) => Promise<ReactElement> }>("../src/app/page");
const { default: robots } = await load<{ default: () => unknown }>("../src/app/robots");
const { gameSources } = await import("../src/demo/game-sources.server");
const { LOCAL_REAL_EXPERIMENT_NOTICE_BODY } = await import("../src/demo/local-real-experiment-loader.server");

interface Fixture { roundId: string; prompt: string; panes: { text: string }[]; clues: string[] }
const fixtures = (JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as { decks: { fixtures: Fixture[] }[] }).decks.flatMap((deck) => deck.fixtures);
/** Text as `renderToStaticMarkup` escapes it. */
const escaped = (text: string): string => text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;")
  .replace(/'/gu, "&#x27;");
const query = (values: Readonly<Record<string, string>> = {}) => ({ searchParams: Promise.resolve(values) });
const render = async (page: Promise<ReactElement>): Promise<string> => renderToStaticMarkup(await page);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the About page (#168)", () => {
  it("lists every deck by the title and description its deck publishes, and nothing from any round", async () => {
    const html = await render(AboutPage(query()));
    const decks = /<dl class="about-decks">(.*?)<\/dl>/su.exec(html)![1]!;
    const sources = gameSources(loaded.experiment);
    expect([...decks.matchAll(/<dt><a href="\/\?deck=([\w-]+)">/gu)].map(([, id]) => id)).toEqual(sources.map(({ id }) => id));
    for (const { title, description } of sources) {
      expect(decks).toContain(`>${escaped(title)}</a></dt><dd>${escaped(description)}</dd>`);
    }
    for (const fixture of fixtures) {
      expect(html).not.toContain(fixture.roundId);
      expect(html).not.toContain(escaped(fixture.prompt));
      for (const clue of fixture.clues) expect(html).not.toContain(escaped(clue));
      for (const { text } of fixture.panes) expect(html).not.toContain(escaped(text));
    }
  });

  it("says how to play, how scoring and hints work, the keys, duels, and what the experiment records", async () => {
    const html = await render(AboutPage(query()));
    expect([...html.matchAll(/<h2 id="[\w-]+">([^<]+)<\/h2>/gu)].map(([, heading]) => heading))
      .toEqual(["How to play", "Keys", "The decks", "Duels", "Where the code comes from", "The experiment"]);
    for (const text of ["five rounds", "250 points for each option", "100% with no hint, 80% after", "50% after two", "Challenge a friend",
      "chosen and checked automatically", "not reviewed by hand", "Terminal, Paper, Arcade, or High contrast", "anonymous events",
      "<code>Sec-GPC: 1</code>", "games that record nothing"]) {
      expect(html).toContain(text);
    }
    expect([...html.matchAll(/<kbd>([^<]+)<\/kbd>/gu)].map(([, key]) => key)).toEqual(["1", "4", "Enter", "H", "N"]);
    expect(html).toContain(`<p class="demo-notice">${escaped(LOCAL_REAL_EXPERIMENT_NOTICE_BODY)} <a href="/about">About</a></p>`);
    expect(aboutMetadata).toMatchObject({ title: "About" });
  });

  it("links the privacy page (#99)", async () => {
    expect(await render(AboutPage(query()))).toContain('<a href="/privacy">privacy page</a>');
  });

  it("keeps the original theme, unless a lab tester picks one", async () => {
    expect(await render(AboutPage(query({ theme: "paper" })))).toMatch(/^<div class="demo-page" data-theme="terminal">/u);
    vi.stubEnv("EXPERIMENT_LAB", "1");
    expect(await render(AboutPage(query({ theme: "paper" })))).toMatch(/^<div class="demo-page" data-theme="paper">/u);
  });
});

describe("the not-found page and an unknown deck (#168, #70)", () => {
  it("shows the way back to the decks under the notice, in the original theme", async () => {
    const html = renderToStaticMarkup(NotFound());
    expect(html).toMatch(/^<div class="demo-page" data-theme="terminal"><p class="demo-notice">/u);
    expect(html).toContain('<main class="empty-state" aria-labelledby="not-found-title"><h1 id="not-found-title">There’s nothing here</h1>');
    expect(html).toContain('<a class="deck-link" href="/">Back to the decks</a>');
    expect(notFoundMetadata).toEqual({ title: { absolute: "Page not found · CodeGuessr" } });
  });

  it("says a deck this artifact doesn't hold isn't available, above the chooser, without repeating its name", async () => {
    for (const deck of ["vulnerable-line", "no-such-deck", ""]) {
      const html = await render(Page(query({ deck })));
      expect(html, deck).toContain('<main class="deck-chooser" aria-labelledby="deck-chooser-title"><p class="deck-notice">That deck isn’t available.');
      if (deck !== "") expect(html, deck).not.toContain(deck);
    }
    const chooser = await render(Page(query()));
    expect(chooser).toContain('<h1 id="deck-chooser-title">Pick a deck</h1>');
    expect(chooser).not.toContain("deck-notice");
  });
});

describe("robots and the layout's metadata (#168)", () => {
  it("lets crawlers read the chooser and About, and keeps them off deals and duels", () => {
    expect(robots()).toEqual({ rules: { userAgent: "*", allow: ["/", "/about"], disallow: ["/*?deck=", "/*?duel"] } });
  });

  it("takes metadataBase from the public origin when a host sets one, and gives every other page's title its suffix", async () => {
    const layout = async (): Promise<Metadata> => {
      vi.resetModules();
      return (await load<{ metadata: Metadata }>("../src/app/layout")).metadata;
    };
    const unset = await layout();
    expect(unset).not.toHaveProperty("metadataBase");
    expect(unset).toMatchObject({
      title: { default: "CodeGuessr — Read the code. Make your call.", template: "%s · CodeGuessr" },
      openGraph: { type: "website", siteName: "CodeGuessr" },
      twitter: { card: "summary" },
    });
    vi.stubEnv("CODEGUESSR_PUBLIC_ORIGIN", "https://codeguessr.example/some/path");
    expect((await layout()).metadataBase?.href).toBe("https://codeguessr.example/");
    vi.stubEnv("CODEGUESSR_PUBLIC_ORIGIN", "ftp://codeguessr.example");
    expect(await layout()).not.toHaveProperty("metadataBase");
  });
});
