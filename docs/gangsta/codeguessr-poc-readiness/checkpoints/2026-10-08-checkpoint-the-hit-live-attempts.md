---
heist: codeguessr-poc-readiness
phase: the-hit
status: blocked
timestamp: 2026-10-08T18:05:00Z
next-action: Operator supplies an AWS credential that AWS accepts for the Software Heritage bucket, then the combined live run resumes under WP-034 and WP-025 mounts the verified artifact
completed-wps: [WP-001, WP-002, WP-003, WP-004, WP-005, WP-006, WP-007, WP-008, WP-009, WP-010, WP-011, WP-012, WP-013, WP-014, WP-015, WP-016, WP-017, WP-018, WP-019, WP-020, WP-021, WP-022, WP-023, WP-024, WP-026, WP-030, WP-031, WP-032, WP-033, WP-035]
pending-wps: [WP-025, WP-027, WP-029]
blocked-wps: [WP-028, WP-034]
failed-wps: []
artifacts:
  - README.md
  - CLAUDE.md
  - ops/demo/record/index.ts
  - docs/media/01-read-the-code.gif
  - docs/media/02-lock-in.gif
  - docs/media/03-full-run.gif
  - docs/media/codeguessr-demo.mp4
  - ops/poc/stack/bounded_parquet.py
  - ops/poc/stack/bounded_http.py
  - ops/poc/stack/stream_metadata.py
  - ops/poc/prepare/request-policy.ts
  - ops/poc/prepare/github-lineage.ts
  - ops/poc/prepare/github-admission.ts
  - ops/poc/prepare/provenance-rounds.ts
  - ops/poc/prepare/stack-metadata.ts
  - ops/poc/prepare/index.ts
  - ops/poc/profiles/local-real-rounds.v1.json
  - apps/game/src/demo/local-real-experiment-loader.server.ts
  - apps/game/src/demo/local-real-experiment.pin.server.ts
  - docs/gangsta/codeguessr-poc-readiness/evidence/2026-10-08-hugging-face-redirect-observation.md
  - docs/gangsta/codeguessr-poc-readiness/evidence/2026-10-08-live-preparation-attempts.md
---

# The Hit: Live Attempts and the Credential Boundary

The signed Contract remains exact at SHA-256
`3acc586d8fb479e6edfd2dd43e9f38ed5d8d6268ee5b025b449d3a564b32fe41`. No
Contract text changed. Work continued on `claude/demoable-poc` from the merged
boundary fixes on `main`.

## Demo media (new)

`pnpm demo:record` drives the arcade in headless Chromium at a 390x844
viewport with caption overlays and encodes three palette GIFs and one H.264 MP4
into `docs/media/` through unit-tested ffmpeg argument builders. The README
embeds the clips; they show the synthetic demo until the real artifact lands.

## Redirect host recorded (WP-028 prerequisite)

One authorized headers-only observation found the pinned `resolve` endpoint
answering 302 to `us.aws.cdn.hf.co`. That host is the single literal in
`REDIRECT_HOSTS` and in the TypeScript redirect policy, added test-first on
both sides, with every other host, scheme, port, userinfo, fragment, or second
hop still rejected and no origin credential forwarded.

## Live findings fixed test-first

Eight authorized live runs are tabulated in
`evidence/2026-10-08-live-preparation-attempts.md`. Each stop was diagnosed
with aggregate-only probes and fixed with a failing test first:

- **Diagnostics.** Every failure logs its stage and a safe code; selection
  failures add pool counts and aggregated rejection codes; a wrapped retry
  failure reports its transport cause.
- **Stack metadata.** The `datasets` scanner pre-buffers whole shards and
  tripped the 64 MiB ceiling before yielding a row, so the worker now lists the
  first shard, reads the footer by suffix range, and fetches one row group per
  exact range through the bounded transport (`bounded_parquet.py`). The
  rebuilt redirect request drops the origin `Host` header; an absent-entry 404
  on the pinned file endpoints passes through body-free for the Hub client's
  no-script detection. FR-028 schema drift fails closed; FR-029 screening skips
  the row but counts it as inspected (`rowsInspected`, charged to the row
  ceiling). The provider schema matches the pinned card (no `filename`),
  `github_id` may be null, `extension` may be empty, and `branch_name` is only a
  non-blank name.
- **GitHub lineage.** A single-parent commit may touch several files; the
  first screenable modification in path order is bound, after a deterministic
  pre-screen of the record's own patch against the excerpt window and diff
  ceiling. Per-file URLs are compared in the provider's percent-encoded form.
  The child side is fetched and screened before any parent request.
- **GitHub admission.** The licence decoder accepts line-wrapped base64
  content.
- **Markers.** A configured marker also matches a Git trailer line that ends in
  exactly one angle-bracket address; the profile additionally lists the
  observed `Co-authored-by: Copilot` and `Co-authored-by: Copilot App` names.
  These two refinements are recorded for the Don's confirmation.

The eighth run admitted three provenance candidates carrying both marker
outcomes and inspected 10,000 rows for each Stack configuration within every
ceiling (about 18.4 MiB and 7 requests per language).

## Deliberately closed boundary

Every Software Heritage blob fetch exits non-zero because AWS rejects the
operator's stored default-profile key (`InvalidClientTokenId` from STS). No
bucket permission question has been reached. WP-028 and WP-034 stay blocked
until the operator supplies an accepted credential; WP-025 and WP-027 wait for
the verified artifact. The server-only loader and operator-pinned trusted hash
for the root route exist and are tested, but `/` intentionally still serves
the synthetic catalogue.

## Fresh verification (2026-10-08)

| Suite | Result |
| --- | --- |
| Workspace unit (`pnpm test`) | 89 files, 2,330 tests, plus 4/4 TAP workspace checks |
| Preparation suite (`ops/poc/prepare`) | 24 files, 366 tests |
| Operator and workspace TypeScript | clean |
| Python workers (locked uv) | 42 tests |
| Accessibility | 37/37 |
| Performance | 6/6 |
| Containment (after production build) | 3/3 |
| Production build | passes |
| Playwright | 13/13 against the local Next dev server |

Playwright's pinned Chromium 1148 was installed on this machine for the run.
The generated artifact and run report remain absent. No token, credential,
account value, repository name, commit identifier, path, message text, or
dataset row is preserved in any evidence or log.

This checkpoint authorizes no merge, deployment, public players, live retry,
or completion claim.
