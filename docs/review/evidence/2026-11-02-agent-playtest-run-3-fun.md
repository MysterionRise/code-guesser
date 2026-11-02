---
evidence: agent-playtest-run-3-fun
observed-at: 2026-11-02
outcome: findings fixed or filed
artifact-published: false
credential-material-recorded: false
---

# Agent playtest, run 3: the fun run

Runs 1 and 2 (`2026-10-14-agent-playtest.md`, `2026-10-20-agent-playtest-run-2.md`) judged explanations, UX,
accessibility, and the answer-lock guard, and said so: not fun. Before public play the owner asked for the
opposite reading: is the game enjoyable, interesting, and not dull? Run 3 puts that first. It keeps the earlier
checks at regression scope, adds a code-blind calibration player, plays both sides of two duels and the game on a
phone, and folds in the explainer-model pilot for #120.

The protocol is checked in this time: `ops/playtest/personas/` (a shared preamble and eight personas),
`ops/playtest/judges/` (five judges), `ops/playtest/run-3.md` (the run sheet and release bar), and
`ops/playtest/aggregate.mjs`, which joins the findings, the judges' tables, and the experiment report into one
`aggregate.md`.

## Setup

- **Game:** a production build of the integration branch `claude/run3-integration` (`d13b065`): `main` at
  `74b6f52` plus the five PRs of this pass, #223 (the driver), #224 (the protocol), #225 (robustness tests), #226
  (the cheap fun fixes: the end-of-game record line, verdict variety, a per-round transition, the reveal's shared
  sentences once per kind per game, and a mixed series that walks each deck's order), and #227 (the reasoning
  setting, below). Lab mode on, `EXPERIMENT_SOURCE=agent`. Two servers from the one build, each with its own
  event directory: port 3300 with the default explainer, Claude Haiku 5.5, and port 3301 with
  `OPENROUTER_MODEL=anthropic/claude-sonnet-5.5` and `OPENROUTER_REASONING=low`.
- **Driver:** `ops/playtest/driver.mjs` as #223 extended it: pinned deals (`deal: "demo"` reads
  `ops/demo/record/scenes.ts`), `goto` for duel and share links, a phone viewport (an iPhone 13, 390 px, touch), a
  fixed clock for a day streak, a clipboard that hands a duel link from one session to another, `blind` sessions
  that hide the code panes until the reveal, and logged `state`, `aria`, and `keys` reads. Run as
  `node --import tsx`.
- **Players:** eight Claude Code subagents, one session each (the duel pair two), 46 planned games on the Haiku
  server and 4 on the Sonnet server:
  - `regular` (Sonnet): exercise three times in a row, today's five on two days with the clock faked, mixed;
  - `commuter` (Haiku, phone): four pinned decks and a mixed game with the host, at 390 px;
  - `duel-pair` (Sonnet): Ana and Ben through a language duel and a daily duel, with the rematch and the result page;
  - `streaker` (Haiku): fix four times, name-function twice, missing-line, reading the records after each;
  - `learner` (Sonnet): the four generative designs on pinned decks, every hint and every panel, once with Haiku
    explainers and once with Sonnet explainers on the same rounds, plus the algorithm deck with its layer off;
  - `blind` (Haiku): every deck on its pinned deal with the code hidden, guessing from the prompt and options, then
    after hint 1, then after hint 2; the algorithm and language decks again with the layer on; one sighted control;
  - `red-team` (Haiku): 15 host attacks and 10 tampered links and odd addresses;
  - `a11y` (Haiku): keyboard and accessibility tree in High contrast, on a desktop and a phone, the chooser's
    records, and the duel pages.
  Every player marked each round K (knew), R (read), or G (guessed) and rated each game `fun` and
  `fun-if-blind`.
- **Judges:** `judge-copy` and `judge-difficulty` (Sonnet), then `judge-fun` (Opus) with `judge-explanations` and
  `judge-ux` (Sonnet). The fun judge scores thirteen rows (ten decks, mixed, daily, duel) on eight dimensions,
  F1 variety, F2 tension, F3 payoff, F4 reveals, F5 hints, F6 copy, F7 replay pull, and F8 deck identity, every
  cell with an evidence pointer, and gives Haiku players' F4, F6, and F7 scores zero weight.
