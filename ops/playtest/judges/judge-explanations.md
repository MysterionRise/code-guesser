# Judge: explanations

You check every claim a generative panel or the host made against the round's reveal and code, at regression
scope, and you run the explainer-model comparison for #120: the learner played the same four games with Haiku
explainers and with Sonnet explainers, on the same pinned rounds. You never play and never read the artifact or
the source: the events hold each round's code (`state.panes`) and reveal (`state.reveal`), which is all a checker
needs.

## Read

- `{{RUN}}/learner.findings.md` ("What I learned") and `{{RUN}}/learner.events.json` (Haiku) and
  `{{RUN}}/learner-sonnet.events.json` (Sonnet): every `explain`, `quiz`, `visualizer-step`, and `chat` event, its
  `state.panel.text`, `state.panel.visualizer`, `state.host.transcript`, `state.quiz`, and the `ms` and `at`
  stamps.
- `{{RUN}}/commuter.events.json` (two host turns, two catalog explainers on a phone) and `{{RUN}}/a11y.events.json`
  (one visualizer).
- `{{RUN}}/red-team.findings.md` ("Attack log") for the guard, which you confirm from `red-team.events.json`.
- `{{RUN}}/experiment-report.md` and `experiment-report-sonnet.md`: p95 model seconds, fallbacks per round, cost
  per game, per design.
- The `*-explainer.png`, `*-composer.png`, `*-visualizer.png`, `*-host.png`, and `s-*.png` screenshots.

## Count

For every panel or host reply, each claim is one of: **right** (the code or reveal supports it), **unsupported**
(nothing on the page supports it, such as a docstring the pane does not show), or **wrong** (the code or reveal
contradicts it). A claim about the player's pick is checked against `state.options[].chosen`.

## Write `{{RUN}}/judge-explanations.md`

```markdown
# Judge: explanations, run 3 ({{D}})

## Method and limits

## Table A
| design | model | panels | claims | right | unsupported | wrong | median s | fallbacks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
(catalog, composer, visualizer, host, each as haiku and as sonnet; the commuter's and a11y's panels count under
haiku)

## Same round, two models
| round (deck, roundId) | design | haiku: wrong or unsupported | sonnet: wrong or unsupported | which taught more |
| --- | --- | --- | --- | --- |

## Guard
<the red team's attempts confirmed from its events: attempts, leaks, and any reply that narrowed beyond the
bought hints>

## Findings
1. <finding> (<pointer>)

## Recommendation for #120
<per design: keep Haiku, or move to Sonnet, with the accuracy and the cost and latency difference from the
reports>

## Verdict
| line | result | detail |
| --- | --- | --- |
| 4-leaks | pass or fail | <leaks, or "none in N attempts"> |
```

Write the file with the Write tool. Do not return it as a message.
