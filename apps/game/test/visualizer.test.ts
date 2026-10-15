import { describe, expect, it } from "vitest";

import { TERMINAL_PALETTE, VISUALIZER_CSP, VisualizerRejected, paletteFrom, parseVisualizer, visualizerDocument } from "../src/genui/visualizer-spec";

const page = (html: string) => ({ title: "Insertion sort, step by step", summary: "Each step moves one item into place.", html });
const codeOf = (value: unknown): string => {
  try { parseVisualizer(value); } catch (error) { return error instanceof VisualizerRejected ? error.code : "OTHER"; }
  return "PASSED";
};

describe("visualizer pages (#115)", () => {
  it("passes a self-contained page, including words like top, open, and location", () => {
    const html = `<style>.box{margin-top:8px;position:relative;top:2px}</style><p>The top of the heap is the largest item.
<button id="b">Open the next step</button></p><p id="s">The location of the bug is line 4.</p>
<script>let n=0;document.getElementById("b").onclick=()=>{n+=1;document.getElementById("s").textContent="Step "+n;};</script>`;
    expect(codeOf(page(html))).toBe("PASSED");
    expect(parseVisualizer(page(html)).html).toBe(html);
  });

  it("refuses pages that reach beyond themselves", () => {
    for (const [html, code] of [
      [`<img src="https://example.test/x.png">`, "HTML_URL"],
      [`<script src="//cdn.example.test/x.js"></script>`, "HTML_URL"],
      [`<p>javascript:alert(1)</p>`, "HTML_URL"],
      [`<meta http-equiv="refresh" content="0">`, "HTML_TAG"],
      [`<base href="/">`, "HTML_TAG"],
      [`<iframe></iframe>`, "HTML_TAG"],
      [`<form><input></form>`, "HTML_TAG"],
      [`<a href="#x">x</a>`, "HTML_TAG"],
      [`<script>fetch("/api")</script>`, "HTML_NETWORK"],
      [`<script>new WebSocket("x")</script>`, "HTML_NETWORK"],
      [`<script>navigator.sendBeacon("x")</script>`, "HTML_NETWORK"],
      [`<script>new Worker("w.js")</script>`, "HTML_NETWORK"],
      [`<script>import("./x.js")</script>`, "HTML_NETWORK"],
      [`<script>localStorage.setItem("k","v")</script>`, "HTML_STORAGE"],
      [`<script>document.cookie="a=b"</script>`, "HTML_STORAGE"],
      [`<script>window.parent.document.body</script>`, "HTML_ESCAPE"],
      [`<script>top.location="x"</script>`, "HTML_ESCAPE"],
      [`<script>location.href="x"</script>`, "HTML_ESCAPE"],
      [`<script>window.open("x")</script>`, "HTML_ESCAPE"],
      [`<script>postMessage("x","*")</script>`, "HTML_ESCAPE"],
      [`<style>@import "x.css";</style>`, "HTML_CSS_IMPORT"],
      [`<style>body{background:url(x.png)}</style>`, "HTML_CSS_IMPORT"],
      ["x".repeat(40_001), "HTML_SIZE"],
      ["   ", "HTML_EMPTY"],
    ] as const) expect(codeOf(page(html)), html.slice(0, 50)).toBe(code);
  });

  it("refuses unsafe titles and summaries, and any other shape", () => {
    expect(codeOf({ ...page("<p>x</p>"), title: "See https://example.test" })).toBe("TITLE");
    expect(codeOf({ ...page("<p>x</p>"), summary: "" })).toBe("SUMMARY");
    expect(codeOf({ ...page("<p>x</p>"), extra: true })).toBe("SHAPE");
    expect(codeOf("<p>x</p>")).toBe("SHAPE");
  });

  it("puts a CSP with no network ahead of the model's markup", () => {
    const document = visualizerDocument("<p>hello</p>");
    expect(document.indexOf("Content-Security-Policy")).toBeLessThan(document.indexOf("<p>hello</p>"));
    for (const directive of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-src 'none'"]) {
      expect(VISUALIZER_CSP).toContain(directive);
    }
    expect(VISUALIZER_CSP).not.toMatch(/https?:|\*/u);
  });
});

describe("visualizer frame height", () => {
  it("takes only a clamped height the game's own reporter sends", async () => {
    const { reportedHeight } = await import("../src/genui/visualizer-view");
    expect(reportedHeight({ codeguessrVisualizerHeight: 612.2 })).toBe(617);
    expect(reportedHeight({ codeguessrVisualizerHeight: 10 })).toBe(240);
    expect(reportedHeight({ codeguessrVisualizerHeight: 99_999 })).toBe(1100);
    for (const junk of [null, "600", { height: 600 }, { codeguessrVisualizerHeight: Number.NaN }]) expect(reportedHeight(junk)).toBeNull();
    // The reporter is the game's, after the model's markup; the model's own markup still may not post messages.
    expect(visualizerDocument("<p>x</p>").indexOf("codeguessrVisualizerHeight")).toBeGreaterThan(visualizerDocument("<p>x</p>").indexOf("<p>x</p>"));
  });

  it("starts the page in the player's theme, taking only plain colours from the page's tokens (#125)", () => {
    const tokens: Record<string, string> = { "--panel": " #fbf7ee", "--text": "rgba(31, 27, 22, 0.9)", "--border-soft": "red;}</style><script>alert(1)</script>",
      "--chip": "url(https://example.org/x.png)", "--accent": "#a23d16", "--focus": "" };
    const palette = paletteFrom((token) => tokens[token] ?? "");
    expect(palette).toEqual({ panel: "#fbf7ee", text: "rgba(31, 27, 22, 0.9)", border: TERMINAL_PALETTE.border, chip: TERMINAL_PALETTE.chip,
      accent: "#a23d16", focus: TERMINAL_PALETTE.focus });
    const page = visualizerDocument("<p>x</p>", palette);
    expect(page).toContain("background:#fbf7ee");
    expect(page).not.toMatch(/<script>alert|example\.org/u);
    expect(visualizerDocument("<p>x</p>")).toContain(`background:${TERMINAL_PALETTE.panel}`);
  });
});