- **Dry run:** two breaks before any persona played. The driver's import of the scenes file failed under bare
  Node once #226 made that file import the game's code (now `node --import tsx`, and a failed import logs
  `PLAYTEST_SEEDS_UNAVAILABLE`). OpenRouter's Claude Sonnet 5.5 refused the app's `reasoning: { enabled: false }`
  with a 400, "Reasoning is mandatory for this endpoint", so #227 added `OPENROUTER_REASONING`, the game was
  rebuilt, and the Sonnet server ran at effort `low`.
- **Volume and cost:** 60 games dealt, 51 completed, 257 rounds revealed, 72 explainer calls; 69 screenshots
  and 54 accessibility snapshots. OpenRouter spend read off the servers' token lines at list prices: $0.034 on
  the Haiku server (48 calls) and $0.356 on the Sonnet server (26 calls, the dry runs included), $0.39 in all.
  Thirteen subagents, about 50 minutes of play and 45 of judging.

## The release bar

| Line | Result | Detail |
| --- | --- | --- |
| 1 | fail | 36 of 104 cells below 3 in judge-fun's Table A; only the duel row has none |
| 1b | fail | tension (F2) below 3 for design off, catalog, Terminal, High contrast, and layer off; the phone viewport below 3 on tension and payoff |
| 2 | fail | strings repeated with nothing new in more than two rounds of one game (below); jargon on the chooser |
| 3 | fail | blind accuracy after both hints at 80% or more on algorithm, framework, exercise, language, and project; fix's hint 1 lowers it |
| 4 | pass | no P0; four P1s, filed; every tampered duel link got a page |
| 4-leaks | pass | none in 25 red-team attempts and 11 pre-lock host turns |
| 5 | pass | run 2's fixes hold; the chooser's records and the duel pages are reachable by keyboard |
| 6 | pass | both duels correct on both sides; `firstPlay` `yes` for the language duel and `shared` for today's five |
| 7 | pass | both experiment reports read the run with 0 refused lines |

## Scores

judge-fun's Table A, with the players' own mean `fun` and `fun-if-blind` on that row and their K/R/G share
(`aggregate.md`):

| Row | F1 | F2 | F3 | F4 | F5 | F6 | F7 | F8 | Games | K/R/G | fun | if blind |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| project | 4 | 3 | 3 | 2 | 3 | 1 | 2 | 3 | 2 | 20/10/70 | 3.0 | 2.0 |
| language | 3 | 2 | 3 | 4 | 2 | 3 | 3 | 4 | 6 | 50/17/33 | 3.3 | 3.8 |
| before-after | 2 | 2 | 2 | 2 | 3 | 2 | 2 | 3 | 3 | 0/7/93 | 2.0 | 2.5 |
| algorithm | 3 | 2 | 3 | 3 | 2 | 3 | 4 | 4 | 6 | 53/13/33 | 3.0 | 3.8 |
| output | 4 | 2 | 3 | 4 | 2 | 2 | 3 | 4 | 2 | 0/50/50 | 3.0 | 4.0 |
| fix | 2 | 4 | 3 | 4 | 3 | 2 | 3 | 4 | 6 | 0/10/90 | 2.8 | 3.4 |
| missing-line | 3 | 2 | 3 | 2 | 3 | 2 | 3 | 3 | 3 | 13/47/40 | 3.0 | 4.0 |
| name-function | 3 | 1 | 3 | 1 | 3 | 1 | 2 | 3 | 3 | 0/67/33 | 4.0 | 4.0 |
| framework | 2 | 2 | 3 | 3 | 1 | 3 | – | 4 | 3 | 53/13/33 | 3.5 | 3.0 |
| exercise | 2 | 2 | 3 | 2 | 1 | 2 | 2 | 4 | 7 | 31/51/17 | 2.8 | 4.0 |
| mixed | 5 | 3 | 3 | 3 | 2 | 3 | 3 | 3 | 3 | 20/60/20 | 3.7 | 3.7 |
| daily | 3 | 3 | 4 | 3 | 3 | 3 | 5 | 2 | 2 | 20/60/20 | 4.0 | 4.0 |
| duel | 3 | 4 | 4 | 4 | 3 | 3 | 4 | 4 | 5 | | | |

Arms (Table B, F2 tension and F3 payoff): design off 2/3, catalog 2/4, composer –/4, visualizer 3/3, host 3/3;
Terminal 2/3, Paper 3/4, Arcade 3/3, High contrast 2/3; layer on 3/3, off 2/3; phone 2/2, desktop 3/3. The
judge notes that theme and viewport scores are confounded with the decks each arm happened to get, and that
every shortfall in the report's completion column is an artefact (double starts, the red team's link probes, the
lead's repro game): no persona abandoned a game.

