import * as React from "react";

import type { HintDetail, RoundScaffold } from "./mode-contract";

/**
 * A question layer in the round (#128): its free scaffold above the code, and a step-through hint as a stepper. The
 * scaffold was audited before it was published, so it says nothing that tells the answer.
 */
export function QuestionScaffold({ scaffold }: { readonly scaffold: RoundScaffold }) {
  return scaffold.design === "trace-it" ? (
    <section className="question-scaffold" aria-label="What to watch">
      <h2 className="scaffold-title">What to watch</h2>
      <ul className="scaffold-list">
        {scaffold.watch.map(({ name, role }) => <li key={name}><code>{name}</code> <span className="scaffold-role">— {role}</span></li>)}
      </ul>
    </section>
  ) : (
    <section className="question-scaffold" aria-label="Ask of the code">
      <h2 className="scaffold-title">Ask of the code</h2>
      <ul className="scaffold-list">{scaffold.prompts.map((prompt) => <li key={prompt}>{prompt}</li>)}</ul>
    </section>
  );
}

/** A step-through hint: the input, then one frame at a time, announced as it changes. */
export function TraceStepper({ detail }: { readonly detail: Extract<HintDetail, { kind: "trace" }> }) {
  const [step, setStep] = React.useState(0);
  const frame = detail.frames[step]!;
  return (
    <div className="trace-stepper" role="group" aria-label="Step-through">
      <p className="trace-input">Input: <code>{detail.input}</code></p>
      <p className="trace-frame" aria-live="polite">
        <span className="trace-count">Step {step + 1} of {detail.frames.length}:</span> {frame.label} <span aria-hidden="true">→</span>{" "}
        <code>{frame.state}</code>
      </p>
      <div className="trace-controls">
        <button type="button" className="hint-button" onClick={() => setStep(step - 1)} disabled={step === 0}>Back</button>
        <button type="button" className="hint-button" onClick={() => setStep(step + 1)} disabled={step === detail.frames.length - 1}>Next step</button>
      </div>
    </div>
  );
}

/** The pane lines a round's bought hints mark. */
export const markedLines = (details: readonly (HintDetail | null)[]): ReadonlySet<number> =>
  new Set(details.flatMap((detail) => detail?.kind === "lines" ? detail.lines : []));
