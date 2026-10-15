"use client";

import * as React from "react";
import { defineCatalog } from "@json-render/core";
import { JSONUIProvider, Renderer, defineRegistry } from "@json-render/react";
import { schema } from "@json-render/react/schema";

import { COMPOSER_BLOCKS, COMPOSER_PROPS, type ComposerBlock, type ComposerSpec } from "./composer-spec";

type Pane = Readonly<{ label: string | null; text: string }>;
type Highlight = Readonly<{ line: number; kind: "helpful" | "misleading"; note: string }>;
type Choice = Readonly<{ label: string; correct: boolean; feedback: string }>;
type Props = Readonly<Record<string, unknown>>;

const catalog = defineCatalog(schema, {
  components: Object.fromEntries((Object.keys(COMPOSER_BLOCKS) as ComposerBlock[]).map((name) =>
    [name, { props: COMPOSER_PROPS[name], description: COMPOSER_BLOCKS[name] }])),
  actions: {},
} as never);

const KIND_TEXT = { helpful: "points to the answer", misleading: "points away" } as const;

/** "Right." or "Not quite." before the feedback, unless the model's feedback already opens with a verdict. */
export const verdictFor = ({ correct, feedback }: Choice): string =>
  /^(?:right|correct|yes|exactly|not quite|no|wrong|incorrect|close)\b/iu.test(feedback.trim()) ? feedback
    : `${correct ? "Right." : "Not quite."} ${feedback}`;

/** A one-question check: the choice stays picked and its feedback is announced; nothing leaves the page. */
function Quiz({ question, choices }: { question: string; choices: readonly Choice[] }) {
  const [picked, setPicked] = React.useState<number | null>(null);
  const id = React.useId();
  return (
    <fieldset className="composer-quiz">
      <legend>{question}</legend>
      {choices.map((choice, index) => (
        <label key={index} className={picked === index ? `composer-choice ${choice.correct ? "correct" : "missed"}` : "composer-choice"}>
          <input type="radio" name={id} checked={picked === index} onChange={() => setPicked(index)} />
          {choice.label}
        </label>
      ))}
      <p aria-live="polite" className="composer-feedback">{picked === null ? "" : verdictFor(choices[picked]!)}</p>
    </fieldset>
  );
}

/** The registry is built per round, so a code excerpt can show the round's own panes. */
const registryFor = (panes: readonly Pane[]) => defineRegistry(catalog, {
  components: {
    Stack: ({ props, children }: { props: Props; children?: React.ReactNode }) =>
      <div className={`composer-stack gap-${props.gap as string}`}>{children}</div>,
    Row: ({ children }: { children?: React.ReactNode }) => <div className="composer-row">{children}</div>,
    Card: ({ props, children }: { props: Props; children?: React.ReactNode }) =>
      <section className="composer-card"><h4>{props.title as string}</h4>{children}</section>,
    Details: ({ props, children }: { props: Props; children?: React.ReactNode }) =>
      <details className="composer-details"><summary>{props.summary as string}</summary>{children}</details>,
    Heading: ({ props }: { props: Props }) => <h4 className="composer-heading">{props.text as string}</h4>,
    Text: ({ props }: { props: Props }) => <p className="composer-text">{props.text as string}</p>,
    Callout: ({ props }: { props: Props }) => (
      <aside className={`composer-callout tone-${props.tone as string}`}>
        <strong className="composer-callout-title">{props.title as string}</strong> <span>{props.text as string}</span>
      </aside>
    ),
    CodeExcerpt: ({ props }: { props: Props }) => {
      const pane = panes[(props.pane as number) - 1];
      if (pane === undefined) return null;
      const from = props.from as number;
      const highlights = props.highlights as readonly Highlight[];
      const kindOf = new Map(highlights.map(({ line, kind }) => [line, kind]));
      const lines = pane.text.split("\n").slice(from - 1, props.to as number);
      return (
        <figure className="genui-code">
          <figcaption>{pane.label ? `Version ${pane.label}, lines ${from}–${props.to as number}` : `Lines ${from}–${props.to as number}`}</figcaption>
          <pre className="code-window numbered" role="region" tabIndex={0} aria-label="Code excerpt, annotated"><code>
            {lines.map((line, index) => {
              const number = from + index;
              const kind = kindOf.get(number);
              return (
                <span className={kind ? `code-line genui-${kind}` : "code-line"} data-line={number} key={number}>
                  <span className="line-number" aria-hidden="true">{number}</span>{line}
                </span>
              );
            })}
          </code></pre>
          {highlights.length > 0 && (
            <ol className="genui-notes">
              {highlights.map(({ line, kind, note }, index) => <li key={index}>Line {line}, {KIND_TEXT[kind]}: {note}</li>)}
            </ol>
          )}
        </figure>
      );
    },
    List: ({ props }: { props: Props }) => {
      const items = (props.items as readonly string[]).map((item, index) => <li key={index}>{item}</li>);
      return props.ordered ? <ol className="composer-list">{items}</ol> : <ul className="composer-list">{items}</ul>;
    },
    Table: ({ props }: { props: Props }) => (
      <table className="genui-comparison">
        <caption>{props.caption as string}</caption>
        <thead><tr>{(props.columns as readonly string[]).map((column, index) => <th scope="col" key={index}>{column}</th>)}</tr></thead>
        <tbody>
          {(props.rows as readonly (readonly string[])[]).map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, index) => index === 0 ? <th scope="row" key={index}>{cell}</th> : <td key={index}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    ),
    Badge: ({ props }: { props: Props }) => <span className={`composer-badge tone-${props.tone as string}`}>{props.text as string}</span>,
    Divider: () => <hr className="composer-divider" />,
    Quiz: ({ props }: { props: Props }) => <Quiz question={props.question as string} choices={props.choices as readonly Choice[]} />,
  },
} as never).registry;

/** Renders a checked composer spec; the parent has already validated it against `parseComposerSpec`. */
export function ComposerView({ spec, panes }: { readonly spec: ComposerSpec; readonly panes: readonly Pane[] }) {
  const registry = React.useMemo(() => registryFor(panes), [panes]);
  return (
    <div className="composer-panel">
      <JSONUIProvider registry={registry}>
        <Renderer spec={spec as never} registry={registry} />
      </JSONUIProvider>
    </div>
  );
}
