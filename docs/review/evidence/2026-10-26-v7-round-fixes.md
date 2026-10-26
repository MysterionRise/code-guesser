---
evidence: v7-round-fixes
observed-at: 2026-10-26
outcome: published
artifact-published: true
credential-material-recorded: false
---

# The v7 round fixes: words read whole, scripts, synonyms, and hints (#200)

Reading the v7 artifact (`2026-10-21-v7-data-run.md`) found rounds that gave their answer away or repeated one idea.
Four v7 rules now refuse them. Each is gated on `profileAtLeast(version, "local-real-rounds.v7")`, so v5 and v6
artifacts keep their own rules, and each holds in the selector, the generator, the shared parser, and the leakage
test. One `--resume` on the v7 journal replaced the refused rounds and published ten decks at the v7 targets.

## What #200 found, and the rules

| Case | Round | Rule from v7 on |
| --- | --- | --- |
| cli/cli's pane sets `"GITHUB_TOKEN"`; its description is "GitHub’s official command line tool" | `…8a81aed1` | `wordStems(text, whole)` also counts a word split at a case change whole, on both sides: `GitHub` gives `git`, `hub`, and `githu`, which meets `GITHUB` |
| ruoyi-vue-pro's pane is partly Chinese, and only its own description is in Chinese | `…b5b4e69c` | a script other than Latin that the pane and a description both show counts as a shared word (`script:Han`) |
| base −2 conversion three times: `decimal_to_negative_base_2`, `decimal_to_negative_binary`, `negative_binary_to_int` | `…8c97e3d4`, `…23302b4e`, `…c4d63e73` | `sameIdea(left, right, version)`: two conversions that join the same two sides, either way round and with synonyms read as one word (`bin`, `int`, `base_2`), are one idea |
| `addEdge` answers two name-the-function rounds | Go `lowestcommonancestor.go`, Java `HeavyLightDecomposition.java` | no name answers twice (`answerName`: case and underscores aside) |
| `a_star.py`: hint 1 says a condition, hint 2 pairs the answer with an assignment | `…93a447b8` | the second hint pairs the answer with an option the first hint leaves open |

Three choices go past the issue's wording:

- **Scripts.** The issue proposed refusing a pane when its script shows in only some of the options' descriptions. The
  rule refuses it when any description shows it, so the script check is one more shared word in `sharedOptionWords`,
  and the selector, the generator, the parser, and the overlap solver read one function. The only extra round it
  refuses is one whose four options are all described in the pane's script, which neither v7 artifact holds.
- **Synonyms only within conversions.** Read with synonyms, `bin_to_decimal` shares every word with
  `binary_coded_decimal` and with `decimal_to_negative_binary`, and the word rule would tie them. So two conversions
  are compared by their two sides, a conversion's words alone tie it to nothing new, and two other names are tied by
  their words, synonyms read, as before. `sameFile` (the fix deck) keeps the v6 reading.
- **Hints in both decks.** The `a_star.py` case was not one round. In the first v7 artifact, 18 of 40 missing-line
  rounds and 14 of 48 name-the-function rounds paired the answer with an option the first hint rules out, so buying
  both hints decided them. A solver that buys both scored 72.5% and 64.6%. Both decks build their second hint the
  same way, so the rule covers both: the pair's other option is a line of the answer's kind, or a name of as many
  words. Every round already holds such an option (the generators' `MISSING_LINE_HINT_DECIDES` and
  `NAME_FUNCTION_HINT_DECIDES`), so the rule changes only which decoy the hint names, and needs no request.

