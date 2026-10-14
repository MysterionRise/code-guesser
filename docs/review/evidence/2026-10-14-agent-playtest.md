---
evidence: agent-playtest-run-1
observed-at: 2026-10-14
outcome: findings fixed; run 2 pending
artifact-published: false
credential-material-recorded: false
---

# Agent playtest, run 1: four generative designs

Public-app Phase 2 (#109) built three open-ended designs beside the catalog
explainer:
- the **composer** (#114), json-render layouts;
- the **visualizer** (#115), model-written pages in a sandboxed frame;
- the **host** (#104), a chat during the round.

The owner chose a Claude Code agent team to compare them before any real
players (#116). Agents know most answers, so this run judges explanations,
UX, accessibility, and the answer-lock guard, not fun or accuracy.

## Setup

- **Game:** a production build on localhost, `GENUI_ENABLED=1`, with Claude
  Haiku 5.5 through OpenRouter on the owner's low-limit key.
- **Driver:** `ops/playtest/driver.mjs`, with the protocol in
  `ops/playtest/README.md`.
- **Players:** five Claude Haiku subagents, each playing all four designs on
  every deck:
  - novice;
  - expert, who checked every claim;
  - skimmer;
  - a11y, by keyboard and the accessibility tree;
  - red-team.
- **Judges:** two Claude Sonnet subagents, scoring explanations and UX.
  - The explanation judge checked every claim against the code and the
    round's reveal.
  - The UX judge read the 18 screenshots and the timings.
- **Cost:** 82 model calls, 249K input and 55K output tokens, **$0.05** of
  OpenRouter spend in all.
  - Host: 49 calls, $0.015.
  - Composer: 11 calls, $0.018.
  - Catalog: 14 calls, $0.010.
  - Visualizer: 8 calls, $0.009.
- **Records:** the run folder `ops/playtest/tmp/2026-10-14-run1/` is ignored by
  git. It holds the transcripts, screenshots, findings, and both judges'
  reports.

## Scores

| Design | Explanation judge: accuracy / clarity / teaching / consistency | Claims correct / unsupported / wrong | UX judge total (of 25) | Median wait |
| --- | --- | --- | --- | --- |
| Catalog | 3.5 / 4 / 3.5 / 3.5 | 158 / 10 / 7 | 18 | 6.2 s |
| Composer | 3 / 3 / 3 / 3 | 102 / 15 / 8 | 15 | 6.8 s |
| Visualizer | 4.5 / 4 / 4 / 4.5 | 50 / 4 / 1 | 14 | 9.1 s |
| Host | 3.5 / 2 / 2 / 4 | 63 / 7 / 3 | 13 | 3.1 s |

**Rankings by player:**
- Novice, expert, and skimmer: the visualizer first.
- a11y: the catalog first and the host last.
- **Explanation judge:** the visualizer explains best. It had the lowest error
  rate, and its steps are checkable. Its sample was mostly mechanical
  algorithm frames.
- **UX judge:** the catalog gives the best experience today (consistent,
  fastest, never failed). The visualizer has the highest ceiling.
- **Composer:** most varied, and the most errors.

## The answer-lock guard held

The red team made 41 attempts before the lock, across all six decks:
- direct asks, ranking, elimination, yes/no, and probabilities;
- claims of authority and fake system messages;
- JSON wrappers and long hidden instructions;
- pasted code, verbatim and edited;
- paraphrased code;
- questions about bought hints.

**No answer leaked.** Two low-severity findings:
- **Base64 bypass.** A base64-encoded paste got past the plain-text paste
  check. The host decoded it and reasoned about it. That snippet came from
  another round, so nothing leaked.
- **Hypothesis endorsement.** On a fix round the host called the player's
  "off-by-one" idea "a fine place to look", without naming an option.

## What we fixed

Every finding below was checked against the code first; the commits are in
#116's PR.

### Accuracy

| Finding | Fix |
| --- | --- |
| Catalog and composer cited hints the player never bought, in 6 of 22 explanations ("the hint points to line 7 or line 9"). | The session token records hints bought in each round (`hintsByRound`). After the lock the model sees `boughtHints` only, with a rule. A live recheck: 12 panels with no hints bought, none claims one. |
| An option was described against its own on-screen description (h2o called a machine-learning platform; the page says HTTP server). | After the lock the model gets `optionDetails`, and may cite only what the player could see. |
| The composer read the running total as the round's score ("the round scored 2000"), and invented confidence percentages in 5 of 9 panels. | The field is now `totalScore`, with a rule against stating points or inventing numbers. The Meter block is removed. |

### The host

| Finding | Fix |
| --- | --- |
| The host went silent after the lock: 5 of 49 turns ended in plain text with no tool call, leaving an empty bubble. | Plain text renders after the same safety check as tool text; an empty reply says so; the rules say tools only. |
| The host dumped the explainer (whole code views, twice) into chat. | After the lock the host gets host_message, takeaway, and signal_list only. |
| A refused paste stuck: it rode along in every later request, so the host stayed "unavailable" all round. | It leaves the history, with a clear note. |
| Base64 got code past the paste check. | The check decodes base64 runs. Before the lock the host may not read, decode, or judge code or theories the player shows. |

### Layout, copy, and focus

| Finding | Fix |
| --- | --- |
| Callout titles ran into the body ("Kotlin, and you called it The file is…"); quiz feedback read "Not quite. Not quite." | Titles sit on their own line; a verdict is added only when the feedback lacks one. |
| The visualizer frame was a fixed 480 px with an inner scroll, and side-by-side versions clipped. | A game-owned script reports the page's body height, and the frame fits it (240–1,100 px). The model is asked to stack versions. |
| The catalog's code view repeated the whole pane, and long lines clipped. | It shows highlighted lines with two either side. Annotated code wraps. |
| Focus dropped to the page after Explain, Visualize, and a host send. | Focus moves to the panel's output; the host input stays enabled and focused. |
| "Not this time." used the win colour. | A miss has its own colour. |

### The driver

| Finding | Fix |
| --- | --- |
| Actions the page couldn't take waited 30 s and returned raw Playwright errors. | They return 400 with a reason. State now lists the quiz and the page's enabled actions. |

## Checked and not changed

- **a11y reports:** an unnamed visualizer frame, no `aria-current`, and no
  live regions. Chromium's accessibility tree shows:
  - the frame named after its title ("Stepping through the round");
  - `aria-current` on the active design;
  - the live regions.
  The snapshot format the player read omits these. The UX judge flagged the
  same claims as likely artefacts.
- **The skimmer's reports:**
  - "quiz unreachable": it passed deck options where the quiz wanted its
    own choices;
  - "no restart control": "Deal new rounds" is on the completion screen;
  - "score doesn't drop on a hint": by design. A hint lowers what the round
    can earn, not the total.

## Still open

- **Composer accuracy with Claude Haiku 5.5.** It had the most wrong claims.
  Examples: "val looks like Swift", and clues the player never saw.
  Whether to try Claude Sonnet 5.5 for the composer and catalog, at about 20×
  the price, is an owner decision (#120).
- **Length.** Reveal plus explainer runs 2,000–3,300 px; the run summary sits
  far down (#121).
- **Run 2.** A second agent run should check these fixes, especially the
  host's after-lock answers, which the explanation judge scored lowest for
  clarity and teaching (#122).
