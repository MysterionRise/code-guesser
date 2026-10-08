---
heist: codeguessr-poc-readiness
phase: the-hit
status: complete-local-poc
timestamp: 2026-10-08T19:20:00Z
next-action: The Don confirms or reverts the two recorded semantics refinements; merge is a separate decision
completed-wps: [WP-001, WP-002, WP-003, WP-004, WP-005, WP-006, WP-007, WP-008, WP-009, WP-010, WP-011, WP-012, WP-013, WP-014, WP-015, WP-016, WP-017, WP-018, WP-019, WP-020, WP-021, WP-022, WP-023, WP-024, WP-025, WP-026, WP-027, WP-028, WP-029, WP-030, WP-031, WP-032, WP-033, WP-034, WP-035]
pending-wps: []
blocked-wps: []
failed-wps: []
artifacts:
  - apps/game/src/demo/generated/local-real-rounds.json
  - apps/game/src/demo/local-real-experiment.pin.server.ts
  - apps/game/src/demo/local-real-experiment-loader.server.ts
  - apps/game/src/app/page.tsx
  - apps/game/src/app/actions.ts
  - tests/e2e/arcade-shell.spec.ts
  - tests/containment/acquisition-boundary.test.mjs
  - docs/media/01-read-the-code.gif
  - docs/media/02-lock-in.gif
  - docs/media/03-full-run.gif
  - docs/media/codeguessr-demo.mp4
  - docs/gangsta/codeguessr-poc-readiness/evidence/2026-10-08-combined-live-run.md
  - docs/gangsta/codeguessr-poc-readiness/evidence/2026-10-08-live-preparation-attempts.md
  - README.md
  - CLAUDE.md
---

# The Hit: Live Artifact Mounted

The signed Contract remains exact at SHA-256
`3acc586d8fb479e6edfd2dd43e9f38ed5d8d6268ee5b025b449d3a564b32fe41`. No
Contract text changed. This checkpoint succeeds the same day's
`the-hit-live-attempts` checkpoint, whose blocker turned out to be a stored AWS
key that the Software Heritage bucket never needed: the content bucket serves
the selected objects anonymously, so the blob worker now sends unsigned
requests and no credential can cross to that host.

## Live artifact (WP-028, WP-034)

The fourteenth authorized run completed at 18:58:56Z with the accepted
`GITHUB_SEARCH_INCOMPLETE` warning and published the artifact and report
atomically. Three further mismatches were fixed test-first between runs nine
and fourteen: Stack revalidation decodes GitHub's line-wrapped base64; licence
screening precedes blob download (FR-029); and FR-009 containment is checked
per candidate, with the composer naming the colliding key and public field in
a data-free code. The last such code,
`PUBLIC_CONTAINMENT_RAWCONTENTHASH_IN_EXCERPT`, exposed a structural
self-collision: a whole-file excerpt's hash equals the raw content hash, so
the public excerpt version id matched a "protected" value that is only a hash
of public text; that self-identical case is exempt.

Independent verification (`evidence/2026-10-08-combined-live-run.md`):
canonical hash `0eab7f489f311125b9a1ae8574fd2a3b072c3c954e48c8284aac39559a607498`
on both the preparer's and the game's canonical forms and as the published
file's byte hash; crawl snapshot
`9249eb590064490285f5f799acabb3fe56edf436fdc1d5b712262c99ca083713`; three
provenance then two language fixtures; distinct Python and TypeScript; every
count within its ceiling (112/200 requests, 10,000 rows per language, 2 of 8
blobs, 0 retries).

## Mounted acceptance (WP-025, WP-027)

The root route binds the artifact through the server-only loader and the
operator-pinned trusted hash; a missing or rejected artifact yields an
explanation and no rounds. Only the FR-015 route-source assertions changed. The
browser scenario plays the five real rounds with answers read on the Node side,
checks that attribution appears only after each answer, and replays.
Containment proves the static bundle carries no crawl snapshot,
correct-answer, attribution, or content-class marker.

## Documentation and media (WP-029)

The README embeds three captioned GIFs and an MP4 recorded from the real rounds
by `pnpm demo:record` with an operator-chosen answer choreography, and states
the preflight, outputs, warning meaning, hashes, and unreviewed status.

## For the Don's confirmation

Two semantics refinements made during the live attempts stay recorded here
rather than silently adopted: a configured marker also matches a Git trailer
line that ends in exactly one angle-bracket address, and the profile lists the
observed `Co-authored-by: Copilot` and `Co-authored-by: Copilot App` names in
addition to its original literals. Reverting either leaves no real commit
matching a marker.

## Fresh verification (2026-10-08)

| Suite | Result |
| --- | --- |
| Workspace unit (`pnpm test`) | 90 files, 2,337 tests, plus 4/4 TAP workspace checks |
| Preparation suite (`ops/poc/prepare`) | 24 files, 370 tests |
| Operator and workspace TypeScript | clean |
| Python workers (locked uv) | 42 tests |
| Accessibility | 37/37 |
| Performance | 6/6 |
| Containment (after production build) | 3/3 |
| Production build | passes |
| Playwright | 13/13 against the local Next dev server, playing the real rounds |
| `git diff --check` | clean |

No token, credential, account value, response body, dataset row, or source
excerpt from a failed diagnostic is preserved in any evidence or log. This
checkpoint authorizes no merge, deployment, or public players.
