/**
 * A stand-in for Anthropic's Messages API (`POST /v1/messages`), for tests only, the way `fake-openrouter.mjs`
 * stands in for OpenRouter: it streams one round of render tool calls as Anthropic's server-sent events, records
 * every request (its key header and body) so tests can check what a model would have seen, and fails on demand.
 * The calls it makes are the OpenRouter fake's, so both providers are tested on the same panels.
 *
 * Run directly (`node tests/e2e/fake-anthropic.mjs`) it listens on FAKE_ANTHROPIC_PORT, on this machine's loopback
 * unless FAKE_ANTHROPIC_HOST names another of its addresses.
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { DEFAULT_CALLS, readBody, visualizerCall } from "./fake-openrouter.mjs";

const event = (type, payload) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;

const messageStart = () => event("message_start", { message: {
  id: "msg_fake", type: "message", role: "assistant", model: "fake", content: [], stop_reason: null, stop_sequence: null,
  usage: { input_tokens: 120, output_tokens: 1 },
} });

const textBlock = (index, text) => [
  event("content_block_start", { index, content_block: { type: "text", text: "" } }),
  event("content_block_delta", { index, delta: { type: "text_delta", text } }),
  event("content_block_stop", { index }),
].join("");

/** A stream of plain text and no tool call, as a model that ignores its tools sends. */
const textStream = (text) => [
  messageStart(),
  textBlock(0, text),
  event("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } }),
  event("message_stop", {}),
].join("");

/** A stream that calls each tool once, then reports usage; `preface` is plain text sent before the calls. */
const toolCallStream = (calls, preface = "") => {
  const offset = preface.length > 0 ? 1 : 0;
  return [
    messageStart(),
    ...(offset === 1 ? [textBlock(0, preface)] : []),
    ...calls.flatMap(({ name, args }, at) => [
      event("content_block_start", { index: at + offset, content_block: { type: "tool_use", id: `toolu_${at}`, name, input: {} } }),
      event("content_block_delta", { index: at + offset, delta: { type: "input_json_delta", partial_json: JSON.stringify(args) } }),
      event("content_block_stop", { index: at + offset }),
    ]),
    event("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 40 } }),
    event("message_stop", {}),
  ].join("");
};

/**
 * Starts the fake on a port (0 picks a free one). `control` sets what the next message returns, as the OpenRouter
 * fake's does: an HTTP `status` to fail with, the tool `calls` to make every time, a `sequence` of call lists, one per
 * request, or a plain `text` reply; a `preface` is plain text sent ahead of the calls. `requests` holds every request
 * received: its `apiKey` header, its `version` header, and its `body`. `host` is the address it listens on, loopback
 * unless something off this machine's loopback must reach it, as for the OpenRouter fake.
 */
export const startFakeAnthropic = async (port = 0, host = "127.0.0.1") => {
  const requests = [];
  let leaks = 0;
  let next = { status: 200, calls: null };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://fake");
    if (request.method === "GET" && url.pathname === "/health") return response.end("ok");
    if (url.pathname === "/leak") { leaks += 1; return response.end("leaked"); }
    if (request.method === "GET" && url.pathname === "/leaks") return response.end(String(leaks));
    if (request.method === "GET" && url.pathname === "/requests") {
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify(requests));
    }
    if (request.method === "POST" && url.pathname === "/control") {
      next = { status: 200, calls: null, ...JSON.parse(await readBody(request)) };
      requests.length = 0;
      return response.end("ok");
    }
    if (request.method === "POST" && url.pathname === "/v1/messages") {
      const body = JSON.parse(await readBody(request));
      requests.push({ apiKey: request.headers["x-api-key"] ?? null, version: request.headers["anthropic-version"] ?? null, body });
      if (next.status !== 200) {
        response.writeHead(next.status, { "content-type": "application/json" });
        return response.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "fake provider body that must never reach a player" } }));
      }
      const offered = new Set((body.tools ?? []).map((entry) => entry.name));
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      if (typeof next.text === "string") return response.end(textStream(next.text));
      const calls = next.sequence?.shift() ?? next.calls ?? (offered.has("render_visualizer") ? visualizerCall(server.address().port)
        : offered.has("compose_panel") ? DEFAULT_CALLS.composer
        : offered.has("offer_hint") ? DEFAULT_CALLS["host-before-lock"]
        : offered.has("takeaway") ? DEFAULT_CALLS["after-lock"] : DEFAULT_CALLS["before-lock"]);
      return response.end(toolCallStream(calls, typeof next.preface === "string" ? next.preface : ""));
    }
    response.writeHead(404);
    return response.end();
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  return {
    port: typeof address === "object" && address !== null ? address.port : port,
    requests,
    control: (value) => { next = { status: 200, calls: null, ...value }; requests.length = 0; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.FAKE_ANTHROPIC_PORT ?? 3202);
  await startFakeAnthropic(port, process.env.FAKE_ANTHROPIC_HOST || undefined);
  console.log(`FAKE_ANTHROPIC_LISTENING ${port}`);
}
