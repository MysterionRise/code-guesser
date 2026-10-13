# CodeGuessr state review

Date: 2026-10-11. Branch `claude/demoable-poc` (draft PR #7). Three independent
read-only reviews fed this document: a product-owner review, a principal-engineer review
of the preparation pipeline, and research into other code sources. A planning pass
turned them into one roadmap, and the main claims were checked against the code.

## Status (updated 2026-10-13)

| Phase | State | Where |
| --- | --- | --- |
| 0: reliability, request savings, UI quick wins | done | PR #7; [evidence](evidence/2026-10-11-three-deck-live-run.md) |
| 1: run journal, per-deck publication, one artifact model | done | PR #8; [evidence](evidence/2026-10-11-phase-1-journal-runs.md) |
| 2: deck redesign | done | PR #9; [evidence](evidence/2026-10-11-v3-decks-run.md) |
| 3a: grow The Stack v2 (twelve languages in look-alike pairs, 24-round Stack decks) | done | `claude/phase-3-stack`; [evidence](evidence/2026-10-13-v4-stack-growth-run.md) |
| 3b: the `SourceAdapter` seam, then other sources | planned | [next-sources plan](2026-10-13-next-sources-plan.md) |

The findings below describe the state before Phase 0 and are kept as written.

## Summary

After about ten weeks, thirteen Contract revisions and sixteen live preparation runs, a
fresh checkout has nothing to play.
- **Why nothing plays:** the three-deck game is implemented, but the v2 artifact has
  never been produced. The two runs on 2026-10-10 failed closed, first on stale Python
  worker limits, then on one transient GitHub search response.
- **The decks:** two of the three can be won without reading the code. The third
  can't be guessed even by reading it.
- **Process:** about 15.5k lines of process documents sit against roughly 400 lines of
  player-facing UI.

### Decisions taken

| Question | Decision |
| --- | --- |
| "Is this AI-generated?" | Replace it with a **"Before or after?"** deck built from commit parent/child versions |
| Signed-Contract governance | **Retire it.** Keep a short list of guardrails in `CLAUDE.md` and the README |
| First source to grow | **The Stack v2** (`bigcode/the-stack-v2`). Other sources come later |
| Immediate scope | This review plus Phase 0: reliability, request savings, UI quick wins, and a live run |

## Product-owner findings

Ranked by impact.

1. **Nothing is playable.**
   - The game accepts only an artifact with all three decks, so one bad deck or one
     transient provider error blocks everything.
   - The empty state is written for the operator ("Run `pnpm prepare:poc`, verify the
     artifact hash…", `apps/game/src/app/page.tsx`).
2. **The AI deck is not code guessing.**
   - The answer comes only from a commit-message trailer (`ops/poc/prepare/ai-credit.ts`).
   - The fixed 3-yes/2-no split can be counted (`ops/poc/prepare/index.ts:215`).
   - "No" rounds come only from facebook/google `refactor` commits, filled first with the
     project deck's rejects. "Yes" rounds come only from github/microsoft/vercel. The
     org is learnable, and it is the opposite of what the deck claims to test.
3. **The language deck can be solved without reading.**
   - The five rounds are always five different languages
     (`ops/poc/prepare/language-rounds.ts:188`). Distractors are fixed per language,
     and seven distractor-only languages can never be right.
   - Clues are the same for every round of a language, so hint 1 is an answer key.
   - Excerpts start at the first code line, usually `import`/`package`/`use`.
4. **The project deck can't be guessed.**
   - Candidates are bare `owner/name` labels. Discovery is sorted by query first
     (`ops/poc/prepare/github-search.ts`), so they probably all come from one org.
   - Excerpts are 6-line diff hunks (`ops/poc/prepare/changed-lines.ts`).
   - Excerpts that name their own repo are rejected, which rules out famous projects.
   - Clue 2 repeats the owner already shown on every candidate.
5. **No replayability.** There are 15 fixed rounds, with fixed round order and fixed
   candidate positions (`ops/poc/prepare/round-projection.ts`). "Play again" shows the
   same screens.
6. **The reveal doesn't teach.**
   - The "misleading signals" are hard-coded and usually false
     (`ops/poc/prepare/project-rounds.ts:111-112`, and the same in the language and AI
     generators).
   - The correct option isn't highlighted, and the source URL is plain text.
7. **Hint economics.** Hint costs (1000/800/500) are never shown, and a two-way guess
   pays the same as a four-way one.
8. **Experience basics.**
   - Onboarding is a three-sentence legal notice.
   - The share text always says "5/5" (that's rounds completed).
   - `white-space: pre-wrap` breaks indentation on phones (`apps/game/src/app/globals.css:19`).
   - Focus is lost after Lock in and Next.
   - The README still describes five rounds and shows the v1 GIFs.

## Principal-engineer findings

Ranked by severity, with effort as S/M/L.

1. **Worker failure reasons are discarded (S).** The Python workers write a stable code
   to stderr, but Node raises a bare `WORKER_EXIT` (`ops/poc/prepare/stack-metadata.ts`,
   `ops/poc/prepare/blob-worker.ts`). Two runs needed manual offline diagnosis because
   of this.
2. **No test crosses the Node↔Python boundary (S).**
   - Every Node test stubs the workers, and the test harness copies the production
     wiring (`index.ts` `defaultDependencies`).
   - The "captured" fixtures are synthetic. The revision 12 limit mismatch went through
     this gap.
3. **The fragile stage runs last (S).** Stack metadata does not depend on GitHub
   admission, but it runs after it. So a Stack failure wastes every GitHub request.
4. **Running out of budget looks like rejections (S).** A `CapacityError` is counted
   as one more rejected candidate. The loop keeps draining the pool and ends with a
   vague `INVARIANT_REJECTED`.
5. **Poor crawl yield (M).**
   - Each admitted GitHub candidate costs 7+2d requests, where d is the path depth.
   - Admission fetches `/commits/{sha}` again after lineage already has it.
   - The cheapest gate, the repository licence/fork/archived check, runs last and
     isn't cached, although repositories repeat.
   - AI credit is checked after the full spend, though the search item carries the
     commit message.
   - The Software Heritage blob fetch runs before the one-request GitHub repository
     check.
   - Estimated saving from fixing these: 30–50% of requests.
6. **Rejections can't be explained (S).** Lineage, admission and revalidation failures
   have no reason codes. There is no per-stage request spend, and the run report is
   written only on success.
7. **Nothing can be resumed or replayed (L).** Responses live only in memory, and a
   failure loses all of them. The finalize step replays through a first-in-first-out
   cache that is fragile.
8. **Transient errors kill runs (S).** Only a 403/429 that carries a retry signal is
   retried. A 5xx, a reset connection, a timeout, or one inconsistent search page fails
   the whole run.
9. **`index.ts` is hard to read (M).**
   - It is 454 lines with 16 lines over 200 characters and 26 `as any` casts.
   - Tree-walk and licence code is duplicated between `github-lineage.ts` and
     `stack-revalidation.ts`.
   - The Stack revision is hard-coded in eight files, and the limits are copied across
     Node and Python.
10. **Two parsers for one artifact (M).** `ops/poc/prepare/model*.ts` (758 lines) and
    `apps/game/src/demo/local-real-experiment-*.server.ts` (966 lines) each parse and
    serialize the same artifact, and the hash is pinned by hand. About 4k lines of game
    modules (identity, consent, incident, day7) are not used by any route.

## Sources

### Extension points
- The artifact binds every source to a GitHub commit or blob URL
  (`ops/poc/prepare/model.ts`), and its snapshot section only knows `github` and
  `stack`.
- A source hosted on GitHub plugs in through the profile alone.
- Any other host needs artifact schema v3 and changes to about seven files. The right
  first step is a `SourceAdapter { discover, admit, bind, validateSource,
  snapshotSection }` refactor.

### The Stack v2 can do more
- **Fields:** Stack rows already carry `repo_name`, `star_events_count`,
  `fork_events_count` and licence data. The metadata worker validates them today but
  drops most of them.
- **Project deck:** pick popular repositories by stars, exclude forks and mirrors, use
  function-level excerpts and same-language distractors. That would make the deck
  guessable and cut its GitHub search dependence.
- **Language deck:** more languages, including look-alike pairs (TypeScript/JavaScript,
  Java/C#/Kotlin, C/C++), for real difficulty.
- **Risk:** one row group may cluster around a few repositories. A count-only probe of
  distinct repositories and star spread per row group must come first.
- **"Before or after?"** still needs GitHub commit lineage, which the pipeline already
  captures.

### Later candidates (ranked)

| Source | Gives | Constraints |
| --- | --- | --- |
| Curated GitHub repos (TheAlgorithms, `dspinellis/unix-history-repo`, famous releases) | algorithm × language, decades | No new provider; check mixed licences |
| Software Heritage API | any forge, decades of history, SWHIDs | 120 req/h anonymous, 1,200 with a token; terms say one object at a time |
| GitLab.com | project, commit, trailers | 5,000 req/h with a token; no global commit search, so a curated project list is needed |
| npm / PyPI with provenance attestations | ecosystem or framework | Screen out built and minified files |
| Rosetta Code | the same task in hundreds of languages | GFDL licence |

**Rejected:**
- AI-labelled code datasets: non-commercial or no-derivatives licences, no
  provenance, and whole-file downloads.
- GH Archive/BigQuery: push events have no commit list, and reads are not bounded.
- `the-stack-smol` and similar subsets: gated, with no commit or author.
- Exercism and Project Euler: solution licences unstated.

## Roadmap

### Phase 0 (now)
- **Governance:** retire the Contract process and keep the guardrails.
- **Diagnostics:** pass worker reason codes through, add a real Node↔Python seam test,
  and give lineage, admission and revalidation failures reason codes.
- **Ordering and budget:** run Stack metadata first; make running out of budget fatal;
  log spend per stage.
- **Retries:** one bounded retry for 5xx, network errors, timeouts and inconsistent
  search pages, with every request still metered.
- **Yield:** screen commit messages before lineage, memoize the repository check and
  repeated GETs, and check the repository before fetching the Software Heritage blob.
- **UI quick wins:**
  - hint costs, a linked source, and focus handling
  - code that scrolls instead of wrapping
  - better share text
  - a player-facing empty state
- **Ship:** a live run, then pin, full verification, re-recorded media, and an updated
  README.

### Phase 1: pipeline structure
- A gitignored, hash-verified run journal with `--resume` and `--offline` replay.
- Per-deck publication, so one to three decks can ship.
- A redacted report written on failure.
- `index.ts` split into modules.
- One shared artifact parser.
- One limits file that Node and Python both read.
- Unused game modules removed.

### Phase 2: deck redesign
Iterate offline against the journal.
- **Language deck:** skip the preamble, clues drawn from the excerpt itself, look-alike
  distractors, and a pool with repeats allowed.
- **"Before or after?"** replaces the AI deck.
- **Project deck:** built from popular Stack v2 repositories.
- **Reveal:**
  - signals worked out per round
  - the correct option highlighted
  - points scaled by the number of options
  - sessions sampled from a pool, with shuffled candidates
- **Leakage test:** simple solvers that don't read the code must stay within chance
  plus 10%.

### Phase 3: grow The Stack v2, then other sources
Run the probe first, then add more languages and row groups, then the `SourceAdapter`
refactor and the next source.

## Guardrails kept after retiring the Contract
- Localhost only; no deployment and no public players.
- Public open-source code only, with licence and recorded-author data.
- Bounded, selective reads only. Never download a whole dataset, a whole language
  shard, or a repository archive.
- Credentials come only from standard stores and are never logged or committed.
- Gameplay never touches the network.
- Malformed provider data fails closed. Transient errors may be retried within the
  request budget.
