import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DECK_IDS, canonicalHash, serializeCanonical, type DeckId } from "../../../packages/artifact/src/index";
import { QuestionsError, openRouterClient, type JournalMode } from "./client";
import { prepareQuestions } from "./prepare";

/**
 * `pnpm prepare:questions [--offline | --fresh] [--decks=algorithm,language] [--limit=N] [--model=id]` (#127).
 *
 * - The key comes from `OPENROUTER_API_KEY` (its standard store is `~/.config/openrouter/key`), the model from
 *   `--model`, `OPENROUTER_MODEL`, or Claude Haiku 5.5.
 * - Model answers are journaled in `ops/poc/questions/tmp/journal.jsonl` (ignored): a rerun replays them, `--offline`
 *   only replays, and `--fresh` asks again.
 * - A full run writes the layers file and its pin; a `--limit` pilot writes only the report.
 */
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const ARTIFACT_PATH = here("../../../apps/game/src/demo/generated/local-real-rounds.json");
const ARTIFACT_PIN_PATH = here("../../../apps/game/src/demo/local-real-experiment.pin.server.ts");
export const LAYERS_PATH = here("../../../apps/game/src/demo/generated/question-layers.json");
export const LAYERS_PIN_PATH = here("../../../apps/game/src/demo/question-layers.pin.server.ts");
const JOURNAL_PATH = here("./tmp/journal.jsonl");
const REPORT_PATH = here("./tmp/report.json");
const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export interface QuestionsArguments {
  readonly mode: JournalMode;
  readonly decks?: readonly DeckId[];
  readonly limit?: number;
  readonly model?: string;
}

/** The command's flags, or undefined for anything else; a value is never echoed back. */
export const parseQuestionsArguments = (argv: readonly string[]): QuestionsArguments | undefined => {
  let mode: JournalMode = "resume";
  let decks: DeckId[] | undefined;
  let limit: number | undefined;
  let model: string | undefined;
  for (const argument of argv) {
    if (argument === "--offline" || argument === "--fresh") {
      if (mode !== "resume") return undefined;
      mode = argument === "--offline" ? "offline" : "fresh";
    } else if (argument.startsWith("--decks=")) {
      decks = argument.slice("--decks=".length).split(",") as DeckId[];
      if (decks.length === 0 || decks.some((deck) => !(DECK_IDS as readonly string[]).includes(deck))) return undefined;
    } else if (argument.startsWith("--limit=")) {
      limit = Number(argument.slice("--limit=".length));
      if (!Number.isSafeInteger(limit) || limit < 1) return undefined;
    } else if (argument.startsWith("--model=")) {
      model = argument.slice("--model=".length);
      if (!/^[a-z0-9-]+\/[a-z0-9.:-]+$/u.test(model)) return undefined;
    } else return undefined;
  }
  return Object.freeze({ mode, ...(decks ? { decks } : {}), ...(limit ? { limit } : {}), ...(model ? { model } : {}) });
};

export const QUESTIONS_USAGE = "usage: pnpm prepare:questions [--offline | --fresh] [--decks=algorithm,language] [--limit=N] [--model=id]";

const writeAtomically = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, content, "utf8");
  renameSync(`${path}.tmp`, path);
};

export const pinSource = (hash: string): string => `import "server-only";

/**
 * The trusted question-layers hash: the SHA-256 of the canonical layers file \`pnpm prepare:questions\` last wrote
 * and checked (#127). The game shows layers only when the file matches it and was written for the pinned artifact.
 */
export const TRUSTED_QUESTION_LAYERS_HASH = "${hash}";
`;

export const runQuestionsCli = async (argv = process.argv.slice(2), log: (line: string) => void = console.info): Promise<void> => {
  const args = parseQuestionsArguments(argv);
  if (args === undefined) {
    log("COMMAND_ARGUMENTS_REJECTED");
    log(QUESTIONS_USAGE);
    throw new QuestionsError("COMMAND_ARGUMENTS_REJECTED");
  }
  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as unknown;
  const pinned = /"([0-9a-f]{64})"/u.exec(readFileSync(ARTIFACT_PIN_PATH, "utf8"))?.[1];
  if (canonicalHash(artifact) !== pinned) throw new QuestionsError("ARTIFACT_PIN_MISMATCH");
  const client = openRouterClient({
    model: args.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL,
    journalPath: JOURNAL_PATH,
    mode: args.mode,
  });
  try {
    const prepared = await prepareQuestions({ artifact, client, log, ...(args.decks ? { decks: args.decks } : {}), ...(args.limit ? { limit: args.limit } : {}) });
    writeAtomically(REPORT_PATH, `${JSON.stringify({ model: client.model, decks: prepared.decks, calls: client.counts() }, null, 2)}\n`);
    if (args.limit === undefined) {
      writeAtomically(LAYERS_PATH, serializeCanonical(prepared.file));
      writeAtomically(LAYERS_PIN_PATH, pinSource(canonicalHash(prepared.file)));
      log(`QUESTIONS_PUBLISHED layers=${prepared.file.layers.length}`);
    } else log("QUESTIONS_PILOT report only");
  } finally {
    const counts = client.counts();
    log(`QUESTIONS_CALLS replayed=${counts.replayed} live=${counts.live} in=${counts.tokensIn} out=${counts.tokensOut}`);
  }
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runQuestionsCli().catch((error: unknown) => {
    console.error(`QUESTIONS_FAILED ${error instanceof QuestionsError ? error.code : "UNCODED"}`);
    process.exitCode = 1;
  });
}
