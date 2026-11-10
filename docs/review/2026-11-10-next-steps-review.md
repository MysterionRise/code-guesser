# Next steps review: milestones, pull requests, the next phase, and a targeted playtest

Reviewed 2026-11-10 at the owner's request: what the milestones are, the open pull requests, the next phase's
issues, and multi-agent testing as part of it. Four reviewer agents read the tracker against `main` at `03cd25a`
(launch, round data, product, engineering). The lead checked their main claims against the code and ran two tests:
a pipeline replay check and agent playtest run 3b, both in
[the run 3b record](evidence/2026-11-10-agent-playtest-run-3b.md). Nothing was merged, and no issue was closed or
moved: the tracker changes this review proposes are listed [at the end](#tracker-changes-proposed) for the owner.

The reviewers' own files, with a verdict and an implementation sketch for every issue in their scope, are beside
this one: [launch](2026-11-10-next-steps-review/launch.md),
[round data](2026-11-10-next-steps-review/round-data.md), [product](2026-11-10-next-steps-review/product.md), and
[engineering](2026-11-10-next-steps-review/engineering.md).

## In short

- **The repository is healthy and idle.** No pull request is open, CI is green on `main`, and no security alert is
  open. 41 issues are open.
- **v1.1 is finished except for the server, which the owner has deferred.** Tag `v1.1.0` now as what is merged,
  and give launch its own milestone ([decision 1](#the-owners-decisions)).
- **The next phase should be a data-quality release, here called v1.2.** Every failing line of run 3's bar traces
  to hint and reveal text. A recount over the whole pool found it worse than the judges' sample: hint 1 is the
  reveal's own sentence on all 96 algorithm and exercise rounds. One new profile version and one re-pin cover it.
- **Launch should follow that release.** A new artifact after day 0 refuses every open challenge link, restarts
  local records, and splits the experiment's periods.
- **Four small engineering changes come first**, because the data run would trip over each: #90, #93, the worker's
  lock pin, and #194.
- **Today's tests passed, with two findings.** A resume on a later day changes the artifact's hash through two
  live counters at Hugging Face, though no round changes (#252). The mini-run found no leak in 13 real attempts on
  the Sonnet host and no blocking defect, and it gave #160 its first clean numbers.
- **Thirteen decisions are the owner's**, in the order they block work.

## State on 2026-11-10

| | |
| --- | --- |
| `main` | `03cd25a`, the only remote branch; CI green; protected since 2026-11-04 (#27) |
| Open pull requests | none: no Dependabot PR, none from outside |
| Alerts | Dependabot 0 open (28 fixed by #251), secret scanning 0, `pnpm audit --audit-level=high` clean |
| Releases | `v1.0.0` (2026-10-20); `main` is 192 commits past it, and `README.md` still names v1.0.0 as current |
| Open issues | 41: v1.1 5, Next 11, no milestone 25 |
| Activity since 2026-11-04 | none, on issues or pull requests |
| Artifact | `847e7512…`, 422 rounds in ten decks; an offline rebuild reproduces it again (below) |

## Pull requests

**None is open.** What to expect:

- **Dependabot's next window is 2026-12-01** (monthly; the last opened #221 and #222 on 2026-11-01). Expect one
  grouped npm PR, the first to include `@ai-sdk/anthropic`: check that `pnpm-lock.yaml` still holds one
  `@ai-sdk/provider` version. Expect an actions bump too.
- **A security PR for the Python worker can come any day, and cannot pass CI.** It changes only
  `ops/poc/stack/uv.lock`, and `stack-metadata.ts` pins that file's hash (`LOCK_HASH`), so the unit tests fail with
  `LOCK_MISMATCH`. That is what happened to #247 and #248. Decision 10 removes the trap.
- **One pull request has come from outside the project: #95, from a fork, on 2026-10-14.** It fixed #90 in four
  lines with CI green and was closed unmerged; #90 is still open, and fired again on 2026-11-04.
- **A fork's pull request reaches no secret.** `ci.yml` runs on `pull_request` with a read-only token; nothing uses
  `pull_request_target`; the repository has no Actions secret. A first-time contributor's run waits for the owner's
  approval, and the three required checks read as waiting until then.
- **Nothing tells a contributor how to work here.** There is no `CONTRIBUTING.md`, pull-request template, issue
  template, or security policy, and private vulnerability reporting is off. Each is small (decision 11).
- **CI takes about 10.5 minutes a pull request**, 6 of them in the browser scenarios. No run has flaked since
  2026-10-27 in 62 runs.

## Milestones

**Today**

| Milestone | Open | What they are |
| --- | --- | --- |
| v1.1 | 5 | #174 (checklist: L13 and L14 unticked), #100 and #170 (both wait only for the server), #120 and #160 (owner decisions) |
| Next | 11 | #31, #59, #60, #68, #80, #81, #82, #128, #147, #159, #194 |
| none | 25 | run 3's data issues #228–#231, #240, #241, #249; the 2026-10-13 backlog #30, #37, #38, #50, #51, #53, #61, #64, #65, #67, #72, #83, #87, #90, #93; the public-app leftovers #103, #105, #109 |
| v1.0, public app phases 1 and 2 | 0 | closed |

**Proposed**, if the owner takes decision 1:

| Milestone | Holds | Done when |
| --- | --- | --- |
| v1.1 | #174 only, then closed | one docs PR finishes the release notes for a local-play release, and `v1.1.0` is tagged |
| v1.2 | the data-quality release: #228, #229, #230, #231, #240, #249, #82, #80, #159, #160; the engineering it needs: #90, #93, #194, #252, and the worker's lock pin; the quick wins #50 and #65's budget test | run 3's bar lines 1, 1b, 2, and 3 pass on a recheck |
| Launch | #100, #170, #120, and tests of an Anthropic-only server | the game is live and a smoke game in each arm records its events |
| Next | #128 (two designs first), #59 with #147, #60, #61, #64's mode, #105, #81's remainder, #31, #68, #37 | not scheduled |

## The next phase, in order

Sizes are the reviewers', from reading the touch points: S is under a day, M a few days, L a week or more.

### Batch 0: finish v1.1 and tidy the tracker (S, docs only)

- **Release notes.** `docs/releases/v1.1.0.md` calls v1.1 "the public release" (`:3-5`), stops its PR list at
  #245 (`:10-11`), files the Anthropic provider under run 3's fixes with no PR number (`:74-78`), omits #27, #250,
  and #251, names the wrong run for the hash (`:98`: `847e7512…` is the 2026-10-26 rebuild's), and says #59 is "not
  built" (`:130`; it is built and left out of the profile).
- **README.** `:8` (current release), `:364` (the rate-limit page now says "Too many new games. Wait a minute."),
  `:601-612` (three curated decks listed, seven configured), `:746` ("OpenRouter only"; either provider since
  #246), `:859` (`compose.test.yaml` is gone).
- **Tracker.** Close #103, #109, and #87 with the evidence under [tracker changes](#tracker-changes-proposed).
- **Tag `v1.1.0`** on that PR's merge commit, with the owner's go-ahead, as v1.0.0 was.

### Batch 1: four engineering changes before any data run

| Change | Size | Why first |
| --- | --- | --- |
| **#90**: add `--quiet` to the two `uv run` calls (`stack-metadata.ts:185`, `blob-worker.ts:98`) and their two tests | S | The first thing a fresh checkout or worktree hits. It is PR #95's diff. It does not orphan the journal, since the journal key reads only the script's name. |
| **#93**: give `StackAccessError` a cause and rethrow run stops (`stack-access.ts:17-22`, `:99-124`) | S | An offline journal miss or a revoked token in preflight prints as `ACCESS_UNAVAILABLE none` today. |
| **The worker's lock pin** (no issue yet): key recorded worker outputs to the worker's `.py` files alone (`worker-journal.ts:19`), look a request up under the old key too so today's journal still replays, then delete `LOCK_HASH` and `LOCK_MISMATCH` | S | A uv security PR then passes CI like an npm one and costs no live resume. `uv run --locked` still refuses a lock that disagrees with `pyproject.toml`. |
| **#194 parts 1 and 2**: mark each search query complete in the journal and replay it alone; turn a bare 403 on `/search/commits` into `RATE_LIMIT_CHECKPOINT` | M | Today a resumed run that replays the seven recorded searches and then fails on a new one writes `discoveryComplete: false` (`journal.ts:150-153`, `:198-203`), and the next resume searches all of them live. Fresh searches drift, so the before-after pool could change. |

Also here, any time: **#252**, so that a resume stops moving the hash; **#65's budget test** (a `node --test` file
that stats `docs/media/*`), before the data phase re-records 54.6 MB of media; and **`CONTRIBUTING.md` with #50's
prerequisites table**, if outside pull requests are welcome.

### Batch 2: decide, then measure (no artifact change)

- **Decisions 4 to 9**, the hint ladder first: #228 and #229 cannot be written without it.
- **#80's remainder as the phase's mechanical bar.** Add hint-reading solvers to `packages/artifact/test/solvers.ts`
  and `deck-leakage.test.ts`: hint 1 equal to the reveal's sentence; before-after's hint 2 against pane line
  counts; how many options hint 1 leaves. Mark each `it.fails` with #228 or #229. They fail today and flip at the
  re-pin.
- **A pool-wide blind audit of the static hints.** Reuse `solverRequest` and `answerProbability` in
  `ops/poc/questions/audit.ts` as a report-only mode of `prepare:questions`: every deck's prompt, options, and
  hints at three stages, about 1,270 short Haiku calls, journaled. It measures bar line 3 on 422 rounds where a
  playtest plays five a deck.

### Batch 3: profile v8 beside v7 (M each; `PROFILE_VERSION` stays v7)

Add `local-real-rounds.v8` to `PROFILE_VERSIONS` and `ARTIFACT_SCHEMA_VERSIONS` (`packages/artifact/src/domain.ts`)
and gate every rule below on `profileAtLeast(version, "local-real-rounds.v8")`, as v7 itself was introduced. The
committed artifact keeps parsing, and each PR merges with no re-pin. Check each with
`--offline --profile=local-real-rounds.v8 --journal=<copy>`.

- **#230 and #249's data half: reveal sentences.** Project: build the helpful sentence from the answer's
  description (`project-rounds.ts:104-105`). Name-function: name the function's own parameters
  (`name-function-rounds.ts:122-125`). Missing-line: filter keywords out of the signal with `namesIn`
  (`missing-line-window.ts:35-39`). Fix the two deck descriptions and fix's evidence clause in the profile.
- **#228: hints that state the answer.** A new per-entry profile field for hint 1 beside `idea`, which stays for
  the reveal (`algorithm-rounds.ts:59`, `exercise-rounds.ts:65`, `framework-rounds.ts:68`). Language: give OCaml
  and F# a block style and derive hint 1 from the pair's shared trait (`language-rounds.ts:154-194`).
- **#229: hints that rule out nothing.** Before-after: replace hint 2's added and removed counts
  (`before-after-rounds.ts:56-59`). Output and fix: new hint shapes, with the parser's rules gated
  (`packages/artifact/src/artifact.ts:435-441`, `:466`).
- **Rounds to refuse.** A missing-line gap that is prose or a `def` line (`missing-line-window.ts:104`).
- **Option notes in the reveal**, the data half of #64: one sentence per option saying what it is. For algorithm,
  exercise, and framework the sentences exist in the profile and are sold as hint 1 today, which is #228's
  finding; once #228 replaces those hints, the sentences belong in the reveal. It needs the new schema version and
  no request.
- **#249's code half**, four small fixes: the day streak on a first daily game (`round-header.tsx:17`), two duel
  strings (`duel-text.ts:13`, `:79`), one sentence in the host's rules (`model.server.ts:224-229`), and a seeded
  shuffle of each game's five (`local-real-experiment-deal.server.ts:152-158`). The last changes every seeded
  deal, so it goes in the re-pin's PR.

### Batch 4: one resume with live GitHub requests (M)

- **#231.** Dry-run the rule first, on a journal copy: the commit's subject must share a word with the changed
  lines (`select-github.ts:57`), and the reveal quotes the message only when it does (`before-after-rounds.ts:73`).
- Take the replacements for #231 and for batch 3's refused rounds in the same session. No new search window.
- **The worker bundle rides this resume**, if the owner takes decision 10's second half: drop `datasets` from
  `ops/poc/stack/pyproject.toml`, and #31's Python half. Any change to a worker `.py` file orphans recorded worker
  outputs, so these go together. Run the resume once before any rule change and keep the recorded preflight
  response, so a moved hash can only mean the bundle (#252 explains why).

### Batch 5: question layers (M)

- **#159 before the questions run.** A second, code-reading model recomputes each trace from the pane in
  `prepareRound` (`ops/poc/questions/prepare.ts:64-80`) and refuses on disagreement. Six of 30 traces were wrong
  last time, and seven are refused by hand.
- **#240.** Offer each Marker hunt round a hash-chosen six of the twelve prompts (`designs.ts:73`): "How is a
  function defined?" is in 42 of 50 layers.
- **#160**, as decided. Then one `pnpm prepare:questions`: about 380 to 400 Haiku calls, all live, since the
  round's hints are part of the writer's request.

### Batch 6: the one re-pin, then the recheck, then the media

- One PR: `PROFILE_VERSION` to v8, the artifact and its pin, the layers and their pin, `GOLDEN_DIGESTS`, the
  flipped `it.fails`, and the run record. Decks whose rounds change only in copy keep their round ids, so their
  pinned deals and digests do not move.
- **The recheck** plays run 3's bar lines 1, 1b, 2, and 3: the blind player on all ten decks with the layer-on
  games first (the protocol as corrected today), two sighted players across the cells never replayed and the
  eleven still below 3, the phone player on before-after and output, and the copy, difficulty, and fun judges.
- Record the media once, after the recheck passes.

### After v1.2

- **Two more question-layer designs before launch** (#128): Diff lens for before-after and Narrow it down for fix,
  the two decks run 3 called too hard. Eight of ten decks have no layer today. Trace table waits for #159.
- **Launch.** First, tests of what an Anthropic-only server runs (M): `pnpm test:deploy` plays the designs on the
  OpenRouter stand-in outside public mode, `pnpm test:container` never sets `GENUI_ENABLED`
  (`tests/container/image.test.mjs`), and `ops/deploy/smoke.mjs` never calls `/api/genui`. So no model call has
  ever been made from the image, with either provider. Then L13 as `docs/deploy.md` describes.
- **At or after launch:** the recap arm (#105), practice mode as a mode (#64), live duel rooms.
- **When a preparation run has room:** #59 (its 5,000-request reason is gone at a ceiling of 10,000; the real
  limits are the 600 commit-read cap and supply), #61, #60.

## The owner's decisions

Each has the reviewers' recommendation. Decisions 1 to 3 concern launch, 4 to 9 the data release, 10 to 13 the
repository.

1. **What is v1.1, now that the server waits?** Keep it open until L13; or tag `v1.1.0` now and give launch its
   own milestone. *Recommended: tag now, launch after v1.2.* v1.0 was tagged the same way ("launch-ready, but
   still local", `docs/releases/v1.0.0.md:4-5`). It costs one docs PR.
2. **#120: which model per design in production?** Run 3's pilot: the explainers were level between Haiku and
   Sonnet at 14 to 18 times the cost; the Haiku host gave 3 empty replies in 7 and 2 wrong claims in 38, the
   Sonnet host none. *Recommended: Sonnet for the host alone*, about $0.07 a game against $0.004, named under the
   provider launch uses, and decided before day 0. One gap: a Haiku host with #245's empty-reply retry was never
   measured. The issue can close on the owner's comment.
3. **Which provider at launch?** OpenRouter is what run 3 measured. Anthropic's own API has one scripted live
   check and today's mini-run. *Recommended: decide with #120, and write the Anthropic-only tests first if the
   answer is Anthropic alone.*
4. **#82: what is a hint for?** (a) Facts about the answer, as four decks do today, which a blind player solved 5
   of 5; (b) pure eliminations, which no sighted player bought; (c) hint 1 a true partial statement that at least
   one decoy shares, then hint 2 the answer and one option hint 1 leaves open. *Recommended: (c) on every
   four-option deck.* Missing-line and name-function work this way since #200 and score best on hints.
5. **#160: the algorithm layer.** Today's numbers are in [what was tested](#what-was-tested-today): a thin pass
   of the bar line. *Recommended: accept the scaffold for now, and fix the deck's static hint 1 first (#228).* If
   a blind first guess should sit nearer chance, the lever is the audit counting structure names (option 2);
   moving the trait between hints (option 3) would not touch it, since the lift comes before any hint.
6. **Hint 2's price**, a code constant (`packages/artifact/src/domain.ts:99`). At 500 a guess after a 50/50 hint is
   worth 250, the same as a blind guess. *Recommended: decide after the pool-wide audit; if hint 2 becomes a
   50/50 on every deck, move it to 650 in the re-pin's PR.*
7. **Profile v8, or v7 in place as #200 did?** *Recommended: v8.* In place, each parser rule ships with its own
   re-pin, and run 3's artifact stops parsing.
8. **#231: how strict, and how big a pool?** "Shares a word with the changed lines" keeps about 19 of 30 rounds;
   adding "says refactor" keeps 12. *Recommended: the softer rule, a pool down to 20, and no new search window in
   this phase.*
9. **#83: credit Stack rounds to the file's last human author?** It changes the credited author on 100 rounds, for
   about 100 requests. *Decide before the data run, since that run re-pins anyway.*
10. **The worker's lock.** Keep today's hand procedure, or key recorded outputs to the worker's code and delete
    `LOCK_HASH`. *Recommended: the second.* And drop `datasets` from the worker: nothing has imported it since
    2026-10-08, and it carried 11 of the 28 alerts (aiohttp, datasets, multidict). One risk: pandas leaves with
    it, and pyarrow uses pandas when present for some timestamps, so the resume in batch 4 is the check.
11. **Are outside pull requests welcome?** The repository is public with 3 forks and five "good first issue"
    labels, and its one outside PR was closed unmerged. *Recommended: yes, with one `CONTRIBUTING.md`, a
    pull-request template, and a ten-line `SECURITY.md`.*
12. **#38: delete the Contract-era code**, about 23,000 lines in `ops/content`, `packages/content`,
    `packages/domain`, and `packages/measurement`? *Recommended: yes, after the data release.*
13. **Unchanged questions, with the reviewers' leanings:** #30 (lint only, no reformat), #65's storage (keep
    `demo.gif` in git, move the per-deck clips to release assets), #67 (yes, a read-only token), #72 (split the
    README after launch), #81's remainder (pin each family deck's measured memory edge as a ceiling and close),
    #59 (leave deferred for v1.2), #105 (decide how a recap joins the experiment after the first report: as a
    design level it would raise the design target from 506 to about 530 a level).

## What was tested today

The full record is [the run 3b evidence](evidence/2026-11-10-agent-playtest-run-3b.md).

- **The pipeline replay, after #251 moved the worker's lock.** One `--resume` recorded 325 worker outputs again
  under the new lock; 324 are byte-identical to the old ones, and the 325th differs only in a byte counter that
  does not reach the artifact. An offline rebuild reproduces `847e7512…` again with no network.
- **A finding from it: a resume on a later day changes the artifact's hash.** Preflight's dataset-info response is
  fetched live on every resume, and it carries `downloads` and `likes`. Its hash is one of the snapshot's accepted
  responses, so the snapshot id moved and with it the provenance stamp on all 422 rounds, though no round changed.
  The journal keeps the 2026-10-26 response, as the 2026-10-15 merge did. Filed as #252.
- **The question layers, measured cleanly for the first time (#160).** A code-blind player met 50 rounds it had
  never seen, the layer-on games first.

  | Algorithm, code-blind | Before any hint | After hint 1 | After hint 2 |
  | --- | --- | --- | --- |
  | Rounds that showed a layer's scaffold (12) | 7 of 12 | 7 of 12 | 9 of 12 |
  | Rounds with no scaffold in the same games (8) | 3 of 8 | 8 of 8 | 8 of 8 |
  | Layer-off games (10) | 1 of 10 | 10 of 10 | 10 of 10 |

  The scaffold lifts a blind first guess from about chance (4 of 18 without one) to 7 of 12, under run 3's bar
  line of 70%. The larger leak is the deck's static hint 1, which took the blind player from 4 of 18 to 18 of 18;
  the layer's own hint 1 added nothing (7 of 12 before and after). On language, the layer's scaffold and first
  hint gave a blind player nothing (0 of 9), and its second hint gave 7 of 9. The lift is in the scaffold's
  names: in 5 of the 7 hits one name (`heap`, `stack`, `min_index`, `block_size`, `swapped`) belongs to one
  option. Twelve rounds is a small sample: the 95% interval on 7 of 12 runs from 32% to 81%.
- **The answer-lock guard on the Sonnet host through Anthropic's own API**, which no run had tested: 0 leaks in 13
  real attempts before a lock, 4 stopped by the paste check and 9 refused by the host. One scripted attack was
  sent after a real lock by the player's slip, so "I've already locked in" as a lie was not exercised.
- **The duel's two forms by keyboard alone**, and the chooser, duel, and refusal pages on a phone: no blocking or
  major defect, and 12 polish items (#253).
- **Run 3's remaining protocol gaps (#241) are closed**, and the corrected protocol is checked in.

## Where the agents disagreed, and what the lead corrected

- **"The worker imports only httpx and pyarrow"**, written by the lead in #251 and `CLAUDE.md`, is wrong. The blob
  worker imports `boto3` and `botocore` lazily (`ops/poc/stack/fetch_blob.py:130-136`), and `huggingface_hub` is
  imported too (`bounded_http.py:232`); botocore's urllib3 did move. Today's replay shows it changed no output.
- **Two reviewers saw the artifact's pin change mid-review** and flagged it as urgent. It was the replay check in
  progress, and the cause is #252, not the lock. The tree was clean on `847e7512…` before the playtest's build.
- **The engineering reviewer asks that the data phase's resume "reproduce `847e7512…` before any data change".**
  A plain resume cannot, because of #252: the recorded preflight response must be kept, or #252 fixed first.
- **The round-data reviewer would take the layer's hint 1 from the deck's static hint 1** (#160). Today's blind
  numbers point the other way: the static hint decides a round and the layer's does not. So that only holds once
  #228 has rewritten the static hint.
- **The launch reviewer's rule for #160** (tighten the audit at a lift of 25 points or more) and the bar line
  (fail above 70%) give different answers on today's 7 of 12. The sample cannot separate them; the pool-wide audit
  in batch 2 can.
- **The keyboard player reported the bought hint and the challenge form as unannounced.** The accessibility
  snapshot cannot show a live region. The code can: hints sit in `aria-live="polite"` (`hint-bar.tsx:25`), and the
  form moves focus into its name field (`duel-game.tsx:108`). Neither is a defect.
- **The product reviewer found no live catalog render on name-function or framework** when judging #103 done. The
  design is one code path for every round kind; two rounds would settle it for about $0.002.

## Tracker changes proposed

For the owner to read and run; nothing here has been applied. New issues filed today: #252 (the resume and the
hash) and #253 (run 3b's polish items).

- **Close as done: #103.** It shipped as the `catalog` design (`apps/game/src/genui/render-catalog.ts:37-84`:
  `takeaway`, `code_view`, `comparison`). Its `genui_rendered` event never existed; `genui_call`,
  `genui_interaction`, and `genui_fallback` cover it (`apps/game/src/experiment/events.ts`).
- **Close as superseded: #109** (everything open in it is #100 on #174, or #105) and **#87** (47 of its 66 issues
  are closed, and it still says generative UI runs on CopilotKit; `docs/review/README.md` and the milestones carry
  the state). Unpin #87.
- **Close with this review's PR: #241.**
- **Milestones**, if decision 1 is taken: create v1.2 and Launch, and move the issues as in the table above.
- **New issues to file:** the worker's lock pin and unused dependencies (decision 10); tests of an Anthropic-only
  server; rounds the next data run should refuse or fix (the prose missing-line round
  `local-missing-line-5facdb72…`, the F# round `local-language-66fb3e93…` whose hint 1 "Blocks are wrapped in
  braces." is false, three missing-line rounds whose hidden line is a `def` line).
- **Stale issue text**, worth a comment when each is next touched: #100 ("OpenRouter only", "Open: hosting"), #170
  (`compose.yaml`, Caddy), #120 (its title names the composer and catalog; the pilot found the host), #160 and #159
  (no labels), #81, #82, and #80 (counts from the v5 pool), #59 and #147 (the 5,000-request premise), #68 ("good
  first issue", though its done-when needs the journal no fork has), #229 ("Blocks release: no", though bar line 3
  fails on it).

## Lines in `CLAUDE.md` to correct

This review leaves `CLAUDE.md` unedited: the session's instruction-file guard flags changes to it, so these are
listed for the owner to apply or approve.

- **"The worker lock moved on 2026-11-04"** paragraph: recorded worker outputs are back under the new lock since
  2026-11-10, so `--offline` works again (journal `run.jsonl.v7-lock-2026-11-10`). Replace "httpx and pyarrow, the
  libraries the worker imports" with the truth above. Add: a resume on a later day changes the hash through
  Hugging Face's counters unless the recorded preflight response is kept (#252).
- **"Iterate on deck rules"**: drop "and since the 2026-11-04 worker lock move one `--resume` first".
- **"Next steps"**: add the data-quality release, and point at this review.
- **The rate-limits bullet** quotes "Too many new games — wait a minute"; the page says "Too many new games. Wait
  a minute."
- **The event-log bullet** says nothing uses `node:sqlite` yet; the state store does (#164).
- **Agent playtests**: add run 3b.

## Method and limits

- **Reviewers** were four general-purpose agents on the session's model, read-only, each with one findings file
  under fixed headings: a verdict per issue with `path:line` evidence, a proposed order with an implementation
  sketch, the owner's decisions, stale tracker or doc text, and risks. They ran no code.
- **The lead verified** every claim that leads to a "close" here, the launch reviewer's nine factual claims, the
  round-data reviewer's eight headline counts on the committed artifact (all exact), and the engineering
  reviewer's claims about the worker's imports, #95, and the journal's discovery flag.
- **Not verified by anyone:** the dollar cost of the questions run; how many before-after candidates remain in
  the search pool; whether `--quiet` silences uv on a fresh environment; `docs/deploy.md` against a real Dokploy;
  which media scenes show hint or reveal text. Counts marked "about" are a reviewer's regex reading.
- **Sizes are estimates** from reading touch points, not from attempting the work.
- **No code audit was done.** The 2026-10-13 audit predates public mode, the security headers, rate limits, the
  state store, duels, the container, and both model providers.
