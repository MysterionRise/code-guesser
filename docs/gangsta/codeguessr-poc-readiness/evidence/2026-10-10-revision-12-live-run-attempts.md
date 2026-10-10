---
heist: codeguessr-poc-readiness
evidence: revision-12-live-run-attempts
observed-at: 2026-10-10T12:30:00Z
outcome: failed-closed
artifact-published: false
credential-material-recorded: false
---

# Revision 12 Live Run Attempts

## Attempt 1 (2026-10-10, operator-run)

The operator ran `pnpm prepare:poc` once with the Hugging Face token from the
standard token file, the `gh` CLI's GitHub token, and the signed Stack
acknowledgement, all supplied through the environment. GitHub preflight,
discovery, lineage, and admission completed; the run then failed closed at the
first Stack configuration and published nothing. The revision 11 artifact and
its pin stayed in place.

```text
PREPARATION_STAGE_FAILED STACK_METADATA WORKER_EXIT none
PREPARATION_FAILURE_SITE collectStackMetadata@stack-metadata.ts
PREPARATION_FAILED
```

### Root cause

Revision 12 raised two signed ceilings: requests per run from 200 to 600 and
Stack metadata bytes from 64 MiB to 96 MiB. The Node orchestrator and the v2
profile carried the new values, but the Python workers still enforced the
revision 11 values as their own hard maxima (`MAXIMUM_REQUESTS = 200` in
`stream_metadata.py`, `bounded_http.py`, and `fetch_blob.py`;
`MAXIMUM_NETWORK_BYTES = 64 MiB` in the first two). The metadata worker
therefore rejected its request before any network access, with
`REQUEST_LIMIT_REJECTED` when more than 200 requests remained and
`NETWORK_LIMIT_REJECTED` for any budget above 64 MiB, and exited non-zero.
The selected-blob worker would next have answered `LIMIT_RAISED` for the same
reason. The orchestrator suites replace both workers with stubs, so no offline
test crossed this seam.

Reproduced offline, without network access, by handing the worker's request
parser the budgets the orchestrator sends.

### Fix

- The three Python workers' maxima now equal the signed revision 12 ceilings
  exactly (600 requests, 96 MiB metadata). No other maximum changed.
- `ops/poc/stack/test_signed_ceilings.py` reads the signed v2 profile and fails
  if any worker maximum (rows, per-blob bytes, requests, metadata bytes,
  temporary disk, blob attempts, successful blobs, total blob bytes) or the
  configured language list differs from it.
- The boundary tests now accept 600 requests and 96 MiB and reject 601 and
  96 MiB plus one byte.

### Metadata headroom

The first row group of each configured language's first shard is 17.3 MiB
(Python), 17.3 MiB (TypeScript), 15.9 MiB (Go), 14.6 MiB (Rust), and 16.7 MiB
(Ruby), about 81.8 MiB together. Revision 11 observed about 1.1 MiB of listing
and footer overhead per language, so the expected total is about 87 MiB
against the 96 MiB ceiling.

## Attempt 2 (2026-10-10, operator-run, after commit `7eb7836`)

The operator ran the same command again about an hour later. It failed closed
during discovery, before any lineage, admission, or Stack request, and
published nothing.

```text
PREPARATION_STAGE_FAILED DISCOVERY GITHUB_SEARCH_REJECTED none
PREPARATION_FAILURE_SITE crawlGitHubCommitSearch@github-search.ts
PREPARATION_FAILED
```

Attempt 1 had passed the same discovery code with the same eight signed
queries. Every search check (response shape, `incomplete_results`, result and
page ceilings, a stable total across pages, exact item counts, identity and
URL binding, committer dates, and duplicate identities) threw the same
`GITHUB_SEARCH_REJECTED` code, so the log could not say which one fired.

### Read-only probe after the attempt

A diagnostic script replayed the eight signed queries with the same
parameters and applied the same checks, printing counts only (11 requests),
then counted committer-date ties around the page boundaries of the three
two-page queries (6 requests). Every query passed every check:

| Query | Total | Pages | Incomplete | Items per page |
| --- | --- | --- | --- | --- |
| `ai-copilot-github` | 62 | 1 | false | 62 |
| `ai-copilot-microsoft` | 49 | 1 | false | 49 |
| `ai-claude-github` | 35 | 1 | false | 35 |
| `ai-claude-vercel` | 85 | 1 | false | 85 |
| `ordinary-facebook` | 148 | 2 | false | 100, 48 |
| `ordinary-google` | 121 | 2 | false | 100, 21 |
| `ordinary-vercel` | 65 | 1 | false | 65 |
| `ordinary-github` | 119 | 2 | false | 100, 19 |

No page boundary falls inside a committer-date tie, so unstable ordering
between pages is not the expected cause. Attempt 2 most likely met one
transient inconsistent search response; the evidence cannot say which check
it failed.

### Diagnostics change

Each search rejection now carries a specific code that the stage line logs in
place of the generic message: `GITHUB_SEARCH_SHAPE`, `GITHUB_SEARCH_IDENTITY`,
`GITHUB_SEARCH_DATE`, `GITHUB_SEARCH_INCOMPLETE`,
`GITHUB_SEARCH_RESULT_CEILING`, `GITHUB_SEARCH_TOTAL_CHANGED`,
`GITHUB_SEARCH_PAGE_CEILING`, `GITHUB_SEARCH_ITEM_COUNT`, or
`GITHUB_SEARCH_DUPLICATE`. Every check and its fail-closed outcome are
unchanged.
