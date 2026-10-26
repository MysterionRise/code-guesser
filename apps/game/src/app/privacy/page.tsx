import type { Metadata } from "next";
import * as React from "react";

import { PageFrame } from "../../demo/page-frame";
import { CONTROL, labMode, labOverrides } from "../../experiment/arms";
import { DISCLOSURES, NEVER_RECORDED, type Disclosure, type DisclosureItem } from "../../privacy/disclosures";

/**
 * Privacy (#99): what CodeGuessr records about a game, and what each feature keeps or sends, rendered from the
 * disclosures registry, whose event log is the event schema in words. It reads no round and no request.
 */

export const metadata: Metadata = {
  title: "Privacy · CodeGuessr",
  description: "What CodeGuessr records about a game, and what it never records.",
};

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

function Fields({ items }: { readonly items: readonly DisclosureItem[] }) {
  return (
    <dl className="info-fields">
      {items.map(({ name, description }) => (
        <React.Fragment key={name}>
          <dt><code>{name}</code></dt>
          <dd>{description}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function DisclosureSection({ disclosure }: { readonly disclosure: Disclosure }) {
  const { id, title, summary, items, empty, events, links } = disclosure;
  return (
    <section aria-labelledby={`privacy-${id}`}>
      <h2 id={`privacy-${id}`}>{title}</h2>
      {summary.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      {items.length > 0 ? <Fields items={items} /> : empty && <p className="info-empty">{empty}</p>}
      {events && Object.entries(events).map(([type, { summary: what, fields }]) => (
        <div className="info-event" key={type}>
          <h3><code>{type}</code></h3>
          <p>{what}</p>
          {Object.keys(fields).length > 0 && <Fields items={Object.entries(fields).map(([name, description]) => ({ name, description }))} />}
        </div>
      ))}
      {links && (
        <ul className="info-list">
          {links.map(({ href, label }) => <li key={href}><a href={href} rel="noreferrer noopener">{label}</a></li>)}
        </ul>
      )}
    </section>
  );
}

/** The privacy page, outside any game: the original theme, unless a lab tester picks one. */
export default async function PrivacyPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const theme = (labMode() ? labOverrides(query).theme : undefined) ?? CONTROL.theme;
  return (
    <PageFrame theme={theme}>
      <nav className="deck-nav" aria-label="Decks"><a href="/">All decks</a></nav>
      <main className="info-page" aria-labelledby="privacy-title">
        <h1 id="privacy-title">Privacy</h1>
        <p className="info-lead">
          CodeGuessr has no accounts. It records how games go, never who plays them, so it can tell which version of the game is more fun.
        </p>
        <h2>Never recorded</h2>
        <ul className="info-list">
          {NEVER_RECORDED.map((never) => <li key={never}>{never}</li>)}
        </ul>
        {DISCLOSURES.map((disclosure) => <DisclosureSection key={disclosure.id} disclosure={disclosure} />)}
      </main>
    </PageFrame>
  );
}
