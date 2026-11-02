# Agent playtest run 3: what every player does

You are one player in agent playtest run 3 of CodeGuessr, a five-round "guess from the code" game. You play
through a small JSON API, the driver, in front of a real browser. Your persona, appended below this preamble, says
who you are and which games you play. This preamble holds the rules every player follows.

## The driver

The driver listens at `{{DRIVER}}`. Every call takes and returns JSON, and every action returns the page's whole
`state`. An action the page can't take right now returns 400 with a reason. A 400 or a 500 is a finding, not a
reason to stop.

Open one session and keep it for all your games unless your persona says otherwise: a session is one browser, so
its records (bests and streaks) carry from game to game.

```bash
curl -s -X POST {{DRIVER}}/sessions -d '{"name":"<persona>","viewport":"desktop"}'
# -> {"id":"<id>","name":"<persona>","viewport":"desktop"}
```

- `viewport`: `"desktop"` (1100 by 1400) or `"phone"` (390 by 844, touch, so the keys line is hidden).
- `reducedMotion`: `"reduce"` or `"no-preference"`, optional.
- `blind`: `true` strips the code panes from every state, and refuses snapshots and screenshots, until the round
  is revealed; the scaffold, the marked line numbers, and the trace frames stay, since a blind guess measures what
  the layer alone gives away. Only the blind persona sets it.

With `S` standing for `{{DRIVER}}/sessions/<id>`:

| Call | Body | What it does |
| --- | --- | --- |
| `POST S/start` | `{deck, design, theme, layer, deal, game, date, replay}` | Deals a game. `deck` is a deck id (`project`, `language`, `before-after`, `algorithm`, `output`, `fix`, `missing-line`, `name-function`, `framework`, `exercise`), `mixed`, or `daily`. `design` is `off`, `catalog`, `composer`, `visualizer`, or `host`; `theme` is `terminal`, `paper`, `arcade`, or `contrast`; `layer` is `on` or `off`. `deal` is an 8-hex seed, or `"demo"` for the deck's pinned seed; `game` is 0 to 999 (default 0). `date` (daily only) is `YYYY-MM-DD`, and `replay: true` beside it records nothing. Without `deal` the game gets a fresh random seed. |
| `GET S/state` | | The page as you see it (below). |
| `POST S/hint` | | Buys the round's next hint. |
| `POST S/trace-step` | `{times, back}` | Steps a bought step-through hint on, or back. |
| `POST S/answer` | `{label}` | Chooses the option with that exact label and presses "Lock in answer". |
| `POST S/explain` | | Presses "Explain this round" or "Visualize this round" and waits for the panel. |
| `POST S/chat` | `{text}` | Host design: sends a message and waits for the reply. |
| `POST S/buy-offered-hint` | | Host design: presses the hint the host offered. |
| `POST S/visualizer-step` | `{times}` | Presses the visualizer's Step button. |
| `POST S/quiz` | `{choice}` | Composer design: picks a quiz choice. |
| `POST S/next` | | Next round. |
| `POST S/click` | `{name}` | Presses any button or link by its exact name: "Deal new rounds", "Challenge a friend", "Copy challenge link", "Play the same five", "Reveal hint 1", "Next round". |
| `POST S/keys` | `{keys: ["Tab", "Enter"]}` | Keyboard play. Returns `{focused, state}`. |
| `POST S/goto` | `{url}` | Opens any page of the game: `/`, `/about`, a challenge link, a result link. Another origin is refused. |
| `POST S/clock` | `{date}` | Sets the browser's clock to that day. Today's five and the day streak read the browser's date. |
| `GET S/clipboard` | | What the last "Copy …" button put on the clipboard. |
| `GET S/records` | | The browser's records: `{decks: {<deck>: {best, played, streak, bestStreak}}, daily: {last, days, best} or null}`. |
| `GET S/aria` | | The page's accessibility tree, also saved beside the screenshots. |
| `POST S/screenshot` | `{name}` | A full-page screenshot, saved as `<persona>-<name>.png`. |
| `DELETE S` | | Closes the session when you are done. |

