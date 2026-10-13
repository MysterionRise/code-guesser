---
evidence: v4-stack-growth-run
observed-at: 2026-10-13
outcome: success
artifact-published: true
credential-material-recorded: false
---

# Phase 3a: grow The Stack v2

The first runs under profile `local-real-rounds.v4` on 2026-10-13. They carry
out the first half of roadmap Phase 3 in the
[state review](../2026-10-11-codeguessr-state-review.md): more Stack v2 rows
and languages. The second half, the next sources, is planned in
[the next-sources plan](../2026-10-13-next-sources-plan.md).

## What the layout probe found

Before the change, a count-only probe read each shard's parquet footer (one
64 KiB tail per language, no rows). Every language's first shard is split into
row groups of about 100,000 rows and 17 to 19 MB.

The worker fetched a whole row group to keep only its first 10,000 rows, so
90% of the downloaded metadata went unused. Reading all 100,000 rows of that
same group costs the same bytes and gives ten times the rows.

| Language | Shards | Row groups in shard 0 | Rows in group 0 | Group 0 bytes |
| --- | --- | --- | --- | --- |
| Python | 9 | 86 | 100,260 | 18.1 MB |
| Ruby | 4 | 80 | 100,269 | 17.5 MB |
| JavaScript | 18 | 87 | 100,304 | 18.1 MB |
| Java | 26 | 82 | 100,078 | 19.1 MB |
| Kotlin | 2 | 58 | 100,279 | 18.1 MB |
| C | 4 | 80 | 100,083 | 16.9 MB |
| C++ | 7 | 85 | 100,404 | 17.7 MB |
| C# (`data/C-Sharp`) | 10 | 79 | 100,316 | 18.7 MB |
| Swift | 2 | 51 | 100,471 | 18.0 MB |

The footers' statistics give each directory's `language` value: `C#`, `C++`,
`C`, `JavaScript`, `Kotlin`, `Swift`, `Java`.

## What changed

- **Rows:**
  - Each language's whole first row group (100,000 rows) is inspected and
    validated.
  - The worker returns a bounded sample instead of every row:
    - the 24 most-starred repositories, 3 files each;
    - one file from each of 200 other repositories;
    - licences on the allowlist only.
  - Node checks that the output is exactly that sample (`SAMPLE_REJECTED`
    otherwise).
  - The journal stays small: 66 MB for twelve languages.
- **Languages:** twelve, in six look-alike pairs:
  - Python and Ruby
  - TypeScript and JavaScript
  - Go and Rust
  - Java and C#
  - Kotlin and Swift
  - C and C++
- **Which language?** 24 rounds, two per language.
  - **Options:** each round offers its answer's pair and one more pair. The
    pairs sit in a private cycle, so each option set holds four rounds whose
    answers are its four languages, and each language is offered in exactly
    eight rounds.
  - **Look-alike screen:** a round must show syntax that tells its language
    from its look-alike (`language-markers.ts`). A superset language (C++,
    TypeScript) needs only its own syntax. A subset language (C, JavaScript)
    must show none of the superset's.
  - **Hints:** the second hint names that syntax.
- **Which project?** 24 rounds, two per language. Each language's four
  repositories, answers and decoys, appear in that language's rounds only,
  so every option appears exactly twice.
- **Ceilings** (`ops/poc/limits.json`):

  | Ceiling | Value |
  | --- | --- |
  | Stack rows per language | 100,000 |
  | Stack metadata | 256 MiB |
  | Requests | 3,000 |
  | Blob attempts | 240 |
  | Successful blobs | 120 |

## Runs

| Run | Command | Result | What it found |
| --- | --- | --- | --- |
| 9 | `--resume` | `STACK_METADATA WORKER_EXIT_PATH_REJECTED` | One TypeScript row's path holds a backslash. It is now screened out as data, not treated as schema drift. |
| 10 | `--resume` | `SELECTION PUBLIC_CONTAINMENT_CANDIDATE_IN_CLUES` | A `github/…` repository was an option, and the hint says "GitHub star events". Repositories named by the deck's own wording are now skipped (`PROJECT_NAMED_BY_TEMPLATE`). |
| 10o | `--offline` | published two decks | A journal miss inside one candidate counted as a rejection, so the replay quietly skipped a deck. A journal miss now fails the run. |
| 11, 12 | `--resume` | `SELECTION EXPERIMENT_RECORD_REJECTED` | A repository description says "object detection", and the authorship-claim guard from the AI deck banned the word. The guard now targets AI and authorship detection. 12 also recorded the failures runs 9 to 11 had left out of the journal. |
| 13 | `--resume` | three decks | Reading the rounds found two problems. The graphql-ruby round's code said `module GraphQL`, so name parts such as `graphql` now count. A C++ `public:` label produced the colon hint, so the block hint now follows the language's own style. |
| 14 | `--resume` | three decks | Reading again found next.js offered in three languages' rounds and never as the answer. Each repository is now an option in one language only. |
| 15 | `--resume` | the published artifact | `replayed=1052 live=22`; offline rebuild byte-identical (`replayed=1074 live=0`). |

