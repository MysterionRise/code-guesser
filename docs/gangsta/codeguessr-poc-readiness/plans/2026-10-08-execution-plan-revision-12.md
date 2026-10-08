---
heist: codeguessr-poc-readiness
date: 2026-10-08
status: draft
contract: docs/gangsta/codeguessr-poc-readiness/specs/2026-10-08-contract-revision-12-draft.md
---

# Execution Plan: Revision 12 Guessing Decks

Every work package follows red-green-refactor with a failing test first. No
work package starts before the Don signs revision 12.

| WP | Title | Main files | Done when |
| --- | --- | --- | --- |
| WP-036 | Profile v2 and parser | `ops/poc/profiles/local-real-rounds.v2.json`, `ops/poc/prepare/profile.ts` | Eight query tuples with roles, five Stack configurations, language templates and distractors, FR-034 markers, and v2 ceilings parse exactly; v1 is rejected by the v2 command |
| WP-037 | Artifact schema v2 | `ops/poc/prepare/model*.ts`, `compose.ts`, `canonical.ts` | Three decks of five, per-deck and cross-deck dedup, amended FR-009 containment, byte-stable replay |
| WP-038 | Project rounds | `ops/poc/prepare/project-rounds.ts` | FR-032 candidates, clues, and containment; deterministic distractors |
| WP-039 | AI-credit rounds | `ops/poc/prepare/ai-rounds.ts`, `provenance-rounds.ts` | FR-034 matching, FR-024 labels, clues, subject screening, honest evidence |
| WP-040 | Language deck | `language-rounds.ts`, `stack-revalidation.ts`, `stack-metadata.ts` | Five languages, four candidates, templated clues, header-skipping window, FR-023 generated screen |
| WP-041 | Orchestration and capacity | `ops/poc/prepare/index.ts`, `capacity.ts`, `testdata/**` | Fifteen-fixture selection within the v2 ceilings; captured replay for all three decks |
| WP-042 | Game authority and deck chooser | `apps/game/src/demo/local-real-experiment*.server.ts`, `apps/game/src/app/page.tsx`, arcade shell | Server-only v2 authority, chooser, `deck` parameter, AI-deck notice line, choose-another-deck flow |
| WP-043 | Browser, containment, accessibility | `tests/e2e/**`, `tests/containment/**`, `tests/accessibility/**` | Each deck plays end to end; static bundle stays clean; chooser is keyboard and screen-reader usable |
| WP-044 | Live run and evidence | generated artifact, pin, dated evidence | One authorized run publishes fifteen fixtures; independent verification; hash pinned |
| WP-045 | Media and documentation | `ops/demo/record/**`, `docs/media/**`, README, CLAUDE.md, checkpoint | One captioned GIF per deck plus a full-run MP4 under four megabytes each; docs and checkpoint state the truth |
