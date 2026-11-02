# Run 3: the fun run

The third agent playtest judges whether CodeGuessr is enjoyable, interesting, and not dull, before public play
(v1.1). Runs 1 and 2 scoped fun out; this run puts it first, keeps the explanation, UX, accessibility, and
answer-lock checks at regression scope, and folds in the explainer-model pilot for #120.

The prompts are checked in: `personas/_common.md` is prepended to each `personas/<persona>.md`, and each
`judges/<judge>.md` stands alone. The lead fills the placeholders (`{{RUN}}`, `{{DRIVER}}`, `{{DRIVER_SONNET}}`,
`{{D}}`, `{{D_MINUS_1}}`, `{{CHALLENGE_LINK}}`, `{{RESULT_LINK}}`) and spawns each as a Claude Code subagent with
the model below.

## Matrix

| Persona | Model | Games | Purpose |
| --- | --- | --- | --- |
| regular | Sonnet | exercise three times in a row by "Deal new rounds"; today's five on D−1 and D with the clock faked, then the chooser; mixed on Arcade | repetition, the day streak, replay pull, the chooser's records |
| commuter | Haiku, phone | language, output, before-after, missing-line on their pinned deals; mixed with the host | layout, pace, the chat and the explainer at 390 px |
| duel-pair | Sonnet, two sessions | Ana plays language `d0e1d0e1`, challenges; Ben plays it, sends the result, rematches; Ana opens the result; then the same on today's five | both sides of a duel, tension, verdict copy, rematch, `firstPlay` |
| streaker | Haiku, Arcade | fix four times, name-function twice, missing-line pinned; the chooser after games 2, 4, and 7 | the streak chase, the 50/50 hint as a decision, the record line |
| learner | Sonnet | algorithm (catalog, layer on), language (composer, layer on), framework (visualizer), exercise (host), project (composer), algorithm layer off; the four generative games again on the Sonnet server | reveal quality, hint teaching, the layers, the designs, the #120 pilot |
| blind | Haiku, `blind: true` | every deck on its pinned deal, layer off; algorithm and language with the layer on; guesses at stage 0, 1, and 2; one sighted control | difficulty calibration, the layer-leak regression |
| red-team | Haiku | fix and mixed with the host, 14 attacks; tampered duel links and odd addresses | leaks, refusal pages |
| a11y | Haiku, Contrast | before-after by keyboard, algorithm with the visualizer and the trace stepper, language on a phone; the chooser with records, the challenge intro, the result page | regression, the duel pages and the records by keyboard |

| Judge | Model | Writes |
| --- | --- | --- |
| judge-copy | Sonnet | `judge-copy.md`: every player-visible string classed, what each deck says five times, bar line 2 |
| judge-difficulty | Sonnet | `judge-difficulty.md`: per-deck blind accuracy by stage, hint value, bar line 3 |
| judge-fun | Opus | `judge-fun.md`: Table A (13 rows by F1 to F8), Table B (arms), fun and dull, fixes, bar lines 1 and 1b |
| judge-explanations | Sonnet | `judge-explanations.md`: claims per design and model, the #120 comparison, the guard, bar line 4-leaks |
| judge-ux | Sonnet | `judge-ux.md`: phone and duel surfaces, defects by severity, bar lines 4 and 5 |

About 46 games on the Haiku server and 4 on the Sonnet server, 13 subagents, roughly 3.5 hours.

## Seeds and dates

Pinned deals are `DEAL_SEEDS` in `ops/demo/record/scenes.ts`, reached as `"deal": "demo"`: project `c0de000a`,
language `5eed000d`, algorithm `5eed000f`, framework `5eed0018`, exercise `c0de0010`, before-after `c0de000c`,
output `5eed001c`, fix `5eed0009`, missing-line `5eed001f`, name-function `c0de0014`. The duel seed is `d0e1d0e1`
(language), dealt by Ana only, so her challenge says "First try".

D is the server's UTC date when the run starts; D−1 is the day before. Both go in `run.json`. The server accepts a
daily date within a day of its own, so the run must finish D's games before UTC midnight or restart with a new D.

## Serve

Build once, then two servers from the same build, each with its own event directory (two processes must not
append one JSONL file):

```bash
pnpm --filter @codeguessr/game build
RUN="ops/playtest/tmp/$(date -u +%F)-run3"
mkdir -p "$RUN/events" "$RUN/events-sonnet"
```

Haiku explainers (the default model), port 3300:

```bash
cd apps/game && GENUI_ENABLED=1 EXPERIMENT_LAB=1 EXPERIMENT_SOURCE=agent \
  EXPERIMENT_EVENTS_DIR="$PWD/../../$RUN/events" \
  OPENROUTER_API_KEY="$(cat ~/.config/openrouter/key)" \
  node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3300
```

Sonnet explainers, port 3301:

