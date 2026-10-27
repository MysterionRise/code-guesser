import "server-only";

/**
 * The trusted artifact hash: the SHA-256 of the canonical artifact the last successful
 * `pnpm prepare:poc` run validated and published. The preparer writes this file as part of
 * publication; the game plays an artifact only when its hash matches, so an edited, stale,
 * or substituted artifact cannot be played.
 */
export const TRUSTED_ARTIFACT_HASH = "847e7512d5374450656b2147b4c7478e6bcc28045a372f33683ae63996e38a5e";
