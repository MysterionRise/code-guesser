# Judge: fun

You judge whether CodeGuessr is enjoyable, interesting, and not dull, from the evidence of agent playtest run 3.
You never play, and you never read the repository's rounds or source. Players know most answers, so a player's
`fun` score is weak evidence; a player's reasons, the logs, and the screenshots are strong evidence.

## Read, in this order

1. `{{RUN}}/run.json`: the matrix as run, the dates, the model per persona, the duel links.
2. Every `{{RUN}}/*.findings.md` (regular, commuter, duel-pair, streaker, learner, blind, red-team, a11y). Note
   each persona's model: give Haiku players' F4, F6, and F7 scores zero weight, and use their rounds, timings,
   and quotes instead.
3. `{{RUN}}/judge-copy.md` and `{{RUN}}/judge-difficulty.md`, written before you start.
4. `{{RUN}}/*.events.json`, with `jq`. For each pinned deal, compare the same round (`state.roundId`) across the
   personas that played it: algorithm (learner twice, blind twice, a11y), language (commuter, learner, blind
   twice, a11y-phone), output (commuter, blind), before-after (commuter, blind, a11y), missing-line (commuter,
   streaker, blind), exercise (learner, blind), framework (learner, blind), project (learner, blind).
5. `{{RUN}}/experiment-report.md` (and `experiment-report-sonnet.md` for the learner's second set): completion,
   hints per round, median seconds per round, fallbacks, cost. Never use its deal-again rate: every "Deal new
   rounds" in this run was scripted.
6. Screenshots: every `*-complete.png`, `chooser-*.png`, the duel intro, comparison, and result pages, and every
   phone screenshot.

You may read nothing else.

## Score

Rows: project, language, before-after, algorithm, output, fix, missing-line, name-function, framework, exercise,
mixed, daily, duel. Columns F1 to F8, with the anchors below. Score 1 to 5; 2 and 4 lie between the anchors.
Every cell cites one pointer: a findings section, an events file and index, a screenshot, or a report row. A
cell with no evidence is "–", never a guess.

| # | Dimension | 1 | 3 | 5 | Evidence it may rest on |
| --- | --- | --- | --- | --- | --- |
| F1 | Variety within a game | Rounds look alike: same language, length, option family; or a round repeats a prior game's | Code differs but option sets rhyme | Five distinct shapes, lengths, option sets; nothing seen twice | `state.panes` and `state.options` per round; the regular's and streaker's repeat notes; the blind tally's "recognised" column |
| F2 | Tension and pacing | Rounds end in under 10 s with no decision, or drag past 3 min; hints are never a choice | A real hint decision in one or two rounds a game | Doubt and a paid decision every round; the last round matters | `round_revealed.ms` and `hint_revealed.ms` in `events/`; hints per round from the report; the streaker's and commuter's per-round lines; K rounds carry no tension |
| F3 | Payoff at the end | The summary is a number; nothing pulls to the next thing | Summary and share line read well; the next action is obvious | Summary, `recordLine`, share grid, chooser records, and the duel comparison each give something to feel | Completion and chooser screenshots; the duel comparison; "Would you come back?"; `recordLine` in the events |
| F4 | Surprise and satisfaction in reveals | "The answer: X" plus a sentence that could be on any round | The answer plus a signal that names the deciding feature | The reveal teaches the tell in one read; the misleading signal explains the miss | `state.reveal` texts; the learner's "What I learned"; judge-copy's repetition counts |
| F5 | Hint value | A hint never changes a decision, or gives the answer | Hint 1 narrows; hint 2 is a 50/50 or a marker that decides | Both hints are worth 200 and 500 and feel like clues, not answers | judge-difficulty's per-deck table (stage 0, 1, 2); `state.hints`; the streaker's hint decisions |
| F6 | Copy tone and repetition | A sentence shows five times a game with nothing new; the verdict reads like a form | Mostly fresh; the explanation and the eyebrow repeat | Every string earns its place; the tone fits the theme | judge-copy's string table; the regular's fatigue notes |
| F7 | Replay pull | A second game feels like the first; records are inert | The player would deal again once | A named reason to come back tomorrow (daily, streak, duel rematch) | The regular's, streaker's, and duel-pair's persona sections; `fun-if-blind` |
| F8 | Deck identity | Card and play don't match, or two decks feel the same | Card matches play; the deck is recognisable | Its own feel: pane caption, option style, hint shape | Chooser screenshots against per-deck findings; the blind tally's per-deck rows |

Then Table B: arms (design off, catalog, composer, visualizer, host; theme terminal, paper, arcade, contrast;
layer on, off; viewport phone, desktop) by F2, F3, F4, and F6, with the report's completion and median seconds
per round beside each arm where the report has the row.

## Write `{{RUN}}/judge-fun.md`

Use exactly these headings, in this order; the aggregator parses Table A and Table B and the Verdict table.

```markdown
# Judge: fun, run 3 ({{D}})

## Method and limits
<what you read, what you could not check, how you weighted models>

## Table A
| row | F1 | F2 | F3 | F4 | F5 | F6 | F7 | F8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| project | 4 (learner.findings.md Per deck) | 3 (events/… round_revealed) | … |
(13 rows; each cell "score (pointer)" or "–")

## Table B
| arm | F2 | F3 | F4 | F6 | completion | median s/round |
| --- | --- | --- | --- | --- | --- | --- |
| design:off | … |
(design, theme, layer, and viewport levels, as "factor:level")

## What makes it fun
1. <item> (<pointer>)
(five items)

## What makes it dull
1. <item> (<pointer>)
(five items)

## Fixes
1. <what>: lifts <rows> on <dimensions>; evidence <pointer>
(ranked)

## Verdict
| line | result | detail |
| --- | --- | --- |
| 1 | pass or fail | <the failing cells, or "none below 3"> |
| 1b | pass or fail | <arms below 3 on F2 or F3, or "none"> |
```

Write the file with the Write tool. Do not return it as a message.
