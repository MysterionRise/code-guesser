/** The artifact model is shared with the game: one parser, in packages/artifact. */
export {
  AI_CANDIDATE_IDS,
  AI_SOURCE_KEYS,
  BASE_SOURCE_KEYS,
  CROSS_DECK_KEYS,
  DECK_IDS,
  DECK_KINDS,
  LANGUAGE_SOURCE_KEYS,
  LINEAGE_SOURCE_KEYS,
  PROJECT_SOURCE_KEYS,
  ROUNDS_PER_DECK,
  artifactFixtures,
  parseExperimentArtifact,
  type DeckId,
  type ExperimentArtifact,
  type ExperimentDeck,
  type ExperimentFixture,
  type FixtureKind,
} from "../../../packages/artifact/src/index";
export { ExperimentRecordError } from "./model-validation";
export {
  parsePrivateReveal,
  parsePublicRound,
  parseRoundRecordSet,
  type PrivateRevealRecord,
  type PublicRoundRecord,
  type RoundRecordSet,
} from "./model-rounds";
export { parseRunRecord, type RunRecord } from "./model-run";
