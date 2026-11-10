# Engineering review, 2026-11-10

> One reviewer agent's findings, as written on 2026-11-10 against `main` at `03cd25a`, kept for their verdict
> and implementation sketch per issue. Where [the review](../2026-11-10-next-steps-review.md) corrects a point,
> the review stands. Line numbers are that commit's.

Read against `main` at `03cd25a`; paths are relative to the repository root. Nothing was run (no `pnpm`, `uv`, or
`node`) and nothing under `ops/poc/stack/tmp/` was read. "Not verified" marks a claim that rests on a tool's
documented behaviour.

## Summary

- Land three things before the data phase's first run: #90 and #93 (a few lines each) and #194 parts 1 and 2; without #194, one failed try at new search windows makes the seven recorded searches go live again (`ops/poc/prepare/journal.ts:150-153`, `:198-203`).
- The Dependabot trap has a durable fix of about 30 lines: key recorded worker outputs to the worker's code alone and delete `LOCK_HASH`; uv security PRs then pass CI and cost no `--resume`.
- "The worker imports only httpx and pyarrow" is half right: `datasets` is unused since 2026-10-08, but `boto3` and `huggingface_hub` are imported lazily; dropping `datasets` removes the source of 11 of the 28 alerts, `huggingface-hub` too makes it 24, and both remove pandas, the one risk.
- CI is healthy (about 10.5 minutes a PR, no flake in the 62 runs since 2026-10-27, no secret a fork can reach), but the repository has no CONTRIBUTING, PR or issue template, or security policy; each is size S.
- Of the 16 issues: 5 do next, 5 later, 5 owner decision, 1 close as superseded; none is done outright, and most carry stale text.

## Verdict per issue

