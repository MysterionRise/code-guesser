import "server-only";

/**
 * The trusted question-layers hash: the SHA-256 of the canonical layers file `pnpm prepare:questions` last wrote
 * and checked (#127). The game shows layers only when the file matches it and was written for the pinned artifact.
 */
export const TRUSTED_QUESTION_LAYERS_HASH = "bccec41ff31fe44d6def6a485a0e266fd52fad364241f881c8f92613463ae527";
