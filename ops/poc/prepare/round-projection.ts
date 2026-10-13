import { createHash } from "node:crypto";

import { canonicalHash } from "./canonical";
import {
  parsePrivateReveal,
  parsePublicRound,
  type ExperimentFixture,
  type PrivateRevealRecord,
  type PublicRoundRecord,
} from "./model";
import type { RoundModeKind } from "./model-rounds";
import type { CrawlProfile } from "./profile";

export interface GeneratedRounds {
  readonly fixtures: readonly ExperimentFixture[];
  readonly publicRounds: readonly PublicRoundRecord[];
  readonly privateReveals: Readonly<Record<string, PrivateRevealRecord>>;
}

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Deterministic, data-dependent order: by hash of the round identity and the item's own identity. */
export const shuffled = <Item>(roundId: string, items: readonly Item[], key: (item: Item) => string): readonly Item[] =>
  Object.freeze([...items].sort((left, right) => {
    const a = canonicalHash({ roundId, item: key(left) });
    const b = canonicalHash({ roundId, item: key(right) });
    return a < b ? -1 : a > b ? 1 : 0;
  }));

export const attributionFor = (source: Readonly<Record<string, unknown>>): string => [
  source.authorName, source.repository, `${String(source.licenseName)} (${String(source.licenseSpdx)})`, source.blobUrl,
].map(String).join(" · ");

const MODE_KIND: Readonly<Record<ExperimentFixture["kind"], RoundModeKind>> = Object.freeze({
  PROJECT: "project", LANGUAGE: "language", AI_CREDIT: "ai",
});

export const projectRound = (
  fixture: ExperimentFixture,
  profile: CrawlProfile,
  rulesInput: unknown,
): Readonly<{ publicRound: PublicRoundRecord; privateReveal: PrivateRevealRecord }> => {
  const candidates = fixture.candidates.map(({ id, label }) => ({ candidateId: id, label }));
  const clues = fixture.clues.map((label, index) => ({ order: index + 1, label }));
  const candidateSet = canonicalHash(candidates);
  const scoring = canonicalHash({ scheme: "local-experiment-zero-one-two-clues.v1" });
  const rules = canonicalHash({ prompt: fixture.prompt, rules: rulesInput });
  const publicRound = parsePublicRound({
    roundId: fixture.roundId,
    roundVersionId: fixture.roundVersion,
    excerpt: { versionId: fixture.source.excerptHash, text: fixture.excerpt },
    mode: {
      kind: MODE_KIND[fixture.kind],
      contractVersionId: canonicalHash({ candidates, prompt: fixture.prompt }),
      calibrationVersionId: canonicalHash({ profileVersion: profile.profileVersion }),
      prompt: fixture.prompt,
      candidates,
      clues,
    },
    versions: { candidateSet, clueSet: canonicalHash(clues), scoring, rules },
  });
  const privateReveal = parsePrivateReveal({
    roundId: fixture.roundId,
    roundVersionId: fixture.roundVersion,
    correctCandidateId: fixture.correctCandidateId,
    evidence: fixture.evidence,
    explanation: fixture.explanation,
    attribution: fixture.attribution,
    helpfulSignals: fixture.helpfulSignals,
    misleadingSignals: fixture.misleadingSignals,
    versions: {
      content: publicRound.excerpt.versionId,
      candidateSet,
      scoring,
      rules,
      evidence: canonicalHash({ evidence: fixture.evidence }),
      reveal: canonicalHash({
        explanation: fixture.explanation,
        attribution: fixture.attribution,
        correctCandidateId: fixture.correctCandidateId,
      }),
    },
  });
  return Object.freeze({ publicRound, privateReveal });
};

/** Orders a deck's fixtures by round identity so answers do not follow source order, then projects them. */
export const generatedDeck = (
  fixtures: readonly ExperimentFixture[],
  profile: CrawlProfile,
  rulesInput: unknown,
): GeneratedRounds => {
  const ordered = Object.freeze([...fixtures].sort((left, right) =>
    left.roundId < right.roundId ? -1 : left.roundId > right.roundId ? 1 : 0));
  const projections = ordered.map((fixture) => projectRound(fixture, profile, rulesInput));
  return Object.freeze({
    fixtures: ordered,
    publicRounds: Object.freeze(projections.map(({ publicRound }) => publicRound)),
    privateReveals: Object.freeze(Object.fromEntries(projections.map(({ privateReveal }) =>
      [privateReveal.roundId, privateReveal]))),
  });
};

/** Fills `{name}` placeholders; every placeholder in the template must be supplied exactly once. */
export const fill = (template: string, values: Readonly<Record<string, string>>): string => {
  let result = template;
  for (const [name, value] of Object.entries(values)) {
    const token = `{${name}}`;
    if (result.split(token).length !== 2) throw new Error("TEMPLATE_PLACEHOLDER_REJECTED");
    result = result.replace(token, value);
  }
  if (/\{[a-z]+\}/u.test(result)) throw new Error("TEMPLATE_PLACEHOLDER_REJECTED");
  return result;
};

export const plural = (count: number, singular: string, pluralWord: string): string =>
  `${count} ${count === 1 ? singular : pluralWord}`;
