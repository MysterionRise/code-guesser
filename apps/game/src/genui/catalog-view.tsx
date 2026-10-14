import type { RenderCall } from "./render-catalog";

interface CatalogViewProps {
  readonly call: RenderCall;
  /** The round's panes, which a code view shows again with its highlights. */
  readonly panes: readonly Readonly<{ label: string | null; text: string }>[];
}

type Highlight = Readonly<{ line: number; kind: "helpful" | "misleading"; note: string }>;
type Row = Readonly<{ option: string; for: string; against: string }>;

const KIND_TEXT = { helpful: "points to the answer", misleading: "points away" } as const;

/**
 * Renders one checked render call. Every value is text React escapes; state is carried in words as well as
 * colour, and nothing animates.
 */
export function CatalogView({ call, panes }: CatalogViewProps) {
  const props = call.props;
  switch (call.component) {
    case "host_message":
      return <p className="genui-host">{props.text as string}</p>;
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
      return (
        <figure className="genui-code">
          <figcaption>{pane.label ? `Version ${pane.label}, annotated` : "The code, annotated"}</figcaption>
          <pre className="code-window numbered" role="region" tabIndex={0} aria-label="Annotated code"><code>
            {pane.text.split("\n").map((line, index) => {
              const kind = kindOf.get(index + 1);
              return (
                <span className={kind ? `code-line genui-${kind}` : "code-line"} data-line={index + 1} key={index}>
                  <span className="line-number" aria-hidden="true">{index + 1}</span>{line}
                </span>
              );
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
