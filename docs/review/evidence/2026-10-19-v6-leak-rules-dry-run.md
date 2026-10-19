---
evidence: v6-leak-rules-dry-run
observed-at: 2026-10-19
outcome: rules-hold
artifact-published: false
credential-material-recorded: false
---

# The v6 leak rules on real data: a dry run (#77, #78, #84, #75)

The v6 rules for "Which project?" (#77), "Predict the output" (#78), weak rounds (#84), and "Before or after?" pane
sizes (#75) apply to v6 artifacts only, so the committed v5 artifact still rebuilds byte for byte. To see them on real data before the v6 run, this dry run forced every v6
rule on (a local edit to `profileAtLeast`, never committed) and replayed the v5 run with `--resume` in a separate
worktree, on a copy of its journal. The journal answered what it held; only the files the new rules called for were
fetched, read-only. Nothing was published or committed from the run.

## The runs

| Run | Requests | Live | Decks published |
| --- | --- | --- | --- |
| 1, `--resume` | 2,109 | 233 | language, before-after, algorithm, output, fix; project refused in generation |
| 2, `--resume` on run 1's journal | 2,087 | 10 | all six |
| 3, `--resume` with #84's rules too, on run 2's journal | 2,185 | 116 | all six |
| 4, `--resume` with #75's rules and a before-after pool of 24, on run 3's journal | 3,000 | 938 | five; fix skipped at the v5 profile's 3,000-request ceiling |

The v5 run made 1,859 requests, so #77 and #78 cost about 230 more on these decks, and #84 about 100 more (run 3). Most went to describing
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

### Weak rounds (#84), run 3

| Rule | Refused | Effect |
| --- | --- | --- |
| A generator's file (`…Gen/`, `test<n>`), before any read | 1 | the fuzz test `someGen/test789.js` is gone |
| A window half of whose lines only declare data | 6 | the C++ string table, the C globals, and the locale strings are gone; the highest share left is 0.33 |
| One output round per idea | 3 | `binary_count_setbits` (agrees with `get_1s_count` on 25, 58, and 0) and `count_vowels_and_consonants` (named for `count_vowels`) are gone |
| One fix round per file | 3 | one of luigi's two `scheduler.py` rounds and thefuck's `git_push_force.py` (beside `git_push.py`) are gone |

One round of each pair #84 lists stays, as the rule intends: at most one per idea or file. Across all three
rules the project deck replaced 10 of 24 rounds, the language deck 1, output 5, and fix 3. The overlap solver stays
at 25%, and the transform solver is at 32.1% over 7 worded rounds.

### Before or after? (#75), run 4

| Solver | v5 artifact (10 rounds) | Run 4 (24 rounds) |
| --- | --- | --- |
| The bigger pane by characters | 80% | 54.2% |
| The pane with more lines | 75% | 58.3% |
| The pane with the longer changed line | 85% | 58.3% |

- `LINEAGE_PROSE_ONLY` refused 12 commits that changed only comments, docstrings, or strings (the v5 deck held three:
  a Go comment rewrite, a Python docstring tree, and a prompt string).
- `LINEAGE_SIZE_UNBALANCED` skipped 52 commits whose side was full, nearly all by their patch, before any tree or blob.
- The deck cost about 985 more requests than the v5 deck of 10, and later rounds cost the most, since the rarer
  shrinking commits fill the last places. That ran the dry run into the v5 profile's 3,000-request ceiling, so the fix
  deck, which runs after it, was skipped; the v6 ceiling is 5,000.
- The v6 profile sets the pool at 20, the issue's floor, rather than 24: the v6 run's estimate is then about 4,300
  requests against the 5,000 ceiling, against about 4,500 at 24, and a spent budget skips every later deck.

## For the v6 run

- **A worker failure with no stable code is not journaled.** The blob worker's `WORKER_STDERR` (stray stderr) is
  rejected without a journal entry, so `--offline` cannot replay past it and fails with `JOURNAL_MISS`. Run 1's
  journal could not be replayed offline for that reason. The data run's procedure covers it: after the live run, a
  `--resume` fetches what the journal lacks, and the two `--offline` replays then run on that journal.
- The rules raised the cost of these decks by about 17%. The v6 profile's larger language deck and new decks are
  budgeted separately (#129).
