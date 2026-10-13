/**
 * Records the local CodeGuessr game at a phone viewport and encodes one short
 * captioned GIF per deck, a full-run GIF, and one MP4 into docs/media.
 * Run with `pnpm demo:record` after a verified preparation run.
 *
 * Set DEMO_BASE_URL to record an already running server; otherwise a Next dev
 * server is started on 127.0.0.1:3100 for the duration of the run.
 * Set DEMO_SCENES to a comma-separated list of scene ids to record a subset.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Page } from "@playwright/test";

import { DEFAULT_GIF_OPTIONS, gifArguments, mp4Arguments } from "./encode";
import { setCaption } from "./overlay";
import { SCENES, type Scene, type Step } from "./scenes";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const GAME_DIRECTORY = join(ROOT, "apps", "game");
const MEDIA_DIRECTORY = join(ROOT, "docs", "media");
const WORK_DIRECTORY = join(MEDIA_DIRECTORY, ".work");
const LOCAL_PORT = 3100;
const VIEWPORT = Object.freeze({ width: 390, height: 844 });
const DEVICE_SCALE_FACTOR = 2;
const SERVER_TIMEOUT_MILLISECONDS = 180_000;
const STEP_TIMEOUT_MILLISECONDS = 20_000;
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

const log = (message: string): void => { process.stdout.write(`${message}\n`); };

const run = (command: string, args: readonly string[], cwd = ROOT): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(command, [...args], { cwd, stdio: ["ignore", "inherit", "inherit"] });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? "signal"}`)));
});

const waitForServer = async (baseUrl: string): Promise<void> => {
  const deadline = Date.now() + SERVER_TIMEOUT_MILLISECONDS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.ok) return;
    } catch {
      // The server is still starting.
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

const performStep = async (page: Page, baseUrl: string, step: Step): Promise<void> => {
  switch (step.kind) {
    case "goto":
      await page.goto(`${baseUrl}${step.path}`, { waitUntil: "networkidle" });
      return;
    case "caption":
      await setCaption(page, step.text);
      return;
    case "click":
      await page.getByRole("button", { name: step.name, exact: true }).click({ timeout: STEP_TIMEOUT_MILLISECONDS });
      return;
    case "link":
      await page.getByRole("link", { name: step.name }).first().click({ timeout: STEP_TIMEOUT_MILLISECONDS });
      await page.waitForLoadState("networkidle");
      return;
    case "choose":
      await page.getByRole("group", { name: "Choose one answer" }).getByRole("radio").nth(step.index)
        .check({ timeout: STEP_TIMEOUT_MILLISECONDS });
      return;
    case "expectText":
      await page.getByText(new RegExp(step.pattern, "u")).first().waitFor({ state: "visible", timeout: STEP_TIMEOUT_MILLISECONDS });
      return;
    case "expectHeading":
      await page.getByRole("heading", { name: new RegExp(step.pattern, "u") }).waitFor({ state: "visible", timeout: STEP_TIMEOUT_MILLISECONDS });
      return;
    case "scrollTo":
      await smoothScroll(page, step.selector);
      return;
    case "wait":
      await page.waitForTimeout(step.milliseconds);
      return;
  }
};

const megabytes = async (path: string): Promise<string> => `${((await stat(path)).size / 1_048_576).toFixed(2)} MB`;

const recordScene = async (scene: Scene, baseUrl: string): Promise<void> => {
  log(`recording ${scene.id}`);
  const browser = await chromium.launch();
  let videoPath: string | undefined;
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      colorScheme: "dark",
      reducedMotion: "no-preference",
      // The screencast is captured at viewport (CSS pixel) size; a larger size only adds padding.
      recordVideo: { dir: WORK_DIRECTORY, size: VIEWPORT },
    });
    const page = await context.newPage();
    for (const step of scene.steps) await performStep(page, baseUrl, step);
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
    for (const scene of selectedScenes()) await recordScene(scene, baseUrl);
    log("done");
  } finally {
    server?.stop();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
