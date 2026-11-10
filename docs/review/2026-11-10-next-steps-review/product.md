# Product review, 2026-11-10

> One reviewer agent's findings, as written on 2026-11-10 against `main` at `03cd25a`, kept for their verdict
> and implementation sketch per issue. Where [the review](../2026-11-10-next-steps-review.md) corrects a point,
> the review stands. Line numbers are that commit's.

## Summary

- Two issues can close now: #103 (the explainer card) shipped as the `catalog` design, and #109 (the roadmap) has nothing left that #174, #100, and #105 do not track.
- No deck, mode, or arm in this scope would move run 3's failing fun lines; two small things would, and both fit the data-quality release: option notes in the reveal (the data half of #64) and #249's four code nits.
- Question layers (#128) come next, after the re-pin and before launch: Diff lens for before-after and Narrow it down for fix, the two decks run 3 called too hard.
- The recap arm (#105), live duel rooms, and practice mode as a mode wait for launch; the three decks (#59 with #147, #60, #61) do not touch the bar and stay later.
- I ran no code, as the brief requires: every claim comes from reading files, issues, and stored event logs, and "evidence doc" below is `docs/review/evidence/2026-11-02-agent-playtest-run-3-fun.md`.

## Verdict per issue

| Issue | Still valid? | Evidence (path:line or PR) | Size (S, M, L) | Depends on | Recommendation |
| --- | --- | --- | --- | --- | --- |
| #103 explainer card (arm B) | No: delivered as the `catalog` design | `apps/game/src/genui/designs.ts:5`, `apps/game/src/experiment/arms.ts:9,28`, `apps/game/src/genui/render-catalog.ts:37-84`; PRs #112, #113, #133 | none left | nothing | close as done (done-when below the table) |
| #109 public-app roadmap | Only #100 and #105 remain, both tracked elsewhere | its checklist against PRs #110–#123, #133, #158, #190–#207; #174 | none left | nothing | close as superseded (below the table) |
| #249, code half (4 nits) | Yes, all four | `apps/game/src/components/arcade/round-header.tsx:17`; `apps/game/src/components/duel/duel-text.ts:13,79`; `apps/game/src/genui/model.server.ts:224-229`; `apps/game/src/demo/local-real-experiment-deal.server.ts:101-121,152-158` | S each | nit 3: one live host check (cents); nit 4: changes every seeded deal, so it goes with the re-pin | do next |
| #64 practice mode | Yes; its text predates four decks | no `practice` or `candidateNotes` anywhere in `apps/` or `packages/`; only project options carry a detail (`ops/poc/prepare/project-rounds.ts:80`) | option notes M; the mode M | notes: a new profile and artifact schema version and a re-pin, no GitHub requests for the first four decks; the mode: launch | do next (option notes only); the mode later |
| #128 question layers | Yes: 2 of 6 designs built, 8 of 10 decks have no layer | `packages/artifact/src/question-layer.ts:14`; 74 layers published (50 Marker hunt, 24 Trace it) | M a design, L in all | a questions run after the re-pin (cents); #159 before Trace table; no new arm | later (first after the data release) |
| #59 Spot the vulnerable line | Yes: built, left out of every profile | #148; `ops/poc/prepare/curated-decks.ts:94`; `ops/poc/prepare/profile.ts:269`; `docs/review/evidence/2026-10-18-vulnerable-line-dry-run.md` | M to turn on | a preparation run (about 1,650 requests without #147), a new profile version, owner decision 3 | later |
| #147 screen advisory commits | Yes, but its stated reason is gone | `ops/poc/prepare/request-policy.ts:11,93` (GET and HEAD only); `ops/poc/limits.json` (`requestCount` 10000) | M | owner decision (one POST shape) | owner decision |
| #60 Which era? | Yes; the owner deferred it on 2026-10-18 | its two comments; no code | L (the issue's size; I did not read `ops/poc/prepare/github-lineage.ts`) | owner decisions, a licence check at old commits, about 450 requests, a schema change | later |
| #61 What does it return? | Yes; unbuilt | no code; `ops/poc/prepare/name-function-window.ts:113` is reusable | L (the issue says M; a new round kind touches about 30 files, as #59's did) | a preparation run (120–180 requests by the issue, not verified), a new schema version | later |
| #105 recap (arm D) | Yes; unbuilt | no `recap` in code; `apps/game/src/components/arcade/round-reveal.tsx:37-71` is #43's static summary | M without an arm, L with one | launch, the arms, an event schema version | later |
| Live duel rooms (no issue) | Named in `CLAUDE.md` "Next steps" 3 and `docs/review/2026-10-20-next-phase-plan.md:253` | no code | L | launch | later |

**#103, done-when line by line.** The proposal's three parts exist as catalog components: code with signals on
their lines (`code_view`, `render-catalog.ts:50-67`), "why not your pick" (`comparison`, `:68-84`, with the pick sent
by `explainRequest`, `apps/game/src/genui/genui-panel.tsx:35-37`), and a takeaway (`takeaway`, `:37-41`). It is built
from the reveal fields through the guard (`apps/game/src/genui/round-context.server.ts:103-116`).

1. "every deck renders an explainer in a local run, with a few rounds per deck read by hand": **met for 8 of 10
   decks, 2 not verified.** Six decks rendered and were read by hand on 2026-10-14
   (`docs/review/evidence/2026-10-14-genui-live-check.md:55-62`). Run 2's event log holds successful catalog calls on
   exercise, algorithm, fix, language, and a daily game (`ops/playtest/tmp/2026-10-20-run2/events/events-2026-10-20.jsonl`,
   ignored by git). Run 3's recheck played missing-line with the catalog explainer (evidence doc `:228-229`). I found
   no live catalog render on name-function or framework: run 2 played those with other designs. The design is the
   same code for every round kind, and two rounds would cost about $0.002.
2. "the card passes a11y and works by keyboard alone": **met.** axe on the explainer in every theme
   (`tests/e2e/themes.spec.ts:40-51`); the request is a native button (`genui-panel.tsx:141`) and focus moves to the
   output (`tests/e2e/genui.spec.ts:282-290`).
3. "it records `genui_rendered` and `genui_interaction` events (#107)": **met under other names.** No
   `genui_rendered` exists anywhere. The server records `genui_call` with `ok` and `calls`
   (`apps/game/src/demo/local-real-experiment.server.ts:236`, `apps/game/src/experiment/events.ts:65`); the browser
   sends `genui_interaction` (`genui-panel.tsx:120`) and `genui_fallback` (`:134`). A rendered panel is an `ok` call
   with no fallback for that round, which is what the report counts (`ops/experiment/report.ts:145-147`).
   `tests/e2e/events.spec.ts:163-178` holds both events to one game.

Two things differ from #103's proposal, both by later decisions: the explainer runs when the player presses "Explain
this round" (`genui-panel.tsx:140-144`), not automatically, and the static reveal folds once a panel renders
(`round-reveal.tsx:211`, #121) instead of staying open under it.

**#109, what is left.** It has no done-when, only a goal and a sequence. Phases 1 and 2, measurement, the report,
and hardening are merged. Of its unticked boxes, #114, #115, and #116 closed on 2026-10-15 (#117, #118, #123); #103
is the row above; #100 is L13 and L14 on #174; #105 stands as its own issue. Its goal, "a public game", is met only
at launch, which #174 already gates. Closing it also removes four stale statements (listed under "Stale or wrong").

## Proposed order

**What would move run 3's failing lines.** After the recheck, the replayed cells still below 3 are variety (F1) on
fix and framework, tension (F2) on exercise, framework, missing-line, and name-function, reveals (F4) on missing-line
and name-function, and hints (F5) on exercise, framework, and mixed; 16 more cells on project, language,
before-after, algorithm, and output were not replayed (evidence doc `:232-238`). Ranked by expected effect:

1. **Option notes in the reveal (from #64): F4, and F5 indirectly.** An option note is one sentence per option
   saying what that option is; #64 calls the field `candidateNotes`. For three decks the sentences exist in the
   profile and are sold as hint 1 today: `clues = [entry.idea, …]` in `ops/poc/prepare/algorithm-rounds.ts:59`,
   `exercise-rounds.ts:65`, and `framework-rounds.ts:68`. That is #228's finding; the evidence doc's difficulty
   table puts it as "hint 1 is the reveal's definition" (`:130`). When #228 replaces those hints, the definitions
   belong in the reveal, where they teach.
2. **#128, Diff lens and Narrow it down: F2 and F5 on before-after and fix**, the two decks judged too hard
   (evidence doc `:129,132`), but only in games drawn `layer: on`, which is half of them.
3. **#249's nits: bar line 2.** The host's repeated opener is one of the four strings still shown in more than two
   rounds of a game (evidence doc `:240-242`). Nit 4 is a variety item on the family decks.
4. **#105 recap: replay pull (F7)**, through a suggested next deck. It is the only item aimed at the experiment's
   primary metric, the deal-again rate, and it cannot be judged without real players.
5. **Live duel rooms** would strengthen the one row with no failing cell (duel, evidence doc `:98`). They lift no
   failing row.
6. **Orthogonal:** the three decks (each adds a row that must pass on its own; vulnerable-line has fix's shape, and
   fix scored F1 2 with 23 of 26 sighted rounds self-rated guesses), practice mode as a mode (no score, so no
   stakes), #103, and #109.

**Batch 0: tracker only, no code.** Close #103 and #109, and correct the lines under "Stale or wrong".

**Batch 1: rides with the data-quality release.**

1. **#249 nit 1, day streak on a first daily game (S).** `recordsAtStart` returns 0 both for "not today's five" and
   for "no streak yet" (`apps/game/src/components/arcade/local-records.ts:153-157`), and `ArcadeHeader` hides the
   streak at 0 (`round-header.tsx:17`). Return `null` for a game that is not today's five and show a start label at
   0. About ten lines in three files (`arcade-shell.tsx:263` passes it); tests in
   `apps/game/test/local-records.test.ts:119-125`, `apps/game/test/arcade-shell.test.tsx:256-258`, and
   `tests/e2e/records.spec.ts:81-96`. Measure the header at 320 px on Linux fonts.
2. **#249 nit 2, duel wording (S).** `firstPlayNote(…, true)` returns `First time for ${name}`
   (`duel-text.ts:79`), shown under the verdict by `apps/game/src/components/duel/duel-comparison.tsx:37`.
   `RESULT_NAMES.challenged` is `"Friend"` (`duel-text.ts:13`), used by the result page (`duel-pages.tsx:61,68`) and
   the result share line (`duel-game.tsx:173`). Two strings to change; "A friend" is what `DEFAULT_NAME` already says
   (`duel-text.ts:11`). Tests: `apps/game/test/duel-ui.test.tsx:95,180,192-193`, `tests/e2e/duel.spec.ts:168`.
3. **#249 nit 3, the host's repeated opener (S).** `DESIGN_RULES.host` asks for "warm, brief, and a little playful"
   and says nothing about openers (`model.server.ts:224-229`). The host's earlier lines already come back as its own
   turns (`:89-95`), so one sentence is enough: never open two replies in a round the same way. No test can hold a
   model's wording; check it with three after-lock turns on the live Sonnet host (about $0.008 a turn).
4. **#249 nit 4, family order within a game (S, with the re-pin).** `arrangeForGames` fixes each game's order as a
   by-product: `fit` ranks an urgent family first (`local-real-experiment-deal.server.ts:105`), equal fits keep the
   pass's order (`:113-121`), and `seriesRounds` takes the five as arranged (`:152-158`). Shuffle each game's five
   with a seeded source after line 158: three lines. It changes every seeded deal, so `GOLDEN_DIGESTS`
   (`apps/game/test/duel.test.ts:198`), the game-0 pin (`apps/game/test/local-real-experiment.test.ts:147`),
   `DEAL_SEEDS` (`ops/demo/record/scenes.ts:68`), and the media all move. A new artifact moves all of those anyway,
   so put it in the re-pin's PR. Not verified: I did not reproduce "ciphers fifth".
5. **Option notes (M for four decks, L for all ten).** A reveal-only fixture key from the next profile version
   (`packages/artifact/src/artifact.ts:68-69`, paired in `packages/artifact/src/domain.ts:23-29`), kept out of
   everything shown before the answer by the containment check. Generators: the three family decks copy each
   option's `idea`; language takes its look-alike note from `ops/poc/prepare/language-markers.ts`. Game: `revealFor`
   (`local-real-experiment.server.ts:246`), `AuthorizedReveal`
   (`apps/game/src/components/arcade/arcade-session.ts:103-134`), a short list in `RoundReveal`
   (`round-reveal.tsx:198-205`), and the after-lock context (`round-context.server.ts:103-116`), so the explainer's
   `comparison` rows rest on data. No GitHub request and no model call. The other six decks need generator work (#64
   lists the data for each) and can follow in a later run.

**Batch 2: after the re-pin, before launch.** #128, two designs: Diff lens (before-after), then Narrow it down
(fix). Layers bind to the artifact's hash, so they are rewritten after the re-pin in any case. Each design touches
the same four places:

- the parser: `QUESTION_DESIGNS` (`question-layer.ts:14`), a layer type, `textsOf` (`:121`), `requireNoOption`
  (`:139`), and a branch in `parseQuestionLayer` (`:182`);
- the writer: `bannedWords`, `DESIGN_RULES`, `TOOLS`, and `layerFrom` in `ops/poc/questions/designs.ts:16,33,50,120`;
- the audit: `codeFacts`, `scaffoldText`, and `hintText` in `ops/poc/questions/audit.ts:52,57,62`;
- the game: `scaffoldOf` and `detailOf` (`apps/game/src/demo/local-real-experiment-layers.server.ts:59-67`),
  `RoundScaffold` and `HintDetail` (`apps/game/src/components/arcade/mode-contract.ts:33-40,78-89`), and
  `QuestionScaffold` (`apps/game/src/components/arcade/question-layer.tsx:9-23`).

Diff lens also needs line numbers and marks on two panes; today only a single pane has them
(`arcade-shell.tsx:96`, `code-panes.tsx:50-69`). Narrow it down sits on fix's numbered pane, and its first hint,
"which region", is the partial hint #229 asks for. Cost is small: the first build made 196 calls for $0.056
(`docs/review/evidence/2026-10-15-question-layers-first-build.md:119-120`). No arm changes: `layer` stays off or on
(`arms.ts:13`), and the report counts that factor only on decks that have layers, so each deck added brings the
356-a-level target closer. Trace table waits for #159: 24 traces are published and a reader refused 7 more as wrong
(`ops/poc/questions/reviewed.ts:6-28`). Clue board comes last.

**Batch 3: at or after launch.**

- **#105 recap.** A game-level guard context (five after-lock round contexts plus `outcomes` and `hintsByRound`
  from the token, `apps/game/src/demo/local-real-experiment-session.server.ts:16-58`), a branch in the route, which
  requires a `roundId` today (`apps/game/src/app/api/genui/route.ts:17,48`), a next-deck component whose deck is a
  closed choice, and a mount in `RoundReveal`'s finished-game block (`round-reveal.tsx:185-197`) with `GameSummary` as
  the fallback. `genui_call` requires a round and one of two phases (`events.ts:33,65`), so a game-level call needs an
  event schema version. How it joins the arms is decision 6.
- **Practice mode as a mode.** A fifth deal kind, `practice`, in `DealDescriptor`
  (`local-real-experiment-deal.server.ts:207-229`); it adds no key, so the token's key list and MAC context stand.
  `revealFor` scores by hints bought (`local-real-experiment.server.ts:257`) and would skip that for the kind. The page
  seals `record: false` as `&replay=1` does (`apps/game/src/app/page.tsx:298,323`) and passes no `records`,
  `shareHref`, or `duel`. Deal it unseeded, so the plays ledger and challenge links are untouched.
  `local-real-experiment.server.ts` is at 452 of the 500 lines `apps/game/test/local-real-experiment.test.ts:37`
  allows.
- **Live duel rooms.** A `rooms` migration in `apps/game/src/server/state-store.server.ts`, one new route for room
  state (the containment test allows only the routes it names), both sides dealt from one sealed deal with one set
  of arms (`dealChallenge`, `challengedArms` in `arms.ts:95`), `OpponentStrip` and `duelVerdict` for display, new
  rate-limit surfaces, a privacy entry, and a way to tell room games apart in events. On localhost the server binds
  127.0.0.1, so a second player cannot join at all.

**Batch 4: later, when a preparation run has room.**

- **#59.** The section exists as test data (`ops/poc/prepare/testdata/vulnerable-line-section.json`). It needs a
  new profile version (v7 must keep rebuilding `847e7512…`), more `published` windows, and either a higher
  `VULNERABLE_COMMIT_READS_MAXIMUM` or #147. Today's cap is 600 (`profile.ts:269`) and the selector stops there
  (`ops/poc/prepare/select-vulnerable-line.ts:81`); at the measured 87 commit reads a round that is about 7 rounds,
  then `DECK_SHORT` (`:148`). Supply is the larger problem: the dry run used up three ecosystems over 2021–2024 for 9
  rounds that would not balance even as a deck of 8 (dry-run doc `:44,69-70`). The game already plays the kind
  (`mode-contract.ts:5-12`, `apps/game/src/app/page.tsx:38`). Nothing under `apps/game/src` or in `docs/licences.md`
  credits the advisory database, which #59 says must be credited under CC-BY-4.0.
- **#61.** A sibling of name-function: `declaredFunctions` already finds Go and Java functions; mask the return
  type instead of the name. New selector, generator, and `packages/artifact` module, a registry entry, and a round
  kind. Supply is not verified: it reads files three decks already use.
- **#60.** As the issue and its 2026-10-18 comment say: the preparer's own licence check at old commits first.

## Owner decisions

1. **Close #103 without a live catalog render on name-function and framework?** Close now: the design is one code
   path for every round kind and eight decks are on record. Or run two rounds first (about $0.002). I recommend
   closing.
2. **Close #109, or keep it as an umbrella with its boxes ticked?** Everything open in it is on #174 or is #105.
   I recommend closing.
3. **How should "Spot the vulnerable line" be filled, when its turn comes?** (a) Leave it deferred. (b) GET only,
   with a higher commit-read cap: about 1,650 requests for 16 rounds. The v7 run used 6,245 (`CLAUDE.md:608`), so the
   total is about 7,900 of 10,000, and the "past its 5,000-request budget" reason on #59 no longer holds. (c) #147's
   GraphQL screen: about 700 requests, at the price of the policy's first POST and request bodies in the journal
   key. I recommend (a) for the next release, then (b) as a dry run with more windows, and #147 only if that dry run
   shows the budget or the supply binding.
4. **Split #64?** Option notes need a schema version and help every game's reveal; the mode needs players who want
   to practise. I recommend notes with the data release and the mode after launch.
5. **Which layer designs before launch, and is Diff lens's diff for everyone?** Before launch no change-log entry
   is needed (`ops/experiment/changes.json` is `[]`); after it each design is a dated change that splits the layer
   comparison. The aligned diff is computed without a model, so it could show in every before-after game. I
   recommend Diff lens and Narrow it down before launch, and the diff for everyone if the data reviewer's
   before-after work (#231) agrees. #128's "Clue board by default" for the four v1.0 decks should be decided per
   deck after these two are judged.
6. **How does a recap join the experiment?** (a) A sixth `design` level: `targetFor` counts levels
   (`ops/experiment/report.ts:52-53`), so even at weight 0, which #105's done-when asks for, the design target rises
   from 506 to about 530 a level (hand-computed from `sampleSize`, `ops/experiment/statistics.ts:136-144`). (b) Its
   own factor: no extra games, since every game counts toward every factor (`arms.ts:2-4`), and a target of 356 a
   level; but factor names are event base keys (`events.ts:136`) and sealed arm keys (`arms.ts:39-44`), so it needs
   events v3, a new game state, and new duel tokens. (c) A static next-deck line for everyone and no arm. I
   recommend deciding after the first report, and (b) if it is built.
7. **After launch, live rooms or a versus-bot first?** Duel is the only row with no cell below 3 and tension is the
   widest failing column; the plan's Later list names both (`docs/review/2026-10-20-next-phase-plan.md:253-254`) and
   neither has an issue. I recommend filing both at launch and building neither now.

## Stale or wrong in the tracker or docs

- `docs/releases/v1.1.0.md:130` says #59 is "not built". It is built and left out of the profile (#148,
  `ops/poc/prepare/curated-decks.ts:94`).
- #109: boxes for #114, #115, #116 are unticked though all closed on 2026-10-15. "v1 runs three arms" and "about
  430 completed games per arm" against five design levels and targets of 506, 475, and 356 (`arms.ts:9`,
  `report.ts:45-53`). "Every arm uses the same model" against a model per design (`model.server.ts:45-46`). "Through
  OpenRouter" against two providers (#246).
- #103: `genui_rendered` was never an event (`events.ts:57-74`); "the static reveal text stays visible underneath"
  against the fold (`round-reveal.tsx:211`). No milestone.
- #105: "#43 plans a static five-round summary" (it shipped in #139, `round-reveal.tsx:37-71`); "three arms"; its
  weight-0 done-when line would move a pre-registered target (decision 6).
- #128: its done-when says "agent playtest run 2 (#122) covers them", and #122 closed on 2026-10-20. Its table
  leaves the four v1.0 decks without a design, and `CLAUDE.md` "Next steps" 3 says "the other four question-layer
  designs", which hides that eight of ten decks have none.
- #59: "Needs owner decision: no", while both ways forward need one; "about 450–500" requests against the measured
  1,650; "the request policy needs `/advisories` added" is done (`request-policy.ts:60-65`).
- #147: no labels. Its premise, on #59's comment, is the 5,000-request budget; the ceiling is 10,000.
- #60: two of the body's four open decisions are settled in its comments (the allowlist on 2026-10-15, the year
  ranges on 2026-10-18); "takes the run near 3,000" predates v7's 6,245.
- #64: lists six decks; "should ride with the next profile change", and v6 and v7 both passed without it.
- #61: its reuse list predates `declaredFunctions` (#143).
- `apps/game/src/genui/genui-panel.tsx:34`: the comment "free chat arrives with the host arm (#104)"; it arrived in
  #119.
- Live duel rooms, the versus-bot, and "Replay misses" are named in `CLAUDE.md` or the plan's Later list with no
  issue.

## Risks

- Option notes enlarge the data-quality release by a schema version and several generators. If that release plans
  no new profile version, the notes carry that cost alone.
- Nit 4, like any new artifact, makes earlier challenge links refuse with `DEAL_DRIFT`: harmless before launch, a
  dated change after it.
- More layer designs mean more model-written text that nothing executes. Hold to the two mechanical designs until
  #159 lands.
- Each new deck adds a row to the fun bar that must pass by itself.
- Run 3's raw records (`ops/playtest/tmp/2026-11-02-run3/`) are not in this checkout, so the ranking rests on the
  evidence document alone.
- Outside my scope: `CLAUDE.md:544` says nothing uses `node:sqlite` yet, while the state store does (#164).
- Outside my scope: `docs/review/README.md:3` is dated 2026-10-26.
- Outside my scope: whether #228 really frees the family decks' `idea` sentences decides how cheap option notes are.