The journal now also records failures:

- **What is recorded:** HTTP refusals, 5xx answers, timeouts, and a worker's
  coded exit, for offline replay only.
- **Replay:** an offline rebuild reproduces a live run exactly, while
  `--resume` retries those failures live.
- **Precedence:** a recorded answer outranks a failure kept for the same
  request.

## Result

| Item | Value |
| --- | --- |
| Artifact canonical SHA-256 (written to the pin by the preparer) | `ba7ce4346ca492c5791eb64da220441443f780822ef9257fb8df5bd47a2fc3af` |
| Crawl snapshot id | `7567f412816dc31db3b5a49cc023d07ab87591a37ff9e868be53d41f1daba74b` |
| Profile hash (`local-real-rounds.v4`) | `ec02e06f69fc61741c344b3e4af820d5c232dc5c1aee1d9359634c60fa7425c5` |
| Decks | project 24, language 24, before-after 10; a game deals five |
| Requests | 1,146 of 3,000 (`STACK_METADATA=84 DISCOVERY=14 ADMISSION=208 BLOB_RETRIEVAL=838`) |
| Stack metadata | 215,618,797 bytes; 100,000 rows per language |
| Blobs | 99 attempts, 48 retrieved, 641,438 bytes |
| Retries and waits | none |

## What the decks hold

**Which project?** Options per language; the first two are each language's
answers:

| Language | Repositories |
| --- | --- |
| Python | transformers, scikit-learn; scrapy, TheAlgorithms/Python |
| Ruby | aws-doc-sdk-examples, activeadmin; CocoaPods, h2o |
| TypeScript | angular, ant-design; next.js, deno |
| JavaScript | three.js, gatsby; cypress, parcel |
| Go | tidb, lazygit; kubernetes, gin |
| Rust | tailwindcss, rustlings; alacritty, selenium |
| Java | spring-boot, spring-framework; RxJava, guava |
| C# | roslyn, maui; aspnetcore, openapi-generator |
| Kotlin | lottie-android, leakcanary; expo, supabase |
| Swift | jitsi-meet, lottie-ios; RxSwift, vapor |
| C | OpenCorePkg, pyenv; redis, chromium |
| C++ | ClickHouse, electron; opencv, PaddleOCR |

**Which language?** Two rounds per language from repositories below 1,000
star events. Each second hint names the syntax that settles the round:

| Language | Hints |
| --- | --- |
| Python | `True`, `False` |
| Ruby | `end` |
| TypeScript | `interface`, `: string` |
| JavaScript | `module.exports`, `var` |
| Go | `:=`, `func` |
| Rust | `fn` |
| Java | `final`, `extends` |
| C# | `readonly`, `override` |
| Kotlin | `val`, `fun` |
| Swift | `func` |
| C | `NULL`, `(void)` |
| C++ | `::` |

**Before or after?** Unchanged from v3: ten refactor commits from kubernetes,
google, facebook, microsoft, and vercel. The later version is pane A in five
rounds.

The `deck-leakage` test runs against this artifact. Every solver that never
reads the code stays within chance plus ten points:

- same option set
- most frequent option, and now least frequent
- has a description
- always one pane
- the new "look-alike offered" solver

## Public source identities

