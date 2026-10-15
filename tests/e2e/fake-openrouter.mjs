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
  // The host, before the lock, when it may offer the round's next hint.
  "host-before-lock": [
    { name: "host_message", args: { text: "I can't see the code yet, but I can cheer you on." } },
    { name: "offer_hint", args: { reason: "Stuck? A hint might point you the right way." } },
  ],
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

/**
 * A visualizer page that passes the server's checks by spelling its escapes in pieces, so only the sandbox stands
 * between it and the game: it tries to read the parent page, use storage, and reach this fake over the network.
 */
const visualizerCall = (port) => [{ name: "render_visualizer", args: {
  title: "Stepping through the round",
  summary: "A counter that advances one step per press.",
  html: `<p id="status">Step 0</p><button id="step">Step</button><p id="isolation">checking</p><p id="storage">checking</p>
<script>
let n = 0;
document.getElementById("step").onclick = () => { n += 1; document.getElementById("status").textContent = "Step " + n; };
let isolation = "isolated";
try { const w = window["par" + "ent"]; void w["docu" + "ment"].body.innerHTML; isolation = "exposed"; } catch (error) {}
let storage = "blocked";
try { window["local" + "Storage"].setItem("k", "v"); storage = "open"; } catch (error) {}
const target = "ht" + "tp://127.0.0.1:${port}/leak";
try { new Image().src = target; } catch (error) {}
try { window["fet" + "ch"](target).catch(() => {}); } catch (error) {}
document.getElementById("isolation").textContent = isolation;
document.getElementById("storage").textContent = storage;
</script>` } }];

const chunk = (choices, extra = {}) =>
  `data: ${JSON.stringify({ id: "fake-1", object: "chat.completion.chunk", created: 0, model: "fake", choices, ...extra })}\n\n`;

/** An OpenAI-style stream of plain text and no tool call, as a model that ignores its tools sends. */
const textStream = (text) => [
  chunk([{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }]),
  chunk([{ index: 0, delta: {}, finish_reason: "stop" }]),
  chunk([], { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }),
  "data: [DONE]\n\n",
].join("");

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
 * `status` to fail with, the tool `calls` to make every time, a `sequence` of call lists, one per request, or a
 * plain `text` reply with no tool call;
 * `requests` holds every completion request body received.
 */
export const startFakeOpenRouter = async (port = 0) => {
  const requests = [];
  // Hits from a visualizer page that tried to reach the network; the sandbox should keep this at zero.
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
    if (request.method === "POST" && url.pathname === "/api/v1/chat/completions") {
      const body = JSON.parse(await readBody(request));
      requests.push({ authorization: request.headers.authorization ?? null, body });
      if (next.status !== 200) {
        response.writeHead(next.status, { "content-type": "application/json" });
        return response.end(JSON.stringify({ error: { message: "fake provider body that must never reach a player", code: next.status } }));
      }
      const offered = new Set((body.tools ?? []).map((entry) => entry.function?.name));
      if (typeof next.text === "string") {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        return response.end(textStream(next.text));
      }
      const calls = next.sequence?.shift() ?? next.calls ?? (offered.has("render_visualizer") ? visualizerCall(server.address().port)
        : offered.has("compose_panel") ? DEFAULT_CALLS.composer
        : offered.has("offer_hint") ? DEFAULT_CALLS["host-before-lock"]
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
