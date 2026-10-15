import { activeLocalRealExperiment } from "../../../demo/local-real-experiment-loader.server";
import { readyDesign } from "../../../genui/designs";
import { playerTurns, streamRound } from "../../../genui/model.server";

/**
 * Generative UI's one network path (#101): off unless `GENUI_ENABLED=1`, and every request needs the live
 * session token of a game this server dealt, so it cannot be used as a general model proxy.
 */
export const dynamic = "force-dynamic";

/** A request body larger than this is refused unread. */
const MAX_BODY_LENGTH = 32_768;
const BODY_KEYS = "design|messages|roundId|sessionToken";
/** Designs that exist only once the answer is locked; the guard keeps the code from them before that. */
const AFTER_LOCK_ONLY = new Set(["composer", "visualizer"]);

const refuse = (status: number, reason: string): Response =>
  Response.json({ reason }, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  if (process.env.GENUI_ENABLED !== "1") return refuse(404, "GENUI_DISABLED");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_LENGTH) return refuse(413, "BODY_TOO_LARGE");
  const text = await request.text();
  if (text.length > MAX_BODY_LENGTH) return refuse(413, "BODY_TOO_LARGE");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, "BODY_REJECTED");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).sort().join("|") !== BODY_KEYS) {
    return refuse(400, "BODY_REJECTED");
  }
  const { sessionToken, roundId, messages } = body as Record<string, unknown>;
  const design = readyDesign((body as Record<string, unknown>).design);
  if (typeof sessionToken !== "string" || typeof roundId !== "string") return refuse(400, "BODY_REJECTED");
  if (design === null) return refuse(400, "DESIGN_REJECTED");
  const loaded = activeLocalRealExperiment();
  if (!loaded.ok) return refuse(503, "GENUI_UNAVAILABLE");
  const round = loaded.experiment.modelContext({ sessionToken, roundId });
  if (!round.ok) return refuse(round.reason === "SESSION_ENDED" ? 410 : 403, round.reason);
  // A game serves only the design it drew (#106), so a client can't switch arms mid-game.
  if (round.arms.design !== design) return refuse(403, "DESIGN");
  if (AFTER_LOCK_ONLY.has(design) && round.context.phase !== "after-lock") return refuse(403, "PHASE");
  const turns = playerTurns(messages);
  if (turns === null) return refuse(400, "MESSAGES_REJECTED");
  const streamed = streamRound({ design, context: round.context, limits: round.limits, codeLines: round.codeLines, turns, signal: request.signal,
    onOutcome: (outcome) => round.recordCall({ ...outcome, tokensIn: Math.min(outcome.tokensIn, 1_000_000),
      tokensOut: Math.min(outcome.tokensOut, 100_000), ms: Math.min(outcome.ms, 86_400_000) }) });
  if (typeof streamed === "string") return refuse(streamed === "GENUI_UNAVAILABLE" ? 503 : 422, streamed);
  return streamed;
}
