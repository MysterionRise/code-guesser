import "server-only";

/**
 * The trusted artifact hash: the SHA-256 of the canonical artifact the last successful
 * `pnpm prepare:poc` run validated and published. The preparer writes this file as part of
 * publication; the game plays an artifact only when its hash matches, so an edited, stale,
 * or substituted artifact cannot be played.
 */
export const TRUSTED_ARTIFACT_HASH = "81f310573a94ed9c7fa43b29442453b78d378647c3a35e7031b1b73b7d8bcce7";
