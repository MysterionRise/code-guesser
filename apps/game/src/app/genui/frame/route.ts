import { VISUALIZER_CSP } from "../../../genui/visualizer-spec";

/**
 * The visualizer's frame (#115, #97): a constant shell the panel loads into a sandboxed iframe and then hands one
 * checked page. A `srcdoc` frame inherits the game page's policy, whose nonce the model's inline scripts can never
 * carry, so the frame is a document of its own, under the visualizer's policy: inline script and style, nothing that
 * leaves the page, a sandbox of its own even when opened directly, and framing by the game alone. The shell takes the
 * first message its parent sends and writes it as the document; it reads nothing from the request.
 */
export const dynamic = "force-static";

const SHELL = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Visualizer</title></head><body><script>
addEventListener("message", function take(event) {
  if (event.source !== parent) return;
  removeEventListener("message", take);
  if (typeof event.data !== "string") return;
  document.open();
  document.write(event.data);
  document.close();
});
</script></body></html>`;

const POLICY = `${VISUALIZER_CSP}; sandbox allow-scripts; frame-ancestors 'self'`;

export function GET(): Response {
  return new Response(SHELL, {
    headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": POLICY },
  });
}
