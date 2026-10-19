import "server-only";

/**
 * The trusted question-layers hash: the SHA-256 of the canonical layers file `pnpm prepare:questions` last wrote
 * and checked (#127). The game shows layers only when the file matches it and was written for the pinned artifact.
 */
export const TRUSTED_QUESTION_LAYERS_HASH = "e87f533053f27ea3d87e6476a37663c981cd0bf54951dee6f341b597a14e5261";
