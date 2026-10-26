import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Duels in the browser (#173): names in a link's fragment, the words a duel shows, its share lines, the challenger's
// rounds beside the friend's game, and the comparison. The share lines are checked against real games too.
const { duelSide, duelVerdict } = await import("../src/components/duel/duel-contract");
const {
  DEFAULT_NAME, challengeShare, firstPlayNote, fragmentNames, nameFragment, opponentRoundLine, ordinal, playNote, resultShare, sanitizeName,
  sideLine, verdictWords,
} = await import("../src/components/duel/duel-text");
const { DuelComparisonTable } = await import("../src/components/duel/duel-comparison");
const { OpponentStrip } = await import("../src/components/duel/duel-game");
const { ChallengeIntro, DuelResult } = await import("../src/components/duel/duel-pages");
type DuelRound = import("../src/components/duel/duel-contract").DuelRound;
type DuelComparison = import("../src/components/duel/duel-contract").DuelComparison;

const URL_OF = "https://codeguessr.example/?duel=AbC_-123";
const GRID = /[🟩🟨⬛]/u;
const ANA: readonly DuelRound[] = [[1, 1, 800], [0, 0, 0], [1, 0, 1000], [1, 0, 1000], [1, 2, 500]];
const BEN: readonly DuelRound[] = [[1, 0, 1000], [1, 0, 1000], [1, 1, 800], [0, 2, 0], [1, 0, 1000]];

/** A comparison as the server sends it, from two games of the same five four-option rounds. */
const comparisonOf = (challenger: readonly DuelRound[], challenged: readonly DuelRound[], play = 1): DuelComparison => ({
  deck: "language", deckTitle: "Which language?", date: null, max: 5000,
  challenger: { ...duelSide(challenger), firstPlay: "yes" }, challenged: { ...duelSide(challenged), play },
  verdict: duelVerdict(challenger, challenged), earlierRoundSet: false,
});

describe("names in a link's fragment (#173)", () => {
  it("keeps letters, marks, digits, spaces, hyphens, apostrophes, and underscores in any script", () => {
    for (const name of ["Ana", "Jean-Luc", "O'Brien", "ben_2", "Zoë", "Анна", "שרה", "李雷", "Ana Lee"]) expect(sanitizeName(name)).toBe(name);
    // NFKC folds look-alike forms: full-width letters, a ligature, and a letter with a combining accent.
    expect(sanitizeName("Ａｎａ")).toBe("Ana");
    expect(sanitizeName("ﬁona")).toBe("fiona");
    expect(sanitizeName("Jose\u0301")).toBe("José");
    // A phone's curly apostrophe is a straight one, and runs of space are one.
    expect(sanitizeName("  O’Brien   Lee ")).toBe("O'Brien Lee");
  });

  it("drops bidi controls and zero-width characters, which could reorder or hide what a name says", () => {
    expect(sanitizeName("\u202EanA")).toBe("anA");
    expect(sanitizeName("Ana\u2066\u2067x\u2069\u200F")).toBe("Anax");
    expect(sanitizeName("A\u200Bn\u200Ca\u200D\uFEFF")).toBe("Ana");
    expect(sanitizeName("Ana\u0000\n\tLee")).toBe("AnaLee");
  });

  it("falls back for emoji, links, markup, query text, anything over 24 code points, and nothing at all", () => {
    for (const value of ["Ana 🎉", "🎉", "https://evil.example", "evil.example", "<b>Ana</b>", "Ana&vs=Bob", "a/b", "Ana!", "@ana", "x".repeat(25),
      "", "   ", "\u200B", 42, null, undefined, { name: "Ana" }]) {
      expect(sanitizeName(value), JSON.stringify(value)).toBe(DEFAULT_NAME);
    }
    expect(sanitizeName("x".repeat(24))).toBe("x".repeat(24));
    // Code points, not UTF-16 units: 24 letters outside the basic plane fit, 25 don't.
    expect(sanitizeName("𠀀".repeat(24))).toBe("𠀀".repeat(24));
    expect(sanitizeName("𠀀".repeat(25))).toBe(DEFAULT_NAME);
    expect(sanitizeName("🎉", "Friend")).toBe("Friend");
  });

  it("reads and writes only names fit to show", () => {
    expect(fragmentNames("#from=Ana&vs=Ben")).toEqual({ from: "Ana", vs: "Ben" });
    expect(fragmentNames("#from=Ana+Lee")).toEqual({ from: "Ana Lee", vs: null });
    expect(fragmentNames("#from=%E2%80%AEanA&vs=%3Cb%3E")).toEqual({ from: "anA", vs: null });
    expect(fragmentNames("")).toEqual({ from: null, vs: null });
    expect(fragmentNames("#vs=https%3A%2F%2Fevil.example")).toEqual({ from: null, vs: null });
    expect(nameFragment({ from: "Ana Lee", vs: "Ben" })).toBe("#from=Ana+Lee&vs=Ben");
    expect(nameFragment({ from: "Ana" })).toBe("#from=Ana");
    expect(nameFragment({ from: "🎉", vs: null })).toBe("");
    expect(fragmentNames(nameFragment({ from: "Zoë O’Brien", vs: "李雷" }))).toEqual({ from: "Zoë O'Brien", vs: "李雷" });
  });
});

describe("a duel's words (#173)", () => {
  it("states each of the challenger's rounds as the friend's reveal does", () => {
    expect(opponentRoundLine("Ana", [1, 1, 800])).toBe("Ana: right, 1 hint, +800 points.");
    expect(opponentRoundLine("Ana", [0, 0, 0])).toBe("Ana: missed, no hints, 0 points.");
    expect(opponentRoundLine("A friend", [1, 2, 250])).toBe("A friend: right, 2 hints, +250 points.");
    expect(sideLine(duelSide(ANA), 5000)).toBe("4/5 right · 3,300 of 5,000");
  });

  it("says whose first try it was, and which play of the link", () => {
    expect(firstPlayNote("yes", "Ana")).toBe("First try");
    expect(firstPlayNote("yes", "Ana", true)).toBe("First try for Ana");
    expect(firstPlayNote("no", "Ana")).toBe("Ana had played these rounds before");
    expect(firstPlayNote("shared", "Ana")).toBeNull();
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal))
      .toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th", "112th"]);
    expect(playNote(1, "Ben")).toBeNull();
    expect(playNote(2, "Ben")).toBe("Ben’s 2nd play of this link");
    expect(playNote(3, null)).toBe("Your 3rd play of this link");
  });

  it("words the verdict for each way a duel is decided", () => {
    const named = { challenger: "Ana", challenged: "Ben" };
    const yours = { challenger: "Ana", challenged: null };
    // The score decides: by how much, for either side.
    expect(verdictWords(comparisonOf(ANA, BEN), yours)).toEqual({ heading: "You win by 500 points", tieBreak: null });
    expect(verdictWords(comparisonOf(ANA, BEN), named)).toEqual({ heading: "Ben wins by 500 points", tieBreak: null });
    expect(verdictWords(comparisonOf(BEN, ANA), yours)).toEqual({ heading: "Ana wins by 500 points", tieBreak: null });
    expect(verdictWords(comparisonOf([[1, 0, 1000], [1, 0, 1000], [1, 0, 1000], [1, 0, 1000], [1, 0, 1000]], [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
      [1, 0, 1000]]), named).heading).toBe("Ana wins by 4,000 points");
    // Level on points: fewer hints decide.
    const hints = comparisonOf([[1, 1, 800], [1, 0, 1000], [0, 0, 0], [1, 0, 1000], [1, 0, 1000]], [[1, 0, 1000], [1, 1, 800], [0, 2, 0], [1, 0, 1000],
      [1, 0, 1000]]);
    expect(hints.verdict).toEqual({ winner: "challenger", decidedBy: "hints" });
    expect(verdictWords(hints, yours)).toEqual({ heading: "Ana wins", tieBreak: "Level on points, so fewer hints decided it." });
    // Level on points and hints: more rounds right decide.
    const correct = comparisonOf([[1, 2, 500], [1, 2, 500], [0, 0, 0], [0, 0, 0], [0, 0, 0]], [[1, 0, 1000], [0, 2, 0], [0, 2, 0], [0, 0, 0], [0, 0, 0]]);
    expect(correct.verdict).toEqual({ winner: "challenger", decidedBy: "correct" });
    expect(verdictWords(correct, named)).toEqual({ heading: "Ana wins", tieBreak: "Level on points and hints, so more rounds right decided it." });
    const swapped = comparisonOf(correct.challenged.rounds, correct.challenger.rounds);
    expect(verdictWords(swapped, yours)).toEqual({ heading: "You win", tieBreak: "Level on points and hints, so more rounds right decided it." });
    // Level on all three: a draw.
    expect(verdictWords(comparisonOf(ANA, ANA), named)).toEqual({ heading: "A draw", tieBreak: "Level on points, hints, and rounds right." });
  });
});

