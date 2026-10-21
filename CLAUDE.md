# Claude handoff: CodeGuessr local real-round PoC

## Mission

A "guess from the code" game. One preparation run crawls real
open-source code before play and freezes ten decks (296 rounds since the v1.0
data run), each a pool of rounds from which every game deals five:

- "Which project?": 24 rounds of popular repositories from The Stack v2.
- "Which language?": 52 rounds over 26 languages in look-alike pairs,
  from The Stack v2.
- "Before or after?": 20 refactor commits from GitHub search.
- "Which algorithm?": 24 TheAlgorithms files (Python, Go, Java), names hidden
  as `mystery`, offered against their family of four.
- "Predict the output": 24 TheAlgorithms/Python functions and one doctest
  call each, read as text and never run.
- "Spot the fix": 24 one-line fixes that Defects4J and BugsInPy record,
  confirmed against each upstream fix commit.
- "Missing line" and "Name the function": 24 rounds each from TheAlgorithms.
- "Which framework?": 32 TodoMVC files; "Which exercise?": 48 Exercism
  reference solutions.

The goal is anonymous public play on one instance of the owner's own server (v1.1, #100). Until #100's launch gates
close, the game is served on localhost only.

## Read first

1. `docs/review/README.md`: the current state, every phase with its PRs, and
   links to each review, plan, and run record.
2. `docs/review/2026-10-11-codeguessr-state-review.md`: the 2026-10-11
   decisions and roadmap; its findings are historical, from before Phase 0.
3. `docs/review/2026-10-13-new-rounds-research.md`: the three decks added in
   Phase 3b, the sources checked, and the backlog of further decks.
4. `docs/review/2026-10-13-next-sources-plan.md`: the plan for forges beyond
   GitHub (GitLab, Software Heritage) and the era deck.
5. `README.md`: how to play, prepare, record, and verify.
6. `docs/releases/v1.0.0.md`: what v1.0 adds, and its known limits.

`docs/gangsta/` is the historical record of the signed-Contract process, which
was retired on 2026-10-11. Use it for background on why rules exist, not as a
gate: changing queries, retries, ceilings, deck rules, or running
`pnpm prepare:poc` again needs no revision, signature, or authorization.

## Guardrails