The name rule rides on the balance search, not on the file order. `balancedChoice` takes keys: of the choices with
the same ranks and scores, a round takes the first whose key (its answer's name) no other round holds. Without keys
the search runs exactly as before, so no other deck moves. Its one new code is `NAME_FUNCTION_ANSWER_REPEATED`, the
generator's check, documented in CLAUDE.md.

## The runs

| Session | Mode | Requests | Live | Outcome |
| --- | --- | --- | --- | --- |
| 1 | `--offline --profile=local-real-rounds.v6 --journal=run.jsonl.v6-resume-2026-10-19` | 4,077 | 0 | `PREPARATION_COMPLETE`, `1abc21f8…` as before |
| 2 | `--offline` on the v7 journal | 2,520 | 0 | `JOURNAL_MISS` in `BLOB_RETRIEVAL`, as expected: the project deck needed files the journal never read |
| 3 | `--resume` on the v7 journal | 6,245 | 114 | `PREPARATION_COMPLETE`, ten decks; the artifact published here |
| 4 | `--offline` | 6,245 | 0 | byte-identical artifact and pin, 7 s |
| 5 | `--offline` | 6,245 | 0 | byte-identical artifact and pin, 7 s |

Session 3 logged `PREPARATION_JOURNAL mode=resume replayed=6001 live=114`. Discovery replayed its twelve search pages,
so GitHub's secondary search limit never came into play, and no session reached a `RATE_LIMIT_CHECKPOINT`. The
journal grew from 6,291 entries to 6,400. Since the preparer's containment checks were indexed (#201), an `--offline`
replay takes seconds, not 40 minutes.

### Spend

`PREPARATION_SPEND PREFLIGHT=2 STACK_METADATA=156 DISCOVERY=12 ADMISSION=1573 BLOB_RETRIEVAL=2430 CURATED_FILES=2072
total=6245`: 94 more than the v7 data run, 74 of them blob retrieval and revalidation for the project deck and 20
curated reads for the output deck.

| Measure | Used | Ceiling |
| --- | --- | --- |
| Requests, replayed and live | 6,245 | 10,000 |
| Stack metadata | 376,213,147 bytes | 448 MiB |
| Blob attempts | 299 | 600 |
| Blobs retrieved | 100 | 200 |
| Stack blob bytes | 1,920,645 | 32 MiB |
| Retries, waits | 0, 0 s | 5, 30 s |

## What each rule refused, and what replaced it

| Deck | Size | Refused | In their place |
| --- | --- | --- | --- |
| Which project? | 48 | cli/cli `…8a81aed1` (Go); ruoyi-vue-pro `…b5b4e69c` (Java); deeplearning4j's `…5da7e85c` moved with its group | labstack/echo `middleware/decompress.go` (`…cf983788`); deeplearning4j `BaseLayer.java` (`…ae7b1feb`); questdb `AnyRecordMetadata.java` (`…331a8417`) |
| Predict the output | 40 | `decimal_to_negative_binary`, `negative_binary_to_int` | `naive_pattern_search`, `decimal_isolate` |
| Name the function | 48 | `addEdge` in `HeavyLightDecomposition.java` | the same file's `buildSegmentTree` |
| Missing line | 40 | 18 second hints that decided their round | a decoy of the answer's kind |
| Name the function | 48 | 13 second hints that decided their round | a name of the answer's count of words |

- **Project.** Go's group answers gofiber/fiber and now labstack/echo; cli/cli stays a decoy beside moby/moby, and
  spf13/cobra drops out. With ruoyi-vue-pro's files refused, Java's second group answers deeplearning4j and questdb
  against jenkins and guava, and deeplearning4j's round moves from `JavaStorageMetaData.java` to `BaseLayer.java`. The
  other 44 project rounds read exactly as before. `PROJECT_WORDS_IN_EXCERPT` went from 38 to 43 and
  `PROJECT_NAME_IN_EXCERPT` from 43 to 46.
- **Output.** `decimal_to_negative_base_2` (`maths/base_neg2_conversion.py`) comes first in the deck's file order and
  stays; the other two are refused after their read and before their bind. Eighteen more files had no round
  (`OUTPUT_NO_DOCTEST` 199 to 217, `OUTPUT_IDEA_REPEATED` 3 to 5). Balancing the new pool asks another documented call
  in seven rounds (`trailing_zeroes`, `mode`, `binary_count_trailing_zeros`, `remove_digit`, `excess_3_code`,
  `bytes_to_int_little`, `vol_cuboid`).
- **Name the function.** No file was read again (`NAME_FUNCTION_NONE` stays 214). Go's `addEdge` keeps its round. With
  the search's path changed, `QRDecomposition.java` now asks for `hasValidRows` (was `dotProduct`), and
  `cyclic.go`'s `Rotate` comes with other decoys.
- **Hints.** Missing line: 19 second hints change, the 18 that decided their round and one the length steering moved;
  the answer is the longer of its pair in 22 of 40. Name the function: 16 change in the rounds that keep their answer,
  13 that decided and three the steering moved, and the HeavyLightDecomposition round was the 14th; the answer is
  the longer of its pair in 24 of 48.
- Every other deck reads exactly as before: each of its rounds differs only in the snapshot id its source records.

## Checks on the artifact

- The canonical SHA-256 is `847e7512d5374450656b2147b4c7478e6bcc28045a372f33683ae63996e38a5e`, pinned in
  `apps/game/src/demo/local-real-experiment.pin.server.ts`; it replaces `81f31057…`. 422 rounds, every deck at its v7
  target: project 48, language 52, before-after 30, algorithm 48, output 40, fix 36, missing-line 40, name-function
  48, framework 32, exercise 48.
- The shared parser now refuses the first v7 artifact, and the leakage test reads each rule back. On the first v7
  artifact its new checks flag two project rounds, three output pairs, one name-the-function pair, and a both-hints
  solver at 72.5% (missing line) and 64.6% (name the function). On the new one they find nothing, and the solver
  scores 50.0% on both decks.
- v6 still rebuilds: session 1 gives `1abc21f8…` again.
- The duel test's golden digests move for the project, name-function, and daily deals; the others deal the same ids.

## Question layers

The layers are bound to the artifact's hash. The language and algorithm rounds read exactly as before, so
`pnpm prepare:questions` replayed every call from the questions journal: `QUESTIONS_CALLS replayed=358 live=0`, no
OpenRouter call. It published the same 74 layers (Marker hunt 50 of 52, Trace it 24 of 48; seven refused on review, as
in the v7 data run), now bound to the new artifact. Their pin moves from `850defd0…` to
`84afc4acdb3b0a99fa1b2de7dfd960b4dffac90fb1841418979de1748f0f62ae`. No trace is new, so none needed reading.

## Verification

Run fresh on the branch with Node 24.22.0:

- `pnpm test`: 2,249 passed, 3 expected failures (#81), 2 skipped;
- `pnpm exec vitest run ops/poc/prepare`: 566 passed;
- `pnpm exec tsc --noEmit -p ops/tsconfig.json` and `pnpm typecheck`: clean;
- the Stack worker's `unittest`: 55 passed;
- `pnpm --filter @codeguessr/game build`: succeeds, and `pnpm test:deploy`: 4 passed;
- the containment test: 5 passed;
- `pnpm test:a11y`: 37 passed, and `pnpm test:performance`: 6 passed;
- `E2E_PORT=3200 pnpm test:e2e`: 109 passed;
- `pnpm audit --audit-level=high`: no known vulnerabilities.

## Journals

The journals hold provider bodies, so they stay on this machine and out of git:

- The resumed journal is `ops/poc/stack/tmp/journal/run.jsonl` in the main checkout, with a copy as
  `run.jsonl.v7-200-2026-10-26`; it rebuilds this artifact with `--offline`. The v7 data run's journal stays
  `run.jsonl.v7-2026-10-21`.
- The questions journal took no new entry.
