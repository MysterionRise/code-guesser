# round-data review, 2026-11-10

> One reviewer agent's findings, as written on 2026-11-10 against `main` at `03cd25a`, kept for their verdict
> and implementation sketch per issue. Where [the review](../2026-11-10-next-steps-review.md) corrects a point,
> the review stands. Line numbers are that commit's.

## Summary

- Every finding in scope holds on the committed artifact, and most hold on the whole pool, not just the judges' sample. Three parts are already done: #240's separator, #81's language half, and most of #80's solvers.
- Most fixes are profile copy or generator literals that replay `--offline`. Only #231 and a handful of refused rounds need a `--resume` with live GitHub requests. The questions run will be live for all 100 algorithm and language rounds, since this phase changes their hints and the writer's rules.
- One re-pin is enough if the rules land gated on a new profile v8 while `PROFILE_VERSION` stays v7, as v7 itself was introduced (commit `14fa181`), and one data-run PR then publishes.
- The owner has to settle the hint ladder first (#82, #160, hint 2's price); #228 and #229 cannot be written without it.
- While I read, the lead's run briefly published another pin in the working tree (`97fa9b74…` at 20:12 GMT, rounds identical to `847e7512…`); by 20:16 the tree was back at the committed hash. Details are under "Stale or wrong".

## Verdict per issue

All counts are from `git show HEAD:apps/game/src/demo/generated/local-real-rounds.json` (422 rounds), read with `jq`.

| Issue | Still valid? | Evidence (path:line or PR) | Size (S, M, L) | Depends on | Recommendation |
| --- | --- | --- | --- | --- | --- |
| #228 hints that state the answer | Yes, on every round of the four decks. Algorithm 48 of 48 and exercise 48 of 48: the reveal's helpful sentence is `label: hint 1`. Language 52 of 52 and framework 32 of 32: hint 2's quoted token is the reveal's "typical X" token. | `ops/poc/prepare/algorithm-rounds.ts:59,83`; `exercise-rounds.ts:65,88`; `framework-rounds.ts:68,94`; `language-rounds.ts:188-194`; copy in `ops/poc/profiles/local-real-rounds.v7.json` (`idea`, `complexity`, `detail`) | M | #82 decision; profile v8 | do next |
| #229 hints that rule out nothing | Yes, and before-after is worse than filed: hint 2's counts decide 25 of 30 rounds for anyone who counts pane lines. Fix: 26 of 36 share one catch-all hint 1. Output: both hints are parser-enforced eliminations. | `before-after-rounds.ts:56-59`; `packages/artifact/src/artifact.ts:435-441` (output), `:466` (fix); `fix-rounds.ts:116`; `output-rounds.ts:119` | M | #82 decision; profile v8 | do next |
| #230 reveal sentences | Yes. Project 48 of 48 and 48 of 48; name-function 39 of 48; the Shell sort line on 8 rounds; missing-line names a keyword, builtin, or prose word in 21 of 39 signals. The code half is done (#234, #242). | `project-rounds.ts:104-105`; `name-function-rounds.ts:122-125`; `missing-line-rounds.ts:62,101-118`; profile v7 `:497` | M | profile v8 | do next |
| #231 before-after commits | Yes. 8 of 30 subjects do not say "refactor"; the subject shares no word with the changed lines in about 11 of 30 (rough stem match); 10 of 30 windows change one or two lines. Every reveal still says the message "describes what version X does differently". | `before-after-rounds.ts:73`; `select-github.ts:49-97`; queries match the whole message (profile v7 `github.queries`) | M, L if the pool runs short | dry run of the rule; pool-size decision | do next |
| #240 layer prompts | Partly. "How is a function defined?" is in 42 of 50 Marker hunt layers. The separator is fixed: roles render as `name: role`. Free-text roles would undo why the list is closed. | `apps/game/src/demo/generated/question-layers.json`; `apps/game/src/components/arcade/question-layer.tsx:14` (#234); `packages/artifact/src/question-layer.ts:17-25,31-44` | S | the questions run | do next |
| #249 (data half) | Yes. "refactor" and "idioms" are deck descriptions; the fix evidence clause is a template; the missing-line signal is #230's. | profile v7 `templates.beforeAfter.description`, `curated.framework.templates.description`, `curated.fix.templates.evidence` | S | rides with #230 | do next |
| #82 partial hints | Yes, as the decision behind #228 and #229. Its own leftovers still hold: language hint 1 decides 4 of 52 rounds, rules out nothing on 15, and is wrong on 1; project hint 1 names a file stem the pane already shows in 27 of 48. | `language-rounds.ts:154-185`; `project-rounds.ts:87-90` | M (inside #228, #229) | owner | owner decision |
| #81 recurring option sets | Half. Language is done and tested; project passes. Algorithm, framework, and exercise are the three expected failures, and #243 does not touch them (it arranges one game, not memory across games). | `packages/artifact/test/deck-leakage.test.ts:56-72,83,141,157`; `apps/game/src/demo/local-real-experiment-deal.server.ts:87` (#243) | S to pin a ceiling, L to break families | none | later |
| #80 solvers | Mostly done (commits `84d9ac6`, `f323f4b`, and the v6 and v7 rule PRs). Missing: any solver that reads hints across decks, and the README list. | `packages/artifact/test/solvers.ts:24-201`; `README.md:164-174` | S | none | do next |
| #159 check traces | Yes. Nothing checks a trace; seven are refused by hand, and the v7 run found 6 of 30 wrong. | `ops/poc/questions/reviewed.ts:6-28`; `docs/review/evidence/2026-10-21-v7-data-run.md:132-147` | M | before the questions run | do next |
| #160 algorithm layer | Yes. At least 8 of 24 published Trace it hint 1s say how the code works, against the writer's own rule. Run 3's layer-on tally is not interpretable (#241). | `ops/poc/questions/designs.ts:37`; `audit.ts:17-23,52-54`; v7 data run `:126-128` | S after the decision | owner; #228 | owner decision |

**What the artifact shows today (question 2).**

- **#228, algorithm (48 of 48).** `local-algorithm-01d981b7…`: hint 1 "It finds the smallest remaining item and swaps it into the next position."; the reveal reads "Selection sort: It finds the smallest remaining item…". Hint 2 is the complexity, 23 distinct strings over 24 algorithms, so it names the answer to anyone who knows them ("O(log log n) on evenly spread data").
- **#228, exercise (48 of 48).** `local-exercise-0de6c47b…`: hint 1 "It joins the first letter of every word, in capitals." beside the options Acronym, Anagram, Isogram, Pangram.
- **#228, framework (32 of 32).** `local-framework-0d096747…`: hint 1 "Views extend a base class, list their DOM events as selector strings, and listen to their models for changes."; hint 2 "Look for `.View.extend({` in the code."; the reveal "`.View.extend({` is typical Backbone."
- **#228, language (52 of 52).** `local-language-17e95a98…`: hint 2 "Look for `readonly` in the code." beside Java, C#, Rust, Go. A few tokens are weaker (`%`, `//`, `self.`, `::`).
- **#229, before-after (30 of 30 affected, 25 decided).** `local-before-after-12c16eee…`: hint 2 "The commit removed 0 of these lines and added 1." In all 30 rounds the newer pane is longer by exactly added minus removed, so the hint names the answer in the 25 rounds where the two differ and says nothing in the 5 where they are equal.
- **#229, fix (36 of 36).** `local-fix-012d632d…`: hint 1 "The fix adds, removes, or rearranges part of an expression." It names the change, which no option shows, so it rules out no line; 26 of 36 rounds carry this one sentence.
- **#229, output (40 of 40).** `local-output-0f8412b1…`: hint 1 "next_power_of_two(1) → 1", and 1 is an option. The parser requires this shape.
- **#230, project (48 of 48).** `local-project-1ce0e8d8…`: "The folders on the way to keys.ts show where denoland/deno keeps this code." and "All four options are popular TypeScript projects."
- **#230, name-function (39 of 48).** "What it takes in and what it hands back narrow down which job it does."; 8 more say "It calls itself…". The misleading sentence is one string on 48 of 48.
- **#230, missing-line.** `local-missing-line-5facdb72…`: "It works with `the`, which the code around the gap uses." This is a bad round, not just a bad sentence: its answer and all three decoys are lines of prose from a string block. Other signals name `def`, `self`, `assert`, `str`, and `Enter` (a word inside a string).
- **#230, others.** Before-after, output, fix, missing-line, and name-function each have one misleading sentence for the whole pool, a literal in the generator.
- **Not in any issue.** `local-language-66fb3e93…` (F#) has hint 1 "Blocks are wrapped in braces.", which is false for F#: OCaml and F# have no block-style rule, so the brace test fires on a record (`language-rounds.ts:182-184`). Four more missing-line rounds read badly: three whose hidden line is a `def` line, and one with four `assert` lines to choose between.
- **Does not fully hold.** #82's "no hint repeats an identifier already in the pane" contradicts the marker hints, which the parser requires to quote the pane (`packages/artifact/src/framework.ts:55-56`).

**Where each fix lands and what it costs (question 1).**

- **Profile copy only, `--offline`:** the algorithm, exercise, and framework hint text and family notes (the Shell sort line is one string); deck descriptions; the fix evidence clause.
- **Generator literals, `--offline`:** every helpful and misleading sentence. The parser checks them only as text (`artifact.ts:612-616`), so no parser rule is needed.
- **Parser rules, version-gated:** output hints (`artifact.ts:435-441`), fix hint 1 (`:466`), and any hint that names two options, which the project, language, algorithm, framework, and exercise validators refuse today (`:358-360`, `:376-378`, `:412-414`).
- **Live requests:** only replacements for refused rounds. #200's resume replaced five rounds for 114 live GitHub requests (`docs/review/evidence/2026-10-26-v7-round-fixes.md:54,65-67`). The v7 run tried about 600 commits for 30 before-after rounds (`2026-10-21-v7-data-run.md:86-87`). No Hugging Face request is expected, since the worker outputs are recorded again; not verified.
- **Questions run:** forced by any re-pin, since layers bind to the artifact hash. It replays free only while the writer's request is unchanged. That request holds each round's hints and reveal sentences (`ops/poc/questions/designs.ts:96-97`), and the journal key is the request body's hash (`client.ts:59-70,103`). So changing algorithm or language copy, or the writer's rules, makes all of it live: about 380 to 400 Haiku calls. The v7 run's 58 live calls were 77,255 tokens in and 13,054 out (`2026-10-21-v7-data-run.md:119-120`). Dollar cost not verified; under a dollar at the rates CLAUDE.md records.
- **Golden digests:** `dealDigest` hashes round and option ids only (`local-real-experiment-deal.server.ts:237-240`), and round ids come from repository, commit, path, and blob (`ops/poc/prepare/round-helpers.ts:38-39`). So a deck whose rounds change only in copy keeps its digest and its pinned deal. `daily` always moves, the two `+layers` digests move with new layers, and a deck with a replaced round moves (`apps/game/test/duel.test.ts:198-213`).
- **Media:** scenes play pinned deals, so copy-only decks show the same rounds with new hint and reveal text. Which scenes show a hint or a reveal: not verified.

**Overlaps (question 3).**

- #82 is the decision; #228 (answer keys) and #229 (hints that do nothing) are its two measured failure modes. Keep #228 and #229 as the work items, move #82's language, project, and superset bullets into them, and close #82 with their PR.
- #160's option 3 is #228's algorithm fix applied to the layer. What is left of #160 is the scaffold's names and the audit bound.
- #81 is not superseded by #243. What remains is the three family decks' memory edge, 36.4% against 32.8% on algorithm. The two unused families cannot close it: the pool cap of 60 fits one more family at two rounds an algorithm (`ops/poc/prepare/profile.ts:610`), and one more family brings the gain from 3.6 points to about 3.2 by my scaling, not run.
- #249's two data boxes belong to #230.

## Proposed order

1. **Batch 0, no artifact change: decide and measure.**
   - **The owner's decisions** below, the hint ladder first.
   - **#80's remainder as the phase's mechanical bar.** Add hint-reading solvers to `packages/artifact/test/solvers.ts` and `deck-leakage.test.ts`: hint 1 equal to the reveal's sentence; before-after hint 2 against pane line counts; how many options hint 1 leaves, per deck. Mark each `it.fails` with #228 or #229, as #80 asks, and bring `README.md:164-174` up to date. They fail today and flip at the data run.
   - **A pool-wide blind audit of static hints.** Reuse `solverRequest` and `answerProbability` in `ops/poc/questions/audit.ts` for every deck's prompt, options, and static hints at three stages, as a report-only mode of `prepare:questions` (like `--limit`, it writes `tmp/report.json`). About 1,270 short Haiku calls, journaled. It gives bar line 3 over 422 rounds where run 3 had five a deck.
2. **Batch 1, profile v8 beside v7, `PROFILE_VERSION` unchanged.**
   - Add `local-real-rounds.v8` to `PROFILE_VERSIONS` and `ARTIFACT_SCHEMA_VERSIONS` (`packages/artifact/src/domain.ts:23-29`), a `CURATED_CAPS` entry (`ops/poc/prepare/profile.ts:310-314`), and a copy of the v7 profile. New keys go through `laterKey` (`profile.ts:524`).
   - Every rule below is gated on `profileAtLeast(version, "local-real-rounds.v8")`, so the committed artifact still parses and each PR merges with no re-pin. Check each with `--offline --profile=local-real-rounds.v8 --journal=<copy>`.
3. **Batch 2, copy and rules that replay offline.**
   - **#230 and #249.** Project: build the helpful sentence from the answer's description and drop the "popular L projects" frame (`project-rounds.ts:104-105`). Name-function: say the function's own parameters, which `PARAMETERS` already reads (`name-function-rounds.ts:91,122-125`). Missing-line: reuse the keyword filter `namesIn` (`missing-line-window.ts:35-39`) in `missing-line-rounds.ts:101-102`. Fix the fast-sorts note and the two descriptions in the v8 profile.
   - **#228.** A new per-entry profile field for hint 1 beside `idea` (which stays for the reveal), parsed in `profile.ts:581,719,772` and read in the three generators' `clues` lines. Language: give OCaml and F# a block style, and derive hint 1 from the pair's shared trait (`language-markers.ts:189-203`, reworded where a note names a language).
   - **#229.** Before-after: a `{changed}` placeholder in `linesClue` (`profile.ts:497`, `before-after-rounds.ts:56-59`); no parser rule reads that hint. Output: carry the function's spare doctests from `select-output.ts` into `OutputCandidate` and gate `artifact.ts:435-441`. Fix: new `FIX_CHANGE_HINTS` wording and `artifact.ts:466`.
   - **Refused rounds.** Refuse a missing-line gap that is prose or a `def` line in `gapChoices` (`missing-line-window.ts:104`). Replacements may need files the journal lacks; the offline dry run says which.
4. **Batch 3, one `--resume` with live GitHub requests.**
   - **#231.** Dry-run the rule first: the subject must share a word with the changed lines (in `selectBeforeAfter`, `select-github.ts:57`), and the reveal quotes the message only when it does (`before-after-rounds.ts:73`). Then take the replacements for this and for batch 2's refused rounds in one session. No new search window.
5. **Batch 4, questions.**
   - **#159.** A second, code-reading model recomputes each trace from the pane in `prepareRound` (`ops/poc/questions/prepare.ts:64-80`) and refuses on disagreement. Test it on the seven hand-refused traces and the 24 a reader passed. Clear `REVIEW_REFUSED`, which refuses a round for good, not one trace.
   - **#240 and #160.** Offer each Marker hunt round a hash-chosen six of the twelve prompts (`designs.ts:73`). Take Trace it's hint 1 from the round's static hint 1, so no model writes it (`designs.ts:120-128`). Hide a role that repeats its name in `question-layer.tsx:14`.
   - Then one `pnpm prepare:questions`, and read whatever traces the check passes.
6. **Batch 5, the one re-pin.** `PROFILE_VERSION` to v8, the artifact and its pin, the layers and their pin, `GOLDEN_DIGESTS`, the flipped `it.fails`, and the evidence record, in one PR.
7. **Batch 6, the recheck, then the media.** Record the media only after the recheck passes, so they are recorded once.

**Release bar for the phase.**

- **Mechanical, in CI:** the new hint solvers pass with no expected failure for #228 or #229. No helpful sentence equals a hint, and none repeats across more than a fifth of a deck's pool.
- **Pool-wide blind audit:** run 3's line 3 thresholds (below 80% after both hints; hint 1 lifts 10 points) measured on every round, not five.
- **Playtest:** run 3's lines 1, 1b, 2, and 3, with lines 4 to 7 at regression scope.

**What the recheck plays.**

- The blind player on all ten decks' pinned deals, with the layer-on games first on rounds it has not seen (#241).
- Two sighted Sonnet players across the 16 cells never replayed (project, language, before-after, algorithm, output) and the 11 still below 3 (exercise, fix, framework, missing-line, name-function, mixed).
- The phone player on before-after and output. Judges: copy, difficulty, and fun.
- Decks that kept their round ids deal the same rounds as run 3, so those cells compare like for like.

## Owner decisions

1. **What is a hint for (#82)?**
   - Options: (a) facts about the answer, as the four recognise decks do today, which run 3 scored F5 1 to 2 and a blind player solved 5 of 5; (b) pure eliminations, as output does, which no sighted player bought in 10 rounds; (c) hint 1 a true partial statement that at least one decoy shares, then hint 2 the answer and one option hint 1 leaves open.
   - Evidence for (c): missing-line and name-function already work this way since #200, with a both-hints solver at 50.0% (`2026-10-26-v7-round-fixes.md:113-116`). With fix, they are the decks whose F5 is 3, and the judge lists fix's 50/50 as fun.
   - One caveat for (c): hint 1 already leaves exactly two options in 20 of 40 missing-line and 20 of 48 name-function rounds (my regex reading of `lineKind` and `nameShape`), so hint 2 names the same pair there. Hint 1 should leave three where it can.
   - Recommendation: (c) on every four-option deck. It needs the parser to allow a hint that names two options.
2. **#160, the algorithm layer.**
   - Options as filed: accept; tighten the audit; step hint 1 back.
   - Recommendation: step hint 1 back by using the round's static hint 1, and accept the scaffold's names, which the pane shows anyway. Re-measure with the blind player on unseen rounds.
3. **Hint 2's price.**
   - It is a code constant (`packages/artifact/src/domain.ts:99`), not artifact data. At 500, a 50/50 after two hints is worth 250, the same as a blind guess; at 650 it is worth 325.
   - Recommendation: decide after the pool-wide audit. If hint 2 becomes a 50/50 on every deck, move it to 650 in the re-pin PR, when local records reset anyway and no duel link is live. It touches `local-real-experiment-duel-token.server.ts:85`, `README.md:97`, and `apps/game/src/app/about/page.tsx:45`.
4. **Profile v8, or v7 in place as #200 did?**
   - In place, a parser rule must ship with a rebuilt artifact, so each such PR is a re-pin; a generator change leaves the committed artifact unreproducible until the next one; and run 3's artifact stops parsing.
   - Recommendation: v8.
5. **#231: how strict, and how big a pool?**
   - By my rough match, "says refactor and shares a word with the changed lines" keeps 12 of 30 rounds; "shares a word" keeps 19.
   - Options: the softer rule with a pool of 20 to 30; the strict rule with new search windows, which GitHub's secondary limit refused in October (#194).
   - Recommendation: the softer rule, accept a pool down to 20 (v6's size), and no new windows in this phase.
6. **#81's remainder.**
   - Options: pin each family deck's measured memory edge as a ceiling, as the language deck's 43.75% is pinned (`deck-leakage.test.ts:67`), and close; or offer four of five or more members, which changes `familyDeckRule` and the decks' character.
   - Recommendation: pin and close, after this phase.

## Stale or wrong in the tracker or docs

- **Working tree, transient (seen 20:12 GMT, gone by 20:16):** `apps/game/src/demo/local-real-experiment.pin.server.ts` held `97fa9b74…`, and the artifact differed from `HEAD` in the snapshot id, one of 4,672 accepted response hashes, and each round's `crawlSnapshotId` and `roundVersion`; every round's text and ids were identical. At 20:24 `git status` was clean and the pin read `847e7512…` again, with the artifact file rewritten at 20:16. Which run gave which hash I could not check (the journal is off limits).
- `CLAUDE.md:633` says the worker outputs "should come back byte-identical; check the hash". One run today did not, by one response hash. A pin that moves this way changes no round, but it would cost a layers run (the layers file names the artifact hash, `packages/artifact/src/question-layer.ts:217`) and the `daily` golden digest, so it should never be committed alone.
- `docs/review/evidence/2026-11-02-agent-playtest-run-3-fun.md:278` says the data fixes are "each a re-pin". One re-pin covers them if they are gated on a new profile version.
- #240: the "em-dash separator" is gone since #234 (`question-layer.tsx:14`), and its proposed free-text roles contradict `question-layer.ts:17-20`.
- #229 says "Blocks release: no", but bar line 3 requires hint 1 to lift every deck (`ops/playtest/run-3.md:126-127`) and the evidence table fails line 3 on fix's hint 1 (`…run-3-fun.md:72`).
- #80: "none simulates deals" and "README.md:66-71" are out of date (`solvers.ts:157`, `README.md:164-174`). The evidence-doc correction it asks for is made (`docs/review/evidence/2026-10-13-v5-six-decks-run.md:53`). Its labels still say size S and good first issue for the whole.
- #81: the language and project paragraphs describe the v5 artifact. Language was fixed on 2026-10-15 (`f323f4b`), and each algorithm answers twice since v7. "Publish the two families" does not fit the pool cap.
- #82: its counts are the v5 pool's (4 and 16 of 24; 11 of 24), and `local-language-e18bc206…` is no longer in the artifact.
- #160 is in milestone v1.1, which is otherwise launch-only; its work is this data phase. #159 and #160 carry no labels.
- #159's done-when names one hand refusal; there are seven (`reviewed.ts:6-28`).
- `README.md:164-174` lists the leakage solvers without pane overlap, before-after pane size, output transforms, or the both-hints solver.
- `CLAUDE.md` "Next steps" has no entry for this data phase.

## Risks

- A stricter before-after rule may leave the pool short, which skips the whole deck (`DECK_SHORT`). Dry-run it before the resume.
- All 48 algorithm traces are rewritten. Without #159's check each needs a reader, and a fifth were wrong last time.
- The first recheck may fail again on copy. Budget a second re-pin; it would be copy-only, with the same round ids and digests.
- New hint text is written by hand for 64 profile entries. The pool-wide blind audit is the only check that it does not leak again.
- The leakage test's memory player deals uniformly (`solvers.ts:141-149`), not as the game does since #40 and #233. In a framework game the repeated family never repeats its answer, a small in-game elimination nothing measures.
- Copy the journal the lead has just re-recorded before any resume. The older copies lack the worker outputs under the new lock.
- Outside my scope: showing each Marker hunt prompt once a game is game code (#240's other half).
- Outside my scope: after launch, this re-pin would need an entry in `ops/experiment/changes.json`; before launch the log stays empty.
