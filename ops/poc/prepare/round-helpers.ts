import { createHash } from "node:crypto";

import { canonicalHash } from "./canonical";
import type { ExperimentFixture } from "./model";

/** A deck's pool of fixtures, in round-identity order so pool order says nothing about answers. */
export interface GeneratedRounds {
  readonly fixtures: readonly ExperimentFixture[];
}

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Deterministic, data-dependent order: by hash of a seed and each item's own identity. */
export const shuffled = <Item>(seed: string, items: readonly Item[], key: (item: Item) => string): readonly Item[] =>
  Object.freeze([...items].sort((left, right) => {
    const a = canonicalHash({ seed, item: key(left) });
    const b = canonicalHash({ seed, item: key(right) });
    return a < b ? -1 : a > b ? 1 : 0;
  }));

export const attributionFor = (source: Readonly<Record<string, unknown>>): string => [
  source.authorName, source.repository, `${String(source.licenseName)} (${String(source.licenseSpdx)})`, source.blobUrl,
].map(String).join(" · ");

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

/** A stable round identity from the round kind and its source's identity. */
export const roundIdFor = (kind: string, source: Readonly<Record<string, unknown>>): string =>
  `local-${kind}-${canonicalHash({ kind, repository: source.repository, commit: source.commit, path: source.path, blob: source.blob }).slice(0, 24)}`;

/** Orders a pool by round identity, so neither selection order nor source order shows through. */
export const orderedPool = (fixtures: readonly ExperimentFixture[]): GeneratedRounds => Object.freeze({
  fixtures: Object.freeze([...fixtures].sort((left, right) => left.roundId < right.roundId ? -1 : left.roundId > right.roundId ? 1 : 0)),
});

/** A count rounded to two significant figures and grouped, for a hint such as "about 73,000". */
export const approximately = (value: number): string => {
  if (value < 100) return String(value);
  const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1);
  return (Math.round(value / magnitude) * magnitude).toLocaleString("en-US");
};

/** The source record a fixture stores: everything the candidate carries except its public text. */
export const sourceRecord = (candidate: Readonly<Record<string, unknown>>, omit: readonly string[]): Readonly<Record<string, unknown>> =>
  Object.freeze(structuredClone(Object.fromEntries(Object.entries(candidate).filter(([key]) => !omit.includes(key)))));
