import "server-only";

/**
 * The trusted artifact hash: the SHA-256 of the canonical five-round artifact,
 * recorded by the operator from independent verification of one successful
 * preparation run (see the dated evidence under docs/gangsta). The preparer
 * never writes this value; it is the separate consumption input FR-007 requires,
 * so an edited, stale, or substituted artifact cannot be played.
 */
export const TRUSTED_ARTIFACT_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
