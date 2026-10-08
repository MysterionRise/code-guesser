import "server-only";

/**
 * The trusted artifact hash: the SHA-256 of the canonical five-round artifact,
 * recorded by the operator from independent verification of one successful
 * preparation run (see the dated evidence under docs/gangsta). The preparer
 * never writes this value; it is the separate consumption input FR-007 requires,
 * so an edited, stale, or substituted artifact cannot be played.
 */
// Recorded by the operator on 2026-10-08 after independent verification of the live run
// (docs/gangsta/codeguessr-poc-readiness/evidence/2026-10-08-combined-live-run.md).
export const TRUSTED_ARTIFACT_HASH = "0eab7f489f311125b9a1ae8574fd2a3b072c3c954e48c8284aac39559a607498";
