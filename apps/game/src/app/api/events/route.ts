import { activeLocalRealExperiment } from "../../../demo/local-real-experiment-loader.server";

/**
 * The event log's beacon (#107): the few events only a browser sees, for a live game this server dealt. It stores
 * nothing about the request itself, and a game that records no events (`Sec-GPC: 1` at the deal) is answered the
 * same way as one that does.
 */
export const dynamic = "force-dynamic";

/**
 * A beacon larger than this is refused unread. A finished game's token runs to about 1,100 characters since game state
 * v3 (#173), so a beacon takes 2 KB.
 */
const MAX_BODY_LENGTH = 2048;

const STATUS = { RECORDED: 204, REJECTED: 400, SESSION_ENDED: 410, LIMIT: 429 } as const;

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_LENGTH) return new Response(null, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY_LENGTH) return new Response(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const loaded = activeLocalRealExperiment();
  if (!loaded.ok) return new Response(null, { status: 503 });
  return new Response(null, { status: STATUS[loaded.experiment.recordClientEvent(body)], headers: { "cache-control": "no-store" } });
}
