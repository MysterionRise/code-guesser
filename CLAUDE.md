# Claude handoff: CodeGuessr local real-round PoC

## Mission

A local-only "guess from the code" game. One preparation run crawls real
open-source code before play and freezes six decks, each a pool of rounds
from which every game deals five:

- "Which project?": 24 rounds of popular repositories from The Stack v2.
- "Which language?": 24 rounds over twelve languages in look-alike pairs,
  from The Stack v2.
- "Before or after?": 10 refactor commits from GitHub search.
- "Which algorithm?": 24 TheAlgorithms files (Python, Go, Java), names hidden
  as `mystery`, offered against their family of four.
- "Predict the output": 24 TheAlgorithms/Python functions and one doctest
  call each, read as text and never run.
- "Spot the fix": 24 one-line fixes that Defects4J and BugsInPy record,
  confirmed against each upstream fix commit.

The goal is a demo on one machine, not public play.

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

`docs/gangsta/` is the historical record of the signed-Contract process, which
was retired on 2026-10-11. Use it for background on why rules exist, not as a
gate: changing queries, retries, ceilings, deck rules, or running
`pnpm prepare:poc` again needs no revision, signature, or authorization.

## Guardrails

- Localhost only; no deployment and no public players.
- Public open-source code only, with licence and recorded-author data.
- Bounded, selective reads only. Never download a whole dataset, a whole
  language shard, or a repository archive. The Stack v2 stays pinned to
  revision `e565caa3a78c2423bd374333a472b049eb090e47` unless deliberately moved.
- Credentials come only from standard stores (`~/.cache/huggingface/token`,
  `gh auth token`, and for generative UI `~/.config/openrouter/key`, mode
  0600) through the environment. Never log or commit tokens,
  provider bodies, contact data, private email, or source excerpts from failed
  diagnostics.
