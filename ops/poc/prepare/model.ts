/** The artifact model is shared with the game: one parser, in packages/artifact. */
export {
  BASE_SOURCE_KEYS,
  BEFORE_AFTER_CANDIDATE_IDS,
  CROSS_DECK_KEYS,
  DECK_IDS,
  DECK_KINDS,
  LINEAGE_SOURCE_KEYS,
  PANE_LABELS,
  ROUNDS_PER_SESSION,
  STACK_SOURCE_KEYS,
  artifactFixtures,
  languageCandidateId,
  mentionsRepository,
  parseExperimentArtifact,
  projectCandidateId,
  type DeckId,
  type ExperimentArtifact,
  type ExperimentDeck,
  type ExperimentFixture,
  type FixtureKind,
} from "../../../packages/artifact/src/index";
export { ExperimentRecordError } from "./model-validation";
export { parseRunRecord, type RunRecord } from "./model-run";
