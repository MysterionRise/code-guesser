import "server-only";

import type { ParsedDeck } from "./local-real-experiment-domain.server";

/**
 * Credits (#99): every source file the artifact's rounds show, with its licence and recorded author, for the credits
 * page. A credit never names its round. Round ids are in a game's page, and a file's path often names its round's
 * answer (`sorts/SelectionSort.java`), so credits are deduplicated and sorted by licence, repository, and path, and
 * carry no round id, deck, order, or hash that could tie a round to its source.
 */
export interface Credit {
  readonly repository: string;
  readonly repositoryUrl: string;
  readonly path: string;
  readonly commit: string;
  /** The file at that commit. */
  readonly fileUrl: string;
  /** The repository's licence: its SPDX id and name, and its licence file at that commit. */
  readonly license: Readonly<{ spdx: string; name: string; fileUrl: string }>;
  /** The author the round's reveal names. */
  readonly author: string;
}

const order = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

/** One credit per file at its commit, sorted by licence, then repository, then path. */
export const creditsOf = (decks: readonly ParsedDeck[]): readonly Credit[] => {
  const credits = new Map<string, Credit>();
  for (const { fixtures } of decks) {
    for (const { source } of fixtures) {
      const key = JSON.stringify([source.repository, source.path, source.commit]);
      // Two rounds from one file at one commit share a credit; its author is the first round's.
      if (credits.has(key)) continue;
      credits.set(key, Object.freeze({
        repository: source.repository,
        repositoryUrl: source.repositoryUrl as string,
        path: source.path,
        commit: source.commit,
        fileUrl: source.blobUrl,
        license: Object.freeze({ spdx: source.licenseSpdx, name: source.licenseName, fileUrl: source.licenseFileUrl as string }),
        author: source.authorName,
      }));
    }
  }
  return Object.freeze([...credits.values()].sort((left, right) => order(left.license.spdx, right.license.spdx)
    || order(left.repository, right.repository) || order(left.path, right.path) || order(left.commit, right.commit)));
};
