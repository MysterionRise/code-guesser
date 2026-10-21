import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Sharing a game (#171): its share line, the link it carries, and each deck's link preview.
const ARTIFACT_PATH = fileURLToPath(new URL("../src/demo/generated/local-real-rounds.json", import.meta.url));
const { loadLocalRealExperiment } = await import("../src/demo/local-real-experiment-loader.server");
const loaded = loadLocalRealExperiment({ artifactPath: ARTIFACT_PATH });
if (!loaded.ok) throw new Error("committed artifact unavailable");
const experiment = loaded.experiment;
vi.mock("../src/demo/local-real-experiment-loader.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/demo/local-real-experiment-loader.server")>();
  return { ...original, activeLocalRealExperiment: () => loaded };
});
let requestHeaders = new Headers({ host: "127.0.0.1:3000" });
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));

const { createArcadeSession, projectDisplayReveal, projectSpoilerFreeShare, transitionArcadeSession } = await import("../src/components/arcade/index");
const { gameSources } = await import("../src/demo/game-sources.server");
const { publicOrigin } = await import("../src/server/public-origin.server");
const { CONTROL } = await import("../src/experiment/arms");

interface Fixture {
  roundId: string; prompt: string; panes: { text: string }[]; candidates: { id: string; label: string }[]; correctCandidateId: string; clues: string[];
}
const artifactDecks = (JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as { decks: { id: string; fixtures: Fixture[] }[] }).decks;
const fixtures = new Map(artifactDecks.flatMap(({ fixtures: deckFixtures }) => deckFixtures.map((fixture) => [fixture.roundId, fixture] as const)));
/** The rounds a deck's address may deal: its own pool, or every deck's for the mix and today's five. */
const poolOf = (deck: string): readonly Fixture[] => artifactDecks.find(({ id }) => id === deck)?.fixtures ?? [...fixtures.values()];
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const points = (value: number): string => value.toLocaleString("en-US");

/**
 * Plays one game of a deck through the server and the browser's session, as a player would: round one right after a
 * hint, rounds two and three missed (three after both hints), and the last two right with none.
 */
const playGame = (deck: string) => {
  const dealt = experiment.dealGame(deck as never, seeded(11), Date.now(), { arms: CONTROL, record: false }, { seed: "0badcafe", game: 0 });
  const mode = dealt.mode;
  let token = dealt.sessionToken;
  let session = createArcadeSession(mode);
  mode.rounds.forEach((round, index) => {
    for (let hint = 0; hint < (index === 0 ? 1 : index === 2 ? 2 : 0); hint += 1) {
      const response = experiment.revealHint({ sessionToken: token, roundId: round.roundId });
      if (!response.ok) throw new Error("hint refused");
      token = response.sessionToken;
      session = transitionArcadeSession(mode, session, { type: "reveal-hint", label: response.hint });
    }
    const fixture = fixtures.get(round.roundId)!;
    const candidateId = index === 1 || index === 2 ? fixture.candidates.find(({ id }) => id !== fixture.correctCandidateId)!.id : fixture.correctCandidateId;
    const response = experiment.answer({ sessionToken: token, roundId: round.roundId, candidateId });
    if (!response.ok) throw new Error("answer refused");
    token = response.sessionToken;
    session = transitionArcadeSession(mode, transitionArcadeSession(mode, session, { type: "lock-answer", candidateId }),
      { type: "accept-reveal", reveal: projectDisplayReveal(response.reveal) });
    if (index < 4) session = transitionArcadeSession(mode, session, { type: "next-round" });
  });
  return { mode, session };
};

describe("the share line (#171)", () => {
  const sources = gameSources(experiment);

  it("offers every deck, the mix, and today's five, by the titles their decks publish", () => {
    expect(sources.map(({ id }) => id)).toEqual(["daily", "mixed", ...experiment.decks.map(({ id }) => id)]);
    expect(sources.slice(0, 2).map(({ title }) => title)).toEqual(["Today’s five", "Mixed"]);
  });

  for (const { id, title } of gameSources(experiment)) {
    it(`marks each round of a ${id} game and names none of its options, answers, rounds, or code`, () => {
      const { mode, session } = playGame(id);
      const url = `http://127.0.0.1:3000/?deck=${id}&deal=0badcafe&game=0`;
      const share = projectSpoilerFreeShare(session.result!, session.history, title, url);
      const { score, attainableMaximum } = session.result!;
      expect(share.message).toBe(`CodeGuessr · ${title} · 3/5 · ${points(score)}/${points(attainableMaximum)}\n🟨⬛⬛🟩🟩`);
      expect(share.text).toBe(`${share.message}\n${url}`);
      // The line reads only whether each round was right and took hints: with nothing else to read, it is the same.
      expect(projectSpoilerFreeShare(session.result!, session.history.map(({ correct, hints }) => ({ correct, hints })), title, url)).toEqual(share);
      const shown = share.text.replace(url, "");
      for (const round of mode.rounds) {
        const fixture = fixtures.get(round.roundId)!;
        expect(shown).not.toContain(round.roundId);
        expect(shown).not.toContain(fixture.prompt);
        // Short or numeric options ("C", "Go", "3") can't be told from the tally; every other option is checked whole.
        for (const { label } of fixture.candidates.filter(({ label: text }) => text.length >= 4 && /\p{L}/u.test(text))) expect(shown).not.toContain(label);
        for (const line of fixture.panes.flatMap(({ text }) => text.split("\n")).map((text) => text.trim()).filter((text) => text.length >= 8)) {
          expect(shown).not.toContain(line);
        }
        for (const clue of fixture.clues) expect(shown).not.toContain(clue);
      }
      for (const { source } of session.history) if (source !== null) expect(share.text).not.toContain(source);
    });
  }
});

