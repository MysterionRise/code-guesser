# Agent playtests (#116)

A Claude Code agent team plays the real game through `driver.mjs` and compares
the four generative designs (#114, #115, #104, and the catalog explainer). The
team is cheap and fast, and good at three things:
- finding bugs and confusing UI;
- judging which design explains a round better;
- attacking the answer-lock guard.

It does not replace real players. Agent players already know most answers, so
their accuracy and "fun" are not a real player's; the real experiment is #106–#108.

## Run it

1. **Serve the game** with generative UI and the OpenRouter key from its standard
   store:

   Lab mode (`EXPERIMENT_LAB=1`) lets players pick designs with `?design=`; a
   production build otherwise draws each game's design at random (#106). The
   event log is optional; `EXPERIMENT_SOURCE=agent` keeps its events apart from
   real games.

   ```bash
   pnpm --filter @codeguessr/game build
   cd apps/game && GENUI_ENABLED=1 EXPERIMENT_LAB=1 EXPERIMENT_SOURCE=agent \
     EXPERIMENT_EVENTS_DIR="$PWD/../../ops/playtest/tmp/<run>/events" \
     OPENROUTER_API_KEY="$(cat ~/.config/openrouter/key)" \
     node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3300
   ```

2. **Start the driver.** Its run folder `ops/playtest/tmp/<run>/` is ignored by
   git.

   ```bash
   node ops/playtest/driver.mjs --game http://127.0.0.1:3300 --port 4100 --out ops/playtest/tmp/<run>
   ```

3. **Spawn the players**, Claude Haiku subagents, one per persona. Each opens its
   own session and plays every design:

   ```bash
   curl -s -X POST localhost:4100/sessions -d '{"name":"<persona>"}'
   curl -s -X POST localhost:4100/sessions/<id>/start -d '{"deck":"algorithm","design":"composer"}'
   ```

   `driver.mjs` lists every endpoint in its header.

4. **Spawn the judges**, Claude Sonnet subagents, once the players finish. They
   read each player's findings and the driver's `<persona>.events.json` and
   screenshots.

5. **Collect the result.** Write the comparison to `docs/review/evidence/`, and
   file the findings as issues.

## Personas

| Persona | Plays as | Looks for |
| --- | --- | --- |
| `novice` | new to programming; reads slowly, buys hints, asks the host for help | whether each design teaches something a beginner can follow |
| `expert` | senior engineer; plays fast | technical accuracy: every claim in a panel checked against the code and the reveal |
| `skimmer` | never reads code closely; clicks through | confusing UI, dead ends, slow or broken states |
| `a11y` | keyboard and screen-reader user: `keys`, `aria`, no mouse-only reasoning | labels, focus order, announcements, colour-only meaning |
| `red-team` | tries to get the answer before locking in | any leak: host jailbreaks, pasted code, prompt injection, anything the panel shows early |

## What a player does

- **Each design:** `catalog`, `composer`, `visualizer`, `host`.
  - Play at least two rounds, on different decks (`project`, `language`,
    `before-after`, `algorithm`, `output`, `fix`).
  - Use the design's features: explain or visualize after answering, step a
    visualizer, answer a composer quiz, chat with the host before and after
    locking in, and buy a hint the host offers.
  - Take a screenshot after each generative panel renders.
- **Play only through the driver.** Never read the repository's artifact or
  source: that would give away answers.
- **Write `<persona>.findings.md`** in the run folder:
  - for each design: what worked; what confused or broke (with the session
    event that shows it); scores from 1 to 5 for clarity, helpfulness,
    accuracy, and fun; and the single best and worst moment.
  - a closing ranking of the four designs, with reasons.

## What the judges do

- **`judge-explanations`** reads every panel and host reply in the events, and
  checks each claim against the round's reveal and code.
- **`judge-ux`** reads the screenshots and the accessibility snapshots.

Each judge scores the four designs from 1 to 5 on:
- accuracy;
- clarity;
- teaching value (does a player read code better next round?);
- visual quality;
- accessibility;
- cost in time.

They list concrete, reproducible defects with the evidence for each.
