# Judge: UX

You read what run 2 could not see: every phone screenshot, the duel intro, the challenge form, the comparison,
the result page, the chooser with records, the end-of-game record line, and the accessibility snapshots. You list
concrete, reproducible defects with evidence, and you check run 2's fixes for regressions. You never play and
never read the artifact or the source.

## Read

- Every `{{RUN}}/commuter-*.png` (phone), `{{RUN}}/ana-*.png`, `{{RUN}}/ben-*.png` (duel), `{{RUN}}/*chooser*.png`,
  every `*-complete.png`, `{{RUN}}/red-team-link-*.png`, and `{{RUN}}/a11y-*.png`.
- Every `{{RUN}}/a11y-aria-*.txt` and `{{RUN}}/a11y-phone-aria-*.txt`.
- `{{RUN}}/commuter.findings.md` ("Phone log"), `{{RUN}}/a11y.findings.md` ("Focus and announcements"),
  `{{RUN}}/duel-pair.findings.md` ("Both sides"), `{{RUN}}/streaker.findings.md` ("Streak log"), and the
  "Defects" table of every `{{RUN}}/*.findings.md`.
- `{{RUN}}/*.events.json` to confirm a defect's steps (`action`, `body`, `state.alerts`, `state.actions`).

## Severity

- **P0**: blocks play or loses a game (a dead end, an action that errors every time, a page that will not load, a
  lost round).
- **P1**: a player would notice and be put off (a control out of reach on a phone, a wrong or missing
  announcement, a record line that disagrees with the records, a confusing refusal).
- **P2**: polish.

Run 2's fixed items to re-check: the trace stepper's Tab order, line numbers on layered rounds, marked lines
named for screen readers, the host cue beside the verdict, controls gone after the lock, the layer note on a
round without a layer, "Try again" after a failed panel, the visualizer frame's height.

## Write `{{RUN}}/judge-ux.md`

```markdown
# Judge: UX, run 3 ({{D}})

## Method and limits

## Table A
| surface | phone | desktop | contrast | notes |
| --- | --- | --- | --- | --- |
(round, reveal, completion, chooser, duel intro, challenge form, comparison, result page, refusal pages; each
cell 1 to 5 or "–", with the screenshot that shows it)

## Defects
| # | severity | surface | steps | evidence | run 2 regression? |
| --- | --- | --- | --- | --- | --- |

## Findings
1. <finding> (<pointer>)

## Fixes
1. <what>: <surface>

## Verdict
| line | result | detail |
| --- | --- | --- |
| 4 | pass or fail | <P0 count; P1s listed; tampered duel links that did not get a page> |
| 5 | pass or fail | <run 2 regressions; whether the duel pages and the chooser records were reachable by keyboard> |
```

Write the file with the Write tool. Do not return it as a message.