| Issue | Still valid? | Evidence (path:line or PR) | Size (S, M, L) | Depends on | Recommendation |
| --- | --- | --- | --- | --- | --- |
| #194 discovery: resume per query, checkpoint on the secondary limit | Yes, all of it | Search pages replay only when the whole recorded discovery finished (`ops/poc/prepare/journal.ts:150-153`); a run that searched anything keeps only its own pages and its own flag (`journal.ts:198-203`); one flag covers all queries (`dependencies.ts:167`). A 403 with no retry instruction falls through to `UNSUPPORTED_STATUS` (`transport.ts:259-278`). The comment at `runtime.ts:39-43` says discovery cannot resume part way. | M | Nothing. It blocks #231's new search windows | do next (parts 1 and 2; part 3, the new windows, belongs to the data phase) |
| #31 charge worker spend on failure | Yes; #165 did not touch it | The meter's error is replaced with no cause (`blob-worker.ts:162-166`, `stack-metadata.ts:404-409`), so `spentBudget` (`diagnostics.ts`, `RUN_BUDGETS`) never sees it. A failed worker raises before its counters are read (`blob-worker.ts:136`) and writes only a code (`ops/poc/stack/fetch_blob.py:384-389`). The floor of one request stands (`select-stack.ts:23`). Tests still throw a `CapacityError` the real dependency never does (`command.test.ts:1228`, `:1333`). | M (Node half S) | Its Python half changes worker code, which orphans recorded worker outputs (`worker-journal.ts:19`); do it only inside the worker bundle (batch B) | later |
| #68 share curated source builders | Yes, and it has grown | `encodedPath` is defined 11 times and `sourceFor` 8 times (`rg "const encodedPath\|const sourceFor" ops/poc/prepare`), against 8 and 3 in the issue. Bot detection still differs (`github-files.ts:45-50` checks `type: "Bot"`, `github-fixes.ts:159` does not). The acceptance tail is repeated in nine curated selectors. The registry (#36, `curated-decks.ts:23-28`) merged none of these. | M | A stable pinned hash to check against, so not while the data phase is changing rounds | later |
| #37 Stack revalidation on the shared git reader | Yes; one item fixed | `stack-revalidation.ts` still hashes trees itself (`:160-170`, `Buffer.compare` against `compareText` in `github-git.ts:67-76`) and decodes base64 itself (`:86-93`). Its last change, `d78df63` on 2026-10-13, added the email-author check the issue calls missing (`:150-152`). Only files, fixes, and lineage use `gitReader`. | M | Worth doing only as the first half of #83 | later |
| #38 retire `acquire:content` | Yes | `package.json:18` (script) and `:27` (dev dependency). `ops/content/` is 2,294 lines; `packages/content` 7,246 source and 6,633 test lines in 24 test files; `packages/domain` 3,979; `packages/measurement` 3,271. The preparer imports three names from `local-poc-support` (`screenBlob`, `isScreenablePath`, `screenLicenseEvidence`). Still asserted or read by `tests/containment/acquisition-boundary.test.mjs:90-98,268-275`, `ops/poc/prepare/failure-codes.test.ts:15`, `apps/game/test/candidate-ordering.test.ts:9`, `apps/game/test/claims-audit.test.ts:10,150-151`, `Dockerfile:23-25`, `tests/deploy/docker-context.test.mjs:58`, and `README.md:829-848`. | M | The owner's yes | owner decision |
| #83 credit Stack rounds to the file's author | Partly overtaken | Stack rounds still say `SELECTED_COMMIT` (`stack-revalidation.ts:275`); the artifact holds 130 such sources (100 Stack rounds and 30 before-after). The parser already holds each kind to its basis (`packages/artifact/src/source.ts:61-69`, `:95`, `:140`, `:158`), and fixes carry `FIX_COMMIT`. No "fix by" wording exists (`rg -i "fix by" apps/game/src` finds nothing). | M | #37 as its first half; a live `--resume` of about 100 requests (the issue says 48); the data phase's re-pin | owner decision |
| #90 uv venv messages in worker stderr | Yes | Both invocations are `uv run --project … --locked python …` (`stack-metadata.ts:184-186`, `blob-worker.ts:98`), and uv's own stderr is captured with the worker's (`stack-metadata.ts:125-131`). The seam test expects `stderr: ""` (`stack-worker-seam.test.ts:45,62,79,81`). In a real run the same noise is `WORKER_STDERR` (`stack-metadata.ts:437`, `blob-worker.ts:137`), or a bare `WORKER_EXIT` when the worker also failed (`stack-metadata.ts:240-249`). PR #95, from a fork, was this exact four-line fix with CI green; it was closed unmerged on 2026-10-14 and the issue stayed open. | S | Nothing | do next |
| #93 keep the cause on `ACCESS_UNAVAILABLE` | Yes | Both catches drop the error (`stack-access.ts:107-109`, `:121-123`), and `StackAccessError` takes no cause (`:17-22`). So an offline `JOURNAL_MISS` or a Ctrl-C in preflight is not seen as a run stop (`RUN_STOPS`, `diagnostics.ts:134`), and a 401 prints status class `none`. `CLAUDE.md:901` documents this as intended. | S | Nothing | do next |
| #67 least-privilege GitHub token | Yes | `README.md:646` and CLAUDE.md's live-run command still pass `gh auth token`. | S | The owner's yes | owner decision |
| #30 lint and format in CI | Yes | No lint or format config is tracked (`git ls-files` matches nothing for eslint, biome, prettier, ruff, editorconfig, or pre-commit). 421 tracked TypeScript and JavaScript files, 75,603 lines. | M | The owner's choice of tool | owner decision |
| #50 split prerequisites by task | Partly done | Its third done-when, "`.node-version` exists", holds: `.nvmrc` and `.node-version` pin 24.22.0, checked by `packages/test-support/workspace.test.mjs:56-63` (#21). `README.md:197-198` still lists only Node and pnpm. uv and Python 3.12 appear only inside a command (`README.md:766`) and ffmpeg at `:578`; nothing says the Hugging Face account must accept the dataset's terms, or that the seam test skips without uv (`stack-worker-seam.test.ts:16,31`). | S | Nothing; best written as part of CONTRIBUTING | do next |
| #51 troubleshooting guide | Half done | Every code the issue lists as missing is in CLAUDE.md's "Reading failures" (each found by `rg`), and `failure-codes.test.ts:96-100` fails when the preparer throws a code that section lacks (#35). The human-facing copy is what is left: there is no `docs/troubleshooting.md`, and `README.md:708-711` still only names the log lines. | S to M | Moving the section means repointing `failure-codes.test.ts:96` at the new file | later |
| #53 "how to add a deck" guide | Yes | No such doc (`ls docs`). The registry the issue waits for has landed (`curated-decks.ts:23-28`), so the guide is shorter than the issue expects. | M | Best written while adding the next deck (#59, #60, #61) | later |
| #65 media size budgets | Yes | No test reads `docs/media` sizes. Today's files fit (`demo.gif` 7.97 MB; the largest other, `deck-missing-line.gif`, 3.86 MB of 4). A full re-record now writes 14 files, 54.6 MB (the issue says about 30). The recorder divides by 1,048,576 and prints "MB" (`ops/demo/record/index.ts:196`). GitHub reports the repository at 252,568 KB. | S (test), M (storage) | The test: nothing. Storage: the owner | do next (the budget test only; where media lives stays an owner decision) |
| #72 README for players, CONTRIBUTING | Yes, and worse | The README is 867 lines and 52 KB (the issue says 272 lines). Its guardrail copy has drifted again: `README.md:746` says the server calls OpenRouter only, while CLAUDE.md names Anthropic's API too (#246). No CONTRIBUTING, PR template, or issue template exists (GitHub's community profile: 42%). | M (README), S (CONTRIBUTING) | The owner's yes for the README; CONTRIBUTING needs none | owner decision |
| #87 backlog map (pinned) | No | It has no done-when; it is an index of the 2026-10-13 audit. 47 of its 66 issues are closed. Its "In flight" list is all merged, 5 of its 13 decisions are settled (#21, #27, #45, #62, and #100's hosting), and it says generative UI runs on CopilotKit (it runs on the AI SDK, #101). | S | Nothing | close as superseded (by `docs/review/README.md`, the `Next` milestone, and this review; unpin it, or replace its body with the 19 of its issues still open) |

