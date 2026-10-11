import {
  canonicalArtifactBytes,
  canonicalArtifactHash,
  canonicalBytes,
  canonicalHash,
} from "./canonical";
import {
  CROSS_DECK_KEYS,
  DECK_IDS,
  DECK_KINDS,
  ROUNDS_PER_SESSION,
  mentionsRepository,
  parseExperimentArtifact,
  type DeckId,
  type ExperimentArtifact,
  type ExperimentFixture,
} from "./model";
import { STACK_LANGUAGES, mentionsLabel, type CrawlProfile } from "./profile";
import type { GeneratedRounds } from "./round-helpers";

const SHA256 = /^[0-9a-f]{64}$/u;

export class ComposeError extends Error {
  /** A safe, data-free reason code such as PUBLIC_CONTAINMENT_LICENSESPDX_IN_PANES, when one is known. */
  public readonly code: string | undefined;

  public constructor(code?: string) {
    super("EXPERIMENT_COMPOSITION_REJECTED");
    this.name = "ComposeError";
    this.code = code;
  }
}

export interface ComposeOptions {
  readonly profile: CrawlProfile;
  readonly canonicalProfileBytes: Uint8Array;
  readonly acceptedResponseHashes: readonly string[];
  /** The decks this run filled; at least one. */
  readonly decks: Partial<Readonly<Record<DeckId, GeneratedRounds>>>;
}

export interface ComposedExperiment {
  readonly artifact: ExperimentArtifact;
  readonly artifactBytes: Uint8Array;
  readonly artifactHash: string;
}

const fail = (code?: string): never => { throw new ComposeError(code); };
const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
/** True when the protected value appears in public text as a whole token (non-alphanumeric boundaries). */
export const containsProtected = (publicText: string, value: string): boolean => {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, "u").test(publicText);
};
export const PROTECTED_SOURCE_KEYS = [
  "repository", "repositoryUrl", "authorName", "authorLogin", "authorSourceUrl", "path",
  "blob", "rawContentHash", "licenseName", "licenseSpdx", "licenseFileUrl", "commit",
  "commitUrl", "blobUrl",
] as const;

const parseResponseHashes = (values: readonly string[]): readonly string[] => {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !SHA256.test(value))) fail();
  if (new Set(values).size !== values.length) fail();
  return Object.freeze([...values]);
};

const POOL_SIZES = (profile: CrawlProfile): Readonly<Record<DeckId, number>> => ({
  project: profile.selection.projectPool, language: profile.selection.languagePool, "before-after": profile.selection.beforeAfterPool,
});

const requireDeck = (generated: GeneratedRounds, id: DeckId, profile: CrawlProfile): void => {
  if (generated.fixtures.length !== POOL_SIZES(profile)[id] || generated.fixtures.length < ROUNDS_PER_SESSION) fail(`DECK_SIZE_${id.toUpperCase().replace("-", "_")}`);
  if (generated.fixtures.some((fixture) => fixture.kind !== DECK_KINDS[id])) fail();
};

const requireBindings = (decks: readonly (readonly ExperimentFixture[])[], profile: CrawlProfile, snapshotId: string): void => {
  const all = decks.flat();
  const ids = new Set<string>();
  for (const fixture of all) {
    if (fixture.source.profileVersion !== profile.profileVersion
      || fixture.source.crawlSnapshotId !== snapshotId || ids.has(fixture.roundId)) fail();
    ids.add(fixture.roundId);
  }
  const distinct = (fixtures: readonly ExperimentFixture[], keys: readonly string[]): void => {
    for (const key of keys) {
      const values = fixtures.map(({ source }) => source[key]);
      if (values.some((value) => typeof value !== "string" || value.length === 0)
        || new Set(values).size !== fixtures.length) fail();
    }
  };
  for (const fixtures of decks) distinct(fixtures, profile.deduplication);
  distinct(all, CROSS_DECK_KEYS);
};

/** What a round shows before the answer; project-round labels are the one place a repository may appear. */
const publicParts = (fixture: ExperimentFixture) => ({
  panes: fixture.panes.map(({ text }) => text).join("\n"),
  prompt: fixture.prompt,
  candidates: JSON.stringify(fixture.kind === "PROJECT"
    ? fixture.candidates.map(({ id, detail }) => ({ id, detail }))
    : fixture.candidates),
  clues: fixture.clues.join("\n"),
});