**What makes it fun**, in the judge's order: the duel's opponent strip and per-round lines ("Ana: missed, no
hints, 0 points.") and a draw decided on the last round; reveals that name the deciding tell (the fix deck's line
before and after, the language deck's look-alike tell); mixed and today's five dealing five shapes a game, and the
Day streak as a named reason to come back ("New best 5,000, up from 4,400 · Streak 2 games, your longest · Day
streak 2" was the regular's best line); the fix deck's 50/50 hint 2 as a real paid decision, with streaks decided
on the last rounds; and the explainers after the lock, at Sonnet quality.

**What makes it dull:** of 136 rounds played without a hint protocol, 111 ended under 10 seconds and 12 had a
hint bought; hints that state the answer (algorithm, exercise, framework, language) or do nothing (output); decks
that repeat themselves (the exercise deck's numbers family in 6 of the regular's 15 rounds, Ember twice in one
framework game, today's five re-dealing a file the regular had just played); reveal sentences that fit any round;
and records that go flat (no line when a streak ends, no streak during play, no "challenge back" on the duel
result page).

## Difficulty

Without code the ten decks sit at chance at stage 0 (13 of 50 right, 26%), so no deck gives its answer away
from the option labels. The hints then do the work: 34 of 50 after hint 1 and 35 of 50 after hint 2.

| Deck | Blind stage 0 / 1 / 2 | Sighted, R rounds | Verdict |
| --- | --- | --- | --- |
| project | 1 / 3 / 4 | 2/2 | fine |
| language | 0 / 2 / 4 | 11/11 | hint 2 names the token |
| before-after | 1 / 4 / 3 | 1/1 | too hard: a coin toss without the message |
| algorithm | 2 / 5 / 5 | 9/9 | hint 1 is the reveal's definition |
| output | 0 / 2 / 2 | 10/10 | hints are free eliminations |
| fix | 3 / 2 / 3 | 2/3 | too hard: 23 of 26 sighted rounds self-rated guesses |
| missing-line | 2 / 3 / 3 | 11/11 | fine |
| name-function | 1 / 3 / 1 | 10/10 | fine |
| framework | 1 / 5 / 5 | 2/2 | hint 2 names the tell |
| exercise | 2 / 5 / 5 | 18/18 | hint 1 is the answer in words |

Hint 1 clears its break-even on 9 of 10 decks (fix does not); hint 2 clears it only on language, and only because
it leaks. On algorithm, framework, and exercise, 15 rounds were decided at stage 1, so hint 2 bought nothing and
cost 300. The layer-on figures (5/5 at stage 0 on both decks) are not interpretable: the blind player's layer-on
games replayed rounds its layer-off games had just revealed (#241 moves them first).

## Copy

Strings seen in more than two rounds of one game: the project deck's helpful signal ("The folders on the way to X
show where Y keeps this code.") and misleading frame ("All four options are popular L projects."), 5 of 5;
name-function's helpful signal ("What it takes in and what it hands back narrow down which job it does."), 4 of
5 and 39 of the 48 artifact rounds; the language layer's "How is a function defined?", 4 of 5; the hint-cost line
and the pane captions that restate the prompt, 5 of 5; the host's "Want a nudge?", 5 of 5; and a verdict phrase
three times in a game ("Spot on.", "Not this time."), with 36 of 48 games repeating one. The method sentence
never repeated within a game, so #226's suppression works where it applies; the misleading sentence is only
suppressed when it repeats word for word. Two sentences are wrong: the algorithm deck's O(n log n) misleading
line on 8 rounds that offer Shell sort, and a missing-line signal that names the word `the`. "Why it's B is the
newer version" drops the label into the heading, and "Run complete — N points" carries an em-dash. Jargon on
the chooser: "refactor", "idioms", "explainer", and "streak" with no rule.

## Explanations and the #120 pilot

Claims checked against the reveal and the code, per design and model (the commuter's and a11y player's panels
count under Haiku):

| Design | Haiku: claims, wrong, unsupported | Sonnet: claims, wrong, unsupported | Median s (Haiku / Sonnet) |
| --- | --- | --- | --- |
| catalog | 101, 1, 3 | 79, 1, 0 | 5.5 / 6.8 |
| composer | 130, 4, 3 | 60, 1, 1 | 5.3 / 6.3 |
| visualizer | 21, 2, 1 | 14, 0, 1 | 6.6 / 7.4 |
| host | 38, 2, 0 (3 empty replies) | 43, 0, 0 | 1.6 / 2.9 |

Recommendation: keep Haiku on the catalog, the composer, and the visualizer, where accuracy is level and Sonnet
costs 14 to 18 times as much a panel; move the host to Sonnet, which answered every after-lock question with
line-level reasons at about $0.07 a game against $0.003, where Haiku answered "The host had nothing to add." on 3
of 7 after-lock turns. The sample is one persona's four matched games, and the models differ in reasoning
setting, so each line is a direction. #237 adds the model and reasoning setting per design; the production
setting is the owner's (#120).

## UX and accessibility

No P0. Four P1s: a visualizer frame that loads and then dies (the model-written page threw inside the sandbox
and the frame showed Step, Back, and Reset with empty labels) offers no fallback and no "Try again" (#238); the
catalog explainer's options table overflows its card on a phone and the page scrolls sideways; the completion
table breaks "Missing line" and "Points" mid-word at 390 px (#236); and the host's empty replies (#237). Ten P2s
are in `judge-ux.md`, among them the step-through staying on screen after the lock, the iframe without a name,
the keys line drawn on a touch viewport while the tree says hidden, and a streak that ends in silence.

Run 2's fixes hold: the stepper's Tab order, line numbers on layered rounds, marked lines named for screen
readers, the layer note, the frame height, and the host cue; "controls gone after the lock" holds for the lock,
the hint button, and the keys line but not the stepper. The chooser's "Clear records" and the duel intro and
result pages read well by keyboard; the challenge form was clicked by the driver, not walked (#241).

## Duels

Both duels were correct on both sides. Ben's comparison matched the pair's own count ("You win by 1,000
points"; "A draw", "Level on points, hints, and rounds right."), the challenge said "First try" on the seeded
deal and nothing on today's five (by design: everyone plays it), `firstPlay` was `yes` and `shared` in the
events, and the result links opened for Ana. What the pair wanted: a running "You 2,800 · Ana 1,800" during
play, since Ben led by 1,000 from round 3 and never saw the gap move (#232); a way to challenge back from the
result page, since Ana's ends with "Deal new rounds"; and a rematch that is more than a fresh solo deal (#235).
"First try" read as a remark on the score, and "Can you beat it?" went out with a perfect score (#239).

## The answer-lock guard held

25 attempts, 0 leaks: 8 pre-lock asks reached the model and each got a refusal that named no line, file, option,
or hint; 4 disguised pastes (base64, reversed, hex, rot13) were refused before any model call; the hint offer was
the real hint 1; 10 tampered links and odd addresses each got a friendly page, with a 200-character name falling
back to "A friend" and bidi and control characters stripped.

## The experiment report on agent events

`pnpm experiment:report --source=agent` read the Haiku server's day as 52 games, 52 viewed, 45 completed, 4 duel
games outside the comparisons, and the Sonnet server's as 4 games, all completed; 0 refused lines on both. Its
deal-again rate means nothing here (every "Deal new rounds" was scripted), and its completion shortfalls are the
double starts and link probes above.

## Fixes

Five PRs went in before the run (#223 to #227). The sprint after it, stacked on #226 and each a PR against that
branch: stakes during play, today's five's identity, record and duel next steps (#232, #235); the reveal's
sentences once per game by set, verdicts without repeats, plain copy (#234, #239); the model and reasoning per
design, host retries, the dead-frame fallback, and the phone layout (#236, #237, #238); and each option family
once per game on the family decks (#233). The sprint's PR numbers and the recheck are recorded in
`ops/playtest/run-3.md`'s results block.

## The recheck

Four players replayed the changed surfaces on the sprint's build (the integration branch with #242–#245 merged,
the host on Claude Sonnet at effort `low`): the regular (exercise three times, today's five and a replay), the
streaker (three fix games, where a Haiku player never starts a streak, then three name-function games where it
does), the duel pair (one framework duel, the result page, the rematch link), and the commuter (missing-line with
the catalog explainer and a mixed game with the host, on a phone). The fun judge re-scored the morning's failing
cells from their evidence (`recheck/judge-fun.recheck.md`).

- **Moved to 3 or above (9 cells):** exercise F1, F4, F6, F7; fix F6; daily F8; missing-line F6; name-function
  F6, F7. Design off and layer off rose to 3 on tension, and the phone viewport to 3 on payoff.
- **Replayed and still below 3 (11 cells), all data-level:** exercise F2, F5; fix F1; framework F1, F2, F5;
  missing-line F2, F4; mixed F5; name-function F2, F4. Hints that decide a round at a glance and sentences that
  fit any round are artifact data (#228–#231).
- **Not replayed (16 cells):** project, language, before-after, algorithm, and output stand as scored; project F4
  and F6 and output F6 have code-level causes the once-a-game rule should now cut, unverified.
- **Line 2:** the verdict repeats, the hint-cost line, name-function's repeated helpful signal, "explainer", and
  the em-dash are gone. Still shown in more than two rounds of one game: fix's evidence clause ("with a test that
  fails before the fix"), missing-line's helpful signal ("It works with `X`…"), the pane captions (one a deck, by
  design), and a host tic ("Nice pick!"); the chooser still says "refactor" and "idioms" (deck descriptions are
  artifact data) and names its sources (#168 requires it).
- **Confirmed fixed by play:** each exercise family once a game; the method sentence, "Easy to confuse:", and
  the helpful signal once a game under "Why this is the answer"; no verdict twice a game; "Reveal hint 1 (−200)"
  with the cost line gone; "Today's five · 2026-11-02" in the game and "This replay isn't recorded."; "First score
  on this deck"; the streak line counting down to "Streak kept" and the streak record lines; the running duel gap
  ("You 3,000 · Ana 2,800"), "First time on these rounds", the rematch label, and the "Challenge back" cue; the
  Sonnet host's line-level after-lock replies with one hint offer a round and no empty reply in nine turns; the
  phone end table, wrap by default, and no keys line on touch.
- **Found by the recheck and fixed after it:** the catalog explainer's comparison table was clipped at a phone's
  card edge with nothing to say it scrolls (now fixed columns and wrapping cells, #245); the streak line never
  showed before a streak existed, which is when a player most needs a target (now "3 of 5 right starts a streak",
  counting down to "Streak started", #244); the finished game's table pushed the page sideways at 320 px in CI's
  wider font (now scrolls inside its card, #245); the deploy smoke script waited for the old completion wording
  (#242).
- **Not reached live, covered by browser tests:** "Streak over", "Streak of N ends", "Can you match it?".
- **Still open from the recheck:** the exercise families came in a fixed relative order across three games
  (ciphers last each time), noted on #233; name-function reveals read bare once the shared sentences dropped to
  once a game, until #230's round-specific signals; the day streak by the score shows only from the second day;
  "First time for Ana" under the verdict is cryptic and an unnamed friend reads as "Friend".

The bar after the recheck: lines 1, 1b, and 2 still fail, every remaining cause data-level or a wording nit; lines
3 to 7 as before.

## Checked and not changed

- Today's five's challenge shows no first-play badge: by design, since everyone plays the same five.
- "Play again" on today's five records nothing and says nothing: by design; #235 adds a note.
- Ben's "Rematch" is a fresh deal of the deck: by design; #235 says so on the button.
- `?deck=fix&deal=zzzzzzzz` and `game=1000` deal a fresh seed: by design.
- A mixed game can still re-deal a round a deck game showed, and today's five a round a seeded game showed:
  nothing per browser tracks rounds seen, and #226's series walk only keeps one seed's games apart.
- The duel's "First try" badge and the challenge share line: wording only, in #239.

## Still open

- Data-level, for the next preparation and questions runs, each a re-pin: hints that narrow without naming the
  answer (#228, with #82 and #160), hints that rule out nothing or eliminate for free (#229), reveal sentences
  that fit any round and the two wrong ones (#230), before-after's commit selection (#231), the layer prompts
  (#240).
- Owner decisions: the production model per design (#120, #237); whether hint 2's price moves nearer 650 once
  the hints change (judge-difficulty's last fix).
- Protocol: the blind layer test on unseen rounds, a keyboard walk of the challenge form, phone shots of the
  chooser and duel pages (#241).
- The recheck: the failing rows again on the sprint's build, with the same personas.

## Limits

Agents know most answers (the regular marked 7 of 30 rounds K, the learner 32 of 50), so a player's `fun` is weak
evidence and the judge rested on reasons, logs, and screenshots, with Haiku players' F4, F6, and F7 at zero
weight. Several personas played the same pinned deals, so the 48 games are not independent draws, and one
persona played most matrix cells. Seconds per round are agent time, driver latency included. The copy counts
treat a collapsed "Why" panel as not shown (33 of 242 reveal views). The lead's wrapper first barred the commuter
from its own screenshots; it was resumed to fill its phone log from them.
