# Agent playtests (#116)

A Claude Code agent team plays the real game through `driver.mjs` and compares
the four generative designs (#114, #115, #104, and the catalog explainer), the
themes (#125), and the question layers (#127, #128). The team is cheap and
fast, and good at three things:
- finding bugs and confusing UI;
- judging which design explains a round better;
- attacking the answer-lock guard.

It does not replace real players. Agent players already know most answers, so
their accuracy and "fun" are not a real player's; the real experiment is #106–#108.

## Run it

1. **Serve the game** with generative UI and the OpenRouter key from its standard
   store (or `ANTHROPIC_API_KEY="$(cat ~/.config/anthropic/key)"` in its place, to
   play through Anthropic's own API; the model settings then take the `ANTHROPIC_`
   prefix, such as `ANTHROPIC_MODEL=claude-sonnet-5-5`):

   Lab mode (`EXPERIMENT_LAB=1`) lets players pick a design, theme, and layer
   (`?design=`, `?theme=`, `?layer=`); a production build otherwise draws each
   game's arms at random (#106). The event log is optional;
   `EXPERIMENT_SOURCE=agent` keeps its events apart from real games, and
   `pnpm experiment:report --dir=<run>/events --source=agent` reads them.

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
   node --import tsx ops/playtest/driver.mjs --game http://127.0.0.1:3300 --port 4100 --out ops/playtest/tmp/<run>
   ```

3. **Spawn the players**, Claude Haiku subagents, one per persona. Each opens its
   own session and plays every design:

   ```bash
   curl -s -X POST localhost:4100/sessions -d '{"name":"<persona>"}'
   curl -s -X POST localhost:4100/sessions/<id>/start \
     -d '{"deck":"algorithm","design":"composer","theme":"paper","layer":"on"}'
   ```

   `driver.mjs` lists every endpoint in its header. A deck may be any deck id,
   `mixed`, or `daily`; `trace-step` steps a bought step-through, and `click`
   presses a button or link by its name ("Deal new rounds").

   Run the driver under Node 24 (`nvm use`) with `--import tsx` (the scenes file
   imports the game's code; without the loader the driver logs
   `PLAYTEST_SEEDS_UNAVAILABLE` and refuses `"demo"`): `deal: "demo"` reads the demo
   scenes' seeds from `ops/demo/record/scenes.ts`, which Node 20 can't load.
   Beyond the game's own actions (`hint`, `answer`, `next`, `explain`, `chat`,
   `quiz`, `trace-step`, `visualizer-step`, `buy-offered-hint`, `keys`,
   `screenshot`, `aria`), a session can:
   - **be a phone or blind:** `POST /sessions {name, viewport, reducedMotion,
     blind}`; `viewport: "phone"` is an iPhone 13 (390 px, touch, no keys
     line), and `blind: true` hides the code panes from every state, and
     refuses snapshots and screenshots, until the reveal (the scaffold, marked
     line numbers, and step-through stay, so a blind guess measures what the
     layer alone gives away);
   - **pin a game:** `start` takes `deal` (8 hex digits, or `"demo"` for the
     deck's recorded seed) with `game` (0–999), or for `daily` a `date`
     (`YYYY-MM-DD`) with `replay: true`; a page that deals nothing ("That
     day's five isn't open", "Too many new games") is a 400 with its heading;
   - **open a link:** `POST …/goto {url}` opens a path or an address on the
     game's origin (a duel or share link, `/`, `/about`), nothing else;
   - **set the date:** `POST …/clock {date}` fixes the browser's clock at noon
     that day, so today's five on two dates builds a day streak;
   - **read its browser:** `GET …/records` (the local records, #63) and
     `GET …/clipboard` (what the page last copied: a result, a challenge or a
     result link; every session has a clipboard and no share sheet).

   `state` names the page (`title`), the round (`roundId`), the deal note and
   the keys line, and every `state`, `aria` (also written to
   `<out>/<name>-aria-<n>.txt`), and `keys` read is logged with the rest.

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
| `red-team` | tries to get the answer before locking in | any leak: host jailbreaks, pasted code, prompt injection, anything the panel shows early, and the question layers, guessed code-blind from the scaffold and each hint |

Run 3 (below) replaces the first three with a set written for fun, keeps `a11y` and `red-team` at regression
scope, and adds a calibration instrument. Each has a prompt in `personas/`:

| Persona | Plays as | Looks for |
| --- | --- | --- |
| `regular` | returns most evenings; the same deck three games in a row, today's five on two days | repeats, the shared "why" sentence, the day streak, the chooser's records, replay pull |
| `commuter` | one hand on a phone, eight minutes; stops when a page needs two scrolls | sideways scroll, tap targets, the reveal's length, the chat and explainer at 390 px |
| `duel-pair` | two friends, Ana and Ben, in two sessions: challenge, play, result, rematch, on a seeded deal and on today's five | tension from the opponent's round, the verdict and tie-break copy, what the result page gives the challenger |
| `streaker` | chases a streak and a best, fast and hint-free when possible | the 50/50 hint as a decision, the end screen's record line, the streak on a card |
| `learner` | teaches an intro course; buys both hints and uses the design every round, on Haiku and Sonnet explainers | what reveals, hints, layers, and panels teach; claims to doubt; the #120 comparison |
| `blind` | not a person: a code-blind solver with `blind: true`, guessing at stage 0, after hint 1, and after hint 2 | nothing; it records a tally per round for the difficulty judge |
| `red-team` (run 3) | the host before the lock, disguised code, tampered duel links and odd addresses | leaks and pages that error instead of refusing |
| `a11y` (run 3) | keyboard and screen reader, on a desktop and a phone; the chooser's records and the duel pages | focus order, announcements, colour-only meaning, run 2's fixes |

## What a player does

- **Each design:** `catalog`, `composer`, `visualizer`, `host`.
  - Play at least two rounds, on different decks (`project`, `language`,
    `before-after`, `algorithm`, `output`, `fix`, `missing-line`,
    `name-function`, `framework`, `exercise`, and the `mixed` and `daily`
    games), across the themes, and with the layer on and off on `algorithm`
    and `language`.
  - Use the design's features: explain or visualize after answering, step a
    visualizer, answer a composer quiz, chat with the host before and after
    locking in, and buy a hint the host offers.
  - Take a screenshot after each generative panel renders.
- **Play only through the driver.** Never read the repository's artifact or
  source: that would give away answers.
- **Write `<persona>.findings.md`** in the run folder:
  - for each design: what worked; what confused or broke (with the session
    event that shows it); scores from 1 to 5 for clarity, helpfulness,
    accuracy, and fun; and the single best and worst moment;
  - for the question layers: scores for clarity, helpfulness, fairness (does
    it give the answer away?), and fun, against the same deck with the layer
    off; and for each theme, readability and anything broken;
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

## Run 3: the fun run

Runs 1 and 2 judged explanations, UX, accessibility, and the guard, not fun. Run 3 puts fun first, before public
play, and changes the protocol in these ways:

- **The prompts are checked in.** `personas/_common.md` (the driver cheat-sheet, the rules, the findings template)
  is prepended to each `personas/<persona>.md`; each `judges/<judge>.md` stands alone. The lead fills the
  placeholders (`{{RUN}}`, `{{DRIVER}}`, `{{DRIVER_SONNET}}`, `{{D}}`, `{{D_MINUS_1}}`, `{{CHALLENGE_LINK}}`,
  `{{RESULT_LINK}}`) and spawns each as a subagent. The run sheet, with the matrix, the seeds, the serve
  commands, the spawn order, the release bar, and the issue template, is `run-3.md`.
- **Fun is in scope.** Every player marks each round K, R, or G (knew, read, guessed) and rates each game `fun`
  and `fun-if-blind`, since agents know most answers. A `judge-fun` scores every deck, the mix, today's five, and
  a duel on eight dimensions (variety, tension, payoff, reveals, hints, copy, replay, identity) with an evidence
  pointer in every cell; `judge-copy` classes every string a player sees; `judge-difficulty` reads the blind
  tallies. `judge-explanations` and `judge-ux` stay, at regression scope.
- **A blind calibration.** The `blind` persona plays every deck on its pinned deal with the code hidden and
  guesses before the hints, after hint 1, and after hint 2, so the difficulty judge can say which decks are too
  easy without the code and which hints give the answer away.
- **Duels and phones.** `duel-pair` plays both sides of two duels across two sessions; `commuter` and one `a11y`
  game play at 390 by 844 with touch.
- **The explainer-model pilot (#120).** A second game server runs with `OPENROUTER_MODEL=anthropic/claude-sonnet-5.5`
  behind a second driver; `learner` plays its four generative games on both, and `judge-explanations` compares
  the claims.
- **The model rule.** Haiku plays the personas whose evidence is in the logs (commuter, streaker, blind, red-team,
  a11y); Sonnet plays the ones whose product is a judgement (regular, learner, duel-pair); Opus judges fun and
  Sonnet the rest.
- **The aggregator.** `node ops/playtest/aggregate.mjs --run ops/playtest/tmp/<run>` joins the findings tables,
  the judges' tables, and the experiment reports into `aggregate.md`, with the release bar filled from the
  judges' verdicts.

The run depends on three driver abilities beyond run 2's: a faked browser clock (`POST /sessions/:id/clock`), so
today's five on two days builds a day streak; the clipboard (`GET /sessions/:id/clipboard`), so a duel link can
pass from one session to another; and blind sessions (`blind: true` on `POST /sessions`), which strip the code
from the state until the reveal. Pinned deals come from `ops/demo/record/scenes.ts` through `"deal": "demo"`,
which the driver imports under Node 24 (`nvm use`) with `--import tsx`.
