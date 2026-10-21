import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/app/globals.css", () => ({}));

const { default: ErrorPage } = await import("../src/app/error");
const { default: GlobalError } = await import("../src/app/global-error");

/** What Next hands an error page: the error, with its digest, and a retry. */
const thrown = Object.assign(new Error("LEDGER_CORRUPT at /srv/state/state.sqlite"), { digest: "1234567890" });

describe("error pages (#97)", () => {
  it.each([["error", ErrorPage], ["global-error", GlobalError]] as const)("%s shows the way back to the decks and nothing internal", (_, Page) => {
    const html = renderToStaticMarkup(createElement(Page as ComponentType<{ error: Error; reset: () => void }>, { error: thrown, reset: () => undefined }));
    expect(html).toContain('<main class="empty-state" aria-labelledby="error-title"><h1 id="error-title">Something went wrong</h1>');
    expect(html).toContain('<a class="deck-link" href="/">Back to the decks</a>');
    expect(html).not.toMatch(/LEDGER_CORRUPT|\/srv\/|1234567890|stack|digest/iu);
  });

  it("gives the global error page its own document, title, and theme tokens", () => {
    const html = renderToStaticMarkup(createElement(GlobalError));
    expect(html).toMatch(/^<html lang="en">/u);
    expect(html).toContain("<title>CodeGuessr — Something went wrong</title>");
    expect(readFileSync(new URL("../src/app/global-error.tsx", import.meta.url), "utf8")).toContain('import "./globals.css";');
  });
});
