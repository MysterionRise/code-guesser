import type { Metadata } from "next";
import * as React from "react";

import { ArtifactUnavailable } from "../../demo/artifact-unavailable";
import { activeLocalRealExperiment } from "../../demo/local-real-experiment-loader.server";
import type { Credit } from "../../demo/local-real-experiment.server";
import { PageFrame } from "../../demo/page-frame";
import { CONTROL, labMode, labOverrides } from "../../experiment/arms";

/**
 * Credits (#99): every file the rounds show, grouped by licence, then repository, with each repository's licence file
 * at the commit its files were read at and a link to the licence's text. It reads the experiment only through
 * `experiment.credits`, which names no round, so nothing here ties a round to its source.
 */

export const metadata: Metadata = {
  title: "Credits · CodeGuessr",
  description: "The open-source files CodeGuessr's rounds show, with their licences and authors.",
};

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

/** What each licence asks of excerpts shown in a game, in a sentence; `docs/licences.md` has the reasoning. */
const LICENSE_NOTES: Readonly<Record<string, string>> = Object.freeze({
  "Apache-2.0": "It asks for its text, the copyright and attribution notices, and a note that the files were changed.",
  "BSD-2-Clause": "It asks for the copyright notice, its conditions, and its disclaimer.",
  "BSD-3-Clause": "It asks for the copyright notice, its conditions, and its disclaimer, and that no one's name is used to endorse anything.",
  ISC: "It asks for the copyright notice and its permission notice.",
  MIT: "It asks for the copyright notice and its permission notice.",
  "Python-2.0": "It asks for the PSF's licence and copyright notice, and a summary of changes.",
});

/** Credits of one licence, then of one repository, in the order they arrive. */
const groupBy = <Key extends string>(credits: readonly Credit[], key: (credit: Credit) => Key): readonly (readonly [Key, readonly Credit[]])[] => {
  const groups = new Map<Key, Credit[]>();
  for (const credit of credits) groups.set(key(credit), [...groups.get(key(credit)) ?? [], credit]);
  return [...groups];
};

const shortCommit = (commit: string): string => commit.slice(0, 7);

function RepositoryCredits({ repository, credits }: { readonly repository: string; readonly credits: readonly Credit[] }) {
  // A repository read at more than one commit has a licence file at each.
  const licenseFiles = groupBy(credits, ({ commit }) => commit);
  return (
    <li className="credit-repository">
      <h3><a href={credits[0]!.repositoryUrl} rel="noreferrer noopener">{repository}</a></h3>
      <p className="credit-license-files">
        {licenseFiles.map(([commit, own], index) => (
          <React.Fragment key={commit}>
            {index > 0 && ", "}
            <a href={own[0]!.license.fileUrl} rel="noreferrer noopener">
              Licence file at <code>{shortCommit(commit)}</code><span className="visually-hidden"> of {repository}</span>
            </a>
          </React.Fragment>
        ))}
      </p>
      <ul className="credit-files">
        {credits.map((credit) => (
          <li key={`${credit.commit}/${credit.path}`}>
            <a href={credit.fileUrl} rel="noreferrer noopener"><code>{credit.path}</code></a>{" "}
            <span className="credit-meta">at <code>{shortCommit(credit.commit)}</code>, by {credit.author}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function Credits({ credits }: { readonly credits: readonly Credit[] }) {
  const licenses = groupBy(credits, ({ license }) => license.spdx);
  const repositories = new Set(credits.map(({ repository }) => repository)).size;
  return (
    <main className="info-page" aria-labelledby="credits-title">
      <h1 id="credits-title">Credits</h1>
      <p className="info-lead">
        Every round shows a short excerpt of real open-source code. These are the {credits.length.toLocaleString("en-US")} files the rounds come
        from, in {repositories.toLocaleString("en-US")} repositories, grouped by licence. Each repository links its own licence file at the commit
        its files were read at, which holds its copyright notice; each licence links its text.
      </p>
      <p>
        An excerpt is a changed copy: a window of its file, and in some rounds without its comments, with names hidden as <code>mystery</code>,
        or with a line left out. A reveal names the file, its author, and its licence. The projects named here don’t endorse CodeGuessr.
      </p>
      <nav aria-label="Licences">
        <ul className="info-list">
          {licenses.map(([spdx, own]) => (
            <li key={spdx}><a href={`#license-${spdx}`}>{own[0]!.license.name}</a> ({own.length.toLocaleString("en-US")} files)</li>
          ))}
        </ul>
      </nav>
      {licenses.map(([spdx, own]) => (
        <section key={spdx} className="credit-license" aria-labelledby={`license-${spdx}`}>
          <h2 id={`license-${spdx}`}>{own[0]!.license.name} <span className="credit-spdx">({spdx})</span></h2>
          <p>
            {LICENSE_NOTES[spdx] ?? "Its text says what it asks."}{" "}
            <a href={`https://spdx.org/licenses/${spdx}.html`} rel="noreferrer noopener">The {own[0]!.license.name} text</a>.
          </p>
          <ul className="credit-repositories">
            {groupBy(own, ({ repository }) => repository).map(([repository, files]) => (
              <RepositoryCredits key={repository} repository={repository} credits={files} />
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

/** The credits page, outside any game: the original theme, unless a lab tester picks one. */
export default async function CreditsPage({ searchParams }: PageProps) {
  const loaded = activeLocalRealExperiment();
  const query = await searchParams;
  const theme = (labMode() ? labOverrides(query).theme : undefined) ?? CONTROL.theme;
  return (
    <PageFrame theme={theme}>
      <nav className="deck-nav" aria-label="Decks"><a href="/">All decks</a></nav>
      {loaded.ok ? <Credits credits={loaded.experiment.credits} /> : <ArtifactUnavailable reason={loaded.reason} />}
    </PageFrame>
  );
}
