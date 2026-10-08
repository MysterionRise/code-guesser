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
4. `docs/gangsta/codeguessr-poc-readiness/specs/2026-10-08-contract-revision-12-signed.md`
   and its correction
   `docs/gangsta/codeguessr-poc-readiness/specs/2026-10-08-contract-revision-13-signed.md`
   (both amend revision 11, which stays binding where not amended:
   `docs/gangsta/codeguessr-poc-readiness/specs/2026-08-15-contract-revision-11-signed.md`)
5. `docs/gangsta/codeguessr-poc-readiness/plans/2026-07-31-execution-plan.md`
6. `README.md`

Verify both signed Contract files before relying on them:

```bash
shasum -a 256 docs/gangsta/codeguessr-poc-readiness/specs/2026-08-15-contract-revision-11-signed.md \
  docs/gangsta/codeguessr-poc-readiness/specs/2026-10-08-contract-revision-12-signed.md \
  docs/gangsta/codeguessr-poc-readiness/specs/2026-10-08-contract-revision-13-signed.md
```

Expected SHA-256:

- Revision 11: `3acc586d8fb479e6edfd2dd43e9f38ed5d8d6268ee5b025b449d3a564b32fe41`
- Revision 12 amendment: `045ff6a7801f07096f0eb178fa358458e9661ed11d2de7830747538c7ce30e78`
- Revision 13 correction: `2af256ad391f3e91de8e5be3ce58a35a468d32a7f9c363a26f22481b81dfcc43`

## Current state

- Branch: `claude/demoable-poc` (continues the merged
  `claude/clever-curie-d7rv1m` work on `main`).
- Baseline before this work: `488aca571e7a05e7dc3aa6ae98c690b7ea69779b`.
- The real five-round artifact exists at
  `apps/game/src/demo/generated/local-real-rounds.json` (canonical SHA-256
  `0eab7f489f311125b9a1ae8574fd2a3b072c3c954e48c8284aac39559a607498`, crawl
  snapshot `9249eb590064490285f5f799acabb3fe56edf436fdc1d5b712262c99ca083713`),
  produced by the fourteenth authorized live run on 2026-10-08 with the
  accepted `GITHUB_SEARCH_INCOMPLETE` warning, and verified independently. See
  `docs/gangsta/codeguessr-poc-readiness/evidence/2026-10-08-combined-live-run.md`.
- The root route mounts that artifact through the server-only loader and the
  operator-pinned hash in `apps/game/src/demo/local-real-experiment.pin.server.ts`;
  there is no synthetic fallback. The synthetic catalogue stays in the codebase
  and its own tests.
- The README embeds three captioned GIFs and an MP4 recorded from the real
  rounds by `pnpm demo:record`.
- The run report lives at the ignored path `ops/poc/stack/tmp/local-experiment-run.json`.
- Software Heritage blobs are read anonymously; no AWS credential is needed.
- Every failure logs its stage, a safe code, the failing function and file,
  and (for selection failures) pool counts and rejection aggregates.

This is a demoable local real-data PoC, not production-ready and not
authorized for public players.

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

1. The Don confirms or reverts two semantics refinements made during the live
   attempts (see the 2026-10-08 checkpoint): trailer-aware marker matching and
   the additive observed Copilot trailer names in the profile.
2. Merge is a separate decision; this handoff authorizes none.
3. To regenerate the artifact, rerun with the operator's credentials:

   ```bash
   HF_TOKEN="$(cat ~/.cache/huggingface/token)" \
   GITHUB_TOKEN="$(gh auth token)" \
   STACK_V2_ACKNOWLEDGED_USABLE_REVISION=e565caa3a78c2423bd374333a472b049eb090e47 \
   pnpm prepare:poc
   ```

   then verify the new artifact independently, update the pinned hash, rerun
   the full verification matrix, re-record the media, and update the evidence.

Read the `PREPARATION_STAGE_FAILED` line first on any failure:
`RETRY_SIGNAL_MISSING 4xx` means a 403/429 without a usable instruction,
`WAIT_LIMIT` means the instruction exceeded the signed fifteen-second wait,
`REQUEST_COUNT` or `REQUEST_LIMIT` in the rejections means the 200-request
ceiling was spent, `WORKER_EXIT` means a Python worker exited non-zero
(reproduce it directly to read its code), and a `PUBLIC_CONTAINMENT_*` code
names the protected key and public field that collided.

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
