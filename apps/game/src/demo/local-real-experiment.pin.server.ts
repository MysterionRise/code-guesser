import "server-only";

/**
 * The trusted artifact hash: the SHA-256 of the canonical three-deck artifact,
 * recorded by the operator from independent verification of one successful
 * preparation run. The preparer never writes this value; it is a separate
 * consumption input, so an edited, stale, or substituted artifact cannot be played.
 */
// Recorded on 2026-10-11 after independent verification of the live run
// (docs/review/evidence/2026-10-11-three-deck-live-run.md).
export const TRUSTED_ARTIFACT_HASH = "27e117c9b6f7c5c509b22eb220aef211cb3a87b79a92ead099f326b41ed0f018";
