# Next phase (v1.1): public launch, duel challenge links, and bigger pools

Planned 2026-10-20 with the owner. Checklist: #174, milestone v1.1.

## Context

v1.0 is merged: 296 rounds in 10 decks, generative UI, and the design experiment. It still runs on localhost only,
keeps nothing between games, and offers no way to play against anyone. The owner asked three things: what the app
is missing, how to get more data, and how to build a Duel mode. Exploration on 2026-10-20 found the following.

**Missing features**
- No way to play another person, and no issue on the subject.
- Nothing carries between games: no bests or streaks (#63), and no practice mode (#64).
- The share text has no URL and no per-round grid.
- Daily uses the server's date, not the player's.
- Missing pages: about/how-to-play, credits, privacy, 404, and OG metadata.
- The notice still says "localhost only".
- Nothing is hosted:
  - no Dockerfile, headers, CSP, or rate limits;
  - the bind address is 127.0.0.1;
  - Node 20 is end-of-life;
  - the session ledger lives only in memory, so a restart reopens replays;
  - the #100 gates are open.

**What duels can build on, and what blocks them**
- A seeded deal (`/?deck=…&deal=…&game=…`) is fully deterministic, rounds and option order both.
- Arms are drawn per page load, so a player drawn the question layer gets scaffolds and different hints from the other player.
- The token seals neither the seed nor per-round results.
- Anything readable in a link lets the friend practise the deal first.

**Data growth**
- Code caps bind before the budget does: per-deck caps of 40, read caps of 240, and the algorithm deck answers each algorithm only once.
- An exhausted GitHub rate limit silently shrinks decks today. Each refusal is counted as one rejected candidate, which ends in `DECK_SHORT`.
- The artifact is parsed twice at load.

## Owner decisions (2026-10-20)

1. **Duel:** async challenge link first. Live rooms come later.
2. **Public:** one instance on the owner's own server, closing #97–#100.
3. **More data:** grow pools from the current sources. No new forges, decks, or licences this phase.
4. **Request ceiling:** may rise to about 10,000.
5. **Node:** 24.22.0 now (#21).
6. **v7 data run:** resume on the v6 journal from 2026-10-19 (about 3,500 live requests, about one rate-limit hour).
7. **Experiment:** keep shipping after launch. Every player-visible change gets a dated entry, and the report splits periods. No freeze.

## Work plan: four tracks, about 30 PRs

Every PR runs the `CLAUDE.md` verification matrix before merging. The checklist is #174 (milestone v1.1).

### Track L: launch hardening and hosting

| PR | What | Key files and functions |
|---|---|---|
| L1 (#100) | Rewrite the guardrails for #100 (docs only). Covers: anonymous public play; no accounts and no stored or logged IP, UA, cookie, or id; one instance; control arm offline; genUI only through the answer-lock guard; spend limits on the OpenRouter key; lab mode never in production; preparation guardrails unchanged; every player-visible change after day 0 gets a dated entry. | `CLAUDE.md`, `README.md`, `docs/architecture.md` |
| L2 (#21) | Node 24.22.0 (#21) | root `package.json` engines, new `.nvmrc`/`.node-version`, `.github/workflows/ci.yml`, `packages/test-support/workspace.test.mjs`, `@types/node` 24, Actions majors |
| L3 (#26) | Toolchain advisories (#26), `.github/dependabot.yml`, `pnpm audit --audit-level=high` in CI | after L2 (Vitest needs Node ≥ 22.12) |
| L4 (#97) | Public mode and boot checks (#97a). Under `CODEGUESSR_PUBLIC=1`, boot requires the session secret, the public origin, the state and events dirs, and the client-IP header. On failure it exits 78 with `GAME_ENVIRONMENT_REJECTED <CODE>`. `secret()` throws instead of making a random secret, and `labMode()` turns off unless the source is non-real. Error pages. Scripts still bind 127.0.0.1; only the container binds 0.0.0.0. | new `apps/game/src/server/environment.server.ts` (`checkEnvironment`), `src/instrumentation.ts`, `app/error.tsx`, `app/global-error.tsx`; containment allowlist in `tests/containment/acquisition-boundary.test.mjs` |
| L5 (#97) | Headers and nonce CSP (#97b). The visualizer moves from `srcDoc` to its own frame route, because a srcdoc frame inherits the page's CSP and its scripts would be blocked. `z.config({ jitless: true })` stops zod's eval probe. Server-action body limit 16 KB. | new `src/middleware.ts`, `next.config.mjs` `headers()`, new `app/genui/frame/route.ts`, `genui/visualizer-view.tsx`, `genui/composer-spec.ts`; new e2e `security-headers.spec.ts` (zero CSP violations across decks and designs) |
| L6 (#98) | Rate limits (#98). Token buckets for deal, hint, reveal, beacon, genui, genui-all, og, `duel_create`, `duel_open`. A `RATE_LIMITED` game refusal; a `limited` genui fallback. A test asserts no IP string is ever stored or logged. | new `server/client-key.server.ts` (the only module that reads the IP: /64 for IPv6, HMAC under a per-process salt), `server/rate-limit.server.ts` (on `globalThis`, like the ledger); wired into `page.tsx`, `app/actions.ts`, `api/events`, `api/genui` |
| L7 (#164) | Persistent state and health. The ledger writes through to SQLite, and `readGame` refuses a game it doesn't know when the store is persistent, so a restart can't replay. `deriveKey(context)` for duel keys. Events stay JSONL. | new `server/sqlite.server.ts` (`process.getBuiltinModule("node:sqlite")`, `Database ?? DatabaseSync`), `server/state-store.server.ts`; `local-real-experiment-session.server.ts` (`recordStep`, `readGame`); new `app/api/health/route.ts` |
| L8 (#99) | Credits and privacy (#99). Credits list sources only, never round ids, because file paths name the answers. The privacy page is generated from the event schema plus a disclosures registry (share-URL fields, localStorage keys, transient IP, OpenRouter, duel link fields). Footer links. | `credits` on `LocalRealExperiment` from `fixture.source`; new `app/credits`, `app/privacy`, `experiment/event-docs.ts` (test: keys equal `PAYLOADS`), `privacy/disclosures.ts`, `docs/licences.md` |
| L9 (#45, #66, #70) | CI against the production build (#45, #66, #70). Playwright runs `next start` plus a public-mode server; an a11y project covers real pages at 320 and 1280 px; keyboard, edge-route and same-origin specs; a first-load JS budget. Retire the evidence-gate stubs. | `playwright.config.ts`, `tests/e2e/*`, `tests/performance/`, `ci.yml` |
| L10 (#168) | Public copy: new notice text, `/about` (how to play, scoring, keys, the experiment), `not-found`, an unknown-deck notice, `metadataBase` and OG defaults, `robots`, `icon` | loader notice constants, `layout.tsx`, new `app/about`, `app/not-found.tsx`, `app/robots.ts` |
| L11 (#169) | Experiment change log. Dated player-visible changes, read by the report to split or annotate periods. The completion denominator becomes games with `game_viewed`, so crawler deals drop out. | new `ops/experiment/changes.json`; `ops/experiment/report.ts`, `render.ts` |
| L12 (#170) | Container and own-server deploy (details asked at this PR: OS, Docker, existing reverse proxy, domain, how deploys reach it). The client-IP header is trusted only from the proxy. CI gets a container job. Check server-action ids across two builds; if they change, a page loaded before a deploy shows "CodeGuessr was updated". | multi-stage `Dockerfile` (`node:24.22.0-bookworm-slim` by digest, `pnpm deploy`, `chmod a+r` on the artifact, which is mode 0600 locally), `ops/deploy/entrypoint.sh` (drops to `node`), `compose.yaml` (game plus Caddy for TLS, or behind the existing proxy; `/data` volume for state and events), `docs/deploy.md`, `ops/deploy/smoke.mjs`, `ops/deploy/pull-events.sh` |
| L13 (#100) | Smoke test, then launch. Run on the server before DNS with `EXPERIMENT_SOURCE=synthetic` and lab mode. Checks: health; headers and nonce; pages; one game per design, theme and layer; rate-limit 429s that fall back to static; restart mid-game continues and a stale token gets `STALE_STEP`; the report sees every arm; no IP-shaped strings in events. Then remove the synthetic and lab settings and record day 0. | `ops/deploy/smoke.mjs`, evidence doc |
| L14 (#174) | Release notes and state update | `docs/releases/v1.1.0.md`, `CLAUDE.md`, `docs/review/README.md` |

### Track D: data, profile v7 (about 300 rounds to 436, stretch 484)

| PR | What |
|---|---|
| D1 (#165, #54) | **Rate-limit checkpoint and journal safety.** Covers detection, stopping, resuming, the journal, and the docs and test that enforce it. |
| D2 (#166) | **Parse once, and a containment index.** The layer loader takes the already-parsed artifact; today the artifact is parsed and hashed twice. `protectedIndex` in `packages/artifact/src/validation.ts` uses a word-token set instead of a scan per protected value, with a property test that it gives the same answers. Comes after X0 (the 500-line limit). |
| D3 (#167) | **Profile v7 and artifact schema v6,** beside v6. Covers versioning, caps, new profile keys, the selectors, limits, and dry runs. |
| D4 (#167) | **The data run.** Covers the run itself, question layers, test updates, and the evidence doc. |
| D5 (#167) | **Media.** Re-pick `DEAL_SEEDS` (`ops/demo/record/scenes.ts`), then `pnpm demo:record` (`demo.gif` under 10 MB, others under 4 MB). |

**D1 in detail**
- Detection: `transport.ts` reads the `x-ratelimit-*` headers. `retry.ts` turns a refused rate-limit retry into `RATE_LIMIT_CHECKPOINT`. `runtime.ts` stops before a live GitHub request when 25 or fewer requests remain and the reset is too far off.
- Stopping:
  - `diagnostics.ts` re-throws run stops past `rejectCandidate`, so they no longer shrink decks. The run stops are `JOURNAL_MISS`, `OFFLINE_NETWORK_REFUSED`, `RATE_LIMIT_CHECKPOINT`, and `RUN_INTERRUPTED` (on SIGINT).
  - The run exits 75 and logs `PREPARATION_RESUME_AFTER <UTC>`.
- Journal (#54):
  - A plain run refuses with `JOURNAL_EXISTS` when a journal exists.
  - `--fresh` renames the old journal and never deletes it.
  - New flags `--profile=` and `--journal=`.
- Docs and test:
  - CLAUDE.md "Reading failures" gets the new codes; `failure-codes.test.ts` enforces it.
  - An integration test asserts that a checkpoint followed by `--resume` gives the same hash as an uninterrupted run.

**D3 in detail**
- Versions: `PROFILE_VERSIONS` pairs v7 with artifact v6.
- Algorithm deck:
  - `deduplicationKeys(kind, version)` replaces `DEDUPLICATION_KEYS_BY_KIND` (`packages/artifact/src/domain.ts`); from v7 the algorithm deck drops `algorithmId`, so an algorithm can be answered twice.
  - `DECK_RULES.algorithm` reuses `familyDeckRule` (`family.ts`).
- Caps: `ops/poc/prepare/profile.ts` gets caps per version. v7 allows curated decks up to 60 rounds and 480 reads.
- New v7-only keys:
  - `selection.projectRoundsPerLanguage` (4);
  - `curated.algorithm.roundsPerAlgorithm` (2).
- Selectors:
  - `select-stack.ts` builds project rounds in groups of two answers and two decoys;
  - `select-algorithm.ts` and `algorithm-rounds.ts` handle k answers per member.
- Limits: `ops/poc/limits.json` and the v7 profile set `requestCount` to 10000 and `blobAttempts` to 600.
- Dry runs: `--resume --profile=local-real-rounds.v7` on a copy of the v6 journal. Set the final targets from the measured yields, recorded in `docs/review/evidence/<date>-v7-dry-run.md`.
- v6 `--offline` must still leave the artifact and pin unchanged.

**D4 in detail**
- Back up `run.jsonl`, switch `PROFILE_VERSION`, and run `--resume` on the v6 journal.
- Run `--offline` twice; both must give the same hash.
- Back up the questions journal, then run `pnpm prepare:questions`.
- Tests:
  - the wrap-around e2e uses the pool size instead of `game=4`;
  - flip `.fails` on #81 memory tests that now pass;
  - regenerate the duel golden digest.
- Evidence: `docs/review/evidence/<date>-v7-data-run.md`.

**Growth targets (from the v6 evidence and supply in the local journal)**

| Deck | v6 | v7 target (stretch) | How |
|---|---|---|---|
| project | 24 | 48 | 4 rounds per language, 48 popular repos per language |
| language | 52 | 52 | already over 48; 60 would need new pairs |
| before-after | 20 | 32 (40) | 4–6 new date windows in the productive orgs; replace the empty django window |
| algorithm | 24 | 48 | each algorithm answered twice from different languages; 6 of 8 families |
| output | 24 | 40 (48) | `fileReads` 360 |
| fix | 24 | 40 (48) | `patchReads` 420 |
| missing-line | 24 | 48 (60) | rounds only |
| name-function | 24 | 48 (60) | `fileReads` 420 |
| framework | 32 | 32 | TodoMVC has no third file for Ractive and Mithril |
| exercise | 48 | 48 | at target |

About 6,900 requests in all (stretch 7,900). Resuming on the v6 journal leaves about 3,500 of them live.

Two things stay untouched: `ops/poc/stack/*.py`, because changing it orphans the worker journal, and
`stackRowsPerLanguage`, because raising it breaks the 448 MiB metadata ceiling.

### Track F: player features

| PR | What | Key files |
|---|---|---|
| F1 (#171) | Better share line. Adds the seeded game's URL, a spoiler-free grid (🟩 right with no hint, 🟨 right with hints, ⬛ missed), and the Web Share API with a clipboard fallback. A static OG image per deck, metadata per deck, and a `result_shared` event. | `projectSpoilerFreeShare` (`components/arcade/arcade-text.ts`); a `shareHref` prop from `page.tsx` (`gameHref`) through `DemoArcade`, `ArcadeShell`, and `RoundReveal`/`CompletionActions`; new `app/og/[deck]/route.tsx` |
| F2 (#172) | Today's five on the player's date. `&date=` is accepted within UTC ±1 day. A bare `/?deck=daily` redirects on the client with the local date and deals nothing. `&replay=1` seals `record: false`. | `dailyDateOf` beside `localDate` in `local-real-experiment-deal.server.ts`; `page.tsx` lines 67, 168, 199; Playwright `timezoneId` tests |
| F3 (#63) | Local records (#63). Best score, games played, streak (3 or more of 5 right), daily streak, and a "Clear records" button. Keyed by artifact hash and deck. "Replay misses" comes later. | new `components/arcade/local-records.ts`, `components/chooser-records.tsx`; written by `ArcadeShell` |
| F4 (#161) | UI polish (#161). A deck column in mixed and daily summaries (`RoundRecord.deck`), a host cue beside the verdict, controls hidden after the lock, and a note on rounds whose layer was refused. Marker hunt's applicability goes into D4's questions run. | `arcade-session.ts`, `arcade-shell.tsx`, `round-reveal.tsx` |

### Track X: duel challenge links

| PR | What |
|---|---|
| X0 (#173) | **Refactor (no behaviour change).** Move `pointsFor`, `deriveRound`, `deriveDecks`, `dealFrom`, and `SCORING` into a new `demo/local-real-experiment-rounds.server.ts`. `local-real-experiment.server.ts` is at 497 lines against the test's 500-line limit. |
| X1 (#173) | **Server.** Covers game state v3, the challenge and result tokens, B's deal checks, a plays ledger, the verdict, and two new actions. |
| X2 (#173) | **UI.** Covers three new page states, the opponent strip, the comparison, sharing, and names. |
| X3 (#173) | **Events v2 and the report.** Covers a new origin field, the duel events, and keeping duel games out of the experiment. |

**X1 in detail**
- **Game state v3:**
  - adds a deal descriptor (`series{seed,game}`, `daily{date}`, `duel{challenge}` or `unseeded`), `dealDigest`, `outcomes[]`, and `priorPlays`;
  - the nested keys go into the `sealGame` JSON replacer list, or they are silently dropped;
  - the MAC context moves to v3, so v2 games end.
- **Challenge token:**
  - encrypted with AES-256-GCM under `deriveKey("codeguessr-duel.v1")`. Encryption, not just signing, keeps the seed from B, so B can't practise the deal first;
  - holds the deal, the digest, A's arms, A's correct/hints/points for each round, the maximum score, and a first-try flag;
  - holds no answers, round ids, option labels, ids, or names;
  - at most 1,024 characters; lives 7 days. A result token lives 30 days.
- **B's deal:**
  - re-dealt from the descriptor, then checked against the digest, the maximum, and the points table; a mismatch is refused as `DEAL_DRIFT`;
  - plays with A's sealed arms, so hints and scaffolds match;
  - other refusals: invalid, expired, and `ROUND_SET` (the artifact changed).
- **Plays ledger:** counts plays per deal with no identity. A's game is flagged as a first try or not, and B's as the 1st or 2nd play of the link. It persists through L7's state store when there is one.
- **Verdict:** `duelVerdict` decides on score, then fewer hints, then more rounds right, otherwise a draw.
- **Actions:** `createDuelChallenge` and `issueDuelResult`.
- **Recording:** duel games seal `record: false` until X3.
- **New files:**
  - `demo/local-real-experiment-duel-token.server.ts`
  - `demo/local-real-experiment-duel.server.ts`
  - `demo/local-real-experiment-plays.server.ts`
  - `components/duel/duel-contract.ts`
- **Reused:** `canonicalHash`, `seededRandom`, `dailyRandom`, `seriesRounds`, `readGame`, `recordStep`, `roundPoints`, `parseArms`.
- No new `route.ts`; the containment test allows only the routes it names.

**X2 in detail**
- **New page states:**
  - `?duel=<t>` is an intro that deals nothing and is `noindex` ("Ana challenges you · Which language? · 3,300/5,000");
  - `?duel=<t>&play=1` deals B's game; lab overrides are ignored;
  - `?duel-result=<t>` shows the comparison read-only and recomputes the verdict.
- **Opponent strip:** shows A's result for a round only after B locks that round, announced in the reveal's existing live region.
- **Comparison:** a table with a caption, row headers, and screen-reader text.
- **Sharing:**
  - `CompletionActions` gets "Challenge a friend";
  - an optional name goes in the URL fragment (`#from=Ana`), so it never reaches the server or its logs. `sanitizeName` applies NFKC, strips control and format characters, and keeps at most 24 code points;
  - a challenge share has no grid; a result share shows both grids;
  - a rematch is a fresh seed of the same deck.
- **Files:**
  - new `duel/duel-page.tsx` and `components/duel/*`;
  - changes to `arcade-shell.tsx`, `round-reveal.tsx`, and `demo-arcade.tsx`;
  - `globals.css` uses existing tokens only.
- **Tests:** `tests/e2e/duel.spec.ts` with two browser contexts.

**X3 in detail**
- Every event carries `origin: deal|duel`; v1 lines read as `deal`.
- New events: `duel_created`, `duel_completed`, `duel_link_copied`. `deal_again.to` gains `rematch`.
- Report v2 keeps duel games out of the factor comparisons (B's arms aren't randomized) and adds a descriptive Duels block.
- No ids, names, or tokens are stored.
- If L6's `limited` and F1's `result_shared` land close in time, fold them into the same schema bump.

### Order and dependencies

1. **Now, in parallel:** L1, L2 then L3, D1, X0.
2. **Next:**
   - L4, then L5–L9 in parallel;
   - D2 (after X0) and D3 with its dry runs;
   - F1;
   - X1 (after L7, which provides `deriveKey` and the state store).
3. **Then:**
   - D4. It goes before launch so daily deals, links, and credits don't change right after;
   - X2, X3, F2–F4, L10, L11.
4. **Finally:** L12, then L13 (day 0), then L14.

The launch gate is L1–L13, D4, and F1. Duels and the other features may land before or after day 0, each with a dated entry in `changes.json`. Duels before launch are preferred, since sharing brings players.

### Owner actions

- Tag and release `v1.0.0`.
- Decide #120 and #160 before launch.
- Repository settings (#27).
- Agree to delete the evidence-gate stubs (#45).
- Server details at L12. Then on the server: Docker, DNS and TLS, the volume, `CODEGUESSR_SESSION_SECRET` (`openssl rand -base64 48`), and a production OpenRouter key with a spend limit and zero data retention.
- Approve each deploy.

## Verification

- **Every PR:**
  - `pnpm test`, `pnpm typecheck`, `pnpm test:a11y`, `pnpm test:performance`
  - `E2E_PORT=3200 pnpm test:e2e`
  - `pnpm exec node --test tests/containment/acquisition-boundary.test.mjs`
  - `pnpm --filter @codeguessr/game build`
  - pipeline PRs also run `pnpm exec vitest run ops/poc/prepare`, `pnpm exec tsc --noEmit -p ops/tsconfig.json`, and the uv unittest.
- **Data:**
  - D1–D3 keep the v6 `--offline` rebuild byte-identical (pin `1abc21f8…`);
  - a checkpoint then resume gives the same hash as an uninterrupted run;
  - D4: `--offline` twice gives the published hash, `PREPARATION_DECKS` lists all ten, deck sizes match the v7 pool sizes, and `deck-leakage.test.ts` passes on the v7 artifact.
- **Duel:**
  - unit tests: seal/open, tampering, swapped contexts, expiry, `ROUND_SET`, `DEAL_DRIFT`, v2 tokens ending, copied arms, a golden digest per deck, and no answer data in any token;
  - the two-context e2e covers A plays, then B plays the same rounds with the same option order, theme, and scaffold. It also checks the strip reveals A's result only after B's lock, the comparison and result link, the rematch, and that no answer label appears on the result page;
  - axe on the intro, the strip, and the comparison.
- **Launch:**
  - the L13 smoke list on the server, then `pnpm experiment:report --source=synthetic` showing every arm;
  - manual: a two-tab duel across a server restart, with the secret set.

## Later (not this phase)

- Live duel rooms (L7's state store makes room for them).
- A versus-bot mode: solver picks precomputed and pinned like question layers, from `ops/poc/questions/audit.ts`, so no model is called during play.
- Practice mode #64 with `candidateNotes` (v8 schema).
- "Replay misses".
- New decks: #61, #59 with #147, and #60.
- Phase 3c forges.
- A commit-message deck from CommitPackFT, filtered by its per-sample licence.

Issues: #164–#173 for the new work and #174 as the checklist; existing issues #21 #26 #45 #54 #63 #66 #70 #97–#100 #161 moved to milestone v1.1.
