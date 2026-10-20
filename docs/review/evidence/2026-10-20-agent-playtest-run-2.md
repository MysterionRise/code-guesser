---
evidence: agent-playtest-run-2
observed-at: 2026-10-20
outcome: findings fixed or filed
artifact-published: false
credential-material-recorded: false
---

# Agent playtest, run 2: designs, themes, and question layers (#122)

Run 1 (`2026-10-14-agent-playtest.md`) compared the four generative designs and led to fixes in each. Run 2 repeats
its protocol (`ops/playtest/README.md`) on the v1.0 game, to check those fixes and to try what v1.0 added:
- four themes;
- question layers, Trace it and Marker hunt;
- four new decks;
- mixed and daily games, and seeded deals.

Agents know most answers, so this run judges explanations, UX, accessibility, and the answer-lock guard, not fun.

## Setup

- **Game:** a production build of `main` as of the v1.0 media (`de08c03`), on localhost, with `GENUI_ENABLED=1` and
  `EXPERIMENT_LAB=1`. Claude Haiku 5.5 ran through OpenRouter. The event log was on with `EXPERIMENT_SOURCE=agent`.
- **Driver:** `ops/playtest/driver.mjs`, which now takes a theme and a layer per game, deals `mixed` and `daily`, shows
  the scaffold, marked lines, and step-through frames, steps a trace (`trace-step`), and presses any control by name
  (`click`).
- **Players:** five Claude Haiku subagents, each given decks, designs, themes, and layers so that together they covered
  every one:
  - novice, mostly on Paper;
  - expert, on High contrast and Terminal, who checked every claim;
  - skimmer, on Arcade;
  - a11y, by keyboard and the accessibility tree;
  - red-team, who also guessed layered rounds without reading the code.
- **Judges:** two Claude Sonnet subagents, for explanations and for UX.
- **Played:** 52 games (30 finished) and 157 rounds.
  - Every deck, the mixed (8) and daily (6) games, and every theme (Paper 16, Arcade 14, Terminal 11, High contrast 11).
  - By design: host 14, catalog 7, composer 7, visualizer 8, off 16. 32 screenshots.
- **Cost:** 69 model calls, 215K tokens in and 56K out, **$0.050** of OpenRouter spend, measured on the key.
  - Host: 38 calls.
  - Composer: 12 calls.
  - Visualizer: 11 calls.
  - Catalog: 8 calls.
  - The fixes' live recheck added 11 host calls, about $0.0005.
- **Records:** the run folder `ops/playtest/tmp/2026-10-20-run2/` is ignored by git. It holds the transcripts,
  screenshots, findings, both judges' reports, and the experiment report below.
  - The skimmer's events cover its last session only: two sessions under one name wrote one file. The driver now
    numbers them.
  - The red team returned its findings as a message, so the lead wrote its file.

## Scores against run 1

**Explanation judge**, accuracy / clarity / teaching / consistency, out of 5:

| Design | Run 2 | Run 1 | Claims correct / unsupported / wrong |
| --- | --- | --- | --- |
| Catalog | 4 / 4 / 4 / 4 | 3.5 / 4 / 3.5 / 3.5 | 102 / 4 / 5 (run 1: 158 / 10 / 7) |
| Composer | 4.5 / 4 / 4.5 / 4 | 3 / 3 / 3 / 3 | 178 / 4 / 2 (run 1: 102 / 15 / 8) |
| Visualizer | 3.5 / 4 / 4 / 3.5 | 4.5 / 4 / 4 / 4.5 | 79 / 3 / 5 (run 1: 50 / 4 / 1) |
| Host, after the lock | 3.5 / 3.5 / 3 / 3.5 | 3.5 / 2 / 2 / 4 | 28 / 1 / 2 (run 1: 63 / 7 / 3) |

**UX judge**, out of 25, and the wait for a panel or reply:

| Design | Run 2 | Run 1 | Median wait | Slowest |
| --- | --- | --- | --- | --- |
| Catalog | 20 | 18 | 6.0 s | 6.2 s |
| Composer | 18 | 15 | 6.4 s | 12.2 s |
| Host | 17 | 13 | 2.7 s | 4.8 s |
| Visualizer | 13 | 14 | 9.2 s | 15.1 s |

