import type { RenderCall } from "./render-catalog";

/** The round's next hint, as the host may offer it: what pressing the button costs, or null when none is left. */
export interface HintOffer {
  readonly label: string | null;
  readonly buy: () => void;
}

interface CatalogViewProps {
  readonly call: RenderCall;
  /** The round's panes, which a code view shows again with its highlights. */
  readonly panes: readonly Readonly<{ label: string | null; text: string }>[];
  readonly hint?: HintOffer;
}

type Highlight = Readonly<{ line: number; kind: "helpful" | "misleading"; note: string }>;
type Row = Readonly<{ option: string; for: string; against: string }>;

const KIND_TEXT = { helpful: "points to the answer", misleading: "points away" } as const;

/**
 * The line numbers a code view shows: each highlight with two lines either side, in order. The round's code is
 * already on screen above, so the view repeats only what it annotates (the UX judge found the full repeat long).
 */
export const excerptLines = (lineCount: number, highlighted: readonly number[], context = 2): number[] => {
  const shown = new Set<number>();
  for (const line of highlighted) {
    for (let at = Math.max(1, line - context); at <= Math.min(lineCount, line + context); at += 1) shown.add(at);
  }
  return [...shown].sort((left, right) => left - right);
};

/**
 * Renders one checked render call. Every value is text React escapes; state is carried in words as well as
 * colour, and nothing animates.
 */
export function CatalogView({ call, panes, hint }: CatalogViewProps) {
  const props = call.props;
  switch (call.component) {
    case "host_message":
      return <p className="genui-host">{props.text as string}</p>;
    case "offer_hint":
      // The host only suggests; the player decides, and the hint costs what the round's own button says.
      return (
        <p className="genui-offer">
          {props.reason as string}{" "}
          {hint === undefined ? <span className="genui-status">(offer closed)</span>
            : <button type="button" className="hint-button" disabled={!hint.label} onClick={hint.buy}>{hint.label ?? "No hint left"}</button>}
        </p>
      );
    case "takeaway":
      return <p className="genui-takeaway"><strong>Takeaway:</strong> {props.text as string}</p>;
    case "signal_list":
      return (
        <div className="genui-signals">
          <h4>Pointed to the answer</h4>
          <ul>{(props.helpful as readonly string[]).map((signal, index) => <li key={index}>{signal}</li>)}</ul>
          <h4>Pointed away</h4>
          <ul>{(props.misleading as readonly string[]).map((signal, index) => <li key={index}>{signal}</li>)}</ul>
        </div>
      );
    case "code_view": {
      const pane = panes[(props.pane as number) - 1];
      if (pane === undefined) return null;
      const highlights = props.highlights as readonly Highlight[];
      const kindOf = new Map(highlights.map(({ line, kind }) => [line, kind]));
      const lines = pane.text.split("\n");
      return (
        <figure className="genui-code">
          <figcaption>{pane.label ? `Version ${pane.label}, annotated` : "The code, annotated"}</figcaption>
          <pre className="code-window numbered" role="region" tabIndex={0} aria-label="Annotated code"><code>
            {excerptLines(lines.length, highlights.map(({ line }) => line)).flatMap((number, index, shown) => {
              const kind = kindOf.get(number);
              const gap = index > 0 && number !== shown[index - 1]! + 1;
              return [
                ...(gap ? [<span className="code-line code-gap" key={`gap-${number}`} aria-hidden="true">⋯</span>] : []),
                <span className={kind ? `code-line genui-${kind}` : "code-line"} data-line={number} key={number}>
                  <span className="line-number" aria-hidden="true">{number}</span>{lines[number - 1]}
                </span>,
              ];
            })}
          </code></pre>
          <ol className="genui-notes">
            {highlights.map(({ line, kind, note }, index) => <li key={index}>Line {line}, {KIND_TEXT[kind]}: {note}</li>)}
          </ol>
        </figure>
      );
    }
    case "comparison":
      return (
        <table className="genui-comparison">
          <caption>The options side by side</caption>
          <thead><tr><th scope="col">Option</th><th scope="col">For</th><th scope="col">Against</th></tr></thead>
          <tbody>
            {(props.rows as readonly Row[]).map((row, index) => (
              <tr key={index}><th scope="row">{row.option}</th><td>{row.for}</td><td>{row.against}</td></tr>
            ))}
          </tbody>
        </table>
      );
  }
}
