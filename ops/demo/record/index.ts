/**
 * Records the local CodeGuessr game at a phone viewport and encodes the vertical
 * demo, one short captioned GIF per deck, a duel GIF, a full-run GIF, and one
 * MP4 into docs/media.
 * Run with `pnpm demo:record` after a verified preparation run.
 *
 * Set DEMO_BASE_URL to record an already running server in lab mode
 * (EXPERIMENT_LAB=1), since scenes pick their theme and question layer by query;
 * otherwise a Next dev server is started on 127.0.0.1:3100 (or DEMO_PORT) for the
 * duration of the run. The recorder only records a server that serves CodeGuessr.
 * Set DEMO_SCENES to a comma-separated list of scene ids to record a subset.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "@playwright/test";

import { DEFAULT_GIF_OPTIONS, gifArguments, mp4Arguments } from "./encode";
import { hideLocalTooling, setCaption, type CaptionStyle } from "./overlay";
import { SCENES, type Scene, type Step } from "./scenes";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const GAME_DIRECTORY = join(ROOT, "apps", "game");
const MEDIA_DIRECTORY = join(ROOT, "docs", "media");
const WORK_DIRECTORY = join(MEDIA_DIRECTORY, ".work");
const LOCAL_PORT = Number(process.env.DEMO_PORT ?? 3100);
const VIEWPORT = Object.freeze({ width: 390, height: 844 });
const DEVICE_SCALE_FACTOR = 2;
const SERVER_TIMEOUT_MILLISECONDS = 180_000;
const STEP_TIMEOUT_MILLISECONDS = 20_000;
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const ARTIFACT = join(ROOT, "apps", "game", "src", "demo", "generated", "local-real-rounds.json");

interface ArtifactFixture { roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string }
/** A round's right answer, and the first option the artifact lists that isn't it. */
interface RoundAnswers { readonly right: string; readonly wrong: string }
/** Each round's answers, read on the Node side from the artifact the game plays, as the browser tests do. */
const loadAnswers = (): ReadonlyMap<string, RoundAnswers> => {
  const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8")) as { decks: { fixtures: ArtifactFixture[] }[] };
  return new Map(artifact.decks.flatMap(({ fixtures }) => fixtures.map(({ roundId, candidates, correctCandidateId }) => [roundId, {
    right: candidates.find(({ id }) => id === correctCandidateId)!.label,
    wrong: candidates.find(({ id }) => id !== correctCandidateId)!.label,
  }] as const)));
};

/** What a step needs besides the page: the server, the scene's caption style, the answers, and its challenge link. */
interface StepContext {
  readonly baseUrl: string;
  readonly captionStyle: CaptionStyle;
  readonly answers: ReadonlyMap<string, RoundAnswers>;
  readonly challengeLink?: string;
}

const log = (message: string): void => { process.stdout.write(`${message}\n`); };

const run = (command: string, args: readonly string[], cwd = ROOT): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(command, [...args], { cwd, stdio: ["ignore", "inherit", "inherit"] });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? "signal"}`)));
});

/** Another local app may already hold the port; recording it would publish the wrong thing. */
const GAME_MARKER = "CodeGuessr";

const waitForServer = async (baseUrl: string): Promise<void> => {
  const deadline = Date.now() + SERVER_TIMEOUT_MILLISECONDS;
  while (Date.now() < deadline) {
    let body: string | undefined;
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.ok) body = await response.text();
    } catch {
      // The server is still starting.
    }
    if (body !== undefined) {
      if (body.includes(GAME_MARKER)) return;
      throw new Error(`${baseUrl} serves something other than CodeGuessr; set DEMO_PORT to a free port or DEMO_BASE_URL to the game`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no server answered at ${baseUrl} within ${SERVER_TIMEOUT_MILLISECONDS / 1000}s`);
};