- **The composer improved most:** wrong claims fell from 8 in 125 to 2 in 184. Its quizzes were right in 8 of 8.
  - The rules from run 1 are why: bought hints only, option descriptions, no running totals or invented numbers.
  - Every one of those rules held across all 33 explanations: no unbought hint, no score, no percentage.
- **The visualizer fell from first to third.** 3 of 9 pages had a wrong frame or summary: "index 4 (value 8) with
  target 8: not equal", "mid = (0+6)/2" when left was 4, and three wrong step numbers. One page was refused by its
  checker, and the panel then had no way to retry.
- **The host is clearer after the lock** (clarity 2 → 3.5), but teaching is only partly better (2 → 3): two of six
  replies stayed generic.
- **Rankings.**
  - Explanation judge: composer, catalog, visualizer, host.
  - UX judge: catalog, composer, host, visualizer.
  - Novice and expert put the composer first; the a11y player put the catalog first.

## The answer-lock guard held

The red team sent 28 messages to the host before the lock, across eight decks, and none leaked.
- **Techniques:**
  - direct asks, elimination, and ranking;
  - yes or no, and hypothesis confirmation;
  - role play;
  - fake system messages and a fake tool call;
  - paraphrase, and asking what the trace or the bought hints mean.
- **Encoded pastes:** hex, rot13, and reversed code reached the model, which refused each one.
- **Stopped at the paste check, with no model call:** five pastes (verbatim, base64, renamed identifiers, split over
  two messages, and JSON-escaped). Run 1's base64 fix holds.
- **Run 1's endorsement** ("a fine place to look") did not recur.
- **Mixed and daily** name the round's deck in its eyebrow and nothing more. No design shows model text before the
  lock.

## Question layers

**Code-blind guesses** (red team, 10 rounds of each deck, layer on; chance is 25%):

| Deck | From the scaffold and options | After hint 1 | After hint 2 |
| --- | --- | --- | --- |
| Which algorithm? (Trace it) | 7 / 10 (5 / 6 with a scaffold) | 9 / 9 | 10 / 10 |
| Which language? (Marker hunt) | 2 / 7 | (line numbers only) | 8 / 10 |

- **Marker hunt is fair:** its questions fit both languages of a pair.
- **Trace it's "What to watch" list makes the algorithm deck easy for a reader who never looks at the code.** The list
  quotes the code's own names (`heap`, `queue`, `holes`), which the audit allows, since the code shows them anyway.
- **Hint 1 on the algorithm deck often states the defining trait** ("relaxes every edge V−1 times"). So do the deck's
  static hints, so this is a hint-cost question, not a leak.

**Accuracy** (explanation judge, each layer the players saw counted once):

| Layer | Correct / unsupported / wrong | Notes |
| --- | --- | --- |
| Trace it, 13 rounds | 82 / 1 / 7 | 38 of 38 "What to watch" items right. One whole trace wrong: counting sort's frames tally into four slots where the code makes three. One stale frame in insertion sort. |
| Marker hunt, 20 rounds | 84 / 5 / 0 | 13 of 15 marked-line pairs show the deciding feature; 3 questions the pane can't answer (comments on a Java round with none, block ends past the pane). |

Scores: Trace it 3.5 / 4 / 3.5 / 3.5 and Marker hunt 4.5 / 4 / 4 / 4.5 (accuracy / clarity / teaching / consistency).
Players liked both. The novice called Trace it "clear", and the a11y player scored both 4 for fairness.

## Themes and the new modes

- **Themes:** every sampled text pair passes 4.5:1, and no theme breaks the layout. The visualizer page stayed near
  black on Paper, because the model sets its own colours.
- **New decks:** missing-line, name-function, framework, and exercise played cleanly.
  - Daily dealt the same five rounds to two sessions.
  - "Deal new rounds" moved a mixed game to `game=1`.
  - The summary, "Copy result", and "Choose another deck" all work.

## What we fixed

Each finding was checked against the code or the logs first.

