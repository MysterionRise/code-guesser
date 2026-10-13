---
evidence: three-deck-live-run
observed-at: 2026-10-11T19:41:05.997Z
outcome: success
artifact-published: true
credential-material-recorded: false
---

# Three-deck live run

The fourth live preparation of the three-deck artifact succeeded on
2026-10-11, after the Phase 0 pipeline fixes from the
[state review](../2026-10-11-codeguessr-state-review.md). Each run used the Hugging Face token from the
standard token file and the `gh` CLI's GitHub token, both supplied through the
environment.

## Attempts

| Run | Outcome | Stage line | What it established |
| --- | --- | --- | --- |
| 1 (2026-10-10) | failed closed | `STACK_METADATA WORKER_EXIT` | The Python workers still enforced revision 11's 200 requests and 64 MiB. |
| 2 (2026-10-10) | failed closed | `DISCOVERY GITHUB_SEARCH_REJECTED` | One transient inconsistent search response; a probe afterwards found every query consistent. |
| 3 (2026-10-11) | failed closed | `STACK_METADATA ROW_IDENTITY_REJECTED`, `PREPARATION_SPEND PREFLIGHT=2 STACK_METADATA=21 total=23` | One of 10,000 Rust rows has a root directory whose name starts with a space; Python accepted it and Node's trim rejected it. With Stack metadata now first, the failure spent no GitHub requests. Fixed in `5d334ef` by screening such paths out. |
| 4 (2026-10-11) | success | `PREPARATION_SPEND PREFLIGHT=2 STACK_METADATA=35 DISCOVERY=11 ADMISSION=203 BLOB_RETRIEVAL=133 total=384`, `PREPARATION_COMPLETE` | The three decks published. |

Runs 1 and 2 are recorded in detail in
`docs/gangsta/codeguessr-poc-readiness/evidence/2026-10-10-revision-12-live-run-attempts.md`.
Before run 4, a standalone metadata check of the Rust and Ruby configurations
(7 requests each) found no other row the Node side would reject.

## Result

| Item | Value |
| --- | --- |
| Artifact canonical SHA-256 (preparer = game = report) | `27e117c9b6f7c5c509b22eb220aef211cb3a87b79a92ead099f326b41ed0f018` |
| Crawl snapshot id | `1faac875d1605da5778d4b2b2cb038557b56ad76a4db720a3630957ffb79ea01` |
| Profile hash (`local-real-rounds.v2`) | `4281b23e2a9e40b001a60b4144f0ceb6504132a5e826475dfe3c5d368dae477e` |
| Run report file SHA-256 (ignored file) | `a244ce0b329c4886ffacdfe4899a96c7b9e30737e9ffa1c9b2d82eadcba69f00` |
| Execution id | `036ec72a-34cf-4ea8-a0ae-21d1f9596265` |
| Decks | project, language, ai; five fixtures each |
| Languages | Python, Rust, Ruby, Go, TypeScript |
| AI outcomes | 3 credited, 2 without credit |

## Counts against ceilings

| Counter | Used | Ceiling |
| --- | --- | --- |
| Requests | 384 | 600 |
| GitHub pages / results | 11 / 684 | 3 pages and 300 results per query |
| Stack rows per language | 10,000 each | 10,000 |
| Stack metadata bytes | 87,054,902 | 100,663,296 |
| Blob attempts / retrieved | 12 / 5 | 50 / 50 |
| Blob bytes | 25,660 | 16 MiB |
| Retries / waited | 0 / 0 ms | 5 / 30 s |

Every one of the eight GitHub queries was classified complete. Other counts:
- 10 repositories admitted, 18 candidates screened, 8 GitHub revalidations.
- 0 duplicates rejected, 15 fixtures selected.

The largest rejection aggregates show where requests go:
- 29 Stack rows were from repositories the GitHub screen rejected (`ADMISSION_REPOSITORY`). The repository screen dropped them before any blob fetch.
- 24 `REPOSITORY_REPEATED` skips.
- 14 `LINEAGE_CHANGED_PATH` rejections.
- 11 Stack rows with disallowed licences.

## Independent verification

A separate script re-parsed both files with the v2 models and checked:
- **Hashes:** the preparer and game canonical hashes equal the report's `artifactHash`.
- **Decks:**
  - the deck shapes, and the crawl snapshot shared by every fixture
  - five distinct languages
  - at least two of each AI outcome
  - five distinct project repositories
- **Ceilings and completeness:** every counter within its ceiling, and every query complete.
- **Content:** excerpt bounds of 129–943 bytes, and no token-like strings or email addresses in either file.

All checks passed.

## Public source identities

```text
facebook/openbmc@cc28d6c004b0c071467874bfbb1f5388ade3684c:meta-facebook/meta-netlakenext/recipes-netlakenext/dimm/files/dimm-util-plat.h
facebook/astryx@c5444875af9036b23010e2d1a63698149db9823a:eslint.config.js
facebook/fbthrift@f5468335400642588349998dbdd625d026154635:thrift/lib/java/runtime/src/main/java/com/facebook/thrift/legacy/client/LegacyRpcClientFactory.java
facebook/rebalancer@63e3d79a50cf7ccd853c48964e0263540afe6e47:algopt/rebalancer/solver/moves/MovesEvaluator.h
facebook/idb@fadfbc721f8615fc09a6a7a6ebe3fbb7eb1c59b5:FBSimulatorControl/Framebuffer/FBSimulatorImage.swift
softwarefactory-project/sf-config@c43ee6e7cd069ebdb20d60a4474cbc6de29f6c67:testinfra/test_zookeeper.py
arthurazs/rust-tutorials@707514d63c5313d3394661afdc401c2192b35d46:codes/04christmas.rs
jay16/carder@3d9c8cb763b08ba559a72d1abc36226702d4c4e6:lib/utils/core_ext/module.rb
kubernetes/gengo@9cce18d56c01fab1d8ed72411ad6ef7005fc33a4:examples/defaulter-gen/_output_tests/slices/fake_deepcopy_conversion.go
nebula-42/splychn_aggr@2c3ff53a1b82f21e3980063ba9adb54648b7c11c:FoodSupplyChain/UI/src/app/Steak/Steak.component.spec.ts
github/copilot-sdk@edf11030e5893885508504cfcbae8310b0d528f1:nodejs/src/index.ts
github/copilot-engine-sdk@a4034f81f1d2c6c48129e62009a8a84651730112:src/mcp-server.ts
facebook/BGP@d25420dc6d1e725b618022b0991c2ccb344d1fc9:neteng/fboss/bgp/cpp/peer/PeerManagerBase.h
github/spec-kit@d4ba7536a373782c78ed2429ff845de5dc78f4d8:tests/contract/test_catalog_schema.py
facebook/flow@d869e62558233b2973eeaa1d0479763da46c5250:rust_port/crates/flow_cli/src/status_command.rs
```

All five "Which project?" answers are facebook repositories, as the review
predicted: discovery is ordered by query, so the first ordinary query fills
the deck. Phase 2 addresses this.

## Fresh verification after pinning

| Check | Result |
| --- | --- |
| `pnpm test` | 2,323 / 2,323 across 94 files |
| `pnpm typecheck` | pass |
| Python worker tests | 52 / 52 |
| `pnpm test:e2e` (on `E2E_PORT=3200`; 3000 was taken by an unrelated Docker container) | 18 / 18 |
| `pnpm test:a11y` | 37 / 37 |
| `pnpm test:performance` | 6 / 6 |
| Acquisition containment | 3 / 3 |
| `pnpm --filter @codeguessr/game build` | pass |