- Gameplay never touches the network; it plays the frozen local artifact. The
  one exception is opt-in generative UI (`GENUI_ENABLED=1`, #101). Its server
  route `apps/game/src/app/api/genui/route.ts` calls OpenRouter only through
  the answer-lock guard, for a live game's round, and the browser never talks
  to a model. Spend limits live on the OpenRouter key, not in the app.
- Preparation may also call OpenRouter: `pnpm prepare:questions` (#127) writes
  question layers with a model that knows the answer. Its answers are journaled
  in `ops/poc/questions/tmp/journal.jsonl` (gitignored) and its output is
  frozen and pinned, so play still never calls a model before the lock.
- Malformed provider data fails closed. Transient errors may be retried within
  the request budget.
- Preserve unrelated worktree changes.

## Current state

- Phases 0 to 3b are merged into `main`, so start new work from `main`:
  - #7 Phase 0, #8 Phase 1, #9 Phase 2, #10 Phase 3a;
  - Phase 3b on 2026-10-13: #12 curated sources, #13 algorithm, #14 output,
    #15 fix, #16 game UX, #17 go-live, #18 the vertical `demo.gif`.
- The game plays profile `ops/poc/profiles/local-real-rounds.v5.json` and
  artifact schema `local-experiment-artifact.v4` from the root-route deck
  chooser (`/?deck=project|language|before-after|algorithm|output|fix`). A
  page load deals five rounds from the deck's pool; `dealGame` in
  `apps/game/src/demo/local-real-experiment.server.ts` does it server-side.
- The server holds each game's progress (#96): `dealGame` seals it in a signed
  token (`local-real-experiment-session.server.ts`), and the hint and answer
  server actions take one step each. A ledger refuses an older token, so a
  round takes one answer, and score and hint counts are the server's. Hint
  text never ships with the page. `CODEGUESSR_SESSION_SECRET` (32+ chars)
  keeps games alive across restarts; without it each process makes a random
  secret.
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
    - Open: #120 (model per design), #121 (page length), #122 (run 2).
  - Composer and visualizer requests keep only the first panel or page
    (`ONE_ONLY`) and ask for `parallel_tool_calls: false`; live, Haiku
    sometimes wrote several pages at once.
  - Live check, with each explain about $0.0007:
    `docs/review/evidence/2026-10-14-genui-live-check.md`. Run it locally
    with `GENUI_ENABLED=1 OPENROUTER_API_KEY="$(cat ~/.config/openrouter/key)"`.
- The design experiment (#106, #107; v1.0 milestone):
  - **Arms** (`apps/game/src/experiment/arms.ts`): each game draws design ×
    theme × question layer independently at deal time, by committed
    `WEIGHTS`. The layer weighs 0 until the game shows it (#127).
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
    - SQLite waits for Node 24 (#21): Node 20 has no `node:sqlite`, so the
      store is JSONL behind the `EventStore` interface.
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
    `prepare:questions` run. The game doesn't show them yet.
  - Evidence: `docs/review/evidence/2026-10-15-question-layers-first-build.md`.
- The committed artifact `apps/game/src/demo/generated/local-real-rounds.json`
  came from the 2026-10-13 v5 run (1,859 of 3,000 requests), rebuilt
  `--offline` with the algorithm and fix leak fixes (#76, #79) and, on
  2026-10-15, the language option sets (#81).
  - Its canonical SHA-256
    `4747549666813ab44d60fca7df89152a65ea5cf91570b316d8d1539aacd4f90a` is
    pinned in `apps/game/src/demo/local-real-experiment.pin.server.ts`; the
    preparer writes the pin.
  - Evidence: `docs/review/evidence/2026-10-13-v5-six-decks-run.md`,
    `docs/review/evidence/2026-10-13-v5-leak-fixes-offline.md`, and
    `docs/review/evidence/2026-10-15-language-pairing-offline.md`.
  - The run's journal is in `ops/poc/stack/tmp/journal/run.jsonl` on this
    machine, so `STACK_V2_ACKNOWLEDGED_USABLE_REVISION=… pnpm prepare:poc
    --offline` rebuilds it byte for byte with no network.
  - The journal holds provider bodies, so it is gitignored and never
    committed; a fresh clone has none, and `--offline` or `--resume` fails
    with `JOURNAL_MISSING`. A fresh `pnpm prepare:poc` writes its own journal
    over `run.jsonl` when it ends, even when it fails, so copy `run.jsonl`
    aside before one.
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
  - **Phase 3b,** the curated decks. Each runs only when the profile carries
    its `curated` section, after the Stack and search decks.
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

1. Phase 3c, in `docs/review/2026-10-13-next-sources-plan.md`: other forges
   (GitLab, Software Heritage) and the "Which era?" deck. It has open decisions
   (licence allowlist, accounts) to settle with the user first.
2. The research note's backlog: guess the commit message (the user said "not
   now"), name the function, which exercise, which framework, vulnerable or
   fixed.

Ask before widening the licence allowlist, raising the 3,000-request ceiling,
or adding a source not named in the research note.

Iterate on deck rules with
`STACK_V2_ACKNOWLEDGED_USABLE_REVISION=e565caa3a78c2423bd374333a472b049eb090e47 pnpm prepare:poc --offline`
(no token, but it needs the local journal above); use `--resume` when a
change needs responses the journal lacks.

Live run (copy `run.jsonl` aside first, because a fresh run replaces it):

```bash
HF_TOKEN="$(cat ~/.cache/huggingface/token)" \
GITHUB_TOKEN="$(gh auth token)" \
STACK_V2_ACKNOWLEDGED_USABLE_REVISION=e565caa3a78c2423bd374333a472b049eb090e47 \
pnpm prepare:poc
```

Add `--resume` after a failed run to replay what the journal holds and fetch
only the rest, or `--offline` to replay the journal with no network and no
token (it fails with `JOURNAL_MISS` on anything unrecorded). The journal is
`ops/poc/stack/tmp/journal/run.jsonl` (ignored).

After a success the artifact and its pin are already written together. Check
the `PREPARATION_DECKS` line for which decks published, read a few rounds of
each deck, run the full verification matrix (the leakage test runs against the
committed artifact), and re-record the media with `pnpm demo:record`:
- `demo.gif`, the vertical headline clip, under 10 MB;
- every other GIF under 4 MB.

Add `DEMO_PORT=3300` if another local app holds port 3100.

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

- `COMMAND_ARGUMENTS_REJECTED`: `prepare:poc` got something other than no
  flag, `--resume`, or `--offline`; it prints the usage line.
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
  - A round generator's own check: `*_ROUNDS_REJECTED`,
    `ALGORITHM_NAME_SHOWN`, `ALGORITHM_FAMILY_UNBALANCED`,
    `OUTPUT_ANSWER_ECHOED`, `OUTPUT_RANK_UNBALANCED`, `FIX_RANK_UNBALANCED`,
    `FIX_REPOSITORY_REPEATED`, `TEMPLATE_PLACEHOLDER_REJECTED`.
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
- `LOGICAL_RETRY_LIMIT`: a GitHub 5xx, network error, timeout, or rate limit
  was retried once and failed again. `RUN_RETRY_LIMIT`, `TOTAL_WAIT_LIMIT`:
  the run's five retries or 30 s of waiting were spent. `WAIT_LIMIT`: a retry
  instruction longer than the fifteen-second wait. `RETRY_SIGNAL_MALFORMED`:
  a retry instruction that was not a positive wait.

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
- `REPOSITORY_SCREENED_OUT` counts later candidates of a repository already
  rejected once. `REPOSITORY_REPEATED`: a repository the deck already holds.
- `SOURCE_DUPLICATE`, `PUBLIC_CONTAINMENT_REJECTED`,
  `SOURCE_IDENTITY_UNREPORTABLE`: a source another round already shows, a
  pane that would reveal a protected value, and a source the run report could
  not record.
- `SUBJECT_UNUSABLE`: a commit subject no hint can quote.
- `PROJECT_NAME_IN_EXCERPT`: code or a file name names an option, including
  a distinctive part of a name, such as `graphql` for graphql-ruby.
  `PROJECT_NAMED_BY_TEMPLATE`: the deck's own wording names the repository.
- `LANGUAGE_PAIR_AMBIGUOUS`: the code does not tell its language from the
  look-alike. `LANGUAGE_ROUNDS_REJECTED`: another language-round check.
- `ALGORITHM_WINDOW`, `ALGORITHM_NAME_IN_CODE`, `ALGORITHM_FAMILY_SHORT`: a
  file with no masked window, code that still names an option, and a family
  dropped whole because one of its algorithms found no file.
  `ALGORITHM_SCREEN`: screened bytes that differ from the bound file's.
- `OUTPUT_NO_DOCTEST`: a file with no function a round can ask about (most
  files). `OUTPUT_PANE_SIZE`: a pane over the byte limit.
  `OUTPUT_FILE_CHANGED`: the file bound differs from the file read.
  `OUTPUT_RANKS_UNBALANCED`: no choice of answers fills every rank in both
  orders, so the output deck is skipped.
- `FIX_PATCH_WIDE`: a dataset patch that changes more than one line (most).
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
```

## Done means

1. `pnpm prepare:poc` exits successfully with its completion marker.
2. The artifact holds the intended decks, each a pool of at least five rounds,
   passes server-side validation and the leakage test, and its pinned hash
   matches.
3. The root route plays every deck offline.
4. Browser, build, accessibility, performance, containment, unit, and type
   checks pass freshly.
5. The README and its media reflect what actually plays.
