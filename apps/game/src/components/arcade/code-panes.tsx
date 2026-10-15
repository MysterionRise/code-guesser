import * as React from "react";

import { PANE_CAPTIONS } from "./arcade-text";
import type { PublicRound } from "./mode-contract";

/**
 * The round's code: one pane, or two versions side by side. A fix round numbers its lines, and the line under the
 * focused or chosen option (or, once revealed, the answer) is highlighted.
 */
export function CodePanes({ round, numbered, paneLines, highlighted, marked = new Set() }: {
  readonly round: Readonly<PublicRound>;
  readonly numbered: boolean;
  /** The single pane's lines when the round numbers them; empty otherwise. */
  readonly paneLines: readonly string[];
  readonly highlighted: number | undefined;
  /** Lines a bought hint points at (#128). */
  readonly marked?: ReadonlySet<number>;
}) {
  return (
    <div className={round.content.panes.length > 1 ? "code-panes compare" : "code-panes"}>
      {round.content.panes.map((pane, index) => (
        <figure className="code-pane" key={pane.label ?? index}>
          {pane.label ? <figcaption>Version {pane.label}</figcaption>
            : PANE_CAPTIONS[round.mode.kind] && <figcaption className="pane-note">{PANE_CAPTIONS[round.mode.kind]}</figcaption>}
          {numbered
            ? <pre className="code-window numbered" role="region" tabIndex={0} aria-label="Code excerpt with numbered lines"><code>
                {paneLines.map((line, lineIndex) => (
                  <span className={lineIndex + 1 === highlighted ? "code-line highlighted" : marked.has(lineIndex + 1) ? "code-line hinted" : "code-line"}
                    data-line={lineIndex + 1} key={lineIndex}>
                    <span className="line-number" aria-hidden="true">{lineIndex + 1}</span>{line}
                  </span>
                ))}
              </code></pre>
            : <pre className="code-window" role="region" tabIndex={0} aria-label={pane.label ? `Code, version ${pane.label}` : "Code excerpt"}><code>{pane.text}</code></pre>}
        </figure>
      ))}
    </div>
  );
}
