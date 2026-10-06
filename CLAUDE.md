# Claude handoff: CodeGuessr local real-round PoC

## Mission

Continue the existing local-only proof of concept until one preparation run
produces exactly five real rounds: three GitHub provenance rounds and two Stack
language rounds. The goal is demo testing on one machine, not public play.

## Read first

Treat these as the durable source of truth, in this order:

1. `docs/gangsta/codeguessr-poc-readiness/checkpoints/2026-10-05-checkpoint-the-hit-boundaries.md`
2. `docs/gangsta/codeguessr-poc-readiness/checkpoints/2026-09-04-checkpoint-handoff.md`
3. `docs/gangsta/codeguessr-poc-readiness/reviews/2026-09-04-handoff-audit.md`
4. `docs/gangsta/codeguessr-poc-readiness/specs/2026-08-15-contract-revision-11-signed.md`
5. `docs/gangsta/codeguessr-poc-readiness/plans/2026-07-31-execution-plan.md`
6. `README.md`

Verify the signed Contract before relying on it:

```bash
shasum -a 256 docs/gangsta/codeguessr-poc-readiness/specs/2026-08-15-contract-revision-11-signed.md
```

Expected SHA-256:
`3acc586d8fb479e6edfd2dd43e9f38ed5d8d6268ee5b025b449d3a564b32fe41`.

## Current state

- Branch: `claude/clever-curie-d7rv1m` (continues the merged
  `codex/heist/codeguessr-poc-readiness` work on `main`).
- Baseline before this work: `fd6f34cd0d8b4a344fb537e87256bc8f8e69837a`.
- The crawler, Stack workers, five-round artifact schema, server-only game
  authority, tests, operator command, MIT licence, and CI workflow exist.
- The root route still uses the synthetic rehearsal catalogue.
- The generated real-round artifact and live run report are intentionally
  absent.
- Report/artifact publication is transactional (staged report, commit inside
  the artifact publisher, rollback on failure).
- Both Python Stack workers enforce the signed endpoint, redirect, network-byte,
  request, credential-forwarding, and temporary-disk ceilings in-process and
  report counters the preparer meters. The Hugging Face redirect allowlist is
  intentionally empty because no target host has been observed under
  authorization; a live metadata stage fails closed with `REDIRECT_REJECTED`
  until that host is recorded and added as a literal in
  `ops/poc/stack/bounded_http.py` and `ops/poc/prepare/request-policy.ts`.
- The bounded transport translates a GitHub 403/429 `retry-after` or exhausted
  rate-limit budget into the controller's single bounded retry; everything else
  still fails closed. A failed run logs
  `PREPARATION_STAGE_FAILED <stage> <code> <statusClass>` before
  `PREPARATION_FAILED`.
- The 2026-10-05 authorized headers-only GitHub probe observed HTTP 200 with
  authentication supplied, no exhausted rate limit, and no retry delay, using
  the session's proxy-injected token rather than the operator's.

This is a resumable engineering handoff, not a completed or production-ready
real-data demo.

## Non-negotiable boundaries

- Localhost only; no deployment or public players.
- Exactly five automatically prepared rounds with a three/two source split.
- No human content-review workflow for this PoC.
- Public open-source repositories only, with licence and recorded-author data.
- The Stack v2 release remains `v2.2.0` at immutable revision
  `e565caa3a78c2423bd374333a472b049eb090e47`.
- Stream metadata and retrieve only selected blobs. Never download the complete
  dataset, a complete language shard, or repository archives.
- Crawling happens before play. Gameplay uses the frozen local artifact and
  performs no network access.
- Do not loosen capacity, completeness, validation, identity, credential,
  atomic-publication, or fail-closed rules without revising the signed Contract
  first.
- Never log or commit tokens, provider bodies, contact data, private email,
  source excerpts from failed diagnostics, or standard credential-store files.

## Immediate next steps

The next external action requires explicit operator authorization. Perform one
authenticated request to the pinned Hugging Face `resolve` endpoint for one
parquet shard of the Stack dataset, with redirects disabled, no retry, and no
response-body read, reporting only:

- Numeric HTTP status.
- The redirect target host, if a `Location` header is present (host only; no
  path, query, or signature).

Then add that host as a literal to `REDIRECT_HOSTS` in
`ops/poc/stack/bounded_http.py` and to the redirect policy in
`ops/poc/prepare/request-policy.ts`, test-first, before any full live run.

If a later operator run fails at GitHub Search, read the
`PREPARATION_STAGE_FAILED` line: `RETRY_SIGNAL_MISSING 4xx` means a 403/429
without a usable instruction (likely secondary throttling or missing token),
`WAIT_LIMIT` means the instruction exceeded the signed fifteen-second wait, and
`UNSUPPORTED_STATUS` with another class means a non-rate-limit status.

Do not rerun the complete preparation command until the redirect host is
recorded and the signed Contract permits the response.

## Commands

Offline preparation verification:

```bash
pnpm exec vitest run ops/poc/prepare
pnpm exec tsc --noEmit -p ops/tsconfig.json
uv run --project ops/poc/stack --locked python -m unittest discover -s ops/poc/stack
```

Complete workspace verification:

```bash
pnpm test
pnpm typecheck
pnpm test:a11y
pnpm test:performance
pnpm test:e2e
pnpm exec node --test tests/containment/acquisition-boundary.test.mjs
pnpm --filter @codeguessr/game build
```

Live preparation, only after authorization and root-cause resolution:

```bash
pnpm prepare:poc
```

The command reads credentials from the shell/provider-standard stores. Do not
place credential values in commands saved to documentation or version control.

## Completion boundary

Do not call the real-data PoC runnable until all of the following are true:

1. Preparation exits successfully and emits its completion marker.
2. Both Python workers enforce and test the signed network and disk boundaries.
3. Report/artifact publication cannot leave an orphan success report.
4. The generated artifact contains exactly three provenance and two language
   fixtures and passes server-side validation.
5. Artifact and run-report hashes, source split, warning/completeness state,
   and capacity counts are independently verified without leaking content.
6. The root route consumes the validated server-only authority.
7. Browser, build, accessibility, performance, containment, unit, and type
   checks pass freshly.
8. The durable checkpoint and README are updated with the actual evidence.

Preserve unrelated worktree changes, and do not stage, rewrite, or delete them
unless their ownership and purpose have been verified.