describe("a duel's share lines (#173)", () => {
  const challenge = { deckTitle: "Which language?", date: null, max: 5000, challenger: { ...duelSide(ANA), firstPlay: "yes" as const } };

  it("shares a challenge as the total to beat and its link, with no grid", () => {
    const share = challengeShare(challenge, "Ana", `${URL_OF}#from=Ana`);
    expect(share).toEqual({
      message: "CodeGuessr duel · Which language? · Ana scored 3,300/5,000. Can you beat it?",
      text: `CodeGuessr duel · Which language? · Ana scored 3,300/5,000. Can you beat it?\n${URL_OF}#from=Ana`, url: `${URL_OF}#from=Ana`,
    });
    expect(share.text).not.toMatch(GRID);
    expect(challengeShare({ ...challenge, deckTitle: "Today’s five", date: "2026-10-21" }, null, URL_OF).message)
      .toBe("CodeGuessr duel · Today’s five of 2026-10-21 · I scored 3,300/5,000. Can you beat it?");
    expect(() => challengeShare(challenge, "Ana", "/?duel=AbC")).toThrow(/absolute web address/u);
  });

  it("shares a result as the verdict, then both grids and totals, the friend's first", () => {
    const share = resultShare(comparisonOf(ANA, BEN), { challenger: "Ana", challenged: "Ben" }, URL_OF);
    expect(share.text).toBe(["CodeGuessr duel · Which language? · Ben wins by 500 points", "Ben 🟩🟩🟨⬛🟩 3,800/5,000",
      "Ana 🟨⬛🟩🟩🟨 3,300/5,000", URL_OF].join("\n"));
    expect(share.message).toBe(share.text.slice(0, -URL_OF.length - 1));
  });
});

