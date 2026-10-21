/**
 * What a player sees when a page fails (#97): nothing of the error itself, not its message, digest, or stack, and
 * the way back to the decks.
 */
export function ErrorNotice() {
  return (
    <main className="empty-state" aria-labelledby="error-title">
      <h1 id="error-title">Something went wrong</h1>
      <p>This page could not be shown. A game in progress may have ended, and the decks are ready for a new one.</p>
      <a className="deck-link" href="/">Back to the decks</a>
    </main>
  );
}
