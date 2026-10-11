# Claude handoff: CodeGuessr local real-round PoC

## Mission

A local-only "guess from the code" game. One preparation run crawls real
open-source code before play and freezes three decks of five rounds: "Which
project?" and an AI-credit deck from GitHub commit search, and "Which
language?" from The Stack v2. The goal is a demo on one machine, not public
play.

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

- Branch `claude/demoable-poc`, PR #7.
- The three-deck game plays real rounds: profile
  `ops/poc/profiles/local-real-rounds.v2.json`, artifact schema
  `local-experiment-artifact.v2`, and the root-route deck chooser
  (`/?deck=project|language|ai`).
- The committed artifact `apps/game/src/demo/generated/local-real-rounds.json`
  came from the 2026-10-11 journal run (384 of 600 requests), reproduced byte
  for byte by `--resume` and `--offline`. Its canonical SHA-256
  `602ca9f5fb48a699da68ded37b944d30ca236023f3618937d1d5ad5bbc8dfe06` is pinned
  in `apps/game/src/demo/local-real-experiment.pin.server.ts`; see
  `docs/review/evidence/2026-10-11-phase-1-journal-runs.md`. The journal for
  that run is in `ops/poc/stack/tmp/journal/run.jsonl` on this machine.
- Phase 0 of the review roadmap is done: worker reason codes, a Node↔Python
  seam test, Stack metadata first, fatal budget exhaustion, bounded retries,
  repository screening, GET reuse, the UI quick wins, and re-recorded media.
- Phase 1 is done (branch `claude/phase-1-pipeline`, stacked on PR #7):
  - `ops/poc/prepare/index.ts` is a thin CLI over `pipeline.ts`,
    `select-github.ts`, `select-stack.ts`, `selection.ts`, `runtime.ts`,
    `diagnostics.ts`, and `dependencies.ts`.
  - A run journal (`journal.ts`, `worker-journal.ts`) backs `--resume` and
    `--offline`.
  - A failed run writes `ops/poc/stack/tmp/local-experiment-last-failure.json`.
  - Every deck that fills is published; publication writes the pin too.
  - `ops/poc/limits.json` is the one limits file for Node and Python.
  - `packages/artifact` is the one artifact parser and hash for the game and
    the preparer.
  - The unreachable beta modules under `apps/game/src` are gone.
- Port 3000 may be taken locally by an unrelated Docker container; run browser
  tests with `E2E_PORT=3200 pnpm test:e2e`.

## Next steps

Phases 2–3 of the review roadmap:

1. Deck redesign, iterating with `pnpm prepare:poc --offline` against the
   journal: language deck without leaks, "Before or after?" replacing the AI
   deck, a project deck from popular Stack v2 repositories (today all five
   answers come from facebook), sampled and shuffled sessions, and a leakage
   test.
2. Grow The Stack v2 (probe row-group repository spread first), then other
   sources.

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
the `PREPARATION_DECKS` line for which decks published, run the full
verification matrix, and re-record the media with `pnpm demo:record`.

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

Rejection aggregates name the failing check: `LINEAGE_*`, `ADMISSION_*`
(`ADMISSION_REPOSITORY_LICENSE` is a repository licence outside the
allowlist), and `REVALIDATION_*`. `REPOSITORY_SCREENED_OUT` counts later
candidates of a repository already rejected once.

Selection diagnostics `REPOSITORY_REPEATED`, `PROJECT_NAME_IN_EXCERPT`,
`PROJECT_REPOSITORY_SKIPPED`, `AI_CREDIT_ABSENT`, and
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
2. The artifact holds the intended decks of five and passes server-side
   validation; its pinned hash matches.
3. The root route plays every deck offline.
4. Browser, build, accessibility, performance, containment, unit, and type
   checks pass freshly.
5. The README and its media reflect what actually plays.
