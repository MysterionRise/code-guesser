import type { Metadata } from "next";

import { PageFrame } from "../demo/page-frame";
import { CONTROL } from "../experiment/arms";

/** The not-found page's own title: the root layout's template doesn't reach a file in its own segment. */
export const metadata: Metadata = { title: { absolute: "Page not found · CodeGuessr" } };

/** Any address the game doesn't serve (#168), in the original theme and under the permanent notice, with the way back to the decks. */
export default function NotFound() {
  return (
    <PageFrame theme={CONTROL.theme}>
      <main className="empty-state" aria-labelledby="not-found-title">
        <h1 id="not-found-title">There’s nothing here</h1>
        <p>This address isn’t part of CodeGuessr. The decks are one click away.</p>
        <a className="deck-link" href="/">Back to the decks</a>
      </main>
    </PageFrame>
  );
}
