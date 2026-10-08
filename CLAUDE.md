# Claude handoff: CodeGuessr local real-round PoC

## Mission

Continue the existing local-only proof of concept until one preparation run
produces three real code-guessing decks of five rounds each (Contract revision
12, FR-002): "Which project?" and "Is this AI-generated?" from GitHub commit
search, and "Which language?" from The Stack v2. The goal is demo testing on
one machine, not public play.

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
- Revision 12/13 implementation (WP-036 to WP-043) is committed: profile
  `ops/poc/profiles/local-real-rounds.v2.json`, the three deck generators,
  artifact schema `local-experiment-artifact.v2`, run report
  `local-experiment-run.v2`, the v2 game authority, and the root-route deck
  chooser (`/?deck=project|language|ai`). Offline suites, the game build,
  and containment pass.
- The committed artifact at `apps/game/src/demo/generated/local-real-rounds.json`
  is still the revision 11 five-round artifact (canonical SHA-256
  `0eab7f489f311125b9a1ae8574fd2a3b072c3c954e48c8284aac39559a607498`). The v2
  authority rejects it, so the root route shows its "nothing to play" notice
  until the revision 12 live run publishes a v2 artifact and its hash is
  pinned in `apps/game/src/demo/local-real-experiment.pin.server.ts`.
- WP-044 (the one live run revision 12 authorizes) has not run yet. The
  committed-artifact loader test and the browser specs need its output.
- The README media still show the revision 11 rounds; `pnpm demo:record` now
  records one scene per deck plus a full run (WP-045).
- The run report lives at the ignored path `ops/poc/stack/tmp/local-experiment-run.json`.
- Software Heritage blobs are read anonymously; no AWS credential is needed.
- Every failure logs its stage, a safe code, the failing function and file,
  and (for selection failures) pool counts and rejection aggregates.

This is a local real-data PoC in transition to three decks, not
production-ready and not authorized for public players.

## Non-negotiable boundaries

- Localhost only; no deployment or public players.
- Exactly three automatically prepared decks of five rounds with the FR-002
  lineage (revision 12; it replaced revision 11's three/two split).
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

1. Run the one live preparation that revision 12 authorizes (WP-044), with
   the operator's credentials from the standard stores:

   ```bash
   HF_TOKEN="$(cat ~/.cache/huggingface/token)" \
   GITHUB_TOKEN="$(gh auth token)" \
   STACK_V2_ACKNOWLEDGED_USABLE_REVISION=e565caa3a78c2423bd374333a472b049eb090e47 \
   pnpm prepare:poc
   ```

   A failed run leaves the previous artifact in place. Revision 12 authorizes
   one run, so report a failure instead of rerunning.
2. Verify the new artifact independently: it parses under the v2 model, the
   preparer and game canonical hashes equal the report's `artifactHash`,
   decks are project/language/ai of five, languages are distinct, the AI deck
   has at least two of each outcome, counts are within the v2 ceilings, every
   query is complete, and neither file contains token-like strings.
3. Pin the verified hash, run the full verification matrix, re-record the
   media with `pnpm demo:record` (remove the revision 11 GIFs), and update the
   README, this handoff, a dated evidence file, and a new checkpoint.
4. Merge is a separate decision; this handoff authorizes none.

Read the `PREPARATION_STAGE_FAILED` line first on any failure:
`RETRY_SIGNAL_MISSING 4xx` means a 403/429 without a usable instruction,
`WAIT_LIMIT` means the instruction exceeded the signed fifteen-second wait,
`REQUEST_COUNT` or `REQUEST_LIMIT` in the rejections means the 600-request
ceiling was spent, `WORKER_EXIT` means a Python worker exited non-zero
(reproduce it directly to read its code), and a `PUBLIC_CONTAINMENT_*` code
names the protected key and public field that collided. Selection
diagnostics `REPOSITORY_REPEATED`, `PROJECT_NAME_IN_EXCERPT`,
`PROJECT_REPOSITORY_SKIPPED`, `AI_CREDIT_ABSENT`, and
`SOURCE_IDENTITY_UNREPORTABLE` are expected screening outcomes, not faults.

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
4. The generated artifact contains exactly three decks of five fixtures with
   the FR-002 lineage and passes server-side validation.
5. Artifact and run-report hashes, source split, warning/completeness state,
   and capacity counts are independently verified without leaking content.
6. The root route consumes the validated server-only authority.
7. Browser, build, accessibility, performance, containment, unit, and type
   checks pass freshly.
8. The durable checkpoint and README are updated with the actual evidence.

Preserve unrelated worktree changes, and do not stage, rewrite, or delete them
unless their ownership and purpose have been verified.
