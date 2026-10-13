---
heist: codeguessr-poc-readiness
evidence: live-preparation-attempts
observed-at: 2026-10-08T17:47:42Z
outcome: failed-closed
artifact-published: false
credential-material-recorded: false
---

# Live Preparation Attempts

Under the operator's authorization, eight full `pnpm prepare:poc` runs were made
on 2026-10-08 between 17:06Z and 17:48Z with the operator's Hugging Face token,
the `gh` CLI's GitHub token, the signed Stack acknowledgement, and the AWS
default profile, all supplied through the environment. Each run failed closed
and published nothing. Between runs, every mismatch between the captured
assumptions and the live providers was fixed test-first; the failing stage
moved forward each time until only the Software Heritage credential remained.

| Run | Start (UTC) | Stage line | What it established |
| --- | --- | --- | --- |
| 1 | 17:06:45 | `PREPARATION_FAILED` only | An uncoded invariant failure logged no stage; the command now logs the stage and a safe class for every failure. |
| 2 | 17:11:28 | `ADMISSION INVARIANT_REJECTED` | Zero candidates admitted; selection failures now also log pool counts and aggregated rejection codes. |
| 3 | 17:14:04 | `ADMISSION INVARIANT_REJECTED`, 154/155 `GITHUB_LINEAGE_REJECTED` | Lineage required a one-file commit; aggregate probes found 30 of 155 single-file commits and 3 with a supported extension. |
| 4 | 17:24:57 | 152 lineage rejections | Lineage still rejected after one request; the per-file `blob_url`, `raw_url`, and `contents_url` carry the path percent-encoded with `%2F`. |
| 5 | 17:29:19 | screening codes, 137 `RETRY_SIGNAL_MISSING` | Candidates reached screening; the 200-request ceiling was exhausted after about eighteen candidates and surfaced as a wrapped retry failure. |
| 6 | 17:36:59 | 9 `GITHUB_ADMISSION_REJECTED`, 116 `REQUEST_COUNT` | Pre-screening on the recorded patch saved requests; every candidate reaching admission was rejected by the licence decoder's trim-exact guard on line-wrapped base64. |
| 7 | 17:43:24 | `STACK_METADATA WORKER_EXIT` | Three provenance candidates admitted with both marker outcomes; the metadata worker rejected real rows on two undocumented column relationships. |
| 8 | 17:46:44 | `BLOB_RETRIEVAL BLOB_ATTEMPTS`, 50 `WORKER_EXIT` | Both Stack configurations inspected 10,000 rows each within ceilings; every selected-blob fetch failed. |

## Provider facts observed (aggregates only)

- GitHub discovery returned 155 candidates for the three signed queries (5, 2,
  and 148) and classified all three as complete.
- Of the first 155 commit records, 30 modified exactly one file; 3 of those
  touched a file with a supported extension. Trailer-query commits carry
  `Co-authored-by: Copilot <address>` and `Co-authored-by: Copilot App <address>`
  lines, never the bare configured literals.
- The Hugging Face `resolve` endpoint redirects parquet reads to
  `us.aws.cdn.hf.co` (recorded separately on the same day). The first Python
  shard is 1,476 MiB in 86 row groups; one row group holds 100,260 rows in
  17.3 MiB compressed. Inspecting 10,000 rows per language costs about 18.4 MiB
  and 7 requests per language. Of 10,000 Python rows, 2,817 passed screening;
  of 10,000 TypeScript rows, 3,031.
- The pinned dataset card documents 26 columns and no `filename` column;
  `github_id` is null on rows without a GitHub Archive linkage; `extension` is
  empty for extensionless files; `branch_name` values are not all `refs/`
  prefixed.
- A direct probe of the Software Heritage bucket with the configured AWS
  default profile answered `InvalidAccessKeyId`, and STS answered
  `InvalidClientTokenId` for the same key: AWS does not recognize the
  operator's stored access key. No bucket permission question was reached.

## Boundary

Every fix stayed inside the signed Contract: no ceiling was raised, no
fail-closed rule was removed, and screening remained a gate on which candidates
may proceed. Two refinements are recorded for the Don's confirmation: a
configured marker also matches a Git trailer line that ends in exactly one
angle-bracket address, and the profile lists the observed Copilot trailer names
in addition to its original literals.

No token, credential, account identifier, repository name, commit identifier,
path, message text, response body, or dataset row is preserved in this
evidence.