## Proposed order

### Batch A: before the data phase's first run (none of it touches a recorded worker output)

1. **#90, S.** Add `"--quiet"` after `"run"` in `metadataWorkerRequest` (`ops/poc/prepare/stack-metadata.ts:185`) and
   `blobWorkerRequest` (`blob-worker.ts:98`), and in the two request-shape tests (`stack-metadata.test.ts:155`,
   `blob-worker.test.ts:46`). That is PR #95's diff. The seam test needs no edit, because `check` reuses the
   request's arguments (`stack-worker-seam.test.ts:20-23`). The journal is unaffected: `workerJournalKey` reads only
   the last argument (`worker-journal.ts:28`). Check once by hand: delete `ops/poc/stack/.venv`, then `pnpm test`.
   Not verified here that `--quiet` silences uv's "Creating virtual environment" line; CI cannot show it, since CI
   syncs the environment first.
2. **#93, S.** In `stack-access.ts`, give `StackAccessError` an optional cause (`:17-22`). In `requestMetadata`
   (`:99-110`) and `requestCard` (`:112-124`), rethrow when `runStop(error)` (`diagnostics.ts:137`) finds a run stop,
   and otherwise throw the same code with `{ cause: error }`. `failureDiagnostic` (`diagnostics.ts:45`) then prints
   the cause's status class: `PREFLIGHT JOURNAL_MISS none` offline, `PREFLIGHT ACCESS_UNAVAILABLE 4xx` for a
   revoked token. Update `stack-access.test.ts:209,216` and the sentence at `CLAUDE.md:901`.
3. **Worker lock, S (no issue yet; file one).** In `worker-journal.ts`, hash the worker's `.py` files only
   (`currentWorkerCode`, `:16-24`; drop `|| name === "uv.lock"` at `:19`). So that today's journal still replays,
   `journaledWorker` (`:50-61`) looks a request up under the new key and then under the old code-and-lock hash,
   kept as one constant; `RunJournal` needs a `has(key)` for that, because `take` throws offline
   (`journal.ts:178-180`). Without the constant the change costs one live `--resume`. Then delete the lock's hash
   check, `LOCK_HASH` and `LOCK_MISMATCH` (`stack-metadata.ts:16`, `:153`), its test
   (`stack-metadata.test.ts:279-283`), and the prose that explains it (`CLAUDE.md:627-634`, `:914`;
   `.github/dependabot.yml:21-23`; `README.md:854`). `uv run --locked` still refuses a lock that disagrees with
   `pyproject.toml`.
