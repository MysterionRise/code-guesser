---
evidence: v5-six-decks-run
observed-at: 2026-10-13
outcome: success
artifact-published: true
credential-material-recorded: false
---

# Phase 3b: six decks

The first run under profile `local-real-rounds.v5`, artifact schema
`local-experiment-artifact.v4`, on 2026-10-13. It adds the three decks from
the [new rounds research](../2026-10-13-new-rounds-research.md) to the three
from Phase 3a:

- Which algorithm?
- Predict the output
- Spot the fix

## Runs

| Run | Mode | Requests | Journal | Outcome |
| --- | --- | --- | --- | --- |
| 1 | `--resume` | 1,859 of 3,000 | 1,069 replayed, 718 live | Failed at publication: `EXPERIMENT_RECORD_REJECTED` in `boundedCount@model-run.ts` |
| 2 | `--resume` | 1,859 | 1,782 replayed, 5 live | All six decks published |
| 3, 4 | `--offline` | none live | full replay | Byte-identical to each other, after the masking fix below |

**Run 1.** Every request completed. The run report still capped selected
rounds at 120, three decks' worth, and six decks select 130. The cap now
derives from the deck list and the 40-round pool maximum (240).

**Spend** in run 1, by stage:

| Stage | Requests |
| --- | --- |
| Preflight | 2 |
| Stack metadata | 84 |
| Discovery | 14 |
| Admission | 208 |
| Blob retrieval | 838 |
| Curated files (all three new decks) | 713 |

**Run 2.** The 5 live requests are the Stack access checks, which are always
live.

## What published

| Deck | Rounds | Mix |
| --- | --- | --- |
| Which project? | 24 | Unchanged sources |
| Which language? | 24 | Unchanged sources |
| Before or after? | 10 | Unchanged sources |
| Which algorithm? | 24 | 8 each in Python, Go, and Java, from TheAlgorithms at pinned commits; six of the eight configured families of four (the deck fills before number theory and string matching are read) |
| Predict the output | 24 | TheAlgorithms/Python: 8 `maths`, 6 `bit_manipulation`, 6 `strings`, 3 `conversions`, 1 `dynamic_programming` |
| Spot the fix | 24 | 19 BugsInPy and 5 Defects4J bugs, from 15 upstream repositories (19 Python, 5 Java) |

**Predict the output.** TheAlgorithms runs `pytest --doctest-modules` over
these directories. Its scheduled `build` run at the pinned commit `3935d28`
passed (actions run 38329953360).

**Spot the fix.** The deck leans Python. At the parent commits of most Apache
Commons fixes, GitHub's licence detection cannot identify the old
`LICENSE.txt`, so admission rejects them (`ADMISSION_LICENSE_SHAPE`). The
licence rule was kept as it is.

**Pin:** the canonical SHA-256 is
`1427cf105672682d0dd89ff7a1d7975b9001f939f0dcbefc0126c79160e8459a`, in
`apps/game/src/demo/local-real-experiment.pin.server.ts`.

## Expected rejections in the new decks

| Code | Count | Meaning |
| --- | --- | --- |
| `OUTPUT_NO_DOCTEST` | 108 | A Python file with no function a round can ask about. |
| `FIX_PATCH_WIDE` | 105 | A dataset patch that changes more than one line. |
| `FIX_CHANGE` | 15 | The upstream fix commit changes more of the file than the dataset's line. |
| `ADMISSION_LICENSE_SHAPE` | 10 | Mostly old Apache licence files GitHub cannot identify. |
| `FIX_WINDOW` | 5 | No 14-line window gives four comparable option lines. |
| `PERSONAL_DATA` | 4 | The file contains personal data. |
| `FIX_PARENT` | 3 | The fix is a merge. |
| `ADMISSION_AUTHOR_CONTACT` | 2 | Closure Compiler commits that record an email address as the author's name. |
| `BLOB_SIZE_LIMIT` | 1 | A file over 256 KiB. |

## Reading every round

I read all 72 new rounds. Each is self-contained and answerable from its code.

One leak turned up. In the pigeonhole sort round, the Java code said
`pigeonHoles`, `createPigeonHoles`, and `populatePigeonHoles`.
- **Why it got through:** label words were masked only when they began a
  single word, and camelCase split `pigeonHoles` into `pigeon` + `Holes`.
- **Fix:** label words are now masked wherever they begin a word, across
  camelCase and snake_case boundaries. `MAX_PIGEON_HOLES` becomes
  `MAX_MYSTERYS`.
- **Check:** no round's answer label word survives in its code.
- **Rebuild:** the artifact was rebuilt offline from the journal with no new
  requests.

Decoys' label words may still appear, so `buckets` in the radix sort round
stays: it misleads toward bucket sort and gives nothing away.

## Fairness on the committed artifact

The leakage test (`packages/artifact/test/deck-leakage.test.ts`) now runs a
block for every deck, and each passes. No code-blind solver beats chance plus
ten points:

| Deck | Solvers |
| --- | --- |
| Which algorithm? | Frequency, rarity, same options, label order |
| Predict the output | Position, text rank, frequency, rarity, label order |
| Spot the fix | Position, nearness to the middle, distance from it, longest line, shortest line |

The shared parser enforces each deck's balance rules.

## Game

- Every deck plays end to end in the browser suite. A new test checks a real
  fix round's gutter, each option's line of code, and the highlight.
- Fix rounds keep their options in line order, which the deck already
  balances. Other four-option rounds still reshuffle each deal.
- Media were re-recorded at 390x844; every GIF is under 4 MB (decimal):

  | File | Size |
  | --- | --- |
  | `deck-project.gif` | 2.75 MB |
  | `deck-language.gif` | 2.66 MB |
  | `deck-before-after.gif` | 2.92 MB |
  | `deck-algorithm.gif` | 3.05 MB |
  | `deck-output.gif` | 2.82 MB |
  | `deck-fix.gif` | 3.28 MB |
  | `full-run.gif` | 3.18 MB |
  | `codeguessr-demo.mp4` | 4.23 MB |

## Verification

| Check | Result |
| --- | --- |
| `pnpm test` | 1,768 pass, none skipped |
| `pnpm typecheck`, ops `tsc` | Clean |
| Python worker tests | OK |
| Containment | 3 pass |
| Build | OK |
| a11y | 37 pass |
| Performance | 6 pass |
| e2e | 19 pass |
| Two `--offline` rebuilds | Byte-identical |
