import "server-only";

/**
 * The trusted question-layers hash: the SHA-256 of the canonical layers file `pnpm prepare:questions` last wrote
 * and checked (#127). The game shows layers only when the file matches it and was written for the pinned artifact.
 */
export const TRUSTED_QUESTION_LAYERS_HASH = "850defd0fc022cfb5efa8fdd7dd0857074b4df697e4e6b69d6482b9494b21580";