describe("a duel's views (#173)", () => {
  it("shows the challenger's rounds only up to the friend's last lock, and says the rest wait, without a live region", () => {
    const html = renderToStaticMarkup(createElement(OpponentStrip, { name: "Ana", rounds: ANA, answered: 2 }));
    expect(html).toContain('aria-label="Ana’s rounds"');
    expect(html).not.toMatch(/aria-live|role="status"|role="alert"/u);
    expect([...html.matchAll(/<span aria-hidden="true">([^<]*)<\/span><span class="visually-hidden">([^<]*)<\/span>/gu)].map(([, mark, words]) => [mark, words]))
      .toEqual([["1 ✓", "Round 1: right, 1 hint, +800 points"], ["2 ✗", "Round 2: missed, no hints, 0 points"],
        ["?", "Round 3, shown after you answer"], ["?", "Round 4, shown after you answer"], ["?", "Round 5, shown after you answer"]]);
    expect(html).not.toContain("1,000");
  });

  it("compares both games in a captioned table with row headers and each mark in words", () => {
    const html = renderToStaticMarkup(createElement(DuelComparisonTable, { comparison: comparisonOf(ANA, BEN, 2), names: { challenger: "Ana", challenged: null }, level: 3 }));
    expect(html).toContain('<h3 id="duel-verdict">You win by 500 points</h3>');
    expect(html).toContain("<caption>Both games, round by round</caption>");
    expect(html).toContain('<th scope="col"><bdi>You</bdi></th><th scope="col"><bdi>Ana</bdi></th>');
    expect(html.match(/<th scope="row">/gu)).toHaveLength(6);
    expect(html).toContain('<td class="duel-missed"><span aria-hidden="true">✗ </span>0<span class="visually-hidden">, missed</span></td>');
    expect(html).toContain('<td><span aria-hidden="true">✓ </span>800<span class="visually-hidden">, right</span><span class="summary-hints"> (1 hint)</span></td>');
    expect(html).toContain("<td>3,800<span class=\"summary-hints\"> (4 right, 3 hints)</span></td>");
    expect(html).toContain("First try for Ana");
    expect(html).toContain("Your 2nd play of this link");
  });

  it("renders the challenger's name only in the browser, which alone reads the fragment", () => {
    const intro = renderToStaticMarkup(createElement(ChallengeIntro, { deck: "Which language?", total: "4/5 right · 3,300 of 5,000", firstPlay: "no",
      playHref: "/?duel=AbC&play=1", chooseAnotherDeckHref: "/" }));
    expect(intro).toContain("<bdi>A friend</bdi> challenges you");
    expect(intro).toContain("A friend had played these rounds before");
    expect(intro).toContain('href="/?duel=AbC&amp;play=1"');
    expect(intro).not.toMatch(GRID);
    const result = renderToStaticMarkup(createElement(DuelResult, { comparison: comparisonOf(ANA, BEN), dealHref: null, chooseAnotherDeckHref: "/" }));
    expect(result).toContain("<bdi>Friend</bdi> vs <bdi>Challenger</bdi>");
    expect(result).toContain("Friend wins by 500 points");
    expect(result).not.toContain("Deal new rounds");
  });
});

