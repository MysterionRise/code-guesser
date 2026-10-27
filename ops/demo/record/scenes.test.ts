import {
  CHALLENGER_PLAN, DAILY_CARD, DEAL_SEEDS, DECKS, DEFAULT_ANSWER_CHOREOGRAPHY, DEMO_SCENE, DUEL_DEAL, DUEL_SCENE, FRIEND_PLAN, SCENES,
  parseAnswerChoreography,
} from "./scenes";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

describe("demo recorder scenes", () => {
  it("defaults the full run to four right answers and a miss, and parses a five-index override", () => {
    expect(parseAnswerChoreography(undefined)).toBe(DEFAULT_ANSWER_CHOREOGRAPHY);
    expect(parseAnswerChoreography("  ")).toBe(DEFAULT_ANSWER_CHOREOGRAPHY);
    expect([...DEFAULT_ANSWER_CHOREOGRAPHY].sort()).toEqual(["miss", "right", "right", "right", "right"]);
    expect(parseAnswerChoreography("0, 1,1,0,1")).toEqual([0, 1, 1, 0, 1]);
    for (const bad of ["0,1", "0,1,1,0,4", "a,b,c,d,e", "0,1,1,0,-1"]) {
      expect(() => parseAnswerChoreography(bad)).toThrow(RangeError);
    }
  });

  it("records one scene per deck, each at its fixed deal with the static design, plus a duel and a full run with the MP4", () => {
    expect(SCENES.map(({ id }) => id)).toEqual(["demo", ...DECKS.map((deck) => `deck-${deck}`), "duel", "full-run"]);
    expect(SCENES.filter(({ mp4 }) => mp4).map(({ id, mp4 }) => `${id}:${mp4}`)).toEqual(["full-run:codeguessr-demo"]);
    for (const deck of DECKS) {
      const scene = SCENES.find(({ id }) => id === `deck-${deck}`)!;
      expect(scene.steps[0]).toMatchObject({ kind: "goto" });
      const query = new URLSearchParams((scene.steps[0] as { path: string }).path.slice(2));
      expect(Object.fromEntries(query)).toMatchObject({ deck, deal: DEAL_SEEDS[deck], game: "0", design: "off" });
      expect(DEAL_SEEDS[deck]).toMatch(/^[0-9a-f]{8}$/u);
    }
  });

  it("shows the question layers in the two decks that have them, and steps through an algorithm's trace", () => {
    for (const deck of ["algorithm", "language"]) {
      const path = (SCENES.find(({ id }) => id === `deck-${deck}`)!.steps[0] as { path: string }).path;
      expect(path).toContain("layer=on");
    }
    const algorithm = SCENES.find(({ id }) => id === "deck-algorithm")!.steps;
    expect(algorithm).toContainEqual({ kind: "click", name: "Reveal hint 2" });
    expect(algorithm).toContainEqual({ kind: "scrollTo", selector: ".trace-stepper" });
  });

  it("starts the full run at the chooser, plays today's five, and ends on the chooser with its day streak", () => {
    const steps = SCENES.find(({ id }) => id === "full-run")!.steps;
    expect(steps[0]).toMatchObject({ kind: "goto", path: expect.stringMatching(/^\/\?design=off&/u) });
    expect(steps).toContainEqual({ kind: "link", name: DAILY_CARD });
    const last = steps.filter(({ kind }) => kind === "link").at(-1);
    expect(last).toEqual({ kind: "link", name: "Choose another deck" });
    expect(steps.filter((step) => step.kind === "click" && step.name === "Lock in answer")).toHaveLength(5);
    expect(steps).toContainEqual({ kind: "scrollTo", selector: ".duel-challenge" });
    expect(steps).toContainEqual({ kind: "expectText", pattern: "^Day streak 1$" });
  });

  it("locks in the right answer in every deck clip but one, which misses", () => {
    const picks = DECKS.map((deck) => SCENES.find(({ id }) => id === `deck-${deck}`)!.steps
      .filter(({ kind }) => kind === "answer" || kind === "miss" || kind === "choose").map(({ kind }) => kind));
    for (const deckPicks of picks) expect(deckPicks).toHaveLength(1);
    expect(picks.flat().filter((kind) => kind === "miss")).toHaveLength(1);
    expect(picks.flat().filter((kind) => kind === "answer")).toHaveLength(DECKS.length - 1);
  });

  it("plays a duel: the challenger off camera on its own deal, the friend on camera to the comparison", () => {
    expect(DUEL_SCENE.challenge?.name).toBe("Ana");
    const [open] = DUEL_SCENE.challenge!.steps;
    expect(open).toMatchObject({ kind: "goto" });
    const query = Object.fromEntries(new URLSearchParams((open as { path: string }).path.slice(2)));
    expect(query).toMatchObject({ deck: DUEL_DEAL.deck, deal: DUEL_DEAL.seed, game: "0", design: "off", layer: "on" });
    // A seed no deck clip deals, so the challenge is the challenger's first try of it.
    expect(Object.values(DEAL_SEEDS)).not.toContain(DUEL_DEAL.seed);
    const locks = (steps: readonly { kind: string; name?: string }[]) => steps.filter((step) => step.kind === "click" && step.name === "Lock in answer");
    expect(locks(DUEL_SCENE.challenge!.steps)).toHaveLength(5);
    expect(DUEL_SCENE.steps[0]).toEqual({ kind: "openChallenge" });
    expect(DUEL_SCENE.steps).toContainEqual({ kind: "link", name: "Play the same five" });
    expect(locks(DUEL_SCENE.steps)).toHaveLength(5);
    // Each side's score as the game scores it: 1,000 a round, 800 after one hint, nothing for a miss.
    const score = (plan: typeof FRIEND_PLAN) => plan.reduce((total, { hints, pick }) => total + (pick === "miss" ? 0 : [1_000, 800, 500][hints]!), 0);
    expect(score(FRIEND_PLAN) - score(CHALLENGER_PLAN)).toBe(200);
    expect(DUEL_SCENE.steps).toContainEqual({ kind: "expectHeading", pattern: "^You win by 200 points$" });
    expect(DUEL_SCENE.steps.filter(({ kind }) => kind === "answer" || kind === "miss")).toHaveLength(5);
  });

  it("captions the before-or-after deck with where its answers come from", () => {
    const captions = SCENES.find(({ id }) => id === "deck-before-after")!.steps
      .flatMap((step) => step.kind === "caption" ? [step.text] : []);
    expect(captions.some((text) => /commit/iu.test(text))).toBe(true);
    expect(captions.join(" ")).not.toMatch(/human[- ]written|detect|AI-generated/iu);
  });

  it("records the headline demo vertically, through seven decks in three themes and both question layers, answering each round right", () => {
    expect(DEMO_SCENE.viewport).toEqual({ width: 360, height: 640 });
    expect(DEMO_SCENE.viewport!.height / DEMO_SCENE.viewport!.width).toBeCloseTo(16 / 9, 2);
    expect(DEMO_SCENE.captionStyle).toBe("sticker");
    const games = DEMO_SCENE.steps.flatMap((step: any) => step.kind === "goto" && step.path.includes("deck=")
      ? [Object.fromEntries(new URLSearchParams(step.path.slice(2)))] : []);
    expect(new Set(games.map(({ deck }) => deck)).size).toBe(7);
    expect(games.filter(({ layer }) => layer === "on").map(({ deck }) => deck).sort()).toEqual(["algorithm", "language"]);
    expect(new Set(games.map(({ theme }) => theme)).size).toBeGreaterThanOrEqual(3);
    for (const game of games) expect(game).toMatchObject({ deal: DEAL_SEEDS[game.deck as keyof typeof DEAL_SEEDS], design: "off" });
    const answers = DEMO_SCENE.steps.filter((step: any) => step.kind === "answer");
    const verdicts = DEMO_SCENE.steps.filter((step: any) => step.kind === "expectHeading" && step.pattern === "^Nice read\\.$");
    expect(answers).toHaveLength(7);
    expect(verdicts).toHaveLength(7);
    expect(DEMO_SCENE.steps.some((step: any) => step.kind === "choose")).toBe(false);
    // No caption may name an answer, only the deck and the points.
    const captions = DEMO_SCENE.steps.flatMap((step: any) => step.kind === "caption" ? [step.text] : []);
    expect(captions.join(" ")).not.toMatch(/search|svelte|react|python|java|rust|go\b|prolog|line \d|order|raindrop|collatz|getmin|pop\b/iu);
  });
});