```text
huggingface/transformers@4fa0aff21ee083d0197a898cdf17ff476fae2ac3:examples/research_projects/xtreme-s/run_xtreme_s.py
jitsi/jitsi-meet@0170c65c7b84979df5b74634134b4e93b0a35c4e:ios/app/broadcast-extension/SampleUploader.swift
awsdocs/aws-doc-sdk-examples@dec41fb589043ac9d8667aac36fb88a53c3abe50:ruby/example_code/sqs/tests/test_send_message_batch.rb
mrdoob/three.js@6a101b4bffdf5b00d24931c2e50817d3a179fa25:examples/jsm/nodes/lighting/HemisphereLightNode.js
pingcap/tidb@c7d55079c2c207abe5638c0400d76b35e7a6d903:executor/infoschema_reader.go
dotnet/roslyn@32d94614c9c4095faa885d8da558c2010d8ae9e4:src/Features/Core/Portable/AddImport/SearchScopes/MetadataSymbolsSearchScope.cs
jesseduffield/lazygit@fc6008fdff405044bd089dc59cda15f92f39e079:pkg/gui/presentation/reflog_commits.go
dotnet/maui@972b15ed45db627596b3ec0dd206e74624d3689f:src/Core/src/Platform/ImageSourcePartLoader.cs
spring-projects/spring-boot@b1547d0139050ae1517ec6fc37b098d437332022:spring-boot-project/spring-boot-docker-compose/src/main/java/org/springframework/boot/docker/compose/core/ImageName.java
gatsbyjs/gatsby@fd8de341684df7aa5fcd911a25786beac471925c:examples/sitemap/src/templates/template-blog-post.js
airbnb/lottie-ios@283a303fd461c7986481fc9834448a2f783e127e:Sources/Private/Model/DictionaryInitializable.swift
activeadmin/activeadmin@a6d8d453cab58123b77c3dce3a275f45f7c78ccb:spec/support/rails_template.rb
tailwindlabs/tailwindcss@00e73b088191856c4313f28662ce61222cf4a0de:oxide/crates/core/src/utility.rs
spring-projects/spring-framework@759e3d4aa6e4e8154f6428e496275bcd89431bba:spring-expression/src/main/java/org/springframework/expression/ConstructorResolver.java
airbnb/lottie-android@34aa06b8db75976f06b134b4fdcdb7dc26e48e07:sample-compose/src/main/java/com/airbnb/lottie/sample/compose/player/ToolbarChip.kt
ClickHouse/ClickHouse@6649328db809d51a694c358571539bc5820464be:src/Processors/Formats/Impl/JSONObjectEachRowRowOutputFormat.cpp
angular/angular@eab92167e5e35e10d7618d252be3bd2ba673aa8d:packages/forms/src/form_builder.ts
electron/electron@0b0707145b157343c42266d2586ed9413a1d54f5:shell/browser/ui/webui/accessibility_ui.cc
scikit-learn/scikit-learn@061f8777b48e5491b0c57bb8e0bc7067c103079d:examples/mixture/plot_gmm_selection.py
acidanthera/OpenCorePkg@1d5b1736fe5a5ef7662b5c076c6d11aac96fd5d6:Staging/AudioDxe/HdaCodec/HdaCodec.c
square/leakcanary@e798d5c099c53b6d44356f461133cc80d1367017:shark/shark-hprof/src/main/java/shark/StreamingRecordReaderAdapter.kt
pyenv/pyenv@91002438663065266207ab74de7e37d6ab8f3890:src/realpath.c
rust-lang/rustlings@2d1da2ab57080e32725612ffddb82006f47f7f71:exercises/conversions/try_from_into.rs
ant-design/ant-design@f0c105d262094550bf5aca8c4d26156a52e865d8:components/locale/ur_PK.ts
joanapalero/top_artists-cli_project@53f71d93571c3606958b305f61dfbd23059bda88:spec/top_artists_spec.rb
jbrwn/URISerializer@42eaa5bd3b98cee072fbe722272c83299a2a64e4:URISerializer/URISerializer.cs
bd-dev-mobileum/presto@c5045aab6fefefe92be3f43149eed9dd187c7892:presto-main/src/main/java/com/facebook/presto/metadata/Split.java
Stefantb/CMakeTools@3fd909e0d45034180e8cf97d73779468c555368f:clear_cache.py
ProgBiss/Sudoku@d583e2f389dc08af4a907d81ce7d6adfe2e12211:src/Fonctions/FinPartie.py
Samsung/Castanets@4896f732fc747dfdcfcbac3d442f2d2d42df264a:extensions/browser/api/bluetooth_socket/bluetooth_socket_apitest.cc
owl-go/rust-learn@f40e0930353b852a38a0b85179f853f7adc8fb00:minigrep/src/lib.rs
knieriem/asset@2e3c6b42235c4128a6fe8b714ddcc2cbc054c61d:asset.go
intel/zephyr@06d5bc51b580777079bb0b7e769e4127598ea5ee:tests/bluetooth/host/keys/bt_keys_store/src/main.c
0rlanne/Login2_swift@beab893c869303614cf91f1bc5f2a51f259c6de5:Yumi/SceneDelegate.swift
BlueLightning42/expresso-logic-minimizer-cpp@bb834d2b083241d30b2f6d4441375b8a82c7df4b:expresso-cpp-bridge/espresso-src/cols.c
aneldev/dyna-currencies@17f0b343f08d7a38a0781bda7d1799c1a14ef63c:src/DynaCurrencies.ts
kurotaky/resource_name_validator@acc53fc32b3353809a2a81cf7f2dda50bf0b08f8:lib/active_model/validations/resource_name_validator.rb
datopian/montreal-city-indicators@632c6b61d8a8c032ccf590e511ff57d992974277:routes/dms.js
icota/lightninglib@4b54b5815565776cb535583686208c7c917ed35f:lnwallet/sigpool.go
ytabuchi/CollectionViewSample@4f7bfd0b49484fe2927fd33ed9c22f2880d1bf92:CollectionViewSample/CollectionViewSample/CollectionViewSample.Android/MainApplication.cs
paritytech/scale-info@ec8d941c35001a49f6ff01dd4fa6d5f1709720a6:derive/src/lib.rs
jasonterando/vscode-php-tdd@19bfb20aa21bea5e7576630e1f5b3094d57711b8:src/test/suite/unit/vs-code-document-shim-mock.ts
ZhuHui19921129/DouYuZB@e22ec124cfec21497b558d4e99bf2c078f6c60ea:DYZB/DYZB/Classes/Main/ViewModel/BaseViewModel.swift
sebastiansokolowski/mHealth-Guard@5c164405abb457b91f04b15ff04ef1702cee6a54:wear/src/test/java/com/sebastiansokolowski/healthguard/model/healthGuard/engine/HeartRateAnomalyEngineTest.kt
LinkerpadStartup/Linkerpad-phase0-@49b1645da41de6b631e3d526f44970449151baa5:app/src/main/java/com/linkerpad/linkerpad/Fragments/DocumentsFragment.kt
adligo/fabricate_tests.adligo.org@b2d2c80d2c6fb84338fb1c1599888629b348abe0:src/org/adligo/fabricate_tests/models/dependencies/LibraryDependencyTrial.java
sola-da/LambdaTester@f993f9d67eab0120b14111be1a56d40b4c5ac9af:experiments/some/someGen/test789.js
ori-sky/ibotpp@8480a69a7fe9e8c4148cc8b75cadfecffcc7415d:src/main.cpp
kubernetes/cloud-provider-gcp@5061e49e4c053dbabb2058942d751c855bc3354a:cmd/cloud-controller-manager/gkenetworkparamsetcontroller.go
google/adk-go@f322a15f976f402991afd8e5d7e709aa7771ea07:examples/workflow/complex/main.go
facebook/astryx@c5444875af9036b23010e2d1a63698149db9823a:eslint.config.js
google/cybernetic-agent-governance-engine@5b81b85a068e543256d5e18276b053aa40db7178:src/integrations/__init__.py
microsoft/agent-framework@61d6c2c23db5d435eaa8c70fa8e5d8770b70720d:python/packages/ag-ui/agent_framework_ag_ui/_snapshot_session.py
kubernetes/autoscaler@5dd768a9f0ab95c4b69521d460208c7e8bcb9d31:vertical-pod-autoscaler/pkg/recommender/routines/recommender_controller.go
kubernetes/node-problem-detector@b0a0ec554d2dbb75bb7e091a749d3a7a2ae4a207:pkg/problemmetrics/problem_metrics.go
google/adk-kotlin@f9dc339b47b12d79047aff1dca6dc46ebbcc1706:core/src/jvmMain/kotlin/com/google/adk/kt/tools/mcp/McpToolset.kt
facebook/rebalancer@63e3d79a50cf7ccd853c48964e0263540afe6e47:algopt/rebalancer/solver/moves/MovesEvaluator.h
vercel/eve@32d298467691e3703e0314611c53aa8a44652334:apps/benchmarks/evals/author-007-digest-schedule/CASE.ts
```
