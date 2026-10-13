---
heist: codeguessr-poc-readiness
evidence: combined-live-run
observed-at: 2026-10-08T18:58:56Z
outcome: success
artifact-published: true
artifact-hash: 0eab7f489f311125b9a1ae8574fd2a3b072c3c954e48c8284aac39559a607498
crawl-snapshot-id: 9249eb590064490285f5f799acabb3fe56edf436fdc1d5b712262c99ca083713
profile-hash: 3264ea6771b9dcad6bf28751b290388f0d0d238c73fd64eb9ac87bdbfb4ecd40
credential-material-recorded: false
---

# Combined Live Run (WP-028 / WP-034)

The fourteenth authorized `pnpm prepare:poc` run of 2026-10-08 completed at
18:58:56Z with `PREPARATION_COMPLETE`, preceded by the signed warning
`GITHUB_SEARCH_INCOMPLETE`. It published
`apps/game/src/demo/generated/local-real-rounds.json` and the redacted run
report atomically. Credentials were the operator's Hugging Face token and the
`gh` CLI's GitHub token, supplied through the environment; Software Heritage
blobs were read anonymously. No credential value is recorded anywhere.

## Independent verification

A verifier outside the preparer re-read both files and confirmed:

| Check | Result |
| --- | --- |
| Canonical artifact hash (preparer form) equals the report's `artifactHash` | `0eab7f48…a607498` |
| Game-authority canonical hash equals the preparer's | identical |
| SHA-256 of the published file bytes | identical (the file is canonical) |
| `crawlSnapshot.id` equals the report's `crawlSnapshotId` | `9249eb59…083713` |
| `profileHash` equals the canonical hash of `local-real-rounds.v1` | `3264ea67…4ecd40` |
| Fixture kinds | PROVENANCE, PROVENANCE, PROVENANCE, LANGUAGE, LANGUAGE |
| Language rounds | one Python, one TypeScript |
| Stack pin | release `v2.2.0`, revision `e565caa3a78c2423bd374333a472b049eb090e47` |
| Excerpt sizes (bytes) | 903, 297, 186, 1117, 844 (bounds 64 to 4096) |
| Token-like strings in artifact or report | none |

## Bounded counts (all within the signed ceilings)

| Measure | Observed | Ceiling |
| --- | --- | --- |
| Requests | 112 | 200 |
| GitHub pages / results | 4 / 155 | 3 per query / 300 per query |
| Stack rows inspected | 10,000 Python, 10,000 TypeScript | 10,000 per language |
| Stack metadata bytes | 36,816,744 | 67,108,864 |
| Blob attempts / retrieved | 8 / 2 | 50 / 50 |
| Blob bytes | 57,079 | 16,777,216 |
| GitHub response bytes | 3,402,815 | 8,388,608 per response |
| Retries / waited | 0 / 0 ms | 3 / 30,000 ms |
| Temporary disk | 0 | 33,554,432 |

Query classifications bound to this artifact hash and crawl snapshot:
`microsoft-generated-trailer` = PROVIDER_REPORTED_INCOMPLETE (the accepted
warning), `github-generated-trailer` = COMPLETE, `facebook-ordinary-change` =
COMPLETE; both Stack configurations COMPLETE. An accepted warning is not
evidence of a complete GitHub population.

Rejections recorded in the report: 7 lineage rejections at discovery, 5
revalidation rejections and 1 unsupported status at GitHub revalidation, 2
licence screenings before blob retrieval.

## Public source identities

The five fixtures bind, in artifact order:

1. `microsoft/vscode@8a1d44aaf1bbe88cbd8dc4aed3ff5b5c8b874b9e` —
   `src/vs/sessions/contrib/chat/browser/responseSelectionResolver.ts`
   (provenance, marker recorded)
2. `facebook/flow@d869e62558233b2973eeaa1d0479763da46c5250` —
   `rust_port/crates/flow_cli/src/status_command.rs` (provenance, marker not
   recorded)
3. `facebook/rebalancer@63e3d79a50cf7ccd853c48964e0263540afe6e47` —
   `algopt/rebalancer/solver/moves/MovesEvaluator.h` (provenance, marker not
   recorded)
4. `softwarefactory-project/sf-config@c43ee6e7cd069ebdb20d60a4474cbc6de29f6c67`
   — `testinfra/test_zookeeper.py` (language, Python)
5. `WILLIAMHIDALGO/Saleor@9f08de1cc962c91f15a944a32bffc88d8c108218` —
   `saleor/static/dashboard-next/orders/types/OrderCreateFulfillment.ts`
   (language, TypeScript)

Every source is a public repository with an allowlisted licence and recorded
author data, revalidated against immutable GitHub records. The trusted hash
above is recorded by the operator in
`apps/game/src/demo/local-real-experiment.pin.server.ts`; the preparer never
writes it.

This evidence makes no complete-population claim and authorizes no public
play. No token, credential, account value, response body, dataset row, or
source excerpt is preserved here.