4. **#194 parts 1 and 2, M.** `journal.ts`: add `markQueryComplete(query)`, write the completed queries in the
   header, replay a `sequence` entry when its query is complete (`:150-153`), and carry completed queries' pages
   through a run that searched others (`:198-203`); an old journal's `discoveryComplete: true` means every query.
   `github-search.ts:291`: call a new `onQueryComplete`, wired in `dependencies.ts:165-167`. For the secondary
   limit, in `runtime.ts`'s request catch (`:198-218`), turn a 403 or 429 with no retry instruction on
   `/search/commits` into `new RetryError("RATE_LIMIT_CHECKPOINT", failure, now() + 3_600_000)`, which the pipeline
   already reports with `PREPARATION_RESUME_AFTER` and exit 75 (`pipeline.ts:286-307`). Tests beside
   `journal.test.ts:149` and `runtime.test.ts:109`, and the issue's integration test in `command.test.ts`. Docs:
   `CLAUDE.md:816`, the README's "Rate limits", and the comment at `runtime.ts:39-43`.

Why these come first:
- Item 1 is the first failure a fresh checkout or worktree meets, and item 2 makes a failed preflight readable.
- Item 3 makes the next uv security PR mergeable; without it the trap of #247 and #248 fires again at the next
  advisory.
- Item 4 must precede any new search window. Today a resumed run that replays the seven recorded searches and then
  fails on a new one writes `discoveryComplete: false`, and the next resume searches all eight live. Fresh
  searches drift (v6's microsoft window found 167 commits on 21 October against 165 on 19 October,
  `docs/review/evidence/2026-10-21-v7-dry-run.md:80`), so the before-after pool could change with them.

### Batch B: the worker bundle, riding the data phase's one live `--resume`

Every change to a non-test `ops/poc/stack/*.py` orphans recorded worker outputs. So these go in one PR, followed
by one `--resume` that must reproduce `847e7512…` before any data change is applied.

5. **Drop `datasets`, S.** In `ops/poc/stack/pyproject.toml:5-8`, replace `datasets==5.0.1` with the three packages
   it was carrying, at the versions the lock holds: `httpx==0.28.1`, `huggingface-hub==1.26.0`, `pyarrow==25.0.0`.
   `uv lock` under uv 0.9.25 takes the lock from 42 packages to 25 (out: datasets, pandas, numpy, aiohttp and its
   six dependencies, multidict, requests, dill, multiprocess, xxhash, tzdata, charset-normalizer). An optional
   second step in the same PR removes the Hub client factory (`install_bounded_backend`,
   `bounded_http.py:226-236`; `_default_installer` and `install_backend_fn`, `stream_metadata.py:358-360`,
   `:380-394`; tests at `test_bounded_http.py:266` and `test_stream_metadata.py:92-104,233-239,358-389`). That drops
   `huggingface-hub` and eight more, leaving 16.
6. **#31, M.** Node half: throw the meter's error as the cause (`blob-worker.ts:162-166`,
   `stack-metadata.ts:404-409`), return early from `fetchSelectedBlob` when no request is left, and drop the floor at
   `select-stack.ts:23`. Python half: both workers write the counters trailer before the code on failure
   (`fetch_blob.py:384-389`, `_main` in `stream_metadata.py`), and `parseBlobWorkerOutput` (`blob-worker.ts:129-147`)
   meters it before raising. Replace the faked `CapacityError` in `command.test.ts:1228,1333` with the real path.
7. **#83 with #37, M, only on the owner's yes.** Rebuild `stack-revalidation.ts:160-244` on `gitReader`,
   `admitRepository`, `selectedAuthor`, and `admitLicense` with `REVALIDATION_` codes. Then read each file's history
   through `fileAuthor` (`github-files.ts:57-75`) and set `PATH_HISTORY` at `stack-revalidation.ts:275`;
   `packages/artifact/src/source.ts:61-69` and `language-rounds.ts:64` hold the basis.

### Batch C: independent quick wins, any time

