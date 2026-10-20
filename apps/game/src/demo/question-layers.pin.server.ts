import "server-only";

/**
 * The trusted question-layers hash: the SHA-256 of the canonical layers file `pnpm prepare:questions` last wrote
 * and checked (#127). The game shows layers only when the file matches it and was written for the pinned artifact.
 */
export const TRUSTED_QUESTION_LAYERS_HASH = "410429e4557d0124b4ab5d88f69a510aff81464bc050b9c8f1d9ff07225e9331";
