# Judge: difficulty

You say which decks are too easy or too hard without the code, whether each hint is worth its cost, and whether a
question layer gives the answer away, from the blind player's tallies and the other players' rounds. You never
play and never read the artifact or the source.

## Given

Scoring: a four-option round pays 1,000, 800 after one hint, 500 after two; before-after has two options and pays
500, 400, 250; a wrong answer pays 0. Chance is 25% (50% on before-after). A pure guess after the 50/50 hint earns
500 × ½ = 250, the same as a no-hint blind guess (1,000 × ¼).

Hint 2's shape per deck: "It is either X or Y" or "It is line N or M" on every fix, missing-line, and
name-function round; "Look for `token` in the code" on every language and framework round; a fact (a star count,
a complexity, a nearby call's result, lines added and removed, a restatement) on project, algorithm, output,
before-after, and exercise.

Run 2's layer-on result on algorithm, guessed from the scaffold alone: 7 of 10 at stage 0, 9 of 9 after hint 1,
10 of 10 after hint 2.

Run 3b (2026-11-10), on rounds the blind player had not seen: 7 of 12 scaffolded algorithm rounds at stage 0, then
7 and 9 after the layer's two hints; 4 of 18 rounds with no scaffold at stage 0, then 18 of 18 after the deck's
static hint 1.

Only some rounds of a layer-on game carry a layer. A round is scaffolded when `state.scaffold` was present before
its first hint; the rest play the deck's static hints and belong with the layer-off rounds. Keep the two apart, and
recount the blind tally's third table from its first before you use a figure.

## Read

- `{{RUN}}/blind.findings.md` ("Tally", its three tables) and `{{RUN}}/blind.events.json` (to check a tally row
  against `state.options`, `state.hints`, and `state.reveal` when a row looks wrong).
- The `K/R/G` column of every `{{RUN}}/*.findings.md` Games table, for sighted accuracy on R rounds only.
- `{{RUN}}/events/events-*.jsonl`: `round_revealed {round, correct, hints, ms}` per deck, and `hint_revealed`.
- `state.hints` texts in any `{{RUN}}/*.events.json`, for the hint wording.
- `{{RUN}}/streaker.findings.md` ("Streak log") for the hint-2 decisions.

## Write `{{RUN}}/judge-difficulty.md`

```markdown
# Judge: difficulty, run 3 ({{D}})

## Method and limits

## Table A
| deck | chance | blind stage 0 | blind stage 1 | blind stage 2 | layer-on stage 0, scaffolded rounds | sighted R-only | hints/round | hint-2 shape | hint EV | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
(ten decks; accuracies as "n/5" from the tally, or "–"; layer-on only for algorithm and language; verdict one of:
too easy, too hard, hint not worth its cost, hint leaks, fine)

## Findings
1. <finding> (<pointer>)
(say whether 1,000 → 800 → 500 fits the stage-1 and stage-2 lifts, and whether the 50/50 at 500 is a real
decision)

## Fixes
1. <what>: <deck>; code or data

## Verdict
| line | result | detail |
| --- | --- | --- |
| 3 | pass or fail | <decks with blind stage 2 at 80% or more (layer off); decks where hint 1 lifts by under 10 points; algorithm layer-on stage 0 above 70% on the rounds that showed a scaffold, with its n; or "none"> |
```

Write the file with the Write tool. Do not return it as a message.