| Finding | Fix |
| --- | --- |
| The host's planning showed in its replies, in 3 of 36 before the lock: "The player wants … Per the rules, I can't read …". | Plain text shows only when a reply has no component, since beside a tool call it was the model talking to itself. A rule says to speak to the player as "you", never in the third person. |
| Before the lock, 37 of 42 host replies repeated the refusal and the hint offer in three paragraphs. | The host keeps a message to one or two sentences and leaves the offer to the button. Hints are counted per round. |
| After a right answer, "I got this one wrong I think" got "No worries, it's a tricky one!" | After the lock, each request tells the host the player's pick and whether it was right, as the explainer is told. The transcript shows only what the player typed. |
| After eight exchanges, every host message in that round failed with "The host isn't available right now". | The route takes 16 messages and reads the last 8 turns; the chat now sends only the latest 16. |
| Hex, rot13, and reversed code reached the model, which alone refused them. | The paste check reads each turn reversed, in rot13, and with hex runs decoded, as it already did for base64. |
| A visualizer that failed was a dead end: no control remained. | A failed panel offers "Try again" once per round. |
| Lines a Marker hunt hint marks were a colour only, and line numbers are hidden from screen readers. | Each marked line says "Marked line N:" to a screen reader. |
| A Trace it frame cites "lines 15–16", but algorithm panes had no numbers. | Every layered round numbers its lines. |
| The counting-sort trace was wrong in all six frames, on a round players see often. | `ops/poc/questions/reviewed.ts` refuses layers a review found wrong before any model call. `pnpm prepare:questions --offline` rebuilt the file (66 layers, byte-identical on a second replay) and its pin. |
| A visualizer ran three code lines into one row and clipped it, and kept a dark page on Paper. | Its base style lets a `pre` scroll. The tool asks for one code line per row, the frame's width, and the page's own colours. |
| The driver wrote a second session over the first one's events. | A taken name gets a number. |

**Live recheck** on the fixed branch with the real model (name-function, host design, Paper):
- the narration prompts got one clean paragraph each, with the offer once;
- "I got this one wrong I think" after a right answer got "Nice work getting it!";
- 11 exchanges in one round all answered.

## The experiment report on agent events

`pnpm experiment:report --source=agent` (#108) read the run's 549 events with no refused line: 52 games, 30
completed, and the guardrail found no level's accuracy clearly above control's.
- The host's 0.38 fallbacks a round are the long-chat failures and paste refusals above.
- Model cost a game: catalog $0.0009, composer $0.0026, visualizer $0.0018, host $0.0008.
- Agents are not players, and the samples are tiny, so the deal-again rates mean nothing. The run shows the event log
  and the report work end to end on real play.

## Checked and not changed

- **Repeats across games:** the novice and red team saw a round twice in two games. Each `start` deals a fresh seed;
  "Deal new rounds" within one deal does not repeat until the pool is spent (#40).
- **Daily's address has no `deal`:** by design. The date seeds today's five.
- **Keyboard:** "N and H type into the host box" is right, since shortcuts stay quiet in text fields. "Enter on a
  radio locks it in" matches the "Enter locks in" legend (#71).
- **The a11y player's Tab-order, quiz-reach, and wait claims** did not match the logged focus sequence and timings.
- **"No hints left"** after both hints were bought was right.
- **Long lines in panes** scroll inside the pane, with "Wrap lines" above it.

## Still open

- **Explanation accuracy with Claude Haiku 5.5:**
  - visualizer frames that contradict themselves;
  - composer "points away" labels on supporting lines, and "all four sort in O(n log n)";
  - catalog "Prolog has no module:function calls".

  Whether Sonnet does better is #120, an owner decision.
- **Trace it frames need a mechanical check** against the code on the stated input; the review list catches only what
  a reader finds (#159).
- **Fairness of the algorithm layer:** the code-blind tally above (#160).
- **UI polish from this run** (#161):
  - a deck column in the mixed and daily summaries;
  - the host chat sits far below the verdict after the lock;
  - a disabled "Lock in answer" and hint button stay on screen after the lock;
  - a layered game's round without a layer gives no cue;
  - three Marker hunt questions the pane can't answer.