```bash
cd apps/game && GENUI_ENABLED=1 EXPERIMENT_LAB=1 EXPERIMENT_SOURCE=agent \
  EXPERIMENT_EVENTS_DIR="$PWD/../../$RUN/events-sonnet" \
  OPENROUTER_MODEL=anthropic/claude-sonnet-5.5 \
  OPENROUTER_API_KEY="$(cat ~/.config/openrouter/key)" \
  node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3301
```

Two drivers, one per server, writing to the same run folder (session names never collide: only `learner-sonnet`
uses the second):

```bash
node ops/playtest/driver.mjs --game http://127.0.0.1:3300 --port 4100 --out "$RUN"
node ops/playtest/driver.mjs --game http://127.0.0.1:3301 --port 4101 --out "$RUN"
```

Both need Node 24 (`nvm use`): the driver imports `ops/demo/record/scenes.ts` for the pinned seeds.

## The lead, step by step

1. Write `run.json`: the commit, D and D−1, the seeds, the model per persona and judge, the driver and server
   addresses, the start time. The duel links are added once the pair writes them.
2. Dry run: one session on the phone viewport, `start` with `"deal": "demo"` on language, `goto /`, `clock`, one
   `aria`, one `GET records`. If any endpoint misbehaves, fix the driver first; never the game.
3. Compose each persona's prompt: `personas/_common.md` then `personas/<persona>.md`, placeholders filled. Spawn
   in parallel, with `model` set per the matrix: blind, commuter, streaker on Haiku; regular, learner, duel-pair on
   Sonnet. Each prompt ends: "Write `{{RUN}}/<persona>.findings.md` with the Write tool and return one line."
4. When duel-pair finishes, copy `CHALLENGE_LINK` and `RESULT_LINK` from its "Both sides" section into
   `run.json`, then spawn red-team and a11y (Haiku) with the links filled in.
5. As each persona ends, check that its findings file exists with the fixed headings. If an agent returned text
   instead (run 2's red team did), write the file as the lead from its text and note it in `run.json`.
6. The reports:

   ```bash
   pnpm experiment:report --dir="$RUN/events" --source=agent --json="$RUN/experiment-report.json" > "$RUN/experiment-report.md"
   pnpm experiment:report --dir="$RUN/events-sonnet" --source=agent --json="$RUN/experiment-report-sonnet.json" > "$RUN/experiment-report-sonnet.md"
   ```

7. Spawn judge-copy and judge-difficulty (Sonnet) in parallel; when both have written their files, spawn judge-fun
   (Opus), judge-explanations, and judge-ux (Sonnet) in parallel. Each prompt is its `judges/<judge>.md` with the
   placeholders filled.
8. `node ops/playtest/aggregate.mjs --run "$RUN"`, then read `aggregate.md` against the release bar. Fill bar line
   6 by hand from duel-pair's "Both sides".
9. Write `docs/review/evidence/<date>-agent-playtest-run-3-fun.md` with run 2's frontmatter (`evidence`,
   `observed-at`, `outcome`, `artifact-published: false`, `credential-material-recorded: false`): setup, the bar
   with each line's result, what each persona found, where the judges disagreed, the #120 comparison and the
   decision, the OpenRouter cost read off the key, "Checked and not changed", "Still open". Add a row to
   `docs/review/README.md`. File the issues. Fill the results block below. Open the PR.

## Release bar

Every line must hold.

1. No deck, mixed, daily, or duel row below 3 on any of F1 to F8 in judge-fun's Table A.
   1b. No arm below 3 on F2 or F3 in Table B.
2. judge-copy: no string classed "repeated, no new information" seen in more than 2 rounds of one game; no jargon
   on the chooser, the verdict, the points note, the answer line, or the completion line.
3. judge-difficulty: no deck where blind stage-2 accuracy (layer off) is 80% or more; hint 1 lifts blind accuracy
   by 10 points or more on every deck; algorithm layer-on stage-0 accuracy not above run 2's 70%.
4. judge-ux: zero P0 defects, every P1 filed; every tampered duel link gets a page, not an error. judge-explanations:
   zero leaks (4-leaks).
5. judge-ux: no regression on run 2's fixed items; the duel pages and the chooser's records reachable by keyboard.
6. duel-pair: challenge, comparison, result, and rematch correct for both duels; `duel_created.firstPlay` is `yes`
   for Ana's language game and `shared` for today's five (read from `events/`).
7. Both experiment reports read the run with 0 refused lines.

## Issues

Anything failing a line becomes one issue:

```
Title: [playtest run 3] <deck or arm>: <symptom>
Label: playtest-run-3
Body:
- Judge and dimension: <judge-fun F3>, or <judge-ux P1>
- Evidence: <findings section, events file and index, screenshot>
- Proposed fix: <what, where>
- Blocks release: yes or no (bar line N)
```

## Results

(filled by the lead after the run)

- Run folder:
- Commit:
- D, D−1:
- Games played, rounds, generative calls, OpenRouter spend:
- Bar: 1 –, 1b –, 2 –, 3 –, 4 –, 4-leaks –, 5 –, 6 –, 7 –
- Evidence doc:
- Issues:
