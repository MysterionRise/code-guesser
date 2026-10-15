import * as React from "react";

import { PANE_CAPTIONS } from "./arcade-text";
import type { PublicRound } from "./mode-contract";

/** A line's own indentation in character widths, a tab counting as the pane's four. */
export const indentWidth = (line: string): number =>
  [.../^[ \t]*/u.exec(line)![0]].reduce((width, character) => width + (character === "\t" ? 4 : 1), 0);

/**
 * The indentation every non-blank line shares, as a prefix to drop for display (#85); line numbers stay the same.
 * Lines that share no common whitespace prefix keep it all.
 */
export const commonIndent = (lines: readonly string[]): string => {
  const prefixes = lines.filter((line) => line.trim().length > 0).map((line) => /^[ \t]*/u.exec(line)![0]);
  if (prefixes.length === 0) return "";
  let common = prefixes[0]!;
  for (const prefix of prefixes) while (!prefix.startsWith(common)) common = common.slice(0, -1);
  return common;
};

/** Wrapped lines hang under their own indentation, two characters further in (#46). */
const hanging = (line: string, wrap: boolean): React.CSSProperties | undefined =>
  wrap ? ({ "--indent": `${indentWidth(line)}ch` } as React.CSSProperties) : undefined;

/**
 * The round's code: one pane, or two versions side by side. A fix round numbers its lines, and the line under the
 * focused or chosen option (or, once revealed, the answer) is highlighted. A numbered pane drops the indentation all
 * its lines share (#85). With "Wrap lines" on, long lines wrap, each under its own indentation (#46).
 */
export function CodePanes({ round, numbered, paneLines, highlighted, marked = new Set(), wrap, onToggleWrap }: {
  readonly round: Readonly<PublicRound>;
  readonly numbered: boolean;
  /** The single pane's lines when the round numbers them; empty otherwise. */
  readonly paneLines: readonly string[];
  readonly highlighted: number | undefined;
  /** Lines a bought hint points at (#128). */
  readonly marked?: ReadonlySet<number>;
  readonly wrap: boolean;
  readonly onToggleWrap: () => void;
}) {
  const dropped = numbered ? commonIndent(paneLines).length : 0;
  return (
    <div className={`${round.content.panes.length > 1 ? "code-panes compare" : "code-panes"}${wrap ? " wrap" : ""}`}>
      <button type="button" className="wrap-toggle" aria-pressed={wrap} onClick={onToggleWrap}>Wrap lines</button>
      {round.content.panes.map((pane, index) => (
        <figure className="code-pane" key={pane.label ?? index}>
          {pane.label ? <figcaption>Version {pane.label}</figcaption>
            : PANE_CAPTIONS[round.mode.kind] && <figcaption className="pane-note">{PANE_CAPTIONS[round.mode.kind]}</figcaption>}
          {numbered
            ? <pre className="code-window numbered" role="region" tabIndex={0} aria-label="Code excerpt with numbered lines"><code>
                {paneLines.map((raw, lineIndex) => {
                  const line = raw.slice(dropped);
                  return (
                    <span className={lineIndex + 1 === highlighted ? "code-line highlighted" : marked.has(lineIndex + 1) ? "code-line hinted" : "code-line"}
                      data-line={lineIndex + 1} key={lineIndex} style={hanging(line, wrap)}>
                      <span className="line-number" aria-hidden="true">{lineIndex + 1}</span>{line}
                    </span>
                  );
                })}
              </code></pre>
            : <pre className="code-window" role="region" tabIndex={0} aria-label={pane.label ? `Code, version ${pane.label}` : "Code excerpt"}><code>
                {wrap
                  ? pane.text.split("\n").map((line, lineIndex) => <span className="code-line" key={lineIndex} style={hanging(line, wrap)}>{line}{"\n"}</span>)
                  : pane.text}
              </code></pre>}
        </figure>
      ))}
    </div>
  );
}