describe("the shared link's origin (#171)", () => {
  it("is the configured public origin, or else the address the request came to", () => {
    expect(publicOrigin(new Headers({ host: "127.0.0.1:3000" }), {})).toBe("http://127.0.0.1:3000");
    expect(publicOrigin(new Headers({ host: "Play.Example.org", "x-forwarded-proto": "https" }), {})).toBe("https://play.example.org");
    expect(publicOrigin(new Headers({ host: "[::1]:3000" }), {})).toBe("http://[::1]:3000");
    expect(publicOrigin(new Headers({ host: "127.0.0.1:3000" }), { CODEGUESSR_PUBLIC_ORIGIN: "https://codeguessr.example/some/path?x=1" }))
      .toBe("https://codeguessr.example");
  });

  it("is refused, so a share carries no link, when it isn't a plain http or https origin", () => {
    for (const host of ["", "evil.example/path", "evil.example?x=1", "user@evil.example", "evil.example:port", "a b", "<script>"]) {
      expect(publicOrigin(new Headers(host === "" ? {} : { host }), {}), host).toBeNull();
    }
    for (const origin of ["javascript:alert(1)", "not a url", "ftp://codeguessr.example"]) {
      expect(publicOrigin(new Headers({ host: "127.0.0.1:3000" }), { CODEGUESSR_PUBLIC_ORIGIN: origin }), origin).toBeNull();
    }
  });
});

/** What the tests read of a page's metadata. */
type Metadata = Readonly<Record<string, unknown> & { metadataBase?: URL }>;

describe("link previews (#171)", async () => {
  // Loaded by computed paths, so Next.js's own declarations stay out of the tests' typecheck, where they break
  // `node:child_process` for the preparer's sources.
  const pagePath: string = "../src/app/page";
  const routePath: string = "../src/app/og/[deck]/route";
  const { generateMetadata } = await import(pagePath) as {
    generateMetadata: (props: { searchParams: Promise<Readonly<Record<string, string>>> }) => Promise<Metadata>;
  };
  const { GET, generateStaticParams } = await import(routePath) as {
    GET: (request: Request, context: { params: Promise<{ deck: string }> }) => Promise<Response>;
    generateStaticParams: () => { deck: string }[];
  };
  const metadataFor = (deck?: string) => generateMetadata({ searchParams: Promise.resolve(deck === undefined ? {} : { deck }) });
  /** Every string a page's metadata holds. */
  const strings = (value: unknown): string[] => typeof value === "string" ? [value]
    : value instanceof URL ? [value.href] : typeof value === "object" && value !== null ? Object.values(value).flatMap(strings) : [];
  afterEach(() => {
    requestHeaders = new Headers({ host: "127.0.0.1:3000" });
    vi.unstubAllGlobals();
  });

  it("names each deck and its preview image, and nothing from any round", async () => {
    for (const source of gameSources(experiment)) {
      const metadata = await metadataFor(source.id);
      expect(metadata).toMatchObject({
        title: `${source.title} · CodeGuessr`, description: source.description,
        openGraph: { title: `${source.title} · CodeGuessr`, images: [{ url: `/og/${source.id}`, width: 1200, height: 630 }] },
        twitter: { card: "summary_large_image" },
      });
      expect(metadata.metadataBase?.href).toBe("http://127.0.0.1:3000/");
      const text = strings(metadata).join("\n");
      for (const fixture of poolOf(source.id)) {
        expect(text).not.toContain(fixture.roundId);
        expect(text).not.toContain(fixture.prompt);
        for (const { label } of fixture.candidates.filter(({ label: option }) => option.length >= 4 && /\p{L}/u.test(option))) {
          expect(text, `${source.id}: ${label}`).not.toMatch(new RegExp(`(?<![\\p{L}\\p{N}])${label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\p{L}\\p{N}])`, "u"));
        }
      }
    }
  });

  it("keeps the layout's title on the chooser and on a deck this artifact doesn't hold", async () => {
    expect(await metadataFor()).toEqual({ metadataBase: new URL("http://127.0.0.1:3000") });
    expect(await metadataFor("vulnerable-line")).toEqual({ metadataBase: new URL("http://127.0.0.1:3000") });
    requestHeaders = new Headers({ host: "bad host" });
    expect(await metadataFor("fix")).not.toHaveProperty("metadataBase");
  });

  it("draws a PNG for every deck, the mix, and today's five, and fetches nothing", async () => {
    const fetch = vi.fn(() => { throw new Error("NETWORK_REFUSED"); });
    vi.stubGlobal("fetch", fetch);
    const params = generateStaticParams();
    expect(params.map(({ deck }) => deck)).toEqual(gameSources(experiment).map(({ id }) => id));
    for (const { deck } of params) {
      const response = await GET(new Request(`http://127.0.0.1:3000/og/${deck}`), { params: Promise.resolve({ deck }) });
      expect(response.status, deck).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect((await GET(new Request("http://127.0.0.1:3000/og/unknown"), { params: Promise.resolve({ deck: "unknown" }) })).status).toBe(404);
  // Twelve images take a few seconds alone, and many more on a busy machine.
  }, 120_000);

  it("draws in the Terminal theme's colours", () => {
    const route = readFileSync(new URL("../src/app/og/[deck]/route.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const terminal = /^:root\s*\{([^}]*)\}/mu.exec(css)![1]!;
    const colours = [.../const COLOURS = \{([^}]*)\}/u.exec(route)![1]!.matchAll(/"?([a-z-]+)"?: "(#[0-9a-f]+)"/gu)];
    expect(colours.map(([, token]) => token)).toEqual(["bg", "bg-glow", "text", "accent"]);
    for (const [, token, value] of colours) expect(terminal, token).toContain(`--${token}: ${value};`);
  });
});
