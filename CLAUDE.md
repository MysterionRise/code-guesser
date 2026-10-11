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

- Branch `claude/demoable-poc`, draft PR #7.
- The three-deck game is implemented: profile
  `ops/poc/profiles/local-real-rounds.v2.json`, artifact schema
  `local-experiment-artifact.v2`, run report `local-experiment-run.v2`, and the
  root-route deck chooser (`/?deck=project|language|ai`).
- The committed artifact `apps/game/src/demo/generated/local-real-rounds.json`
  is still the older v1 five-round artifact, which the v2 game rejects, so `/`
  shows its "nothing to play" notice until a v2 run publishes and its hash is
  pinned in `apps/game/src/demo/local-real-experiment.pin.server.ts`.
- Phase 0 pipeline fixes are in: worker reason codes, a Node↔Python seam test,
  Stack metadata first, fatal budget exhaustion, bounded retries, repository
  screening, and GET reuse.
- Live runs on 2026-10-10 failed closed twice (stale Python worker limits, then
  one transient GitHub search response); see
  `docs/gangsta/codeguessr-poc-readiness/evidence/2026-10-10-revision-12-live-run-attempts.md`.
- The README media still show the v1 rounds.

## Next steps

Phase 0 of the review roadmap: worker reason codes, a Node↔Python seam test,
Stack metadata first, budget exhaustion as a fatal error, bounded retries,
request-saving screens, UI quick wins, then a live run, pin, full verification,
and re-recorded media. Phases 1–3 (run journal and per-deck publish, deck
redesign with "Before or after?" replacing the AI deck, growing The Stack v2)
follow; see the review.

Live run:

```bash
HF_TOKEN="$(cat ~/.cache/huggingface/token)" \
GITHUB_TOKEN="$(gh auth token)" \
STACK_V2_ACKNOWLEDGED_USABLE_REVISION=e565caa3a78c2423bd374333a472b049eb090e47 \
pnpm prepare:poc
```

After a success: verify the artifact (it parses under the v2 model, preparer
and game canonical hashes equal the report's `artifactHash`, decks are
project/language/ai of five, no token-like strings), pin the hash, run the full
verification matrix, and re-record the media with `pnpm demo:record`.

## Reading failures

Read the `PREPARATION_STAGE_FAILED <stage> <code> <status-class>` line first.

- `RETRY_SIGNAL_MISSING 4xx`: a 403/429 without a usable retry instruction.
- `WAIT_LIMIT`: a retry instruction longer than the fifteen-second wait.
- `BUDGET_EXHAUSTED_<BUDGET>`: a run-wide budget (requests, blob attempts or
  bytes, metadata bytes, retries, waits, temporary disk) ran out; the run stops
  instead of rejecting every later candidate. `PREPARATION_SPEND` shows the
  requests each stage used.
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
2. The artifact holds the three decks of five and passes server-side
   validation; its hash is pinned.
3. The root route plays every deck offline.
4. Browser, build, accessibility, performance, containment, unit, and type
   checks pass freshly.
5. The README and its media reflect what actually plays.
