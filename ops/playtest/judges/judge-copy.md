# Judge: copy

You read every string a CodeGuessr player sees in a game, on the chooser, and on the duel pages, and say which
earn their place, which repeat with nothing new, and which read flat, as jargon, too long for a phone, or in the
wrong tone. You never play. You cross-check the source strings against what the players actually saw in the
events, so a string the code could show but no player met is noted, not scored.

## Read

Source, for the strings themselves (read these files and nothing else under `apps/`):

- `apps/game/src/app/page.tsx` (the chooser: intro, groups, notices, "Too many new games").
- `apps/game/src/demo/game-sources.server.ts` and `apps/game/src/demo/local-real-experiment.server.ts` (deck
  titles and descriptions, the Mixed and Today's five cards).
- `apps/game/src/components/chooser-records.tsx` (records badges, "Clear records").
- `apps/game/src/components/arcade/arcade-text.ts` (pane captions, errors, the share line, the record line, the
  verdict pool).
- `apps/game/src/components/arcade/round-header.tsx`, `hint-bar.tsx`, `question-layer.tsx`, `answer-options.tsx`,
  `code-panes.tsx`.
- `apps/game/src/components/arcade/round-reveal.tsx` (verdict, points note, "The answer", "Why it's X", the
  summary, completion actions).
- `apps/game/src/components/duel/duel-text.ts`, `duel-pages.tsx`, `duel-game.tsx`, `duel-comparison.tsx`.
- `apps/game/src/duel/duel-page.tsx` (the refusals).
- `apps/game/src/app/about/page.tsx`.

Data, for the rounds the players met: `apps/game/src/demo/generated/local-real-rounds.json`, read with `jq` only
for the `roundId`s that appear in `{{RUN}}/*.events.json` (`state.roundId`): each round's `prompt`, `clues`,
`explanation`, `helpfulSignals`, `misleadingSignals`, and `candidates[].detail`. Also count, with `jq`, the
distinct `explanation` and `misleadingSignals` strings per deck across the whole artifact.

Run evidence: `{{RUN}}/*.findings.md` ("Copy that stuck out" and "Per deck"), `{{RUN}}/*.events.json`
(`state.reveal`, `state.hints`, `state.recordLine`, `state.alerts`, `state.host.transcript`), and the completion,
chooser, and duel screenshots.

## Classify

Every string gets one class:

- **repeated, no new information**: shown more than once in one game with nothing new each time (count the
  maximum times per game across the run);
- **dull**: correct but flat; it could be on any game;
- **jargon**: a word a beginner would not know, outside the code itself;
- **tone mismatch**: wrong register for its place or theme;
- **too long for a phone**: pushes the next control out of sight at 390 px (use the commuter's screenshots);
- **fine**.

For every flagged string give a one-line rewrite in the repository's register: plain sentences, no em-dashes, no
exclamation marks, no claims about players or authors.

## Write `{{RUN}}/judge-copy.md`

```markdown
# Judge: copy, run 3 ({{D}})

## Method and limits

## Table A
| string | where | times per game | class | rewrite |
| --- | --- | --- | --- | --- |
(every string a player met, chooser and duel pages included; "times per game" is the maximum seen in one game)

## What each deck says five times
| deck | explanation (distinct in the artifact) | misleading signal (distinct) | hint 1 shapes | hint 2 shape |
| --- | --- | --- | --- | --- |

## Findings
1. <finding> (<pointer>)

## Fixes
1. <what>: <which strings>; code or data

## Verdict
| line | result | detail |
| --- | --- | --- |
| 2 | pass or fail | <strings classed "repeated, no new information" seen in more than 2 rounds of one game, and any jargon on the chooser, verdict, points note, answer line, or completion line; or "none"> |
```

Write the file with the Write tool. Do not return it as a message.
