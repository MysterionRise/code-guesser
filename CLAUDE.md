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

- Branch: `claude/demoable-poc` (continues the merged
  `claude/clever-curie-d7rv1m` work on `main`).
- Baseline before this work: `488aca571e7a05e7dc3aa6ae98c690b7ea69779b`.
- The crawler, Stack workers, five-round artifact schema, server-only game
  authority, a server-only artifact loader with an operator-pinned trusted hash,
  a scripted demo recorder (`pnpm demo:record`, README GIFs and MP4), tests,
  operator command, MIT licence, and CI workflow exist.
- The root route still uses the synthetic rehearsal catalogue; the loader is
  tested but not yet wired because no artifact exists.
- The generated real-round artifact and live run report are intentionally
  absent.
- On 2026-10-08 eight authorized live runs moved the failing stage from
  GitHub admission through Stack metadata to selected-blob retrieval. GitHub
  discovery, lineage, admission (three candidates, both marker outcomes), and
  both Stack metadata configurations (10,000 rows each) now pass against the
  live providers within every ceiling. See
  `docs/gangsta/codeguessr-poc-readiness/evidence/2026-10-08-live-preparation-attempts.md`.
- The Hugging Face redirect host `us.aws.cdn.hf.co` is recorded and
  allowlisted on both sides. The metadata worker reads one parquet row group
  per exact range request instead of streaming through `datasets`.
- A failed run logs `PREPARATION_STAGE_FAILED <stage> <code> <statusClass>`
  for every failure, plus `PREPARATION_COUNTS` and `PREPARATION_REJECTIONS`
  aggregates when selection fails.
- The remaining blocker is the operator's AWS credential: the default profile
  key is rejected by AWS itself (`InvalidClientTokenId`), so every Software
  Heritage blob fetch exits with `WORKER_EXIT`.

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

1. The operator replaces the AWS default-profile credentials (or exports
   `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) with a key AWS accepts and that
   may read the `softwareheritage` bucket. Verify with a single
   `sts get-caller-identity` before any run; never record the values.
2. Rerun the live preparation:

   ```bash
   HF_TOKEN="$(cat ~/.cache/huggingface/token)" \
   GITHUB_TOKEN="$(gh auth token)" \
   STACK_V2_ACKNOWLEDGED_USABLE_REVISION=e565caa3a78c2423bd374333a472b049eb090e47 \
   pnpm prepare:poc
   ```

   If blob retrieval still fails with `WORKER_EXIT`, reproduce one fetch with the
   worker directly and check for a requester-pays requirement before changing
   code.
3. On `PREPARATION_COMPLETE`, verify the artifact independently (canonical hash
   equals the report's `artifactHash`, three provenance then two language
   fixtures, counts within ceilings), record the hash in
   `apps/game/src/demo/local-real-experiment.pin.server.ts`, and commit the
   artifact.
4. Wire `apps/game/src/app/page.tsx` and `actions.ts` to
   `local-real-experiment-loader.server.ts`, replace only the route-source
   assertions (FR-015) in `rehearsal-catalogue.test.ts`, `demo-game.test.ts`,
   and the containment test, and rewrite `tests/e2e/arcade-shell.spec.ts` to
   derive answers from the artifact.
5. Re-record the README media with `pnpm demo:record`, then update README,
   checkpoint, and this file with fresh evidence.

Read the `PREPARATION_STAGE_FAILED` line first on any failure:
`RETRY_SIGNAL_MISSING 4xx` means a 403/429 without a usable instruction,
`WAIT_LIMIT` means the instruction exceeded the signed fifteen-second wait,
`REQUEST_COUNT` or `REQUEST_LIMIT` in the rejections means the 200-request
ceiling was spent, and `WORKER_EXIT` means a Python worker exited non-zero
(reproduce it directly to read its code).

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
