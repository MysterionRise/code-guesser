/**
 * A stand-in for OpenRouter's OpenAI-compatible chat endpoint, for tests only: it streams one round of render
 * tool calls, records every request body so tests can check what a model would have seen, and fails on demand.
 *
 * Run directly (`node tests/e2e/fake-openrouter.mjs`) it listens on FAKE_OPENROUTER_PORT for the browser tests.
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const DEFAULT_CALLS = Object.freeze({
  "after-lock": [
    { name: "takeaway", args: { text: "Read the keywords before the punctuation." } },
    { name: "signal_list", args: { helpful: ["The block keywords"], misleading: ["The familiar operators"] } },
  ],
  "before-lock": [{ name: "host_message", args: { text: "Hints cost points. Good luck!" } }],
  // A small composed panel that fits any round: its excerpt is the first line, which every pane has.
  composer: [{ name: "compose_panel", args: {
    root: "panel",
    elements: [
      { id: "panel", type: "Stack", props: { gap: "medium" }, children: ["verdict", "code", "signals", "quiz"] },
      { id: "verdict", type: "Callout", props: { tone: "tip", title: "The tell", text: "The first line already gives it away." }, children: [] },
      { id: "code", type: "CodeExcerpt", props: { pane: 1, from: 1, to: 1, highlights: [{ line: 1, kind: "helpful", note: "Read this line first." }] }, children: [] },
      { id: "signals", type: "List", props: { ordered: false, items: ["Keywords before punctuation", "Then the brackets"] }, children: [] },
      { id: "quiz", type: "Quiz", props: { question: "What should you read first?", choices: [
        { label: "The keywords", correct: true, feedback: "Keywords name the language fastest." },
        { label: "The comments", correct: false, feedback: "Comments rarely settle it." },
      ] }, children: [] },
    ],
  } }],
});

const chunk = (choices, extra = {}) =>
  `data: ${JSON.stringify({ id: "fake-1", object: "chat.completion.chunk", created: 0, model: "fake", choices, ...extra })}\n\n`;

/** An OpenAI-style stream that calls each tool once, then reports usage. */
const toolCallStream = (calls) => [
  chunk([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]),
  ...calls.flatMap(({ name, args }, index) => [
    chunk([{ index: 0, delta: { tool_calls: [{ index, id: `call_${index}`, type: "function", function: { name, arguments: "" } }] }, finish_reason: null }]),
    chunk([{ index: 0, delta: { tool_calls: [{ index, function: { arguments: JSON.stringify(args) } }] }, finish_reason: null }]),
  ]),
  chunk([{ index: 0, delta: {}, finish_reason: "tool_calls" }]),
  chunk([], { usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 } }),
  "data: [DONE]\n\n",
].join("");

const readBody = (request) => new Promise((resolve, reject) => {
  let text = "";
  request.setEncoding("utf8");
  request.on("data", (part) => { text += part; });
  request.on("end", () => resolve(text));
  request.on("error", reject);
});

/**
 * Starts the fake on a port (0 picks a free one). `control` sets what the next completions return: an HTTP
 * `status` to fail with, the tool `calls` to make every time, or a `sequence` of call lists, one per request;
 * `requests` holds every completion request body received.
 */
export const startFakeOpenRouter = async (port = 0) => {
  const requests = [];
  let next = { status: 200, calls: null };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://fake");
    if (request.method === "GET" && url.pathname === "/health") return response.end("ok");
    if (request.method === "GET" && url.pathname === "/requests") {
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify(requests));
    }
    if (request.method === "POST" && url.pathname === "/control") {
      next = { status: 200, calls: null, ...JSON.parse(await readBody(request)) };
      requests.length = 0;
      return response.end("ok");
    }
    if (request.method === "POST" && url.pathname === "/api/v1/chat/completions") {
      const body = JSON.parse(await readBody(request));
      requests.push({ authorization: request.headers.authorization ?? null, body });
      if (next.status !== 200) {
        response.writeHead(next.status, { "content-type": "application/json" });
        return response.end(JSON.stringify({ error: { message: "fake provider body that must never reach a player", code: next.status } }));
      }
      const offered = new Set((body.tools ?? []).map((entry) => entry.function?.name));
      const calls = next.sequence?.shift() ?? next.calls ?? (offered.has("compose_panel") ? DEFAULT_CALLS.composer
        : offered.has("takeaway") ? DEFAULT_CALLS["after-lock"] : DEFAULT_CALLS["before-lock"]);
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      return response.end(toolCallStream(calls));
    }
    response.writeHead(404);
    return response.end();
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  return {
    port: typeof address === "object" && address !== null ? address.port : port,
    requests,
    control: (value) => { next = { status: 200, calls: null, ...value }; requests.length = 0; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.FAKE_OPENROUTER_PORT ?? 3201);
  await startFakeOpenRouter(port);
  console.log(`FAKE_OPENROUTER_LISTENING ${port}`);
}
