import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ArtifactUnavailable } from "../src/demo/artifact-unavailable";

describe("empty state when no rounds load", () => {
  it.each([
    ["MISSING", /There is no artifact at <code>apps\/game\/src\/demo\/generated\/local-real-rounds\.json<\/code>/u],
    ["HASH_MISMATCH", /does not match the hash pinned in this build/u],
    ["SCHEMA", /matches its pinned hash but is not valid JSON of the current format/u],
  ] as const)("names the %s reason code and what the operator does about it", (reason, explanation) => {
    const html = renderToStaticMarkup(createElement(ArtifactUnavailable, { reason }));
    expect(html).toContain('<section class="empty-state" role="alert" aria-labelledby="empty-state-title">');
    expect(html).toContain("No rounds are ready yet");
    expect(html).toContain(`For the operator: <code data-reason="${reason}">${reason}</code>.`);
    expect(html).toMatch(explanation);
    expect(html).toMatch(/rebuild and restart the game/u);
  });

  it("is what the root route renders when the loader reports no rounds", () => {
    const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("<ArtifactUnavailable reason={loaded.reason} />");
  });
});
