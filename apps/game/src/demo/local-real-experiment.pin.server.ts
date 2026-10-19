import "server-only";

/**
 * The trusted artifact hash: the SHA-256 of the canonical artifact the last successful
 * `pnpm prepare:poc` run validated and published. The preparer writes this file as part of
 * publication; the game plays an artifact only when its hash matches, so an edited, stale,
 * or substituted artifact cannot be played.
 */
export const TRUSTED_ARTIFACT_HASH = "1abc21f8b819f40e45dc690d63cf89ad2fa1b22355ffdc321d1ac1ffb09b9522";