8. **CONTRIBUTING and #50, S.** One `CONTRIBUTING.md`: the per-task prerequisites table (#50); what a fork can run
   (everything CI runs, since CI uses no secret); what it cannot (`prepare:poc --offline` needs the journal, which is
   never committed, so "reproduces the pinned hash" is the owner's check); that a first PR waits for "Approve and
   run"; that CI takes about 10.5 minutes. Link it from `README.md:197`.
9. **PR template and security policy, S.** `.github/pull_request_template.md` with three boxes: checks run; a
   player-visible change after launch adds an entry to `ops/experiment/changes.json`; a change to
   `ops/poc/stack/*.py` orphans recorded worker outputs. A ten-line `SECURITY.md`, with private vulnerability
   reporting switched on in the repository's settings (it is off today).
10. **#65's budget test, S.** A `node --test` file under `tests/` that stats `docs/media/*`: `demo.gif` under
    10,000,000 bytes, every other GIF under 4,000,000, and a cap for the MP4; run it in `pnpm test`. Fix the unit
    at `ops/demo/record/index.ts:196`. Land it before the data phase re-records.
11. **README lines, S.** Delete the `compose.test.yaml` row (`README.md:859`); name both providers at `:746`; list
    all seven curated decks in step 4 (`:601-612`); refresh the run figures at `:627`.
12. **Tracker tidy, S.** Close or rewrite #87; put #90 and #93 in the `Next` milestone; take "good first issue" off
    #68.

### Park

#68 and #53 until the next new deck; #51 until someone other than an agent runs the preparer; #38, #30, #67, and
#72's README split until the owner decides.

## Owner decisions

1. **How should the worker's lock moves be handled?**
   - (a) Keep today's hand procedure and write it down; it exists only in PR #251's body. Each advisory costs a
     hand relock, a pin edit, and a live `--resume` with both tokens.
   - (b) Add a script that relocks and rewrites `LOCK_HASH`. It saves two minutes; the PR still cannot merge
     unaided, and the `--resume` stays.
   - (c) Key recorded worker outputs to the worker's code alone and delete `LOCK_HASH` (batch A, item 3). A uv
     security PR then passes CI as an npm one does. Replays are unaffected: Node validates every replayed output
     as a live one (`worker-journal.ts:45-49`), and no HTTP response in the journal is keyed to a library version
     either.
   - Evidence: #247 and #248 changed only `uv.lock` (+4 −4 each) and failed 28 unit tests in 3 files on
     `LOCK_MISMATCH` (run 41903053356). The lock dates from 2026-09-04 and had 28 advisories against it by
     2026-11-04, so the next one is likely weeks away, not months.
   - Recommendation: (c).
2. **Should the worker drop `datasets`, and `huggingface-hub` with it?**
   - Evidence: nothing imports `datasets` since `40e29ff` (2026-10-08) moved the reader to exact parquet ranges
     (`bounded_parquet.py`). `boto3` and `botocore` are imported (`fetch_blob.py:130`, `:135-136`). So is
     `huggingface_hub` (`bounded_http.py:232`, called at `stream_metadata.py:394`), but only to install a client
     factory that no request uses: the reader builds its own client (`stream_metadata.py:351-355`). `aiohttp`
     comes in only through the `fsspec[http]` extra that `datasets` asks for (`uv.lock:193`).
   - The 28 fixed alerts by package: filelock 12, aiohttp 8, urllib3 3, datasets 2, certifi 1, fsspec 1,
     multidict 1. Dropping `datasets` removes aiohttp, datasets, and multidict: 11. Dropping `huggingface-hub` too
     removes filelock and fsspec: 24 in all. certifi and urllib3 stay, since the worker's requests use them.
   - Risk: pandas leaves with `datasets`. The worker never imports it, but pyarrow uses pandas when present to
     convert nanosecond timestamps in `to_pylist()` (`bounded_parquet.py:194`), and `_date`
     (`stream_metadata.py:197-213`) takes whatever comes back. Not verified which unit The Stack's date columns
     use. The live `--resume` that this lock move needs anyway is the check; if a date fails or the hash moves,
     keep `pandas` as a declared dependency.
   - Recommendation: drop `datasets` in batch B, and `huggingface-hub` in the same PR if the owner accepts losing
     a guard that has nothing left to guard.
3. **Are outside pull requests welcome?** The repository is public with 3 forks, and five open issues are labelled
   "good first issue". The one outside PR since 2021, #95, fixed #90 correctly and was closed unmerged. Options:
   say yes and add batch C's items 8 and 9; or say no in the README and remove the label. Recommendation: yes,
   with item 8, which costs one file.
4. **#38: delete the Contract-era code (about 23,000 lines across `ops/content`, most of `packages/content`,
   `packages/domain`, and `packages/measurement`)?** For: at least 26 test files leave `pnpm test`, and the
   Dockerfile and three tests stop naming dead packages. Against: size M, a containment test to rewrite, and no
   player or data benefit. Recommendation: yes, after the data phase.
