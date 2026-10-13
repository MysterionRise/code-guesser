---
evidence: v5-leak-fixes-offline
observed-at: 2026-10-13
outcome: success
artifact-published: true
credential-material-recorded: false
---

# Deck leak fixes: an offline rebuild

A round-quality audit scored code-blind solvers on the committed v5 artifact
and found four live leaks (#76 to #79). This rebuild closes the two that the
v5 run's journal can serve. It ran `--offline` with no network and no token.
The other two need files the journal does not hold; they wait for a
`--resume` run.

## What changed

**Which algorithm? (#76).** Label words were masked only whole and only for
the answer:
- stems survived: `heapify` in a heap sort round, `count` in a counting sort
  round;
- a decoy's word left in view ruled that decoy out: `buckets` in the radix
  sort round.

Now every option's label stem (`heap`, `count`, `bucket`, `insert`, four
letters or more) is masked wherever it appears, with the rest of the word it
sits in. The parser rejects code that shows any option's stem.

**Spot the fix (#79).**
- Decoys skip every line of a comment, block comment, or docstring, read over
  the whole file.
- A fourth balance order ranks options by complexity (operator and bracket
  characters), with the same slack as length.
- Ranks break ties by position, but a solver splits a tie, so tied busy lines
  still scored 38.2% with the order alone. The deck now also caps what
  picking the line with the most or the least of each line feature scores,
  ties split. The features are length, complexity, indentation, and words used
  once in the pane. The cap is an equal share plus a tenth of the deck.
- Re-drawing windows pushed the second hint's pair off balance by chance: the
  longer line of the pair went from 54.2% to 66.7%, against 50%. Each hint now
  pairs its answer with a decoy chosen across the pool, so the answer is the
  longer of its pair in half the rounds.
- The parser checks all three rules.

**Backed out: project panes (#77).** The three cited rounds echo their own
answer, so a fix needs another file from each of those repositories:
- awsdocs with `Aws::SQS`;
- tailwindcss with `Utility`;
- gatsby with `React.Component`.

Checking three-letter name parts such as `aws` rejects the awsdocs file. The
selector then needs the repository's next file, which the run never fetched:
`JOURNAL_MISS` in `BLOB_RETRIEVAL`.

**Backed out: output transforms (#78).** Two functions return a rearrangement
of their input in every doctest, so no call of theirs is askable:
- `xor_swap` returns its two arguments swapped;
- `reverse_letters` returns the same letters reordered.

Dropping them needs at least two more TheAlgorithms/Python files past the 24th
the run accepted: `JOURNAL_MISS` in `CURATED_FILES`.

Both leaks stay tracked as expected failures in the leakage test.

## Runs

| Run | Mode | Journal | Outcome |
| --- | --- | --- | --- |
| Baseline | `--offline` | 1,787 replayed, 0 live | Byte-identical to the committed artifact |
| #78 rule | `--offline` | 1,307 replayed | `JOURNAL_MISS` in `CURATED_FILES`; backed out |
| #77 three-letter parts | `--offline` | 379 replayed | `JOURNAL_MISS` in `BLOB_RETRIEVAL`; backed out |
| Tie-aware complexity ranks | `--offline` | 1,787 replayed | Fix deck skipped, `FIX_RANKS_UNBALANCED`; replaced by the score cap |
| Final, twice | `--offline` | 1,787 replayed, 0 live | All six decks; byte-identical to each other |

In ten fix rounds the answer is the busiest option line, or tied for it, in
every window its file allows. A rank that puts the answer last among tied
lines therefore cannot balance, while a cap on the solver's split score can.

## What published

| Deck | Rounds | Change |
| --- | --- | --- |
| Which project? | 24 | None |
| Which language? | 24 | None |
| Before or after? | 10 | None |
| Which algorithm? | 24 | Three panes masked further: radix, counting, and heap sort |
| Predict the output | 24 | None |
| Spot the fix | 24 | The same 24 bugs; 21 rounds take another window, another hint pair, or both |

The crawl snapshot and the four unchanged decks are identical to the v5 run.

**Pin:** the canonical SHA-256 is
`8f542bd92942174e67e79249896a31d4f9a3ecdbbc31d882f26722b0967a5535`, in
`apps/game/src/demo/local-real-experiment.pin.server.ts`.

## Solvers, before and after

The auditor's scripts were run against `main` at `a4f6387` and then against
this artifact. Chance is 25%, or 50% once the second fix hint leaves two lines.

| Deck | Solver | Before | After |
| --- | --- | --- | --- |
| Which algorithm? | Label stem in the code, pick | 30.2% | 25.0% |
| | Label stem in the code, avoid | 23.3% | 25.0% |
| | Hallmark words, fitted after reading the rounds (reading, an upper bound) | 85.4% | 85.4% |
| Spot the fix | Most operators and brackets | **38.9%** | 33.3% |
| | Fewest operators and brackets | 10.4% | 9.0% |
| | Longest / shortest line | 33.3% / 10.4% | 33.3% / 4.2% |
| | Deepest / shallowest indentation | 28.8% / 19.8% | 23.3% / 19.1% |
| | A word seen once in the pane | 31.3% | 21.5% |
| | Avoid comment and docstring lines | 24.7% (3 rounds offer prose) | 25.0% (none) |
| | Option position, any | 25.0% | 25.0% |
| | Most central line | 25.0% | 22.9% |
| | Last line of the pane | 26.0% | 28.1% |
| | Hint 2 pair, then the longer line | 54.2% | 50.0% |
| | Hint 2 pair, then the later line | 45.8% | 54.2% |
| Predict the output | A transform of the call's arguments, 7 non-numeric rounds | **60.7%** | **60.7%** (#78, open) |
| Which project? | Five-letter stems shared by the pane and an option | **38.5%** | **38.5%** (#77, open) |

## Reading every round

I read all 24 algorithm rounds and all 24 fix rounds of the new artifact.

- **Algorithm.** The three changed panes read naturally.
  - `buckets` becomes `mysterys`.
  - `count` becomes `mystery`.
  - In the heap sort round, the helper call `heapify(...)` becomes
    `mystery(...)`. The window still opens on the sort itself, not on the
    helper.
- **Fix.** Every option is a line of code. Panes that open inside a docstring
  offer none of its lines, and comment lines are never options. Each hint pair
  names the answer and one other option.

## Verification

These ran on the branch merged with `main` at `b35ce0c`; an offline rebuild
there gives the same bytes and pin.

| Check | Result |
| --- | --- |
| `pnpm test` | 1,796 pass, none skipped; the leakage test runs against this artifact, with two expected failures (#77, #78) |
| `pnpm exec vitest run ops/poc/prepare` | 442 pass |
| `pnpm typecheck` (test files included), ops `tsc` | Clean |
| Python worker tests | 55 OK |
| Containment | 3 pass |
| Build | OK |
| a11y | 37 pass |
| Performance | 6 pass |
| e2e (`E2E_PORT=3240`) | 19 pass |
| Two `--offline` rebuilds | Byte-identical |

The README GIFs still show the earlier rounds and need a re-record after merge.