const startLocalServer = (): Readonly<{ baseUrl: string; stop: () => void }> => {
  const nextBinary = join(GAME_DIRECTORY, "node_modules", "next", "dist", "bin", "next");
  const child: ChildProcess = spawn(process.execPath, [nextBinary, "dev", "--hostname", "127.0.0.1", "--port", String(LOCAL_PORT)], {
    cwd: GAME_DIRECTORY,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${LOCAL_PORT}`,
    stop: () => { if (child.exitCode === null) child.kill("SIGTERM"); },
  });
};

const smoothScroll = async (page: Page, selector: string): Promise<void> => {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: STEP_TIMEOUT_MILLISECONDS });
  await page.locator(selector).first().evaluate((element) => {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await page.waitForTimeout(650);
};

const performStep = async (page: Page, context: StepContext, step: Step): Promise<void> => {
  switch (step.kind) {
    case "goto": {
      await page.goto(`${context.baseUrl}${step.path}`, { waitUntil: "networkidle" });
      // A theme is a lab pick; a server outside lab mode draws its own, and the scene's captions would not match.
      const theme = new URLSearchParams(step.path.slice(step.path.indexOf("?") + 1)).get("theme");
      const shown = await page.locator(".demo-page").getAttribute("data-theme", { timeout: STEP_TIMEOUT_MILLISECONDS });
      if (theme !== null && step.path.includes("deck=") && shown !== theme) {
        throw new Error(`${step.path} shows the ${shown ?? "default"} theme; record a server in lab mode (next dev, or EXPERIMENT_LAB=1)`);
      }
      return;
    }
    case "answer":
    case "miss": {
      const roundId = await page.locator(".game-card").getAttribute("data-round-id", { timeout: STEP_TIMEOUT_MILLISECONDS });
      const answers = roundId === null ? undefined : context.answers.get(roundId);
      if (answers === undefined) throw new Error("the current round is not in the artifact");
      await page.getByRole("group", { name: "Choose one answer" }).getByLabel(step.kind === "answer" ? answers.right : answers.wrong, { exact: true })
        .check({ timeout: STEP_TIMEOUT_MILLISECONDS });
      return;
    }
    case "openChallenge":
      if (context.challengeLink === undefined) throw new Error("the scene opens a challenge it has none of");
      await page.goto(context.challengeLink, { waitUntil: "networkidle" });
      return;
    case "caption":
      await setCaption(page, step.text, context.captionStyle);
      return;
    case "click":
      await page.getByRole("button", { name: step.name, exact: true }).click({ timeout: STEP_TIMEOUT_MILLISECONDS });
      return;
    case "link":
      await page.getByRole("link", { name: step.name }).first().click({ timeout: STEP_TIMEOUT_MILLISECONDS });
      await page.waitForLoadState("networkidle");
      return;
    case "choose": {
      // A mixed game deals before-or-after rounds too, which offer two answers.
      const radios = page.getByRole("group", { name: "Choose one answer" }).getByRole("radio");
      await radios.first().waitFor({ state: "visible", timeout: STEP_TIMEOUT_MILLISECONDS });
      await radios.nth(Math.min(step.index, await radios.count() - 1)).check({ timeout: STEP_TIMEOUT_MILLISECONDS });
      return;
    }
    case "expectText":
      await page.getByText(new RegExp(step.pattern, "u")).first().waitFor({ state: "visible", timeout: STEP_TIMEOUT_MILLISECONDS });
      return;
    case "expectHeading":
      await page.getByRole("heading", { name: new RegExp(step.pattern, "u") }).waitFor({ state: "visible", timeout: STEP_TIMEOUT_MILLISECONDS });
      return;
    case "scrollTo":
      await smoothScroll(page, step.selector);
      return;
    case "jumpTo":
      await page.locator(step.selector).first().waitFor({ state: "visible", timeout: STEP_TIMEOUT_MILLISECONDS });
      await page.locator(step.selector).first().evaluate((element, block) => {
        element.scrollIntoView({ behavior: "instant", block });
      }, step.block);
      return;
    case "wait":
      await page.waitForTimeout(step.milliseconds);
      return;
  }
};

/**
 * A duel's challenger (#173), off camera: plays the scene's challenge game in a browser context of its own, which
 * records no video, then makes it a challenge under the challenge's name and returns the link it copied. The context
 * has a clipboard and no share sheet, so the link is copied, as in the browser tests.
 */
const playChallenge = async (browser: Browser, context: StepContext, challenge: NonNullable<Scene["challenge"]>): Promise<string> => {
  const challenger = await browser.newContext({ viewport: VIEWPORT });
  try {
    await challenger.grantPermissions(["clipboard-read", "clipboard-write"]);
    await challenger.addInitScript(() => { delete (Navigator.prototype as { share?: unknown }).share; });
    const page = await challenger.newPage();
    for (const step of challenge.steps) await performStep(page, context, step);
    await page.getByRole("button", { name: "Challenge a friend", exact: true }).click({ timeout: STEP_TIMEOUT_MILLISECONDS });
    await page.getByLabel("Your name (stays in the link)").fill(challenge.name, { timeout: STEP_TIMEOUT_MILLISECONDS });
    await page.getByRole("button", { name: "Copy challenge link", exact: true }).click({ timeout: STEP_TIMEOUT_MILLISECONDS });
    await page.locator(".duel-share .share-status").getByText("Challenge link copied").waitFor({ timeout: STEP_TIMEOUT_MILLISECONDS });
    // The share line ends with the link.
    const link = (await page.evaluate(() => navigator.clipboard.readText())).split("\n").at(-1) ?? "";
    if (!link.startsWith(`${context.baseUrl}/?duel=`)) throw new Error("the challenge copied no link to this server");
    return link;
  } finally {
    await challenger.close();
  }
};

const megabytes = async (path: string): Promise<string> => `${((await stat(path)).size / 1_048_576).toFixed(2)} MB`;

const recordScene = async (scene: Scene, baseUrl: string, answers: ReadonlyMap<string, RoundAnswers>): Promise<void> => {
  log(`recording ${scene.id}`);
  const browser = await chromium.launch();
  const viewport = scene.viewport ?? VIEWPORT;
  const sceneContext: StepContext = { baseUrl, captionStyle: scene.captionStyle ?? "banner", answers };
  let videoPath: string | undefined;
  try {
    // The challenger plays before the recording starts, so the clip opens on the friend's intro.
    const stepContext: StepContext = scene.challenge === undefined
      ? sceneContext
      : { ...sceneContext, challengeLink: await playChallenge(browser, sceneContext, scene.challenge) };
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      colorScheme: "dark",
      reducedMotion: scene.reducedMotion ?? "no-preference",
      // The screencast is captured at viewport (CSS pixel) size; a larger size only adds padding.
      recordVideo: { dir: WORK_DIRECTORY, size: viewport },
    });
    await hideLocalTooling(context);
    const page = await context.newPage();
    for (const step of scene.steps) await performStep(page, stepContext, step);
    const video = page.video();
    await context.close();
    videoPath = await video?.path();
  } finally {
    await browser.close();
  }
  if (!videoPath) throw new Error(`${scene.id} produced no screencast`);

  const screencast = join(WORK_DIRECTORY, `${scene.id}.webm`);
  await rename(videoPath, screencast);
  const gif = join(MEDIA_DIRECTORY, `${scene.id}.gif`);
  await run(FFMPEG, gifArguments(screencast, gif, { ...DEFAULT_GIF_OPTIONS, ...scene.gif }));
  log(`  ${gif} (${await megabytes(gif)})`);
  if (scene.mp4) {
    const mp4 = join(MEDIA_DIRECTORY, `${scene.mp4}.mp4`);
    await run(FFMPEG, mp4Arguments(screencast, mp4));
    log(`  ${mp4} (${await megabytes(mp4)})`);
  }
};

const selectedScenes = (): readonly Scene[] => {
  const filter = process.env.DEMO_SCENES?.split(",").map((value) => value.trim()).filter(Boolean);
  if (!filter || filter.length === 0) return SCENES;
  const unknown = filter.filter((id) => !SCENES.some((scene) => scene.id === id));
  if (unknown.length > 0) throw new Error(`unknown DEMO_SCENES: ${unknown.join(", ")}`);
  return SCENES.filter((scene) => filter.includes(scene.id));
};

const main = async (): Promise<void> => {
  await mkdir(WORK_DIRECTORY, { recursive: true });
  const external = process.env.DEMO_BASE_URL;
  const server = external ? undefined : startLocalServer();
  const baseUrl = (external ?? server?.baseUrl ?? "").replace(/\/$/u, "");
  try {
    log(`waiting for ${baseUrl}`);
    await waitForServer(baseUrl);
    const answers = loadAnswers();
    for (const scene of selectedScenes()) await recordScene(scene, baseUrl, answers);
    log("done");
  } finally {
    server?.stop();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