5. **#83: credit Stack rounds to the file's last human author?** It changes the credited author on 100 rounds and
   on the credits page, for about 100 requests. Recommendation: decide before the data phase's run, since that run
   re-pins anyway; a yes makes it batch B's item 7.
6. **Should the dependency audit stay inside the required "Node workspace" job?** On 2026-10-26 a new Next.js
   advisory failed that step on an unrelated PR (run 40347429077). That is #26 working as designed, but it blocks
   every PR, a fork's included, until the bump lands. Options: keep it; or move it to a job that is not required,
   with a weekly schedule. Recommendation: keep it while the owner is the only author, and revisit if outside PRs
   arrive.
7. **#30, #65 (storage), #67, #72 (README split):** the questions are unchanged. Recommendations: #30 Biome, lint
   only, no reformat; #65 keep `demo.gif` in git and move the per-deck clips to a release's assets at the next
   re-record; #67 yes, a fine-grained read-only token; #72 split the README after launch.

### Facts behind these decisions

Pull-request flow:
- The next Dependabot window is 2026-12-01: every ecosystem is `monthly` with no day set, and the last scheduled
  run opened #221 and #222 on 2026-11-01 at 14:17 UTC.
- Expect one grouped npm PR (minor and patch; majors are ignored). It will be the first to include
  `@ai-sdk/anthropic`, added 2026-11-03, so check that `pnpm-lock.yaml` still holds one `@ai-sdk/provider` version.
  Expect a `setup-uv` bump, and a Docker digest if the tag was rebuilt. Which npm packages are behind today was not
  verified.
- uv raises nothing on schedule (`open-pull-requests-limit: 0`, `.github/dependabot.yml:28`), but a security PR
  can come any day and fails until batch A's item 3 lands.
