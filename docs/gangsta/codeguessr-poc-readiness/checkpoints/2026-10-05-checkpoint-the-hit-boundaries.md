---
heist: codeguessr-poc-readiness
phase: the-hit
status: blocked
timestamp: 2026-10-05T17:30:00Z
next-action: Operator authorizes one Hugging Face resolve observation (redirect target host only), the host is allowlisted test-first on both sides, then the combined live run resumes under WP-034
completed-wps: [WP-001, WP-002, WP-003, WP-004, WP-005, WP-006, WP-007, WP-008, WP-009, WP-010, WP-011, WP-012, WP-013, WP-014, WP-015, WP-016, WP-017, WP-018, WP-019, WP-020, WP-021, WP-022, WP-023, WP-024, WP-026, WP-030, WP-031, WP-032, WP-033, WP-035]
pending-wps: [WP-025, WP-027, WP-029]
blocked-wps: [WP-028, WP-034]
failed-wps: []
artifacts:
  - README.md
  - CLAUDE.md
  - LICENSE
  - .github/workflows/ci.yml
  - ops/poc/prepare/report-store.ts
  - ops/poc/prepare/blob-worker.ts
  - ops/poc/stack/bounded_http.py
  - docs/gangsta/codeguessr-poc-readiness/specs/2026-08-15-contract-revision-11-signed.md
  - docs/gangsta/codeguessr-poc-readiness/reviews/2026-09-04-handoff-audit.md
---

# The Hit: Boundary Fixes and GitHub Probe

The signed Contract remains exact at SHA-256
`3acc586d8fb479e6edfd2dd43e9f38ed5d8d6268ee5b025b449d3a564b32fe41`. No
Contract text changed. Work continued on `claude/clever-curie-d7rv1m` from
the merged handoff on `main`.

## Audit blockers closed (WP-010, WP-019, WP-023 return to completed)

Every change below followed Red-Green-Refactor with a failing regression test
first.

- **Transactional publication (WP-023).** The run report is staged beside its
  target, committed from inside the artifact publisher's new `beforeCommit`
  hook while the previous artifact's backup still exists, and rolled back on
  any publication failure. A report-commit failure restores the previous
  artifact through the existing backup path. Tests: `report-store.test.ts`,
  `artifact-store.test.ts`, `command.test.ts`, `integration.test.ts`.
- **Worker ceilings (WP-010, WP-019).** The preparer hands both Python workers
  the remaining request, network-byte, and temporary-disk budgets and requires
  a canonical counters trailer, charging reported requests, bytes, and peak
  temporary disk against the signed ceilings through `recordWorkerRequests`,
  `recordStackRows`, and the previously uncalled `reserveTemporaryDisk`. The
  metadata worker installs a bounded httpx transport as the Hub client factory
  (exact hosts and endpoint families, HTTPS GET/HEAD only, credential-like
  query rejection, request and byte metering, no retryable status or transport
  exception surfaced to the Hub backoff loop, at most one redirect to an exact
  allowlisted host with origin credentials stripped, Hub hardening environment,
  32 MiB cache metering). The blob worker pins the Software Heritage endpoint,
  region, signature version, timeouts, and a single attempt, and its
  before-send guard allows exactly one GET per object to the exact bucket host
  and key path with no query. Tests: `test_bounded_http.py`,
  `test_stream_metadata.py`, `test_fetch_blob.py`, `stack-metadata.test.ts`,
  `blob-worker.test.ts`, `capacity.test.ts`.

## Further defects found and closed

- **Production could never retry.** The retry controller acted only on a
  signal no production code emitted, and the transport rejected every non-2xx
  before reading headers. The transport now translates a GitHub 403/429 with
  an integer `retry-after`, or an exhausted rate-limit budget with a future
  reset, into the controller's one bounded retry without reading the body;
  absent instructions still fail closed and malformed or elapsed ones surface
  as malformed. Diagnostics keep only the status class, as NFR-012 requires.
- **Opaque failure.** The command logged only `PREPARATION_FAILED`. It now
  also logs `PREPARATION_STAGE_FAILED <stage> <reason-code> <status-class>` for
  coded failures, never a body, URL, message, or credential.
- **Audit-chain race.** Each append captures the chain length its handle last
  observed before any I/O and conflicts deterministically; `read()` refreshes
  the head. Twenty consecutive runs of the concurrency test passed.

## Repository hygiene

MIT `LICENSE`, the manifest `license` field, a GitHub Actions workflow pinning
Node 20.18.0, pnpm 9.15.9, and the locked uv environment across every
verification suite, and the README badge. The workflow needs no provider
secrets and never runs live preparation.

## Authorized GitHub probe

One GET to `api.github.com/search/commits` for query
`microsoft-generated-trailer`, headers only, body discarded unread, no retry:
HTTP 200, authentication supplied, rate limit not exhausted, no retry delay.
The token and proxy were the session's, not the operator's, and the proxy
appears to strip rate-limit headers, so this does not reproduce the operator's
2026-08-29 conditions; it establishes that the endpoint and query are live.

## Deliberately closed boundary

The Contract requires exact redirect target hosts. The host that Hugging Face
parquet reads redirect to has never been observed under authorization, so the
metadata worker's `REDIRECT_HOSTS` ships empty and a live metadata stage will
fail closed with `REDIRECT_REJECTED`. Recording that host is the next external
action; WP-028 and WP-034 stay blocked until it is allowlisted on both sides.

## Fresh verification (2026-10-05)

| Suite | Result |
| --- | --- |
| Workspace unit (`pnpm test`) | 87 files, 2,307 tests, plus 4/4 TAP workspace checks |
| Preparation suite (`ops/poc/prepare`) | 24 files, 356 tests |
| Operator and workspace TypeScript | clean |
| Python workers (locked uv) | 34 tests |
| Accessibility | 37/37 |
| Performance | 6/6 |
| Containment (after production build) | 3/3 |
| Production build | passes |
| Playwright | 13/13 against the local Next dev server |

Playwright's pinned Chromium build is absent from this sandbox; the browser
run used a throwaway configuration pointing at the sandbox's Chromium 141 and
the repository configuration is unchanged. Scoped credential and
Gangsta-identifier scans of changed source files are clean. The generated
artifact and run report remain absent; `pnpm prepare:poc` was not run because
this session has no Hugging Face or Software Heritage credentials and the
Contract requires operator authorization.

This checkpoint authorizes no merge, deployment, public players, live retry,
or completion claim.
