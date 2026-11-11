/**
 * `pnpm play`: serves the game on this machine for play and testing, with generative UI on when a key is at hand.
 *
 *   pnpm play [--provider=anthropic|openrouter|off] [--port=<1024-65535>]
 *
 * - It runs the game's own `dev` script, so the server listens on 127.0.0.1 only and is in lab mode (`?design=`,
 *   `?theme=`, and `?layer=` pick a game's arms).
 * - Generative UI goes through Anthropic's own API when an Anthropic key is in the environment or in its standard
 *   store (`~/.config/anthropic/key`, mode 0600), else through OpenRouter's OpenAI-compatible endpoint with its key
 *   (`~/.config/openrouter/key`), else it is off and the game plays its static reveal. `--provider` names one.
 * - Model settings pass through as they are set: `ANTHROPIC_MODEL_HOST=claude-sonnet-5-5 pnpm play`.
 * - It prints the address and the provider, never a key. Spend limits live on the key itself.
 */
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";

import { firstFreePort, parsePlayArguments, planPlay, PLAY_USAGE } from "./play";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HOST = "127.0.0.1";
const PROBE_MILLISECONDS = 500;

function fail(code: string, usage = false): never {
  process.stderr.write(usage ? `${code}\n${PLAY_USAGE}\n` : `${code}\n`);
  process.exit(1);
}

/** Whether something already answers on this port of the loopback address. */
const taken = (port: number): Promise<boolean> => new Promise((resolve) => {
  const socket = connect({ host: HOST, port });
  const done = (answer: boolean): void => { socket.destroy(); resolve(answer); };
  socket.setTimeout(PROBE_MILLISECONDS, () => done(true));
  socket.once("connect", () => done(true));
  socket.once("error", () => done(false));
});

const main = async (): Promise<void> => {
  const options = parsePlayArguments(process.argv.slice(2)) ?? fail("PLAY_ARGUMENTS", true);
  const plan = planPlay(options, process.env);
  if ("refused" in plan) fail(plan.refused);
  const port = options.port ?? await firstFreePort(taken) ?? fail("PLAY_NO_FREE_PORT");

  process.stdout.write(plan.provider === "off" ? "PLAY_GENUI off\n" : `PLAY_GENUI ${plan.provider} key=${plan.keyFrom}\n`);
  process.stdout.write(`PLAY_SERVER http://${HOST}:${port}\n`);
  const child = spawn("pnpm", ["--filter", "@codeguessr/game", "dev", "--port", String(port)],
    { cwd: ROOT, env: plan.environment, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { child.kill(signal); });
  child.once("error", () => fail("PLAY_START_FAILED"));
  child.once("exit", (code, signal) => { process.exit(code ?? (signal === null ? 1 : 130)); });
};

// No detail of an unexpected failure is printed: it could hold the environment the server was to get.
main().catch(() => fail("PLAY_FAILED"));