const requireOwnCandidatesAbsent = (fixture: ExperimentFixture): void => {
  const parts = publicParts(fixture);
  const shown = [["PANES", parts.panes], ["PROMPT", parts.prompt], ["CLUES", parts.clues]] as const;
  for (const [part, value] of shown) {
    if (fixture.kind === "PROJECT" && fixture.candidates.some(({ label }) => mentionsRepository(value, label))) {
      fail(`PUBLIC_CONTAINMENT_CANDIDATE_IN_${part}`);
    }
    if (fixture.kind === "LANGUAGE" && STACK_LANGUAGES.some((label) => mentionsLabel(value, label))) {
      fail(`PUBLIC_CONTAINMENT_CANDIDATE_IN_${part}`);
    }
  }
};

/** Names the protected key and the public part that exposed it, never the value. */
const requirePublicContainment = (fixtures: readonly ExperimentFixture[]): void => {
  const shown = fixtures.map(publicParts);
  const publicText = shown.map((parts) => Object.values(parts).join("\n")).join("\n");
  for (const fixture of fixtures) {
    requireOwnCandidatesAbsent(fixture);
    const protectedEntries: readonly (readonly [string, unknown])[] = [
      ["evidence", fixture.evidence], ["explanation", fixture.explanation], ["attribution", fixture.attribution],
      ...PROTECTED_SOURCE_KEYS.map((key) => [key, fixture.source[key]] as const),
    ];
    for (const [name, value] of protectedEntries) {
      if (typeof value !== "string" || !containsProtected(publicText, value)) continue;
      // A whole-file excerpt makes rawContentHash equal the public excerpt hash: a hash of public text.
      if (name === "rawContentHash" && (value === fixture.source.excerptHash || value === fixture.source.parentExcerptHash)) continue;
      const part = shown.flatMap((parts) => Object.entries(parts)).find(([, text]) => containsProtected(text, value))?.[0] ?? "UNKNOWN";
      fail(`PUBLIC_CONTAINMENT_${name.toUpperCase()}_IN_${part.toUpperCase()}`);
    }
  }
};

const crawlSnapshot = (profile: CrawlProfile, profileHash: string, acceptedResponseHashes: readonly string[]) => Object.freeze({
  id: canonicalHash({ profileHash, acceptedResponseHashes }),
  profileVersion: profile.profileVersion,
  profileHash,
  github: Object.freeze({
    apiVersion: profile.github.apiVersion,
    queries: Object.freeze(profile.github.queries.map((query) => Object.freeze({
      ...query, pages: profile.capacity.githubPages, resultCeiling: profile.capacity.githubResults,
    }))),
  }),
  stack: Object.freeze({
    release: profile.stack.release, revision: profile.stack.revision,
    configurations: Object.freeze(profile.stack.configurations.map(({ configuration }) => configuration)),
  }),
  acceptedResponseHashes,
});

const TEMPLATE_KEYS = Object.freeze({ project: "project", language: "language", "before-after": "beforeAfter" } as const);

export const composeExperimentArtifact = (options: ComposeOptions): ComposedExperiment => {
  if (!(options.canonicalProfileBytes instanceof Uint8Array)
    || !sameBytes(options.canonicalProfileBytes, canonicalBytes(options.profile))) fail();
  const acceptedResponseHashes = parseResponseHashes(options.acceptedResponseHashes);
  const profileHash = canonicalHash(options.profile);
  const snapshot = crawlSnapshot(options.profile, profileHash, acceptedResponseHashes);
  const present = DECK_IDS.filter((id) => options.decks[id] !== undefined);
  if (present.length === 0) fail("NO_DECK");
  for (const id of present) requireDeck(options.decks[id]!, id, options.profile);
  requireBindings(present.map((id) => options.decks[id]!.fixtures), options.profile, snapshot.id);
  // Named first, so a leak reports its key and part instead of the parser's single rejection.
  requirePublicContainment(present.flatMap((id) => options.decks[id]!.fixtures));
  const artifact = parseExperimentArtifact({
    schemaVersion: "local-experiment-artifact.v3",
    contentClass: "LOCAL_UNREVIEWED_EXPERIMENT",
    profileHash,
    crawlSnapshot: snapshot,
    decks: present.map((id) => {
      const template = options.profile.templates[TEMPLATE_KEYS[id]];
      return { id, title: template.title, description: template.description, roundsPerSession: ROUNDS_PER_SESSION,
        fixtures: options.decks[id]!.fixtures };
    }),
  });
  return Object.freeze({
    artifact,
    artifactBytes: canonicalArtifactBytes(artifact),
    artifactHash: canonicalArtifactHash(artifact),
  });
};
