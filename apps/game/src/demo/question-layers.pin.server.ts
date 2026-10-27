import "server-only";

/**
 * The trusted question-layers hash: the SHA-256 of the canonical layers file `pnpm prepare:questions` last wrote
 * and checked (#127). The game shows layers only when the file matches it and was written for the pinned artifact.
 */
export const TRUSTED_QUESTION_LAYERS_HASH = "84afc4acdb3b0a99fa1b2de7dfd960b4dffac90fb1841418979de1748f0f62ae";