// The share lines of real games: dealt, played, challenged, answered, and compared by the server.
const ARTIFACT_PATH = fileURLToPath(new URL("../src/demo/generated/local-real-rounds.json", import.meta.url));
interface Fixture { roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string }
const fixtures = new Map((JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as { decks: { fixtures: Fixture[] }[] })
  .decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures.map((fixture) => [fixture.roundId, fixture] as const)));

describe("real duels' share lines (#173)", () => {
  beforeEach(() => vi.stubEnv("CODEGUESSR_SESSION_SECRET", "f".repeat(32)));
  afterEach(() => vi.unstubAllEnvs());

  it("name no option, answer, or round of the game in any deck", async () => {
    const { loadLocalRealExperiment } = await import("../src/demo/local-real-experiment-loader.server");
    const loaded = loadLocalRealExperiment({ artifactPath: ARTIFACT_PATH });
    if (!loaded.ok) throw new Error("committed artifact unavailable");
    const { experiment } = loaded;
    const play = (game: { mode: { rounds: readonly { roundId: string }[] }; sessionToken: string }, right: (index: number) => boolean) =>
      game.mode.rounds.reduce((token, { roundId }, index) => {
        const fixture = fixtures.get(roundId)!;
        const answered = experiment.answer({ sessionToken: token, roundId,
          candidateId: right(index) ? fixture.correctCandidateId : fixture.candidates.find(({ id }) => id !== fixture.correctCandidateId)!.id });
        if (!answered.ok) throw new Error(answered.reason);
        return answered.sessionToken;
      }, game.sessionToken);
    for (const deck of [...experiment.decks.map(({ id }) => id), "mixed"]) {
      const dealt = experiment.dealGame(deck as never, Math.random, Date.now(), { arms: { design: "off", theme: "terminal", layer: "off" }, record: false },
        { seed: "0badcafe", game: 0 });
      const created = experiment.createChallenge(play(dealt, (index) => index !== 1));
      if (!created.ok) throw new Error(created.reason);
      const friend = experiment.dealChallenge(created.challengeToken);
      if (!friend.ok) throw new Error(friend.reason);
      const issued = experiment.issueResult(play(friend.game, (index) => index !== 3), created.challengeToken);
      if (!issued.ok) throw new Error(issued.reason);
      const texts = [challengeShare(created.challenge, "Ana", URL_OF).text,
        resultShare(issued.comparison, { challenger: "Ana", challenged: "Ben" }, URL_OF).text];
      // Each line is its fixed words, the deck's title, the names, totals, and marks: there is no room for an option.
      const title = created.challenge.deckTitle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const link = URL_OF.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      expect(texts[0], deck).toMatch(new RegExp(`^CodeGuessr duel · ${title} · Ana scored [\\d,]+/[\\d,]+\\. Can you beat it\\?\\n${link}$`, "u"));
      expect(texts[1], deck).toMatch(new RegExp(`^CodeGuessr duel · ${title} · (?:(?:Ana|Ben) wins(?: by [\\d,]+ points)?|A draw)\\n`
        + `Ben [🟩🟨⬛]{5} [\\d,]+/[\\d,]+\\nAna [🟩🟨⬛]{5} [\\d,]+/[\\d,]+\\n${link}$`, "u"));
      for (const { roundId } of dealt.mode.rounds) {
        for (const text of texts) expect(text, deck).not.toContain(roundId);
        for (const { id } of fixtures.get(roundId)!.candidates) for (const text of texts) expect(text, deck).not.toContain(id);
      }
      expect(texts[0], deck).not.toMatch(GRID);
    }
  });
});
