---
heist: codeguessr-poc-readiness
evidence: revision-12-feasibility
observed-at: 2026-10-08T19:35:00Z
credential-material-recorded: false
---

# Revision 12 Feasibility Observation

Read-only, count-only probes under the operator's existing live-run
authorization sized the three proposed decks. GitHub commit-search probes
requested one result per query and kept only `total_count` and
`incomplete_results`. Stack probes listed configurations and read only the
first shard's parquet footer for each language; no row was read.

## GitHub commit-search populations

| Query | Results | Complete |
| --- | --- | --- |
| `"Co-authored-by: Copilot" org:microsoft committer-date:2026-09-01..2026-09-07 merge:false is:public` | 1,734 | yes, over the 300 ceiling |
| `"Co-authored-by: Copilot" org:microsoft committer-date:2026-09-01..2026-09-02 merge:false is:public` | 717 | yes, over the ceiling |
| `"Co-authored-by: Copilot" org:github committer-date:2026-09-01..2026-09-07 merge:false is:public` | 324 | yes, over the ceiling |
| `"Co-authored-by: Copilot" org:github committer-date:2026-09-01..2026-09-30 merge:false is:public` | 1,433 | yes, over the ceiling |
| `"Co-authored-by: Copilot" org:{vercel,google,facebook} committer-date:2026-09-01..2026-09-07 merge:false is:public` | 0 each | yes |
| `"Co-Authored-By: Claude" org:microsoft committer-date:2026-09-01..2026-09-07 merge:false is:public` | 101 | no |
| `"Co-Authored-By: Claude" org:github committer-date:2026-09-01..2026-09-07 merge:false is:public` | 10 | yes |
| `"Co-Authored-By: Claude" org:vercel committer-date:2026-09-01..2026-09-07 merge:false is:public` | 14 | yes |
| `"Co-authored-by: Copilot" org:github committer-date:2026-09-01 merge:false is:public` | 62 | yes |
| `"Co-authored-by: Copilot" org:microsoft committer-date:2026-09-06 merge:false is:public` | 49 | yes |
| `"Co-Authored-By: Claude" org:github committer-date:2026-09-01..2026-09-30 merge:false is:public` | 42 | yes |
| `"Co-Authored-By: Claude" org:vercel committer-date:2026-09-01..2026-09-30 merge:false is:public` | 85 | yes |
| `refactor org:microsoft committer-date:2026-09-06 merge:false is:public` | 5 | yes |
| `refactor org:google committer-date:2026-09-01..2026-09-07 merge:false is:public` | 121 | yes |
| `refactor org:vercel committer-date:2026-09-01..2026-09-30 merge:false is:public` | 119 | yes |
| `refactor org:github committer-date:2026-09-01..2026-09-07 merge:false is:public` | 20 | yes |
| `refactor org:facebook committer-date:2026-07-01..2026-07-31 merge:false is:public` | 148 | yes |

The revision 11 discovery pool held 155 candidates from 28 distinct
repositories.

## Stack v2 first-shard geometry at revision `e565caa3a78c2423bd374333a472b049eb090e47`

The pinned revision lists 658 language configurations.

| Language | Shards | First shard | Row groups | Rows in group 0 | Group 0 compressed |
| --- | --- | --- | --- | --- | --- |
| Python | 9 | 1,476.3 MiB | 86 | 100,260 | 17.3 MiB |
| TypeScript | 5 | 1,232.0 MiB | 72 | 100,359 | 17.3 MiB |
| JavaScript | 18 | 1,494.4 MiB | 87 | 100,304 | 17.2 MiB |
| Go | 2 | 1,271.5 MiB | 80 | 100,051 | 15.9 MiB |
| Rust | 1 | 516.0 MiB | 36 | 100,308 | 14.6 MiB |
| Java | 26 | 1,485.5 MiB | 82 | 100,078 | 18.3 MiB |
| Ruby | 4 | 1,335.0 MiB | 80 | 100,269 | 16.7 MiB |
| C# | 10 | 1,408.0 MiB | 79 | 100,316 | 17.8 MiB |
| PHP | 8 | 1,463.5 MiB | 86 | 100,125 | 17.0 MiB |
| Kotlin | 2 | 988.2 MiB | 58 | 100,279 | 17.3 MiB |
| Swift | 2 | 865.2 MiB | 51 | 100,471 | 17.2 MiB |
| C++ | 7 | 1,429.1 MiB | 85 | 100,404 | 16.9 MiB |

Inspecting 10,000 rows costs one row group, so Python, TypeScript, Go, Rust,
and Ruby together need about 82 MiB of metadata, above revision 11's 64 MiB
ceiling.

No token, commit, repository name, message text, response body, or dataset row
is preserved.
