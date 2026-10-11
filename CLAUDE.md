# Claude handoff: CodeGuessr local real-round PoC

## Mission

A local-only "guess from the code" game. One preparation run crawls real
open-source code before play and freezes three decks, each a pool of ten
rounds from which every game deals five: "Which project?" (popular
repositories from The Stack v2), "Which language?" (The Stack v2), and
"Before or after?" (refactor commits from GitHub search). The goal is a demo on
one machine, not public play.

## Read first

1. `docs/review/2026-10-11-codeguessr-state-review.md`: current product and
   engineering review, decisions, and the roadmap.
2. `README.md`: how to play, prepare, record, and verify.

`docs/gangsta/` is the historical record of the signed-Contract process, which
was retired on 2026-10-11. Use it for background on why rules exist, not as a
gate: changing queries, retries, ceilings, deck rules, or running
`pnpm prepare:poc` again needs no revision, signature, or authorization.

## Guardrails

- Localhost only; no deployment and no public players.
- Public open-source code only, with licence and recorded-author data.
- Bounded, selective reads only. Never download a whole dataset, a whole
  language shard, or a repository archive. The Stack v2 stays pinned to
  revision `e565caa3a78c2423bd374333a472b049eb090e47` unless deliberately moved.
- Credentials come only from standard stores (`~/.cache/huggingface/token`,
  `gh auth token`) through the environment. Never log or commit tokens,
  provider bodies, contact data, private email, or source excerpts from failed
  diagnostics.
- Gameplay never touches the network; it plays the frozen local artifact.
- Malformed provider data fails closed. Transient errors may be retried within
  the request budget.
- Preserve unrelated worktree changes (`apps/game/tsconfig.tsbuildinfo` stays
  unstaged).

## Current state