- Anonymous public play, once #100's launch gates close; until then, localhost only.
  - No accounts and no personal data. Nothing stores or logs an IP address, user agent, cookie, or persistent id. Rate
    limits (#98) may read the client address in memory, in one module, and never keep it.
  - One instance, on the owner's own server (#170). Rate limits and counters live in the process and the session ledger
    on its volume (#164), so a second instance needs shared stores first.
  - Lab mode (`EXPERIMENT_LAB`) is never on in production, except for a smoke run tagged with a non-real
    `EXPERIMENT_SOURCE`.
  - After launch day, every player-visible change (UI, artifact, or arms) gets a dated entry in the experiment change log
    (#169), so the report can split its periods.
- Public open-source code only, with licence and recorded-author data.
- Bounded, selective reads only. Never download a whole dataset, a whole
  language shard, or a repository archive. The Stack v2 stays pinned to
  revision `e565caa3a78c2423bd374333a472b049eb090e47` unless deliberately moved.
- Credentials come only from standard stores (`~/.cache/huggingface/token`,
  `gh auth token`, and for generative UI `~/.config/openrouter/key`, mode
  0600) through the environment; on the server, only from its secret store, never through `NEXT_PUBLIC_*`. Never log
  or commit tokens, provider bodies, contact data, private email, or source excerpts from failed diagnostics.
- The control arm plays the frozen local artifact and makes no outbound request. The one exception is opt-in generative
  UI (`GENUI_ENABLED=1`, #101). Its server route `apps/game/src/app/api/genui/route.ts` calls OpenRouter only through
  the answer-lock guard, for a live game's round. The browser talks only to the game's own origin, never to a model.
  Spend limits live on the OpenRouter key, not in the app; the app's rate limits and per-game caps fall back to the
  static reveal.
- Preparation may also call OpenRouter: `pnpm prepare:questions` (#127) writes
  question layers with a model that knows the answer. Its answers are journaled
  in `ops/poc/questions/tmp/journal.jsonl` (gitignored) and its output is
  frozen and pinned, so play still never calls a model before the lock.
- The preparation guardrails above (bounded reads, the licence allowlist, credentials) are unchanged by public play.
- Malformed provider data fails closed. Transient errors may be retried within
  the request budget.
- Preserve unrelated worktree changes.

## Current state

- Phases 0 to 3b are merged into `main`, so start new work from `main`:
  - #7 Phase 0, #8 Phase 1, #9 Phase 2, #10 Phase 3a;
  - Phase 3b on 2026-10-13: #12 curated sources, #13 algorithm, #14 output,
    #15 fix, #16 game UX, #17 go-live, #18 the vertical `demo.gif`.
- v1.0 (milestone #4, checklist #130) is merged too: #131–#162, from 2026-10-15 to 2026-10-20, on top of the
  public-app Phases 1 and 2 (#110–#123). Its release notes are `docs/releases/v1.0.0.md`. The `v1.0.0` tag and GitHub
  release wait for the owner's go-ahead.
- The game plays profile `ops/poc/profiles/local-real-rounds.v6.json` and
  artifact schema `local-experiment-artifact.v5` from the root-route deck
  chooser (`/?deck=<deck id>`). A
  page load deals five rounds from the deck's pool; `dealGame` in
  `apps/game/src/demo/local-real-experiment.server.ts` does it server-side.
- **Profile v6 (#129):** `ops/poc/profiles/local-real-rounds.v6.json` is the v1.0 data run's profile. It configures
  every v1.0 deck built so far (missing-line, name-function, framework, exercise), the seven rarer pairs for the
  language deck alone, the wider allowlist (BSD-2-Clause, ISC, Python-2.0), and the raised ceilings in
  `ops/poc/limits.json` (5,000 requests, 448 MiB of Stack metadata, 400 blob attempts, 200 blobs, 32 MiB), and a
  before-after pool of 20.
  - `PROFILE_VERSIONS` and `ARTIFACT_SCHEMA_VERSIONS` (`packages/artifact/src/domain.ts`) pair each profile with
    its schema: v5 with `local-experiment-artifact.v4`, v6 with `.v5`. The parser holds an artifact to its
    snapshot's version, in its schema and every source.
  - The preparer runs v6 (`PROFILE_VERSION`) since the data run (2026-10-19). Rules for v6 apply to v6 artifacts
    only (`profileAtLeast`), and the parser still reads v5 artifacts.
  - v6 rules so far:
    - **#78, output answers read off the call:** `transformsArgument` reads an output off its call when it
      reorders the call's numbers or, not being a number, is a piece of the arguments or an anagram of a string
      argument. No answer may be the only such option (`transformGivesAway`), and picking that option scores at most
      chance and a tenth over a deck's worded rounds (`transformScore`, `transformLimit`). The answer search
      budgets it, and the parser checks both.
    - **#77, project panes that echo an option:** no pane shares a distinctive word with any of its round's
      options as shown, owner, name, and description (`sharedOptionWords` in `packages/artifact/src/project.ts`:
      five-letter stems of words of three letters or more, common code and English words aside, the leakage
      test's overlap solver). A repository is described before its files are tried, an answer's pane is held to
      its own words and the other answer's (and neither answer's code or file name may name the other), and a
      decoy whose words an answer's pane shows is skipped. The parser also reads names inside identifiers
      (`namesRepository`, now in `packages/artifact`).
    - **#84, weak rounds:** a Stack file under a generator's directory (`…Gen/`) or named `test<n>` is skipped before
      it is read (`generatedPath`), and a window half of whose lines only declare data is refused (`dataOnly`, in
      `excerpt-window.ts`). One output round per idea: no two functions named for one thing (`sameIdea` in
      `packages/artifact/src/ideas.ts`: every word of the shorter name, of two or more, is a word of the other), and
      none that agrees with a chosen function on two documented calls. One fix round per file: no two fixes in one
      file, or in files side by side named alike (`sameFile`), skipped before any upstream request.
    - **#75, before-after pane sizes:** the later pane is the bigger one by characters in half the pool, give or
      take one, and picking the pane with more lines or the longer changed line wins at most 60% (`growthFits` in
      `packages/artifact/src/before-after.ts`). Once one side is full, a commit that would add to it is skipped by
      its patch before any tree or blob (`patchGrowth`), then by its windows. A commit must change code: one whose
      patch changes only comments, or whose files differ only in comments, docstrings, or string text
      (`changesOnlyProse` in `code-skeleton.ts`), is refused. The v6 pool is 20 rounds.
    - Dry run of these rules on the v5 data: `docs/review/evidence/2026-10-19-v6-leak-rules-dry-run.md`.
- **Mixed and daily play (#56, #74):** `/?deck=mixed` deals one round from each of five decks drawn at random
  (`MIXED_DECK`, offered when the artifact holds five decks or more); `/?deck=daily` deals the same mix seeded by
  the artifact's hash and the local date (`dailyRandom` in `local-real-experiment-deal.server.ts`). Both are
  `SessionDeckId`s, sealed in the token and named in events; each round's eyebrow names its deck, and a game's
  `attainableMaximum` is the sum of its rounds' top points.
- **Seeded deals (#40):** a deck's or the mix's address without `&deal=<8 hex>&game=<n>` redirects to a fresh seed's
  game 0. Game n takes positions 5n to 5n + 4 of the pool in the seed's order (`seriesRounds` in
  `local-real-experiment-deal.server.ts`, a fresh order each pass), and its options in a seeded order, so a reload
  deals the same game and "Deal new rounds" links to game n + 1. A game that starts a new pass shows a note.
- The server holds each game's progress (#96): `dealGame` seals it in a signed
  token (`local-real-experiment-session.server.ts`), and the hint and answer
  server actions take one step each. A ledger refuses an older token, so a
  round takes one answer, and score and hint counts are the server's. Hint
  text never ships with the page. `CODEGUESSR_SESSION_SECRET` (32+ chars)
  keeps games alive across restarts; without it each local process makes a random
  secret.
- **Public mode (#97, L4):** `CODEGUESSR_PUBLIC=1` marks a public server, and `checkEnvironment`
  (`apps/game/src/server/environment.server.ts`) holds it to anonymous play:
  - it requires the session secret, an https `CODEGUESSR_PUBLIC_ORIGIN` with no path, absolute `CODEGUESSR_STATE_DIR`
    and `EXPERIMENT_EVENTS_DIR`, a `CODEGUESSR_CLIENT_IP_HEADER` name, and the OpenRouter key under `GENUI_ENABLED=1`;
  - it refuses lab mode and an `OPENROUTER_BASE_URL` other than OpenRouter's unless `EXPERIMENT_SOURCE` is `agent` or
    `synthetic`, and an `EXPERIMENT_DISABLED` pair it doesn't know;
  - `src/instrumentation.ts` runs it at boot: each failure prints `GAME_ENVIRONMENT_REJECTED <CODE>`, never a value,
    and the server exits 78. `pnpm test:deploy` (`tests/deploy/`) boots the production build to check that.
  - In public mode `secret()` throws rather than make a secret up, and `labMode()` is off for real games.
    `app/error.tsx` and `app/global-error.tsx` say nothing internal. The `dev` and `start` scripts still bind
    127.0.0.1; only the container (#170) will bind 0.0.0.0.
- **State store and health (#164, L7):** with `CODEGUESSR_STATE_DIR`, `recordStep` writes each game's step through to
  `<dir>/state.sqlite` (`server/state-store.server.ts`, on `node:sqlite` via `server/sqlite.server.ts`, loaded with
  `process.getBuiltinModule` so webpack never sees it; WAL, `busy_timeout`). `readGame` checks memory, then the store,
  and ends a game the store doesn't know (`SESSION_ENDED`), so a restart can't replay a seen round. Migrations count
  in `user_version`; add a table (duels, #173) as a new migration. Without the directory, the ledger is memory-only as
  before. `deriveKey(context)` is HKDF-SHA256 of the session secret, for other features' signing keys.
  `GET /api/health` (`app/api/health/route.ts`) answers `ok` or 503 with a bare code and records nothing. Events stay
  JSONL.
- The answer-lock guard (#102) is the only path from round data to a model:
  - `modelContext` on the experiment reads the sealed game, and
    `apps/game/src/genui/round-context.server.ts` builds the round's context.
    Before the lock that is deck, prompt, option labels, bought hints and
    score; after it, the code and the reveal too.
  - `modelInput` wraps the round as escaped JSON inside `<round_data>`, under
    a system rule that it is data and never instructions.
  - A model may render only `apps/game/src/genui/render-catalog.ts`
    components, checked by `parseRenderCall`.
  - `apps/game/test/answer-lock.test.ts` checks every committed round, an
    injection fixture, and that only `genui/model.server.ts` may import a
    model client.
- Generative UI's foundation (#101) runs on the Vercel AI SDK, not CopilotKit.
  CopilotKit 1.79 shipped install analytics (Scarf), Segment telemetry, and
  about 720 packages; the AI SDK is about 25 packages and sends nothing by
  itself.
  - `genui/model.server.ts` streams one step through an OpenAI-compatible
    provider pointed at OpenRouter (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`,
    default `anthropic/claude-haiku-5.5`, `OPENROUTER_BASE_URL`), and asks
    for `data_collection: "deny"`. The tools are the catalog components;
    each call is checked by `parseRenderCall` in its `execute`.
  - Before the lock it refuses a chat turn that pastes the round's code.
  - The panel (`genui/genui-panel.tsx`) loads lazily on a revealed round and
    renders only checked outputs. Any failure, a 402 from a spent key
    included, leaves the static reveal.
  - The SDK streams a call's raw input before it is checked; nothing renders
    it.
  - Tests use `tests/e2e/fake-openrouter.mjs`, never the real service:
    Playwright starts it on `E2E_PORT + 1`, and `apps/game/test/genui.test.ts`
    runs it in-process.
  - Requests turn reasoning off (`reasoning: { enabled: false }`): Claude
    Haiku 5.5 thinks by default and, on the first live check, spent the whole
    output budget on it. After-lock code goes to the model as numbered lines,
    and the panel tells it the player's pick.
  - The server logs codes only: `GENUI_FINISHED <phase> <finishReason>
    calls=<n> in=<tokens> out=<tokens>`, `GENUI_RENDER_REJECTED <component>
    <check>`, `GENUI_STREAM_FAILED <status>`.
  - Designs (#114, Phase 2 of #109): `catalog`, `composer`, `visualizer`,
    `host`, or `off` (`genui/designs.ts`). Each game draws one at deal time
    (#106); in lab mode `?design=` picks it and a "Designs" nav switches.
  - The composer (`genui/composer-spec.ts`, `genui/composer-view.tsx`) lets
    the model lay out the whole post-lock panel as a json-render spec. The
    spec is a tree of 14 blocks: stack, row, card, details, heading, text,
    callout, code excerpt, list, table, badge, meter, divider, and quiz.
    - Elements may carry only type, props and children: no state, actions,
      visibility, repeats, or expressions.
    - `parseComposerSpec` checks it on the server and again in the browser.
    - A refused panel gets one repair round, told which check failed.
    - Live, a composed panel costs about $0.0012 (7K tokens in, 1K out).
  - The visualizer (#115, `genui/visualizer-spec.ts`, `visualizer-view.tsx`)
    lets the model write one small HTML page that shows the round's code at
    work. It runs in an iframe with `sandbox="allow-scripts"` (opaque origin)
    and a CSP of `default-src 'none'` put ahead of the model's markup: no
    network, storage, or game access.
    - `parseVisualizer` refuses external URLs, links, meta, base, frames,
      forms, network and storage APIs, parent, top, or location access, and
      pages over 40 KB. It matches access patterns, not words.
    - An e2e page spells its escapes in pieces to pass those checks, and the
      sandbox still stops it.
    - Live: 11–16 s, about 2–3K output tokens (about $0.0015).
  - The host (#104, `genui/host-chat.tsx`) is a chat beside the round.
    - Before the lock it sees no code (the guard) and can call `offer_hint`.
      That renders a buy-hint button the player presses at the round's own
      cost; the host never buys or invents hints.
    - After the lock it discusses the code with the catalog components.
    - Its earlier `host_message` replies go back as its own turns.
    - Live, it declined every request for the answer before the lock.
  - Agent playtests (#116): `ops/playtest/driver.mjs` keeps real browser
    sessions on the game behind a small JSON API, and `ops/playtest/README.md`
    is the protocol: five Claude Haiku persona players and two Claude Sonnet
    judges, run as Claude Code subagents. Run 1
    (`docs/review/evidence/2026-10-14-agent-playtest.md`, $0.05 of
    OpenRouter):
    - found no answer leak in 41 red-team attempts;
    - ranked the visualizer best for explaining and the catalog best for
      UX;
    - drove the fixes now in place:
      - the token records hints bought per round (`hintsByRound`); after
        the lock the model sees only `boughtHints` and the options'
        `optionDetails`;
      - the context's score is named `totalScore`, and the composer's
        Meter is gone;
      - the host after the lock gets host_message, takeaway, and
        signal_list only; its plain-text replies render; a refused paste
        leaves its history;
      - the paste check decodes base64;
      - the visualizer frame sizes itself from a game-owned height
        reporter;
      - focus moves to the explainer output.
    - Run 2 (`docs/review/evidence/2026-10-20-agent-playtest-run-2.md`, $0.05) added themes, layers, and the new decks
      and modes. The driver takes `theme` and `layer`, deals `mixed` and `daily`, and has `trace-step` and `click`.
      - It found no leak in 28 host attacks. The composer is now the most accurate design (2 wrong claims in 184),
        and the visualizer the least.
      - Its fixes:
        - the host shows plain text only when a reply has no component;
        - after the lock the host is told the player's pick (`withPick` in `host-chat.tsx`);
        - the host sends at most 16 messages (`HOST_HISTORY`, the route's cap);
        - the paste check also reads hex, rot13, and reversed text;
        - a failed panel offers "Try again" once;
        - marked lines are named for screen readers, and layered rounds number their lines;
        - a review-refused trace (`reviewed.ts`).
    - Open: #120 (model per design), #159 (check traces against the code), #160 (the algorithm layer's fairness),
      #161 (UI polish).
  - Composer and visualizer requests keep only the first panel or page
    (`ONE_ONLY`) and ask for `parallel_tool_calls: false`; live, Haiku
    sometimes wrote several pages at once.
  - Live check, with each explain about $0.0007:
    `docs/review/evidence/2026-10-14-genui-live-check.md`. Run it locally
    with `GENUI_ENABLED=1 OPENROUTER_API_KEY="$(cat ~/.config/openrouter/key)"`.
- The design experiment (#106, #107; v1.0 milestone):
  - **Arms** (`apps/game/src/experiment/arms.ts`): each game draws design ×
    theme × question layer independently at deal time, by committed
    `WEIGHTS`. Question layers exist for the algorithm and language decks
    so far; on another deck a game drawn `layer: on` plays as `off`.
  - **Themes** (#125): Terminal (the original), Paper, Arcade, and High
    contrast. Every colour, font, and corner in `globals.css` reads a token;
    Terminal's are on `:root`, each other theme's on
    `:root:has([data-theme="…"])`, set by the page's wrapper from the game's
    arms (the chooser stays Terminal unless a lab tester picks one).
    `theme-tokens.test.ts` requires every theme to define every token and
    every text pair to reach 4.5:1; `tests/e2e/themes.spec.ts` runs axe's WCAG
    2 A/AA rules on each theme's round, reveal, explainer, and chooser. The
    visualizer frame starts in the theme's colours (`paletteFrom`).
    - The draw is sealed in the session token (version 2, with `arms`,
      `record`, `correct`, `roundStartedAt`), and the genui route serves only
      the sealed design (`403 DESIGN`).
    - `EXPERIMENT_DISABLED=design:host,…` switches levels off; their weight
      goes to control, which can't be switched off.
    - Lab mode (`EXPERIMENT_LAB=1`, or `next dev`) honours `?design=`,
      `?theme=`, `?layer=` and shows the Lab bar (design and theme
      switchers). Playtests on `next start` need it.
  - **Event log** (`experiment/events.ts`, `experiment/event-store.server.ts`,
    `demo/local-real-experiment-events.server.ts`):
    - schema v1, one strict parser: exact keys, closed enums, bounded
      numbers, so no IP, user agent, id, chat text, round content, or chosen
      option can be stored;
    - the server records `game_dealt`, `hint_revealed`, `round_revealed`,
      `game_completed`, and `genui_call` itself; the browser sends
      `game_viewed`, `deal_again`, `result_copied`, `genui_interaction`, and
      `genui_fallback` to the beacon route `app/api/events/route.ts`
      (1 KB, a live signed token, 60 per game);
    - opt-in: nothing is recorded without `EXPERIMENT_EVENTS_DIR` (one JSONL
      file per UTC day, rolled up into `totals.jsonl` after 90 days), and a
      deal under `Sec-GPC: 1` seals `record: false`;
    - `EXPERIMENT_SOURCE=agent|synthetic` tags playtests and tests.
    - The store is JSONL behind the `EventStore` interface. Node 24 (#21)
      has `node:sqlite`, but nothing uses it yet.
  - **Report** (#108, `ops/experiment/`): `pnpm experiment:report` reads one source's raw days with the events
    parser and prints Markdown (`--json=` writes JSON).
    - Each factor's levels are compared on the deal-again rate of completed games: seeded Beta draws
      (`statistics.ts`), 95% intervals, P(best) among levels with data, and the difference from control.
    - The secondaries come beside it, and the accuracy guardrail flags a level clearly above control.
    - Pre-registered targets (`PLAN`, `targetFor`): 10 points over 30%, power 0.8, Bonferroni over each factor's
      comparisons, so 506 games per design, 475 per theme, and 356 per layer level. The read waits for every target or
      day 56.
    - Layers count only on decks in `question-layers.json`, and rolled-up totals are left out.
    - Tests recover known effects from quota-built synthetic stores, and `events.spec.ts` reads the e2e store.
- Question layers (#127, #128; v1.0): generative UI inside the question,
  written at preparation time and frozen in
  `apps/game/src/demo/generated/question-layers.json`, pinned by
  `question-layers.pin.server.ts` and bound to the artifact's hash.
  - Designs so far: "Trace it" (algorithm) and "Marker hunt" (language). The
    free scaffold uses closed vocabularies (`WATCH_KINDS`, `MARKER_PROMPTS`),
    since free text leaked in the pilots; two hints are sold like the static
    ones.
  - `packages/artifact/src/question-layer.ts` is the one parser. It refuses
    a layer that names an option (labels, spellings, stems, languages, file
    extensions), points outside the code, or isn't plain bounded text.
  - `ops/poc/questions/` writes them: one writer call a round, one repair,
    then a code-blind solver (`audit.ts`) measures how far the scaffold and
    hint 1 lift the answer over a control holding what the layer quotes from
    the code. Round and deck bounds refuse leaky layers.
  - `pnpm prepare:questions [--offline | --fresh] [--decks=…] [--limit=N]
    [--model=…]`; `--limit` is a pilot that writes only
    `ops/poc/questions/tmp/report.json`. Logs are codes and counts:
    `QUESTIONS_DECK <deck> attempted= kept= <CODE>=n`, `QUESTIONS_DECK_REFUSED`,
    `QUESTIONS_PUBLISHED`, `QUESTIONS_CALLS`, `QUESTIONS_FAILED <code>`
    (`JOURNAL_MISS`, `OPENROUTER_KEY_MISSING`, `QUESTIONS_PROVIDER_<status>`,
    `QUESTIONS_MALFORMED`, `ARTIFACT_PIN_MISMATCH`).
  - The layers bind to the artifact, so a new artifact needs a new
    `prepare:questions` run.
  - In the game (`demo/local-real-experiment-layers.server.ts`): the loader
    reads the file once and shows layers only when it matches its pin, was
    written for this artifact, and passes the parser again; otherwise it logs
    `QUESTION_LAYERS_UNAVAILABLE <code>` and every round plays static. A game
    drawn `layer: on` carries each layered round's scaffold in its public
    round (`RoundScaffold`), and its hints are the layer's, sold through the
    same hint action with a `detail` beside the text (lines to mark, or a
    step-through). Layered rounds number their lines; the genui guard's
    `boughtHints` are the game's own hints.
  - Evidence: `docs/review/evidence/2026-10-15-question-layers-first-build.md`; the v6 artifact's layers (67 of
    76 rounds kept) are in `docs/review/evidence/2026-10-19-v6-data-run.md`.
  - **Review refusals:** a layer a reader found wrong is listed in `ops/poc/questions/reviewed.ts` and never written
    (`REVIEW_<code>` in the `QUESTIONS_DECK` line), since nothing runs a round's code to check a step-through. Agent
    playtest run 2 refused the counting-sort trace, so 66 layers are published.
- The committed artifact `apps/game/src/demo/generated/local-real-rounds.json`
  came from the 2026-10-19 v6 data run (#129): a live run (4,089 of 5,000
  requests), then a `--resume` (29 live) for requests the live run gave up
  on a rate limit with its retries spent, which journals as of this run.
  - Its canonical SHA-256
    `1abc21f8b819f40e45dc690d63cf89ad2fa1b22355ffdc321d1ac1ffb09b9522` is
    pinned in `apps/game/src/demo/local-real-experiment.pin.server.ts`; the
    preparer writes the pin.
  - Evidence: `docs/review/evidence/2026-10-19-v6-data-run.md`. The v5
    artifact's runs are `docs/review/evidence/2026-10-13-v5-six-decks-run.md`
    and the offline rebuilds after it.
  - The run's journal is in `ops/poc/stack/tmp/journal/run.jsonl` on this
    machine, so `STACK_V2_ACKNOWLEDGED_USABLE_REVISION=… pnpm prepare:poc
    --offline` rebuilds it byte for byte with no network. The v5 journal is
    `run.jsonl.v5-2026-10-15`.
  - The journal holds provider bodies, so it is gitignored and never
    committed; a fresh clone has none, and `--offline` or `--resume` fails
    with `JOURNAL_MISSING`. A fresh run writes its own journal when it ends,
    even when it fails, so it never starts over one (#54): `pnpm prepare:poc`
    with no flag refuses with `JOURNAL_EXISTS` when `run.jsonl` exists, and
    `--fresh` renames the old one to `run.jsonl.<UTC stamp>` first.
- Done so far:
  - **Phase 0:** diagnostics, retries, yield, and UI quick wins.
  - **Phase 1:**
    - the module split;
    - the run journal (`--resume`, `--offline`);
    - per-deck publication and the failure report;
    - `ops/poc/limits.json`;
    - `packages/artifact` as the one parser and hash.
  - **Phase 2:** the v3 decks.
    - Generators: `project-rounds.ts`, `language-rounds.ts`,
      `before-after-rounds.ts`.
    - Selectors: `select-stack.ts`, `select-github.ts`; windows come from
      `code-windows.ts`.
    - The game deals sessions, shows panes and option details, highlights the
      answer, and scores 250 × options per round.
    - The leakage test is `packages/artifact/test/deck-leakage.test.ts`.
  - **Phase 3a:** The Stack v2 grown to twelve languages in look-alike pairs
    (`LANGUAGE_PAIRS`). The language deck offers two whole pairs per round and
    must tell a language from its look-alike (`language-markers.ts`). Since
    #81 a pair's four rounds take four different second pairs (a derangement),
    so no option set appears in more than two rounds.
  - **Rarer languages (v1.0, #129):** `STACK_LANGUAGES` adds seven pairs
    (Haskell/Elm, OCaml/F#, Erlang/Prolog, Clojure/Racket, Julia/MATLAB,
    Ada/Pascal, Elixir/Crystal) after the first twelve (`MAINSTREAM_LANGUAGES`).
    - A profile configures whole pairs in that order (`isLanguageSelection`);
      v5 still reads the twelve and rebuilds byte for byte. A configuration
      with `"projectDeck": false` feeds the language deck alone, since a rare
      language's popular repositories are mostly other languages' projects.
    - Each has comments (`excerpt-window.ts`), preamble and definition rules
      (`code-windows.ts`), markers and a look-alike note
      (`language-markers.ts`), a block-style hint, and the worker's shard
      directory and extensions. Its name in any case refuses a window.
    - A pair takes the second pairs two to five places along a hash-ordered
      cycle (six pairs keep the v5 sets). Pairs that read alike as families
      (`RESEMBLANCES`: Elixir/Crystal and Julia/MATLAB with Python/Ruby,
      Haskell/Elm with OCaml/F#, Erlang/Prolog with Elixir/Crystal) never
      share a round; the cycle is searched until none does.
    - The worker journal is keyed to the worker's code, so adding a language
      orphaned v5's recorded worker outputs. On 2026-10-15 a `--resume`
      re-recorded them (110 of 111 byte-identical; Java's rows identical, its
      network counters not), merged into the 13 October journal; the old one
      is `run.jsonl.before-rare-languages`.
    - Dry run: `docs/review/evidence/2026-10-15-rare-languages-dry-run.md`.
  - **Phase 3b,** the curated decks. Each runs only when the profile carries
    its `curated` section, after the Stack and search decks.
    - **Missing line (#57, v1.0):** `missing-line-window.ts` (gaps, decoys,
      ranks), `select-missing-line.ts`, `missing-line-rounds.ts`, and the
      shared rules in `packages/artifact/src/missing-line.ts` (kind
      `MISSING_LINE`, deck `missing-line`). The profile section
      `curated["missing-line"]` turns it on; the committed v5 profile has none,
      so it goes live with the v6 run (#129). Dry run:
      `docs/review/evidence/2026-10-15-missing-line-dry-run.md`.
    - **Name the function (#73, v1.0):** `name-function-window.ts` (functions,
      masks, decoys, ranks, extreme scores), `select-name-function.ts`,
      `name-function-rounds.ts`, and `packages/artifact/src/name-function.ts`
      (kind `NAME_FUNCTION`, deck `name-function`). Its profile section
      `curated["name-function"]` lists `sources`, each a pinned repository and
      its directories (nested paths allowed, since directory listings are
      flat); like missing-line it goes live with the v6 run. Dry run:
      `docs/review/evidence/2026-10-15-name-function-dry-run.md`.
    - **Which framework? (#62, v1.0):** a Recognise deck from tastejs/todomvc, the same to-do app in many
      front-end frameworks, so only idioms tell them apart. `framework-window.ts` (commentary, masking, windows),
      `framework-markers.ts` (each framework's idioms), `select-framework.ts`, `framework-rounds.ts`, and
      `packages/artifact/src/framework.ts` (kind `FRAMEWORK`, deck `framework`).
      - A round offers one family of four (`curated.framework.families`) and each family's rounds answer each
        framework `roundsPerFramework` times, from different files listed in the profile.
      - Every framework's names (`names`, matched across words) and `symbols` (whole identifiers, such as `can`)
        are masked as `mystery` in every round. API namespaces that spell no name (`ko.`, `m(`, `goog.`, `Mn.`,
        `$scope`) stay: they are the idioms.
      - A window shows at least two of its framework's markers and none of another family member's; it skips
        imports, AMD and Closure headers, style sheets, credit lines, and script tags, and never crosses a
        single-file component's sections.
      - TodoMVC's licence file is MIT "unless otherwise specified", which GitHub names no licence for. Its pin
        declares the licence (`license: { spdx, path, blob }`), which `admitRepository` and `admitLicense` accept
        only for that exact file and only where GitHub detects none. An example is skipped when a directory on a
        file's path holds a licence file or its `package.json` declares another licence.
      - Goes live with the v6 run (#129). Dry run: `docs/review/evidence/2026-10-15-framework-dry-run.md`.
    - **Which exercise? (#58, v1.0):** a Recognise deck of Exercism reference solutions
      (`exercises/practice/<slug>/.meta/example.*`) from six MIT tracks: Python, Go, Rust, Ruby, JavaScript, and C#.
      `select-exercise.ts`, `exercise-rounds.ts`, `exerciseWindow` in `function-windows.ts`, and
      `packages/artifact/src/exercise.ts` (kind `EXERCISE`, deck `exercise`).
      - Six families of four (`curated.exercise.families`); each exercise is answered `roundsPerExercise` times,
        from different tracks that take turns being tried first. A solution path is its track's `solution` with
        `{slug}`; the directory is the truth.
      - Every option's names and label stems are masked; the window opens at a definition of the answer's own names
        only (Go methods included), since Go's saddle-points solution opens with the matrix exercise's parser.
      - Hints are profile copy; no hint, prompt, or note may use an option's label word (`squares`, `cipher`).
      - `family.ts` holds the rules both family decks share: whole-family options, members spelled by word, and
        each member answered equally often (`familyDeckRule`).
      - Goes live with the v6 run (#129). Dry run: `docs/review/evidence/2026-10-15-exercise-dry-run.md`.
    - **Spot the vulnerable line (#59), deferred past v1.0:** a Reason deck of one-line fixes that reviewed GitHub
      advisories link. `github-advisories.ts` (listings and the one-line commit check), `select-vulnerable-line.ts`,
      `vulnerable-line-rounds.ts`, and `packages/artifact/src/vulnerable-line.ts` (kind `VULNERABLE_LINE`, deck
      `vulnerable-line`). Rounds look and balance like fix rounds (`fixWindows`, `pairedDecoys`, `linesBalanced`).
      - Each ecosystem is listed once per `published` window, the first page of 100 oldest first, so no cursor is
        needed; the request policy allows exactly that listing. An advisory needs one fix commit, a CWE the profile
        gives a hint for, and no withdrawal; one round per repository.
      - The commit must replace one line of one source file, beside tests, notes, and manifests only; the fix binder
        (`bindFixCommit`) then confirms it against the files. Hint 1 names the CWE; nothing before the answer holds
        an advisory or CVE id or the package. A round whose line is the busiest or longest option in every window is
        refused, since security fixes sit on such lines.
      - The dry run measured about 87 commit reads per balanced round, so the owner deferred it on 2026-10-18; the
        v6 profile leaves it out. Dry run: `docs/review/evidence/2026-10-18-vulnerable-line-dry-run.md`.
    - **Registry (#36):** `ops/poc/prepare/curated-decks.ts` lists them in
      run order (`configured`, `select`, `generate`); ids live in
      `curated-deck-ids.ts`, and a deck's profile section is keyed by its id
      with its `templates`. The pipeline loops over the registry, and
      generation goes through one `generateCurated` dependency. A new curated
      deck still touches the artifact schema (`packages/artifact`) and, for
      snapshot data, `compose.ts`.
    - **Curated files:** `github-files.ts` reads a file at a pinned commit
      through verified trees, with its licence and last human author.
      `github-fixes.ts` lists dataset bugs (BugsInPy's through one recursive
      listing with every subtree hash-checked) and confirms each one-line fix
      upstream.
    - **Which algorithm?:** `select-algorithm.ts`, `algorithm-rounds.ts`,
      `function-windows.ts`. Commentary is stripped, and names and label words
      are masked, the words even across camelCase.
    - **Predict the output:** `doctest-parse.ts`, `select-output.ts`,
      `output-rounds.ts`.
    - **Spot the fix:** `fix-patch.ts`, `select-fix.ts`, `fix-window.ts`,
      `fix-rounds.ts`.
    - **Balance:** `balancedChoice` in `round-helpers.ts` picks answers so they
      balance in every order a code-blind solver might use (position, text,
      centrality, length). The shared parser checks each deck's rules.
    - **Game:**
      - the chooser shows two columns, each deck tagged Recognise or Reason;
      - fix rounds number their lines, show each option's code, keep line
        order, and highlight the chosen line;
      - panes keep their own whitespace.
    - An author name that is an email address is rejected as contact data.
- Port 3000 may be taken locally by an unrelated Docker container; run browser
  tests with `E2E_PORT=3200 pnpm test:e2e`.

## Next steps

1. Finish v1.0 (#130): the `v1.0.0` tag and GitHub release, with the owner's go-ahead. Owner decisions still open:
   #120 (model per design) and #160 (the algorithm layer's fairness).
2. The next release, v1.1 (milestone v1.1, checklist #174), planned in `docs/review/2026-10-20-next-phase-plan.md`.
   The owner decided on 2026-10-20:
   - public play on one instance of the owner's own server (hardening #97–#100, #164, #170);
   - async duel challenge links (#173);
   - bigger pools from the current sources in profile v7 (#165–#167);
   - Node 24 (#21);
   - shipping on after launch, with every player-visible change dated (#169).
3. After v1.1: the deferred decks, "Spot the vulnerable line" (#59) and "Which era?" (#60), and the other four
   question-layer designs (#128). Live duel rooms and practice mode (#64) come later too.
4. Phase 3c, in `docs/review/2026-10-13-next-sources-plan.md`: other forges
   (GitLab, Software Heritage). It has open decisions (licence allowlist,
   accounts) to settle with the user first.
5. The research note's backlog: guess the commit message (the user said "not
   now"), vulnerable or fixed.

Ask before widening the licence allowlist, raising the request ceiling past 10,000 (`ops/poc/limits.json`; the owner
approved up to 10,000 for the v7 run on 2026-10-20, and the file says 5,000 until #167), or adding a source not named
in the research note or #129.

Iterate on deck rules with
`STACK_V2_ACKNOWLEDGED_USABLE_REVISION=e565caa3a78c2423bd374333a472b049eb090e47 pnpm prepare:poc --offline`
(no token, but it needs the local journal above); use `--resume` when a
change needs responses the journal lacks.

Live run (`--fresh` because a journal exists; it renames `run.jsonl` to
`run.jsonl.<UTC stamp>` and never deletes it):

```bash
HF_TOKEN="$(cat ~/.cache/huggingface/token)" \
GITHUB_TOKEN="$(gh auth token)" \
STACK_V2_ACKNOWLEDGED_USABLE_REVISION=e565caa3a78c2423bd374333a472b049eb090e47 \
pnpm prepare:poc --fresh
```

GitHub allows about 5,000 requests an hour. A run that spends them stops at
`RATE_LIMIT_CHECKPOINT` (exit 75), journals what it has, and logs
`PREPARATION_RESUME_AFTER <UTC minute>`. Run the same command with `--resume`
instead of `--fresh` after that minute, one session per checkpoint, until
`PREPARATION_COMPLETE`. `--resume` also continues any other failed run: it
replays what the journal holds and fetches only the rest. `--offline` replays
the journal with no network and no token (it fails with `JOURNAL_MISS` on
anything unrecorded). The journal is `ops/poc/stack/tmp/journal/run.jsonl`
(ignored); `--journal=<name>` names another file in that directory, and
`--profile=<version>` runs another profile in `ops/poc/profiles`, so a dry run
of a new profile can replay a copy of the journal beside the committed one.
Ctrl-C stops a run as `RUN_INTERRUPTED` and still journals it; a second Ctrl-C
ends the process at once.

After a success the artifact and its pin are already written together. Check
the `PREPARATION_DECKS` line for which decks published, read a few rounds of
each deck, run the full verification matrix (the leakage test runs against the
committed artifact), and re-record the media with `pnpm demo:record`:
- `demo.gif`, the vertical headline clip, under 10 MB;
- every other GIF under 4 MB.

Add `DEMO_PORT=3300` if another local app holds port 3100. Scenes play fixed deals (`DEAL_SEEDS` in
`ops/demo/record/scenes.ts`) with lab-mode picks of theme and layer, so a new artifact deals other first rounds: look
at each before re-recording and pick another seed where one reads badly on a phone. `DEMO_BASE_URL` may point at a
running `next start` with `EXPERIMENT_LAB=1`.

## Reading failures

Read the `PREPARATION_STAGE_FAILED <stage> <code> <status-class>` line first.
`PREPARATION_FAILURE_SITE <function>@<file>` names where the failure was
thrown, and `ops/poc/stack/tmp/local-experiment-last-failure.json` holds the
same codes with spend, capacity counts, and rejection aggregates.

The stages run in this order: `PREFLIGHT`, `STACK_METADATA`, `DISCOVERY`,
`ADMISSION`, `BLOB_RETRIEVAL`, `CURATED_FILES`, `SELECTION`, `GENERATION`,
`REPORT`, `PUBLICATION`. `GENERATION` binds the sources to the final snapshot,
generates the rounds, and composes the artifact; `REPORT` validates the run
report. A failure from `ADMISSION` to `REPORT` also logs `PREPARATION_COUNTS`
and `PREPARATION_REJECTIONS`. `ops/poc/prepare/failure-codes.test.ts` fails
when the preparer throws a code this section does not name.

### Codes that fail the run

- `COMMAND_ARGUMENTS_REJECTED`: `prepare:poc` got something other than at
  most one of `--fresh`, `--resume`, and `--offline`, with at most one
  `--profile=<version>` (a version `PROFILE_VERSIONS` names) and one
  `--journal=<name>` (a file name, no path); it prints the usage line.
- Run stops end the run wherever they are thrown, even inside one candidate,
  so they never shrink a deck. The pipeline still journals the run, logs the
  failure line, and writes the failure report:
  - `RATE_LIMIT_CHECKPOINT`: GitHub's rate limit is spent until a reset
    beyond the fifteen-second wait. Either a refused rate-limit retry
    (`PREPARATION_STAGE_FAILED <stage> RATE_LIMIT_CHECKPOINT 4xx`, the 403 or
    429 its cause), or a live request held back because 25 or fewer core
    requests were left (`none`). It logs `PREPARATION_RESUME_AFTER <minute>`,
    the UTC minute the limit lifts, and exits 75; run `--resume` after it.
  - `RUN_INTERRUPTED`: SIGINT or SIGTERM; the run stops at its next request
    or worker run and exits 130.
  - `JOURNAL_MISS` and `OFFLINE_NETWORK_REFUSED`, below.
- `JOURNAL_EXISTS` (`PREFLIGHT`, before any request): a run with no journal
  flag found a journal at its path, which it would replace. Run `--fresh` to
  set it aside as `<name>.<UTC stamp>` (logged as
  `PREPARATION_JOURNAL_SET_ASIDE <file>`), or `--resume`. `--fresh` refuses
  the same way if that stamped name is taken.
- `INVARIANT_REJECTED`: an internal consistency check failed, such as a
  revalidated Stack file whose language differs from its row.
  `UNCODED_<CLASS>` (for example `UNCODED_TYPEERROR`) is an error with no
  stable code. Both mean a bug and fail the run even inside one candidate;
  the failure site says where.
- `JOURNAL_MISS`, `JOURNAL_MISSING`, `JOURNAL_CORRUPT`: `--offline` needed a
  response or worker output the journal lacks, there is no journal, or a
  journal entry failed its hash check. Run without `--offline` (or with
  `--resume`). A miss fails the whole run, even inside one candidate, so a
  replay never publishes fewer decks than the run it replays.
  `OFFLINE_NETWORK_REFUSED` is the offline transport's guard against any
  request the journal did not answer. `FINALIZE_REPLAY_MISS`: `GENERATION`
  needed a response the run never accepted.
- Preflight: `ACKNOWLEDGEMENT_MISSING`, `ACKNOWLEDGEMENT_MISMATCH` (the
  acknowledged revision is unset or not the pinned one); `REVISION_MISMATCH`,
  `RELEASE_MISMATCH`, `TERMS_CHANGED`, `PROFILE_MISMATCH` (The Stack v2 moved
  from what the profile pins); `ACCESS_*`, `CARD_*` (access is no longer
  granted, or the access check or dataset card could not be fetched or read).
  Preflight reports every transport failure, an offline journal miss
  included, as `ACCESS_UNAVAILABLE` or `CARD_UNAVAILABLE`.
- Stack metadata worker:
  - `WORKER_EXIT_<CODE>`: the worker exited non-zero with its own stable code
    (`WORKER_UNEXPECTED` for an unmapped exception). A bare `WORKER_EXIT`
    means its stderr was not a code.
  - `WORKER_EXIT_SAMPLE_REJECTED`, `SAMPLE_REJECTED`: its sample request or
    output broke its bounds (a licence off the allowlist, too many
    repositories or files, an ordinary repository twice).
  - `ROW_*`, `OUTPUT_MALFORMED`, `OUTPUT_NONCANONICAL`, `COUNTERS_REJECTED`,
    `WORKER_STDERR`: output that broke its contract. `METADATA_BYTES`,
    `METADATA_CAPACITY`, `TEMPORARY_DISK`: its budgets.
  - `UV_MISSING`, `WORKER_START_FAILED`, `RUNTIME_MISSING`, `PYTHON_MISMATCH`,
    `LOCK_MISMATCH`: the locked Python runtime could not start.
- `GITHUB_SEARCH_*`: the discovery check that rejected a search response.
  `INCOMPLETE`, `TOTAL_CHANGED`, `ITEM_COUNT`, and `DUPLICATE` are provider
  inconsistencies; `SHAPE`, `IDENTITY`, and `DATE` are record drift;
  `RESULT_CEILING` and `PAGE_CEILING` mean a query outgrew its ceilings.
- `PREPARATION_DECK_SKIPPED <deck> <code>`: that deck was left out and the
  others still publish; the aggregates count it as `SELECTION:<DECK>_DECK_SKIPPED`.
  - In selection: it did not fill (`DECK_SHORT`, or the `BUDGET_EXHAUSTED_*`
    budget that ran out). `SELECTION DECK_SHORT` or `NO_DECK_FILLED` means
    none filled.
  - In generation (#32): its generator or the parser refused it, or it
    collided with a deck already kept, and the code is that check's (for
    example `FIX_RANK_UNBALANCED`, `PUBLIC_CONTAINMENT_<KEY>_IN_<FIELD>`).
    Decks are generated and composed in order, so a collision drops the later
    deck. With every deck refused, the run fails in `GENERATION` with the
    first code. An invariant or uncoded error is a bug and fails the run.
- `BUDGET_EXHAUSTED_<BUDGET>`: a run-wide budget ran out (`REQUEST_COUNT`,
  `BLOB_ATTEMPTS`, `SUCCESSFUL_BLOBS`, or `TOTAL_BLOB_BYTES`). The deck being
  filled and every later deck are skipped instead of rejecting every later
  candidate. `PREPARATION_SPEND` shows the requests each stage used. Retries
  and waiting are bounded by the retry codes below, and Stack metadata bytes
  and temporary disk by the metadata worker's own codes.
- Generation and report:
  - `EXPERIMENT_RECORD_REJECTED`: the shared parser rejected a round, the
    artifact, or the run report. `RUN_REPORT_REJECTED`: the report's own
    check.
  - `EXPERIMENT_COMPOSITION_REJECTED`, `DECK_SIZE_<DECK>`, `NO_DECK`: the
    composed artifact is inconsistent, a deck has the wrong size, or no deck
    is left.
  - `PUBLIC_CONTAINMENT_<KEY>_IN_<FIELD>` (or
    `PUBLIC_CONTAINMENT_CANDIDATE_IN_<FIELD>`): names the protected value and
    the public field that collided.
  - A round generator's own check: `*_ROUNDS_REJECTED`, `PROJECT_WORDS_SHOWN`
    (v6: a project pane shares a word with an option), `BEFORE_AFTER_SIZE_UNBALANCED` (v6: the
    later pane is the bigger one in more than half the pool and one, #75), `OUTPUT_IDEA_REPEATED` and
    `FIX_FILE_REPEATED` (v6: two rounds repeat one idea or one file, #84),
    `ALGORITHM_NAME_SHOWN`, `ALGORITHM_FAMILY_UNBALANCED`,
    `OUTPUT_ANSWER_ECHOED`, `OUTPUT_ANSWER_TRANSFORMED` (v6: the answer alone reads
    off its call's arguments), `OUTPUT_TRANSFORM_UNBALANCED` (v6: picking such an
    option beats chance and a tenth), `OUTPUT_RANK_UNBALANCED`, `FIX_RANK_UNBALANCED`,
    `FIX_REPOSITORY_REPEATED`, `MISSING_LINE_RANK_UNBALANCED`,
    `MISSING_LINE_HINT_DECIDES` (no other option does what the answer
    does, so the first hint would pick it), `NAME_FUNCTION_RANK_UNBALANCED`,
    `NAME_FUNCTION_HINT_DECIDES` (no other name joins as many words as the
    answer), `LANGUAGE_PAIRING_CONFLICT` (no cycle of second pairs keeps resembling
    pairs out of the same round), `FRAMEWORK_FAMILY_UNBALANCED` (a family's frameworks are
    not answered equally often), `FRAMEWORK_NAME_SHOWN` (a pane, prompt, or hint still
    names a framework), `EXERCISE_FAMILY_UNBALANCED` (a family's exercises are not each
    answered equally often from different tracks), `EXERCISE_NAME_SHOWN` (a pane, prompt, or
    hint names an option), `VULNERABLE_LINE_RANK_UNBALANCED` (vulnerable-line answers not balanced
    as fix answers are), `VULNERABLE_LINE_ADVISORY_SHOWN` (a pane, prompt, or hint holds an advisory
    or CVE id or the package), `TEMPLATE_PLACEHOLDER_REJECTED`.
- Publication: `HASH_MISMATCH`, `INVALID_ARTIFACT`, `INVALID_HASH`, and
  `REPORT_*_FAILED` (staging, committing, rolling back, or finalizing the
  report). The previous artifact and pin stay.
- Internal checks mean an edited profile or limits file, or a bug:
  `CRAWL_PROFILE_REJECTED`, `LIMIT_*`, `*_DIMENSIONS`, `UNKNOWN_*`,
  `*_RELEASED`, `EMPTY_BLOB`, `WAIT_VALUE`, `CANONICAL_VALUE_REJECTED`,
  `CONFIGURATION_REJECTED`, `ENVIRONMENT_REJECTED`, `JOURNAL_OFFLINE_RECORD`,
  `INVALID_TARGET`, `INVALID_TEMP_ID`, `INVALID_RETRY_LIMITS`,
  `INVALID_TRANSPORT_LIMITS`.

### Provider, transport, and retry codes

These fail the run in `DISCOVERY`, and reject one candidate while candidates
are being selected.

- `UNSUPPORTED_STATUS 4xx`: a status the preparer does not accept (a 401
  from a revoked token, a 404, or a 403/429 without a usable retry
  instruction). The retry controller's `RETRY_SIGNAL_MISSING` wrapper is
  reported as the failure it wraps.
- `TIMEOUT`, `NETWORK`, `MALFORMED_BODY`, `RESPONSE_LIMIT`, `REQUEST_LIMIT`,
  `PAGE_LIMIT`, `CONCURRENCY_LIMIT`, `POLICY`: the bounded transport's own
  checks. The capacity meter's `BLOB_BYTES`, `RESPONSE_BYTES`, and
  `CONCURRENCY` reject the one request or blob that broke them;
  `GITHUB_PAGES` and `GITHUB_RESULTS` fail discovery.
- `LOGICAL_RETRY_LIMIT`: a GitHub 5xx, network error, or timeout was retried
  once and failed again. `RUN_RETRY_LIMIT`, `TOTAL_WAIT_LIMIT`: the run's
  five retries or 30 s of waiting were spent. `WAIT_LIMIT`: a retry
  instruction longer than the fifteen-second wait. A rate limit refused any of
  these ways stops the run at `RATE_LIMIT_CHECKPOINT` instead (#165).
  `RETRY_SIGNAL_MALFORMED`: a retry instruction that was not a positive wait.

### Rejection aggregates

Rejections are counted as `STAGE:CODE=count`, where the stage is the check's
own (`GITHUB_REVALIDATION`, `SCREENING`, `DEDUPLICATION`, and so on). They are
expected screening outcomes, not faults; a deck is skipped only when too many
add up.

- `LINEAGE_*`, `ADMISSION_*`, `REVALIDATION_*`, `FILE_*`, and `FIX_*` name the
  failing check of a commit, a repository, a Stack file, a curated file, or a
  fix. For example:
  - `LINEAGE_CHANGE_WINDOW`: a commit whose change does not fit one
    before-and-after window.
  - `LINEAGE_PROSE_ONLY` (v6, #75): a commit that changes only comments,
    docstrings, or string text. `LINEAGE_SIZE_UNBALANCED` (v6): a commit whose
    change would add to the pane-size side the deck has filled.
  - `ADMISSION_REPOSITORY_LICENSE`: a repository licence outside the
    allowlist.
  - `REVALIDATION_WINDOW`: a file with no code window past its preamble.
  - `FILE_AUTHOR_AUTOMATED`: a curated file whose last ten changes all came
    from bots.
- `ADMISSION_AUTHOR_CONTACT`, `REVALIDATION_AUTHOR_CONTACT`: an author
  recorded under an email address, which is never published.
- `LICENSE_REJECTED`: a Stack row's licence is off the allowlist, before any
  download.
- The blob screen:
  - Content: `PERSONAL_DATA` (an email address in the file), `SECRET_LIKE`,
    `GENERATED_CONTENT`, `MINIFIED_CONTENT`, `BLOB_SIZE_LIMIT`,
    `BINARY_CONTENT`, `INVALID_UTF8`, `DECEPTIVE_CONTROL`,
    `DUPLICATE_CONTENT`.
  - Path: `INVALID_PATH`, `UNSUPPORTED_EXTENSION`, `EXCLUDED_PATH` (docs,
    vendor, and generated directories, lock files, minified files).
- The blob worker: `WORKER_EXIT_<CODE>`, `BLOB_IDENTITY_REJECTED`,
  `BLOB_CAPACITY`, `NETWORK_BYTES`, `REDIRECT_REJECTED`.
- `GENERATED_PATH` (v6, #84): a Stack file under a `…Gen` directory or named
  `test<n>`, skipped before it is read. `DATA_ONLY_CONTENT` (v6): a window half
  of whose lines only declare data, such as a table of string constants.
- `REPOSITORY_SCREENED_OUT` counts later candidates of a repository already
  rejected once. `REPOSITORY_REPEATED`: a repository the deck already holds.
- `SOURCE_DUPLICATE`, `PUBLIC_CONTAINMENT_REJECTED`,
  `SOURCE_IDENTITY_UNREPORTABLE`: a source another round already shows, a
  pane that would reveal a protected value, and a source the run report could
  not record.
- `SUBJECT_UNUSABLE`: a commit subject no hint can quote.
- `PROJECT_NAME_IN_EXCERPT`: code or a file name names an option, including
  a distinctive part of a name, such as `graphql` for graphql-ruby.
  `PROJECT_WORDS_IN_EXCERPT` (v6, #77): code that shares a distinctive word
  with an option's name or description, such as `Aws::SQS` beside "AWS Code
  Examples"; an answer's file is refused, and a decoy is skipped.
  `PROJECT_NAMED_BY_TEMPLATE`: the deck's own wording names the repository.
- `LANGUAGE_PAIR_AMBIGUOUS`: the code does not tell its language from the
  look-alike. `LANGUAGE_ROUNDS_REJECTED`: another language-round check.
- `ALGORITHM_WINDOW`, `ALGORITHM_NAME_IN_CODE`, `ALGORITHM_FAMILY_SHORT`: a
  file with no masked window, code that still names an option, and a family
  dropped whole because one of its algorithms found no file.
  `ALGORITHM_SCREEN`: screened bytes that differ from the bound file's.
- `OUTPUT_NO_DOCTEST`: a file with no function a round can ask about (most
  files; from v6, also one whose every call gives its result away, #78).
  `OUTPUT_PANE_SIZE`: a pane over the byte limit.
  `OUTPUT_FILE_CHANGED`: the file bound differs from the file read.
  `OUTPUT_IDEA_REPEATED` (v6, #84): a function named for a chosen round's idea,
  or agreeing with a chosen function on two documented calls.
  `OUTPUT_RANKS_UNBALANCED`: no choice of answers fills every rank in both
  orders (and, from v6, keeps the transform solver in bounds), so the output
  deck is skipped.
- `MISSING_LINE_NO_GAP` (#57): a file with no line a round can hide, in a
  window that holds it away from both edges, with three same-indent decoys
  from elsewhere in the file. `MISSING_LINE_FILE_CHANGED`: the file bound
  differs from the file read. `MISSING_LINE_RANKS_UNBALANCED`: no choice of
  gaps balances the deck in text, length, and shared-name orders, so the
  deck is skipped. `MISSING_LINE_LANGUAGE`: the pinned repository's language
  has no source-file rule yet.
- `NAME_FUNCTION_NONE` (#73): a file with no function a round can ask about
  (most TheAlgorithms files hold one or two). A round needs a function the
  author named, of four lines up to `functionLines`, whose masked pane names
  no other identifier, and three other authored names the pane never spells.
  `NAME_FUNCTION_FILE_CHANGED`: the file bound differs from the file read.
  `NAME_FUNCTION_RANKS_UNBALANCED`: no choice balances the deck in text and
  length order within the extreme solvers' limits, so the deck is skipped.
  `NAME_FUNCTION_LANGUAGE`: a source's language has no source-file rule.
- `FRAMEWORK_LICENSE_OWN` (#62): an example that states a licence of its own, by a licence
  file on the file's path or its `package.json`; `FRAMEWORK_LICENSE_UNREADABLE`: a manifest
  that is not a JSON object. `FRAMEWORK_WINDOW`: a file with no window that shows two of its
  framework's idioms and none of another of its family. `FRAMEWORK_FILE_CHANGED`: the file
  bound differs from the file read. `FRAMEWORK_FAMILY_SHORT`: a family dropped whole because
  one of its frameworks found too few files.
- `EXERCISE_WINDOW` (#58): a reference solution too short for a window (`minimumExcerptBytes`), such as
  Go's leap year or most tracks' Two-fer. `EXERCISE_NAME_IN_CODE`: a window that still names an option after
  masking. `EXERCISE_SCREEN`: screened bytes that differ from the bound file's. `EXERCISE_FAMILY_SHORT`:
  a family dropped whole because one of its exercises found too few tracks. A track without the
  exercise fails admission at its path, under `FILE_*`.
- Vulnerable line (#59): `VULNERABLE_ADVISORY_SHAPE`, an advisory listing that is not a page of
  reviewed advisories in its window and order. Before any commit is read: `VULNERABLE_WITHDRAWN`,
  `VULNERABLE_REFERENCES` (not exactly one fix commit), `VULNERABLE_CWE` (no CWE the profile has a
  hint for), and `REPOSITORY_REPEATED`. The commit: `VULNERABLE_PARENT` (a merge), `VULNERABLE_CHANGE`
  (code beyond one replaced line, the usual case), `VULNERABLE_LANGUAGE` (a file of a language with no
  rule, such as PHP), `VULNERABLE_VERSION` (a version bump); then the fix binder's `FIX_*` checks.
  The file: `VULNERABLE_PACKAGE_SHOWN` (every window names the package), `VULNERABLE_STANDS_OUT` (the
  line is the busiest, longest, most indented, or most rarely worded option in every window).
  `VULNERABLE_RANKS_UNBALANCED`: no choice of windows balances the deck.
- `FIX_PATCH_WIDE`: a dataset patch that changes more than one line (most).
  `FIX_FILE_REPEATED` (v6, #84): a fix in a file the deck already holds, or in
  one beside it named alike, skipped before any upstream request.
  - `FIX_CLAIM`: the fix's lines, which the reveal quotes, claim something
    about authorship (#32).
  - `FIX_CHANGE`, `FIX_DIFF`, `FIX_PARENT`: the upstream fix commit changes
    more of the file, differs from the dataset's line, or is a merge.
  - `FIX_WINDOW`: no window gives four comparable option lines.
    `FIX_CONTENT`, `FIX_ENCODING`: the upstream file could not be read as
    checked text.
  - `FIX_DATASET_*`, `FIX_RECORD_*`: a dataset's tree, patch, or bug record
    is malformed or missing (`FIX_DATASET_ENCODING`: not UTF-8).
  - `ADMISSION_LICENSE_SHAPE` here is usually an old commit whose licence
    file GitHub cannot identify.
  - `FIX_RANKS_UNBALANCED`: no choice of windows balances the deck.

## Commands

Run them under Node 24.22.0, which `.nvmrc` pins (`nvm use`).

```bash
pnpm exec vitest run ops/poc/prepare
pnpm exec tsc --noEmit -p ops/tsconfig.json
uv run --project ops/poc/stack --locked python -m unittest discover -s ops/poc/stack
pnpm test
pnpm typecheck
pnpm test:a11y
pnpm test:performance
pnpm test:e2e
pnpm exec node --test tests/containment/acquisition-boundary.test.mjs
pnpm --filter @codeguessr/game build
pnpm test:deploy
pnpm audit --audit-level=high
```

## Done means

1. `pnpm prepare:poc` exits successfully with its completion marker.
2. The artifact holds the intended decks, each a pool of at least five rounds,
   passes server-side validation and the leakage test, and its pinned hash
   matches.
3. The root route plays every deck offline.
4. Browser, build, boot, accessibility, performance, containment, unit, and type
   checks pass freshly.
5. The README and its media reflect what actually plays.
