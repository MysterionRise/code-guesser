# launch review, 2026-11-10

> One reviewer agent's findings, as written on 2026-11-10 against `main` at `03cd25a`, kept for their verdict
> and implementation sketch per issue. Where [the review](../2026-11-10-next-steps-review.md) corrects a point,
> the review stands. Line numbers are that commit's.

Checked against `main` at `03cd25a` (committed files; see the first line of Risks about the working tree).

## Summary

- Tag `v1.1.0` now as what is merged, a local-play release that is ready for public play, and move launch (#100, #170, L13) to its own milestone that follows the next data release. v1.0 was tagged the same way (`docs/releases/v1.0.0.md:4-5`).
- Every launch gate in #100 is closed, and the only unmet done-when lines in #100 and #170 are "live on the server". Run 3's failing bar lines are the one repository-side reason to hold launch, which is why launch should follow the data release.
- The launch material is mostly current after #246. The release notes draft misses #250 and #251 and still calls v1.1 "the public release"; `docs/deploy.md:133` recommends an Anthropic host setting that was never run live.
- An Anthropic-only public server boots clean by the unit tests, but no test boots the production build or the image with the Anthropic provider, the container test never turns generative UI on at all, and the smoke script never calls a model.
- #120 can close on the owner's word (run 3's pilot met its second done-when line). #160 turns on one number from today's blind test: layer-on minus layer-off accuracy at stage 0 on unseen rounds.

## Verdict per issue

| Issue | Still valid? | Evidence (path:line or PR) | Size (S, M, L) | Depends on | Recommendation |
| --- | --- | --- | --- | --- | --- |
| #174 v1.1 release checklist | Partly. 24 of 26 boxes ticked. L13 is genuinely open (the owner's). L14 is drafted but stale. | Draft: `docs/releases/v1.1.0.md` (last touched by #246; nothing from #250, #251). Unticked boxes: `gh issue view 174`. Tag list holds only `v1.0.0`. | S (one docs PR, tracker edits, the tag) | The owner's choice in decision 1 | do next: finish L14 as a local-play release, move the L13 line to the launch milestone, tag, close |
| #100 Launch checklist | Yes, for two of its three done-when lines. Its body is stale in three places (below). | All 11 gates closed (`gh issue list`: #96, #97, #98, #99, #102, #21, #26, #27, #45, #66, #70). No deployment: `docs/deploy.md:7` still says `codeguessr.example`; `ops/experiment/changes.json` is `[]`. | M (the issue's own label; server work, not repository work) | A server and a domain; #120's setting; recommended: the next data release first | later, in its own milestone |
| #170 Container image and deploy | Only its first done-when line. Everything a PR can do merged in #215. | `Dockerfile`, `ops/deploy/*`, `docs/deploy.md`, CI job `.github/workflows/ci.yml:95-127`; bind test `packages/test-support/workspace.test.mjs:72-81`. | S for the two test gaps in batch 2; the deploy itself is #100's L13 | #100 (same owner action) | later, with #100. Its open line is a subset of #100's, so the owner may prefer to close it as superseded and keep one launch issue |
| #120 Model per design | Yes, as a decision. Its title and proposal are stale: the pilot found the host, not the composer and catalog, worth Sonnet. | `docs/review/evidence/2026-11-02-agent-playtest-run-3-fun.md:157-174`; code `apps/game/src/genui/model.server.ts:45-49`; #237 closed by #245. | S (a comment and a server setting; no code) | Which provider launch uses, since the variable names differ per provider | owner decision |
| #160 Algorithm layer's fairness | Yes, as a decision. Run 3's rerun of the tally was contaminated, so nothing newer than run 2 measures it. | Run 2: `docs/review/evidence/2026-10-20-agent-playtest-run-2.md:101-106`. Run 3: `…run-3-fun.md:140-141`, #241. Audit bounds: `ops/poc/questions/audit.ts:17-23`. | S if accepted; M if the layers are rebuilt (a `prepare:questions` run and a re-pin) | Today's blind test; #228 for hint 1 | owner decision |

### Done-when lines, met or unmet

**#100**
- "every gate is closed": **met**. All eleven boxes are ticked and each issue is closed, the last four on 2026-11-04 (#97 by #250; #27, #66, and #70 the same evening).
- "the game is live at its public URL, with the headers and with the credits and privacy pages": **unmet**. Nothing is deployed. The headers and pages themselves exist and CI checks them on the image (`ops/deploy/smoke.mjs:93-135`, run by `tests/container/image.test.mjs:90-93`).
- "a smoke game in each arm records its events": **unmet**. The nearest evidence is run 3's agent events on a local production build (`…run-3-fun.md:209-212`), not the image and not the server. No automated test records one game per arm: `tests/e2e/events.spec.ts:42,165` records `design=off` and `design=catalog` only.
- Its proposal ("Rewrite the guardrails in `CLAUDE.md` and `README.md`") is done (#176), with one line now stale after #246 (`README.md:745-746`, below).

**#170**
- "The image runs on the owner's server behind TLS, and the smoke script passes there.": **unmet**. The same owner action as #100's second line.
- "A workspace test asserts that only the Dockerfile binds `0.0.0.0`.": **met**, `packages/test-support/workspace.test.mjs:72-81`.
- Proposal items: the Dockerfile, entrypoint, runbook, smoke script, `pull-events.sh`, CI container job, and the server-action notice all merged in #215. `compose.yaml` with Caddy was replaced by Dokploy and Traefik (`docs/deploy.md:3-5`); no `compose.yaml` exists. "To settle at this issue: the OS … the domain" was settled in the runbook, not on the issue (0 comments), and the domain is still a placeholder.

**#174** (no done-when section; its checklist and owner actions)
- L13 "smoke test on the server, then day 0": **open**, the owner's.
- L14 "release notes … and the `CLAUDE.md` and review index updates": **half done**. The draft exists; the fixes it needs are in batch 1.
- Owner actions: "Tag `v1.0.0`" **met** (tag and release, 2026-10-20). "Repository settings (#27)" **met** (#27 closed 2026-11-04). "Decide #120 and #160 before launch" **unmet**. "Server details and secrets at #170" **unmet** (no comment on #170). "Approve each deploy" not applicable yet.

## Proposed order

1. **Batch 1, now: finish v1.1.0 as a local-play release (S, docs and tracker only).** It goes first because every later change makes the draft staler, and the next data run will change the round count and hash the draft names.
   - `docs/releases/v1.1.0.md`: reword the lede (`:3-6`) and the "Public play, hardened" heading (`:13`, `:26-27`) to "ready for public play, still served locally; launch is its own milestone". Extend the PR ranges (`:10-11`) with #246, #250, #251. Move the Anthropic bullet (`:74-78`) out of "What changed because of it" into its own entry with `(#246)` and the live check. Add #27's settings and #250's planted-secret test beside `:28`. Add #251's `--resume`-before-`--offline` note to "Upgrading" (`:89-103`). Fix `:98` (the hash is the 2026-10-26 rebuild's, #214). Add "not launched: the runbook has never run against a real server" and "#120 and #160 undecided" to "Known limits".
   - `README.md:8` (current release), `:191-193` ("comes with v1.1" becomes "comes with launch, #100"), `:364` and `:745-746` (stale wording, below), `:864` (link). `CLAUDE.md:23-24`, `:37`, `:265`, `:776-779`. `docs/review/README.md:3`, `:24`, `:50`.
   - Tracker, scripted for the owner: a milestone "Launch" holding #100 and #170 (and #120 if still open); #174's L13 line edited to point there, L14 ticked, #174 closed; the v1.1 milestone's description corrected (it says "~436 rounds"; the artifact holds 422) and closed; `needs decision` off #100; labels on #160.
   - Tag `v1.1.0` on the docs PR's merge commit and publish the GitHub release from the notes. No version bump: `package.json:3` is `0.0.0` and was at `v1.0.0` too.
2. **Batch 2, any time before launch: test what an Anthropic-only server runs (M).** Independent of batch 1. M rather than S only because the container case needs the image to reach a stand-in on the host, which differs between CI's Linux and macOS (not verified).
   - `tests/deploy/boot-environment.test.mjs:96-139`: run "plays every generative design" once per provider. Start `startFakeAnthropic` (`tests/e2e/fake-anthropic.mjs:57`) and pass `GENUI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`. Add one public-mode boot with `GENUI_ENABLED=1` and an Anthropic key alone that expects no `GAME_ENVIRONMENT_REJECTED` (beside `:141-167`).
   - `tests/container/image.test.mjs:70-137`: one container with `EXPERIMENT_SOURCE=synthetic`, `EXPERIMENT_LAB=1`, `GENUI_ENABLED=1`, and a stand-in address, playing one catalog round to `.genui-takeaway` as `boot-environment.test.mjs:118-125` does. The stand-ins bind `127.0.0.1` (`fake-anthropic.mjs:94`, `fake-openrouter.mjs:139`), so they need a host parameter.
   - `ops/deploy/smoke.mjs`: an opt-in `--genui` flag (parse at `:28-30`, usage at `:17`, a check after `:184`) for the pre-launch run, which has lab mode on: open `/?deck=algorithm&design=catalog`, lock, press "Explain this round", wait for the takeaway. It spends one real call, about $0.001. Then `docs/deploy.md:277` adds the flag, and `docs/deploy.md:133` is corrected.
   - Optional, same files: play one recorded game per design, theme, and layer level against the CI container and run `pnpm experiment:report --source=synthetic` on the pulled events. That moves steps 3 and 4 of `docs/deploy.md:278-281` into CI and leaves L13 to prove only DNS, TLS, the proxy's header, and the real key.
3. **Batch 3, the owner's two decisions (no code unless #160 picks a rebuild).** #120: a comment naming the setting, then close. #160: decided by today's number (below); a rebuild rides the next `prepare:questions` run, since the layers bind to the artifact and must be rewritten after any data run anyway.
4. **Batch 4, later: launch (L13), in the Launch milestone.** `docs/deploy.md` sections 1 to 8 on the server, `--record --rate-limits` (and `--genui`), day 0 in `ops/experiment/changes.json`, an evidence document. It should follow the data release that fixes run 3's bar lines 1 to 3: a new artifact after day 0 refuses every open challenge link (`ROUND_SET`), restarts local records (`docs/releases/v1.1.0.md:98-99`), needs new question layers, and splits the experiment's periods. The plan applied the same rule to D4 (`docs/review/2026-10-20-next-phase-plan.md:216`).

### An Anthropic-only public boot, traced

Configuration: `CODEGUESSR_PUBLIC=1`, `GENUI_ENABLED=1`, `ANTHROPIC_API_KEY` set, no OpenRouter key, no `GENUI_PROVIDER`.

- **Boot.** `apps/game/src/instrumentation.ts:5-12` runs `checkEnvironment`. `providerFor` returns `anthropic` (`apps/game/src/genui/provider.server.ts:36-40`), the key is present, so no code is added (`apps/game/src/server/environment.server.ts:100-104`). `ANTHROPIC_BASE_URL` unset passes (`:107`). The pure function is tested: `apps/game/test/environment.test.ts:83-86`.
- **Codes on a mistake.** No Anthropic key but `GENUI_PROVIDER=anthropic`: `ANTHROPIC_API_KEY_MISSING`. No key at all and no `GENUI_PROVIDER`: `OPENROUTER_API_KEY_MISSING` (`environment.test.ts:99-102`), which names the provider the owner did not mean. A leftover `OPENROUTER_BASE_URL` is refused even though OpenRouter is unused (`environment.server.ts:106`).
- **At a request.** `streamRound` picks the provider again (`apps/game/src/genui/model.server.ts:329-333`), the model is `ANTHROPIC_MODEL_<DESIGN>`, then `ANTHROPIC_MODEL`, then `claude-haiku-5-5` (`:45-46`, `provider.server.ts:22-25`). Any `OPENROUTER_MODEL_HOST` is ignored, so #120's setting must be named under the provider in use. Model names are not checked at boot: a wrong one fails each call into the static reveal, visible only as `GENUI_STREAM_FAILED 404` in the logs.
- **Privacy text.** `apps/game/src/privacy/disclosures.ts:131-132` is fixed text that names both services ("either OpenRouter … or Anthropic directly") and links both sets of articles (`:136-139`). It is true for either setup but does not say which one this server uses.
- **Test coverage of that configuration.**
  - Tested: the boot check as a function; the route in process against the Anthropic stand-in (`apps/game/test/genui.test.ts:430-548`); one live run on a local production build, lab mode, not public mode, reasoning off (`docs/review/evidence/2026-11-03-genui-anthropic-live-check.md:13-18`).
  - `pnpm test:deploy`: never boots with the Anthropic provider. Its design test uses the OpenRouter stand-in and is not in public mode (`tests/deploy/boot-environment.test.mjs:97-101`); its public-mode boots have no `GENUI_ENABLED` (`:19-26`).
  - `pnpm test:container`: never sets `GENUI_ENABLED` (`tests/container/image.test.mjs:23-28`), so every game there is `design: off` (`apps/game/src/experiment/arms.ts:86`) and `/api/genui` answers 404 (`apps/game/src/app/api/genui/route.ts:25`). No model call has been made from the image with either provider.
  - `pnpm test:e2e`: pinned to OpenRouter (`playwright.config.ts:43`).
  - `ops/deploy/smoke.mjs`: no request to `/api/genui`. On the server, the first model call is step 3 of L13, by hand (`docs/deploy.md:278-279`).
- **Untested, in short:** the image making any model call; a public-mode production boot with the Anthropic key; the browser scenarios on Anthropic; a refused or spent Anthropic key against the real service (the live check says so, `:52`); `ANTHROPIC_REASONING_HOST=low` against the real service.

## Owner decisions

### 1. What is v1.1, now that the server waits?

| | (a) Keep v1.1 open until L13 | (b) Tag v1.1.0 now; launch gets its own milestone | (c) As (b), and launch follows the next data release |
| --- | --- | --- | --- |
| Costs | Nothing today | One docs PR (batch 1), tracker edits, a tag | The same; launch also waits for a preparation run and a questions run |
| Release notes | Stay a draft; already miss #250 and #251, and go staler with each merge | About ten edits, listed in batch 1 | The same |
| README | `README.md:8` keeps saying v1.0.0 while `main` is 192 commits past the tag (`git rev-list --count v1.0.0..HEAD`) | `:8`, `:191-193`, `:864` | The same |
| #174 | Open, with L13 and L14 unticked, for as long as the server waits | L13 line moved, L14 ticked, closed | The same |
| Leaves undone | A release for the duels, the 422 rounds, the records, and the hardening that are already merged. The next data run would land inside "v1.1" and change what its notes describe | Launch; the runbook is still unproven on a real server; the experiment has no real players | Launch, by design until the rounds pass run 3's bar |

- For (a): v1.1 was planned as "public launch" (`docs/review/2026-10-20-next-phase-plan.md:1`), and (a) keeps that meaning.
- For (b): v1.0's notes set the precedent, "launch-ready, but still local" (`docs/releases/v1.0.0.md:4-5`), and the draft already says L13 "is not part of this release's verification" (`docs/releases/v1.1.0.md:113`).
- For (c): run 3's bar still fails lines 1, 1b, 2, and 3, "every remaining cause data-level or a wording nit" (`…run-3-fun.md:263-264`), and an artifact change after day 0 is the most expensive kind of change (batch 4).
- **Recommendation: (c).** It costs the same as (b) today and only records an order the deferral already allows.

### 2. #120: which model does each design use in production?

- **What run 3 found** (`…run-3-fun.md:159-174`): catalog 1 wrong claim in 101 on Haiku and 1 in 79 on Sonnet; composer 4 in 130 and 1 in 60; visualizer 2 in 21 and 0 in 14; host 2 in 38 with 3 empty replies of 7 on Haiku, 0 in 43 and none empty on Sonnet. One persona's four matched games, "so each line is a direction".
- **What the code supports:** `<PREFIX>_MODEL_<DESIGN>` and `<PREFIX>_REASONING_<DESIGN>` for both providers (`model.server.ts:45-49`); the default is Haiku for every design (`provider.server.ts:22-25`). On OpenRouter, Sonnet needs `OPENROUTER_REASONING_HOST=low`, since its endpoint refuses reasoning off (`model.server.ts:26-30`). On Anthropic no reasoning setting is needed (the live check ran without one).
- **Cost per five-round game**, computed here from the live check's token counts (`…anthropic-live-check.md:25-31`) at its list prices (`:39`), with a panel every round or two host turns every round:

  | Design | Haiku | Sonnet |
  | --- | --- | --- |
  | catalog | $0.004 | $0.075 |
  | composer | $0.007 | $0.14 |
  | visualizer | $0.005 | $0.09 |
  | host | $0.004 (run 3 measured $0.003) | $0.07 (run 3 measured $0.07; the live check says $0.08) |

  At the experiment's target of 506 games per design (`CLAUDE.md`, "Pre-registered targets"; not recomputed), the host arm costs about $37 on Sonnet against $2 on Haiku. A game's caps bound the worst case at 12 panels, or 8 host turns a round (`apps/game/src/server/rate-limit.server.ts:42`).
- **Options:** (A) Haiku everywhere, the default; (B) Sonnet for the host alone, run 3's recommendation and the only setup both rechecked (`…run-3-fun.md:249`) and live-checked; (C) Sonnet everywhere, 14 to 18 times the explainers' cost for level accuracy.
- **One gap in the evidence for (A):** the retry on an empty host reply merged after the pilot (#245), and the recheck ran the host on Sonnet only. Whether a Haiku host with the retry still answers nothing is unmeasured.
- **Can it close once the owner names a setting? Yes.** Done-when line 1, "the owner picks a model per design", is the comment. Line 2, "an agent run (#122) compares accuracy for the composer and catalog", is met by run 3's pilot, not by #122 (run 2 ran Haiku only). Nothing needs committing; the setting lives in the server's environment, and `docs/deploy.md:128,133` already describe it.
- **Recommendation: (B),** named under the provider launch will use, and decided before day 0: changing a design's model afterwards is a player-visible change that needs a `changes.json` entry and splits the report's periods.

### 3. #160: how easy may the algorithm layer be without the code?

- **Its options:** (1) accept it; (2) tighten the audit so structure names such as `heap` and `queue` count against the scaffold; (3) make hint 1 a step back from the defining trait.
- **Run 2 measured** (layer on, ten rounds, chance 25%): 7 of 10 from the scaffold and options, 9 of 9 after hint 1, 10 of 10 after hint 2; the language layer 2 of 7 (`…run-2.md:101-106`).
- **Run 3 measured** (layer off): algorithm 2, 5, 5 of 5 at stages 0, 1, 2 (`…run-3-fun.md:130`). So hint 1 decides the round with no layer at all, which is #228's finding for the static hints. Its layer-on figure, 5 of 5 at stage 0, is "not interpretable" because those rounds had just been revealed (`:140-141`).
- **Still unmeasured:** layer-on stage-0 accuracy on rounds the solver has not seen; the same rounds with the layer off, to separate what the options give away from what the layer adds; and whether the lift comes from the code's names or from the roles the layer attaches to them. The preparation audit measures a different thing, a model's probability lift over a control that already holds the names (`ops/poc/questions/audit.ts:12-13,52-54`), and the published layers pass it.
- **The number that decides it:** layer-on minus layer-off blind accuracy at stage 0, on the same unseen rounds.
  - At or under 10 points, the audit's own deck bound (`audit.ts:21`): option 1, close #160.
  - Layer-on above 70%, run 3's bar line (`ops/playtest/run-3.md:126-127`), or a lift of 25 points or more, the audit's round bound (`audit.ts:17`): option 2, with the next questions run.
  - In between: not decided by this sample. Only 24 Trace it layers are published (`apps/game/src/demo/generated/question-layers.json`), so each figure carries about 20 points either way, and their difference more.
- **Recommendation:** let that number choose between options 1 and 2, and move option 3 into #228 whatever it says, since hint 1's leak is the deck's and not the layer's. Any rebuild is data work for the next questions run, so #160 should not hold the v1.1.0 tag.

### 4. Which provider does launch use?

- OpenRouter: run 3 measured there; zero data retention is an account setting (`docs/deploy.md:52-54`); Sonnet needs effort `low`.
- Anthropic directly: live-checked once on the owner's key (`…anthropic-live-check.md:14`); no router; the gaps listed in the trace above.
- **Recommendation:** decide it with #120, and run batch 2 first if the answer is Anthropic alone.

## Stale or wrong in the tracker or docs

**Release notes draft**
- `docs/releases/v1.1.0.md:3-5` calls v1.1 "the public release: anonymous play on one instance of the owner's own server"; nothing is deployed, and `:113` of the same file says L13 is outside the release's verification.
- `:10-11` ends the PR list at #245; #246, #250, and #251 merged on 2026-11-03 and 2026-11-04.
- `:74-78` puts the Anthropic provider under "What changed because of it" (run 3) and gives no PR number; #246 does not come from run 3.
- `:28` omits the repository settings of #27 and #250's planted-secret test (`tests/containment/acquisition-boundary.test.mjs:247`).
- `:89-103` ("Upgrading") omits #251: `--offline` needs one `--resume` first, since `LOCK_HASH` moved (`ops/poc/prepare/stack-metadata.ts:16`).
- `:98` says the artifact "is the v7 data run's (`847e7512…`)"; that hash is the 2026-10-26 rebuild's (commit `d0b7e22`, #214). The v7 data run's was `81f31057…`.
- `:105-113` ("Verified") omits the Anthropic live check that `docs/review/README.md:21-22` cites.

**Runbook**
- `docs/deploy.md:133` says "`claude-sonnet-5-5` with `low` is run 3's recommendation for the host". Run 3 ran on OpenRouter, where `low` is forced (`…run-3-fun.md:56-59`); the Anthropic live check ran the Sonnet host with reasoning off (`…anthropic-live-check.md:16-18`). The recommended pair was never run against the real service; only its request shape is unit-tested (`apps/game/test/genui.test.ts:475-476`).
- `docs/deploy.md:274` says L13 runs "with DNS and TLS in place"; the plan says "before DNS" and lists "rate-limit 429s that fall back to static" (`docs/review/2026-10-20-next-phase-plan.md:66`). `ops/deploy/smoke.mjs:186-199` checks the beacon's 429 only, not a generative call falling back.
- No line says when HSTS grows from 300 seconds. The code says "it grows once the public origin has served HTTPS for a while" (`apps/game/src/middleware.ts:32-33`), `README.md:339-340` says "for now", and no issue tracks it.
- Checked and current: every variable in the three tables (`docs/deploy.md:102-138`) against `environment.server.ts:82-113`, `provider.server.ts`, `model.server.ts:45-49`, and the `Dockerfile:37-42`; the health codes (`:187-188`) against `app/api/health/route.ts` and the loader; the log codes (`:169-171`) against every `console` call in `apps/game/src`; every smoke flag (`:265-272`) against `smoke.mjs:17,28-30`; the report flags (`:216`, `:280`) against `ops/experiment/index.ts:27,41-43`.

**README and handoff**
- `README.md:8`: "The current release is v1.0.0", 192 commits behind `main`.
- `README.md:364` and `CLAUDE.md:265`: "Too many new games — wait a minute". The page says "Too many new games. Wait a minute." (`apps/game/src/app/page.tsx:188`; the boot test matches the new wording, `tests/deploy/boot-environment.test.mjs:241`).
- `README.md:745-746`: "the server calls OpenRouter only through the answer-lock guard". Since #246 it calls either provider (`model.server.ts:333`); `CLAUDE.md`'s guardrail names both.
- `docs/review/README.md:3` dates the state 2026-10-26; `:24` "Its release notes" now follows the run 3 paragraph but means v1.0; `:50` lists no PRs for v1.1.

**Tracker**
- #100: "generative-UI arms call OpenRouter only" (either provider since #246); "Open: hosting" (settled 2026-10-20, plan `:39`); "SQLite events (#107)" (events are JSONL); the `needs decision` label.
- #170: `compose.yaml` and Caddy (Dokploy and Traefik instead); `pnpm deploy --prod` (standalone, `Dockerfile:27-31`); "CodeGuessr was updated. Deal new rounds." (the text is "Reload the page to keep playing.", `apps/game/src/components/arcade/arcade-text.ts:175`); the `needs decision` label, when what remains is a domain and a date.
- #120: the title and proposal name the composer and catalog; its done-when cites #122, which ran Haiku only.
- #160: no labels at all, though its body says it needs an owner decision.
- #174: "Decide #120 and #160 before launch" sits in a release checklist that, under decision 1, no longer includes launch.
- Milestone v1.1's description says "~436 rounds"; the artifact holds 422 (`docs/releases/v1.1.0.md:37`).

## Risks

- **Outside my scope, seen while checking the hash:** the working tree's artifact and pin changed at 20:12 today. The pin reads `97fa9b74…`, the committed one `847e7512…` (`git diff --stat`: two files). Either the `--resume` after #251 did not come back byte-identical or it is mid-run. Question layers bind to the artifact's hash, so a game served from this tree plays every round static, and a layer-on blind test on it would measure nothing. Tag only from committed `main`.
- Option (b) or (c) changes what "v1.1" meant in the plan and in `docs/releases/v1.0.0.md:4-5` ("hosting … come in the next release"); the notes must say so plainly.
- Launching on the current artifact would open the experiment on rounds that fail the game's own bar lines 1 to 3 (the data reviewer's scope).
- A #120 change after day 0 is a dated, player-visible change and splits the report's periods.
- `docs/deploy.md` has never run against a real Dokploy; its menu names (`:66-92`) and the 290 MB image size (`:22`, written before #246 added a package) are not verified.
- Batch 2's container case depends on Docker networking that differs between CI and macOS; not verified.
- Claude Sonnet 5.5 can end a turn with a refusal stop reason; `model.server.ts` asks for no fallback, and how the host shows that turn is not verified.
- The privacy page's statement that Anthropic "deletes it within 30 days by default" (`disclosures.ts:132`) was not checked against Anthropic's terms (no network).
- The list prices in decision 2 are the live check's; they match the Claude API reference cached on 2026-11-03, and OpenRouter's own prices were not checked.
- The bulk tracker edits in batch 1 need the owner's hands (a script), and the tag needs the owner's go-ahead, as v1.0.0's did.