- The five merged Dependabot PRs (#211, #218, #219, #221, #222) each merged unchanged within 33 hours.

What a fork's pull request can reach:
- `ci.yml` triggers on `pull_request` only (`:3-6`) with `contents: read` (`:8-9`). No `pull_request_target`
  appears under `.github/`.
- The repository has 0 Actions secrets, 0 Dependabot secrets, and 0 variables, and
  `packages/test-support/workspace.test.mjs:53` fails if the workflow ever names one.
- A first-time contributor's run waits for the owner's approval (`approval_policy: first_time_contributors`);
  until then the three required checks read as waiting.
- Present: `LICENSE` (MIT, checked by `workspace.test.mjs:17-25`) and the README. Missing: CONTRIBUTING, a PR
  template, issue templates, a security policy (private vulnerability reporting is off), and a code of conduct.

CI health:
- Wait per PR: the last five full runs took 10 m 24 s to 11 m 47 s (runs 41906013970, 41905934901, 41904150332,
  41903543792, 41562424190). When ten runs queued at once on 2026-11-02, the slowest took 15 minutes.
- Slowest job: Node workspace, about 10.5 minutes; Container image takes 1.5 to 4 minutes, Stack worker under 30
  seconds. Slowest step: Browser scenarios, 6 m 01 s of the job's 10 m 29 s (run 41906013970); then accessibility
  1 m 10 s, unit tests 50 s, typecheck 27 s.
- Since 2026-10-27: 62 runs. Of 21 pushes to `main`, none failed. Of 41 PR runs, 5 failed and 3 were cancelled by
  a newer push. The five: #247 and #248 on `LOCK_MISMATCH`, and three real defects caught before merge (a type
  error in #246, sideways scroll at 320 px in #245, the smoke script's locator in #242).
- The last flakes were two on 2026-10-26 (`tests/e2e/rate-limits.spec.ts:82`, `arcade-shell.spec.ts:358`).
- Protection requires three checks by job name, not strict, admins not enforced, no review. No path filter
  exists, so all three jobs always report and none can be left waiting.

## Stale or wrong in the tracker or docs

- `README.md:859` lists `compose.test.yaml`; the file was removed in `7fefafc`.
- `README.md:746` says the server calls "OpenRouter only"; since #246 it may call Anthropic's API, as CLAUDE.md's
  guardrails say.
- `README.md:601-612` names three curated decks (algorithm, output, fix); the v7 profile configures seven.
- `README.md:627` quotes the 2026-10-21 run (6,151 requests); the committed artifact is the 2026-10-26 rebuild
  (CLAUDE.md: 6,245 requests, 114 live).
- `CLAUDE.md:632` and PR #251's body call httpx and pyarrow "the libraries the worker imports". The blob worker
  imports boto3 and botocore (`fetch_blob.py:130-136`), and botocore's urllib3 did move (2.7.0 to 2.8.0).
- `ops/poc/stack/bounded_http.py:3` says requests are issued by `datasets`; nothing imports it.
- `.github/dependabot.yml:21-23` says the lock moves by hand but not how; the commands are only in PR #251.
- `docs/review/README.md:3` dates the current state 2026-10-26.
- #90: labelled "good first issue" and still open, though PR #95 fixed it. Its line numbers have moved
  (`stack-worker-seam.test.ts:45,62,79,81`; `blob-worker.ts:98`; `stack-metadata.ts:185`), and the part it calls
  unverified is settled by the code: `WORKER_STDERR` at `stack-metadata.ts:437`.
- #50: asks for Node 20.18.0 in `.node-version`; #21 pinned 24.22.0 in both version files.
- #51: its "missing codes" are all documented, and it waits on #35, which is closed.
- #53: waits on #36, which is closed.
- #37: "the email-author check is missing" was fixed by `d78df63`.
- #31: "the 3,000-request ceiling" is 10,000 (`ops/poc/limits.json:17`); its line numbers have moved.
- #83: "48 rounds" and "about 48 requests" are 100 and about 100 (project 48, language 52).
- #68: its counts are low (see the table), and it is labelled "good first issue" although its done-when needs the
  journal, which no fork has.
- #38: `package.json:16` is `:18`; the containment assertion is at `:271`, not `:120`; `compose.test.yaml`, which
  it lists, is gone.
- #65: "about 30 MB" a re-record is 54.6 MB; "108 MB" is 252,568 KB by GitHub's count.
- #72: "272 lines" is 867.
- #87: pinned, and wrong in the ways its table row lists.
- Milestones: #90 and #93 have none, though the next data run meets both.

## Risks

- Batch A's item 3 lets a uv security PR merge on green CI, so a bump of httpx, pyarrow, or botocore is first
  exercised against live data at the next run that needs a worker. Until then the 55 Python tests and the seam
  test are the only cover.
- The old-key constant in item 3 must be computed on `03cd25a` before the change; a wrong value costs one live
  `--resume` and nothing else.
- #194 changes the file every replay depends on. Develop it against a copy (`--journal=`), and check that
  `--offline` on the untouched `run.jsonl` still gives `847e7512…`.
- Until #194 lands, a try at new search windows on `run.jsonl` itself can replace the seven recorded searches.
  Use a copy, as the v7 dry run did.
- Batch B's `--resume` re-reads The Stack live. If the provider's bytes have moved, the hash moves for reasons
  unrelated to the bundle, so run it before any rule change.
- `--quiet` for #90 is uv's documented flag, not verified here on a fresh environment.
- Renaming or splitting a CI job strands every open PR, because protection names the three jobs. Add a lint job
  (#30) to protection only after it is green on `main`.
- Browser tests run with `retries: 0` (`playwright.config.ts:21`), so one flake fails a required job and costs
  another 10.5 minutes.
- CI's actions are pinned by tag, not commit (`ci.yml:28-49`), and any action is allowed. With a read-only token
  and no secrets, the exposure is small.
- `pnpm.overrides` in `package.json` (`next>postcss`, `undici`) are kept by hand; Dependabot does not move them.
- Outside my scope: CLAUDE.md is 90 KB and loads into every agent session ("Current state" is 60 KB of it).
- Outside my scope: npm majors (Next 16, TypeScript 7) are ignored by Dependabot and wait for a hand upgrade.