- Branches and PRs, stacked: `claude/demoable-poc` (#7, Phase 0),
  `claude/phase-1-pipeline` (#8, Phase 1), `claude/phase-2-decks` (Phase 2).
- The game plays profile `ops/poc/profiles/local-real-rounds.v3.json` and
  artifact schema `local-experiment-artifact.v3` from the root-route deck
  chooser (`/?deck=project|language|before-after`). A page load deals five
  rounds from the deck's pool; `dealSession` in
  `apps/game/src/demo/local-real-experiment.server.ts` does it server-side.
- The committed artifact `apps/game/src/demo/generated/local-real-rounds.json`
  came from the 2026-10-11 v3 run (569 of 1,500 requests). Its canonical SHA-256
  `cf5bc8d31407b0dad797ffb372dda7d11d4d5da50ed1c30e0218bead31e14e0a` is pinned
  in `apps/game/src/demo/local-real-experiment.pin.server.ts` (the preparer
  writes it); see `docs/review/evidence/2026-10-11-v3-decks-run.md`. The
  journal for that run is in `ops/poc/stack/tmp/journal/run.jsonl` on this
  machine, so `pnpm prepare:poc --offline` rebuilds it with no network.
- Phases 0–2 of the review roadmap are done:
  - Phase 0: diagnostics, retries, yield, and UI quick wins.
  - Phase 1: the module split, the run journal (`--resume`, `--offline`),
    per-deck publication, the failure report, `ops/poc/limits.json`, and
    `packages/artifact` as the one parser and hash.
  - Phase 2: the v3 decks. The generators are `project-rounds.ts`,
    `language-rounds.ts`, and `before-after-rounds.ts`; the selectors are
    `select-stack.ts` and `select-github.ts`. The windows come from
    `code-windows.ts`. The game deals sessions, shows panes and option
    details, highlights the answer, and scores 250 × options per round. The
    leakage test is `packages/artifact/test/deck-leakage.test.ts`.
- Port 3000 may be taken locally by an unrelated Docker container; run browser
  tests with `E2E_PORT=3200 pnpm test:e2e`.

## Next steps

Phase 3 of the review roadmap: grow the sources.

1. More Stack v2 row groups and languages (look-alike pairs such as
   TypeScript/JavaScript, Java/Kotlin, C/C++), so pools can grow past ten and
   the language deck's options stay answerable.
2. A `SourceAdapter` seam, then the next source (the Software Heritage API or
   curated GitHub repositories).

Iterate on deck rules with `pnpm prepare:poc --offline`; use `--resume` when
a change needs responses the journal lacks.

Live run:

```bash
HF_TOKEN="$(cat ~/.cache/huggingface/token)" \
GITHUB_TOKEN="$(gh auth token)" \
STACK_V2_ACKNOWLEDGED_USABLE_REVISION=e565caa3a78c2423bd374333a472b049eb090e47 \
pnpm prepare:poc
```

Add `--resume` after a failed run to replay what the journal holds and fetch
only the rest, or `--offline` to replay the journal with no network and no
token (it fails with `JOURNAL_MISS` on anything unrecorded). The journal is
`ops/poc/stack/tmp/journal/run.jsonl` (ignored).

After a success the artifact and its pin are already written together. Check
the `PREPARATION_DECKS` line for which decks published, read a few rounds of
each deck, run the full verification matrix (the leakage test runs against the
committed artifact), and re-record the media with `pnpm demo:record` (each GIF
under 4 MB).

## Reading failures

Read the `PREPARATION_STAGE_FAILED <stage> <code> <status-class>` line first;
`ops/poc/stack/tmp/local-experiment-last-failure.json` holds the same codes
with spend, capacity counts, and rejection aggregates.

- `PREPARATION_DECK_SKIPPED <deck> <code>`: that deck did not fill (`DECK_SHORT`,
  or the `BUDGET_EXHAUSTED_*` budget that ran out) and was left out; the others
  still publish. `SELECTION DECK_SHORT` or `NO_DECK_FILLED` means none filled.
- `JOURNAL_MISS`, `JOURNAL_MISSING`, `JOURNAL_CORRUPT`: `--offline` needed a
  response the journal lacks, there is no journal, or a journal entry failed its
  hash check. Run without `--offline` (or with `--resume`).

- `RETRY_SIGNAL_MISSING 4xx`: a 403/429 without a usable retry instruction.
- `WAIT_LIMIT`: a retry instruction longer than the fifteen-second wait.
- `BUDGET_EXHAUSTED_<BUDGET>`: a run-wide budget (requests, blob attempts or
  bytes, metadata bytes, retries, waits, temporary disk) ran out; the deck
  being filled and every later deck are skipped instead of rejecting every
  later candidate. `PREPARATION_SPEND` shows the requests each stage used.
- `LOGICAL_RETRY_LIMIT`, `RUN_RETRY_LIMIT`, `WAIT_LIMIT`: a GitHub 5xx, network
  error, timeout, or rate limit was retried once and failed again, or the
  run's five retries or 30 s of waiting were spent.
- `WORKER_EXIT_<CODE>`: a Python worker exited non-zero with its own stable
  code (`WORKER_UNEXPECTED` for an unmapped exception). A bare `WORKER_EXIT`
  means its stderr was not a code.
- `PUBLIC_CONTAINMENT_*`: names the protected key and public field that
  collided.
- `GITHUB_SEARCH_*`: the discovery check that rejected a search response.
  `INCOMPLETE`, `TOTAL_CHANGED`, `ITEM_COUNT`, and `DUPLICATE` are provider
  inconsistencies; `SHAPE`, `IDENTITY`, and `DATE` are record drift.

Rejection aggregates name the failing check: `LINEAGE_*` (`LINEAGE_CHANGE_WINDOW`
is a commit whose change does not fit one before-and-after window),
`ADMISSION_*` (`ADMISSION_REPOSITORY_LICENSE` is a repository licence outside
the allowlist), and `REVALIDATION_*` (`REVALIDATION_WINDOW` is a file with no
code window past its preamble). `REPOSITORY_SCREENED_OUT` counts later
candidates of a repository already rejected once.

Selection diagnostics `REPOSITORY_REPEATED`, `SUBJECT_UNUSABLE` (a commit
subject no hint can quote), `PROJECT_NAME_IN_EXCERPT` (code or a file name
that names an option), `LANGUAGE_ROUNDS_REJECTED`, and
`SOURCE_IDENTITY_UNREPORTABLE` are expected screening outcomes, not faults.

## Commands

```bash
pnpm exec vitest run ops/poc/prepare
pnpm exec tsc --noEmit -p ops/tsconfig.json
uv run --project ops/poc/stack --locked python -m unittest discover -s ops/poc/stack
pnpm test
pnpm typecheck
pnpm test:a11y
pnpm test:performance
pnpm test:e2e
pnpm exec node --test tests/containment/acquisition-boundary.test.mjs
pnpm --filter @codeguessr/game build
```

## Done means

1. `pnpm prepare:poc` exits successfully with its completion marker.
2. The artifact holds the intended decks, each a pool of at least five rounds,
   passes server-side validation and the leakage test, and its pinned hash
   matches.
3. The root route plays every deck offline.
4. Browser, build, accessibility, performance, containment, unit, and type
   checks pass freshly.
5. The README and its media reflect what actually plays.
