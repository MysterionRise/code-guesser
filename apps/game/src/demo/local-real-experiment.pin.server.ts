import "server-only";

/**
 * The trusted artifact hash: the SHA-256 of the canonical artifact the last successful
 * `pnpm prepare:poc` run validated and published. The preparer writes this file as part of
 * publication; the game plays an artifact only when its hash matches, so an edited, stale,
 * or substituted artifact cannot be played.
 */
export const TRUSTED_ARTIFACT_HASH = "602ca9f5fb48a699da68ded37b944d30ca236023f3618937d1d5ad5bbc8dfe06";
