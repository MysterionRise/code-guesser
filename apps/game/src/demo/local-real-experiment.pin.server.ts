import "server-only";

/**
 * The trusted artifact hash: the SHA-256 of the canonical artifact the last successful
 * `pnpm prepare:poc` run validated and published. The preparer writes this file as part of
 * publication; the game plays an artifact only when its hash matches, so an edited, stale,
 * or substituted artifact cannot be played.
 */
export const TRUSTED_ARTIFACT_HASH = "ba7ce4346ca492c5791eb64da220441443f780822ef9257fb8df5bd47a2fc3af";