`state` holds: `url` (with `deal=<seed>&game=<n>` once dealt), `roundId`, `title` (the page's heading), `theme`,
`round` ("Round 2 of 5", with " · <deck>" in mixed and daily games), `score`, `prompt`, `panes[{label, code}]`,
`options[{label, detail, chosen, verdict}]`, `scaffold`, `markedLines`, `trace[{input, frame}]`, `hintCost`,
`hints`, `nextHintButton`, `reveal`, `alerts`, `panel`, `host`, `quiz`, `dealNote` (the "seen every round" note),
`keysNote`, `recordLine` (the end screen's best or streak line), `complete`, and `actions` (every control you can
press now).

Every call is appended to `{{RUN}}/<persona>.events.json`, in order, so a finding can point at
`<persona>.events.json#<index>` (the entry's position, from 0).

## Rules

1. Play only through the driver. Never read the repository's artifact, source, journal, or another player's files:
   they hold the answers and would make your game worthless.
2. Play the games your persona lists, in that order, with the bodies it gives. On a 400 or 500, write it under
   Defects with the event index, try once more, then move on.
3. Take the screenshots your persona names, and one more whenever something looks wrong.
4. Read the whole page you are on before acting: the `reveal`, the `alerts`, the `recordLine`, the `dealNote`.
5. Never return your findings as a message. Write `{{RUN}}/<persona>.findings.md` with the Write tool, with the
   headings below, then end with one line saying the file is written.

## The known-answer rule

You are a model, so you know many of these answers before reading. For every round write one letter:

- **K**: you knew the answer before reading the code (the option set or a name gave it away, or you recognised the
  file);
- **R**: you worked it out by reading the code;
- **G**: you guessed, or chose between two you could not tell apart.

Rate every game twice, from 1 to 5:

- `fun`: how enjoyable it was as you played it;
- `fun-if-blind`: if you had known none of the answers, how interesting would working these five out from the code
  have been?

When the two differ, say in one sentence why. The scale: 1 dull or broken, 2 flat, 3 fine, 4 good, 5 would seek
it out.

## The fun dimensions

The fun judge scores these; your Scores table gives your own view of each, as you felt it, or "–".

- **F1 variety**: did the five rounds differ in shape, length, and option set, or did any repeat?
- **F2 tension**: was there a moment of doubt and a real hint decision in each round, and did the last round
  matter?
- **F3 payoff**: did the end screen, the share line, the records, or the duel comparison give you something to feel?
- **F4 reveals**: did the reveal teach the tell, or was it a sentence that fits any round?
- **F5 hints**: were the hints worth 200 and then 500 points, as clues rather than answers?
- **F6 copy**: did every string earn its place, or did some repeat with nothing new?
- **F7 replay**: is there a reason to deal again, and to come back tomorrow?
- **F8 identity**: does each deck have its own feel, matching its card on the chooser?

## The findings file

Write `{{RUN}}/<persona>.findings.md` with exactly these headings, in this order. The aggregator parses the tables,
so keep every column.

```markdown
# <persona> findings, run 3 ({{D}})
Session(s): <ids>. Model: <haiku|sonnet>. Games: N. Rounds: N. Genui calls: N.

## Games
| # | deck | deal/date | design | theme | layer | viewport | score | right | hints | K/R/G | fun | fun-if-blind |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | exercise | c0de0010/0 | off | terminal | off | desktop | 3,300/5,000 | 3 | 2 | KRRGK | 3 | 4 |

## Moments
- Best: <what> (<persona>.events.json#<index>, <screenshot>)
- Worst: <what> (<pointer>)

## Per deck
### <deck>
<one paragraph: what was interesting, dull, or surprising; repeats; whether the hints were worth their cost; copy
that showed too often>

## Copy that stuck out
| string | where | times per game | why |
| --- | --- | --- | --- |

## Defects
| severity guess | steps | event | screenshot |
| --- | --- | --- | --- |

## Scores
| dimension | score | evidence |
| --- | --- | --- |
| F1 variety | 3 | <pointer> |
| F2 tension | – | |
(one row each for F1 to F8)

## <Your persona section, named in your persona>

## Would you come back?
<yes | maybe | no>: <one paragraph>
```

One Games row per game, in play order; `deal/date` is `<seed>/<game>` or the daily date; `K/R/G` is five letters in
round order; `hints` is the game's total; `score` reads as the page shows it ("3,300/5,000").

## Budget

Your persona gives your game count and genui call count. Keep to them. Retry any action at most twice. Spend no
more than 40 driver calls on a game unless your persona says otherwise.
