---
evidence: v6-leak-rules-dry-run
observed-at: 2026-10-19
outcome: rules-hold
artifact-published: false
credential-material-recorded: false
---

# The v6 leak rules on real data: a dry run (#77, #78)

The v6 rules for "Which project?" (#77) and "Predict the output" (#78) apply to v6 artifacts only, so the committed
v5 artifact still rebuilds byte for byte. To see them on real data before the v6 run, this dry run forced every v6
rule on (a local edit to `profileAtLeast`, never committed) and replayed the v5 run with `--resume` in a separate
worktree, on a copy of its journal. The journal answered what it held; only the files the new rules called for were
fetched, read-only. Nothing was published or committed from the run.

## The runs

| Run | Requests | Live | Decks published |
| --- | --- | --- | --- |
| 1, `--resume` | 2,109 | 233 | language, before-after, algorithm, output, fix; project refused in generation |
| 2, `--resume` on run 1's journal | 2,087 | 10 | all six |

The v5 run made 1,859 requests, so the rules cost about 230 more on these decks. Most went to describing
repositories before trying their files, and to the files that replaced refused rounds.

Run 1 refused the project deck in generation (`PROJECT_ROUNDS_REJECTED`). In run 1 one blob read failed with
`WORKER_STDERR`, which selection skipped, so selection took another file. The generator's other checks (three
decoys, distinct options, the templates) are all ones selection enforces, and the new word rule fails with its own
code, so by elimination one answer's code or file name named the language's other answer. Selection never checked
that pair; it checks an answer against its own name and every decoy against every answer, while the generator
checks every option. From v6, selection checks the pair too (`PROJECT_NAME_IN_EXCERPT`). In run 2 the read
succeeded and the deck published. Run 1's path could not be replayed to confirm it, for the reason below.

## What changed

### Which project? (#77)

| | v5 artifact | Dry run |
| --- | --- | --- |
| Overlap solver (most shared words) | 38.5% | 25.0% |
| Reverse overlap solver (fewest shared words) | — | 25.0% |
| Rounds replaced | | 7 of 24 |

Gone: the three rounds #77 names (`Aws::SQS` in aws-doc-sdk-examples, `pub enum Utility` in tailwindcss,
`extends React.Component` in gatsby), and four whose panes shared a word with an option's description:
transformers, roslyn, maui, and angular. The rejections: `PROJECT_WORDS_IN_EXCERPT` 17, `PROJECT_NAME_IN_EXCERPT`
22.

No pane shares a word with any option, so the overlap solver ties every option and scores chance either way.

### Predict the output (#78)

| | v5 artifact | Dry run |
| --- | --- | --- |
| Transform solver on worded rounds | 60.7% (7 rounds) | 33.3% (6 rounds) |
| Rounds replaced | | 2 of 24 |

Gone: `xor_swap(-1, 1)` and `reverse_letters("nohtyP is nohtyP", 2)`, whose every call rearranges its input.
`capitalize` stays, now asking about `capitalize("hello world")`: two of its options are pieces of the argument
(`'Hello world'`, `' hello world'`), so the clue points nowhere. New: `mode(["x", "y", "y", "z"])` and a
`lin_search` call. The deck still balances every rank.

## For the v6 run

- **A worker failure with no stable code is not journaled.** The blob worker's `WORKER_STDERR` (stray stderr) is
  rejected without a journal entry, so `--offline` cannot replay past it and fails with `JOURNAL_MISS`. Run 1's
  journal could not be replayed offline for that reason. The data run's procedure covers it: after the live run, a
  `--resume` fetches what the journal lacks, and the two `--offline` replays then run on that journal.
- The rules raised the cost of these decks by about 12%. The v6 profile's larger language deck and new decks are
  budgeted separately (#129).
