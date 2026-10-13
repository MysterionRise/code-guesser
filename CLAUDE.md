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

1. `docs/review/2026-10-11-codeguessr-state-review.md`: current product and
   engineering review, decisions, and the roadmap.
2. `docs/review/2026-10-13-new-rounds-research.md`: the three decks added in
   Phase 3b, the sources checked, and the backlog of further decks.
3. `docs/review/2026-10-13-next-sources-plan.md`: the plan for forges beyond
   GitHub (GitLab, Software Heritage) and the era deck.
4. `README.md`: how to play, prepare, record, and verify.

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
  `gh auth token`) through the environment. Never log or commit tokens,
  provider bodies, contact data, private email, or source excerpts from failed
  diagnostics.
- Gameplay never touches the network; it plays the frozen local artifact.
- Malformed provider data fails closed. Transient errors may be retried within
  the request budget.
- Preserve unrelated worktree changes (`apps/game/tsconfig.tsbuildinfo` stays
  unstaged).

## Current state

- Phases 0 to 3a are merged into `main` (#7 Phase 0, #8 Phase 1, #9 Phase 2,
  #10 Phase 3a). Phase 3b is a stack of pull requests, each on the one before:
  #12 curated sources, #13 algorithm, #14 output, #15 fix, #16 game UX, and the
  go-live pull request. Merge them in that order, then start new work from
  `main`.
- The game plays profile `ops/poc/profiles/local-real-rounds.v5.json` and
  artifact schema `local-experiment-artifact.v4` from the root-route deck
  chooser (`/?deck=project|language|before-after|algorithm|output|fix`). A
  page load deals five rounds from the deck's pool; `dealSession` in
  `apps/game/src/demo/local-real-experiment.server.ts` does it server-side.
- The committed artifact `apps/game/src/demo/generated/local-real-rounds.json`
  came from the 2026-10-13 v5 run (1,859 of 3,000 requests).
  - Its canonical SHA-256
    `1427cf105672682d0dd89ff7a1d7975b9001f939f0dcbefc0126c79160e8459a` is
    pinned in `apps/game/src/demo/local-real-experiment.pin.server.ts`; the
    preparer writes the pin.
  - Evidence: `docs/review/evidence/2026-10-13-v5-six-decks-run.md`.
  - The run's journal is in `ops/poc/stack/tmp/journal/run.jsonl` on this
    machine, so `STACK_V2_ACKNOWLEDGED_USABLE_REVISION=… pnpm prepare:poc
    --offline` rebuilds it byte for byte with no network.
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
    must tell a language from its look-alike (`language-markers.ts`).
  - **Phase 3b,** the curated decks. Each runs only when the profile carries
    its `curated` section, after the Stack and search decks.
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

1. Merge the Phase 3b stack (#12 → #16, then go-live).
2. Phase 3c, in `docs/review/2026-10-13-next-sources-plan.md`: other forges
   (GitLab, Software Heritage) and the "Which era?" deck. It has open decisions
   (licence allowlist, accounts) to settle with the user first.
3. The research note's backlog: guess the commit message (the user said "not
   now"), name the function, which exercise, which framework, vulnerable or
   fixed.

Ask before widening the licence allowlist, raising the 3,000-request ceiling,
or adding a source not named in the research note.

Iterate on deck rules with
`STACK_V2_ACKNOWLEDGED_USABLE_REVISION=e565caa3a78c2423bd374333a472b049eb090e47 pnpm prepare:poc --offline`
(no token); use `--resume` when a change needs responses the journal lacks.

Live run:

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
committed artifact), and re-record the media with `pnpm demo:record` (each GIF
under 4 MB).

## Reading failures

Read the `PREPARATION_STAGE_FAILED <stage> <code> <status-class>` line first;
`ops/poc/stack/tmp/local-experiment-last-failure.json` holds the same codes
with spend, capacity counts, and rejection aggregates.

- `WORKER_EXIT_SAMPLE_REJECTED`, `SAMPLE_REJECTED`: the metadata worker's
  sample request or output broke its bounds (a licence off the allowlist, too
  many repositories or files, an ordinary repository twice).
- `PREPARATION_DECK_SKIPPED <deck> <code>`: that deck did not fill (`DECK_SHORT`,
  or the `BUDGET_EXHAUSTED_*` budget that ran out) and was left out; the others
  still publish. `SELECTION DECK_SHORT` or `NO_DECK_FILLED` means none filled.
- `JOURNAL_MISS`, `JOURNAL_MISSING`, `JOURNAL_CORRUPT`: `--offline` needed a
  response the journal lacks, there is no journal, or a journal entry failed its
  hash check. Run without `--offline` (or with `--resume`). A miss fails the
  whole run, even inside one candidate, so a replay never publishes fewer decks
  than the run it replays.

- `RETRY_SIGNAL_MISSING 4xx`: a 403/429 without a usable retry instruction.
- `WAIT_LIMIT`: a retry instruction longer than the fifteen-second wait.
- `BUDGET_EXHAUSTED_<BUDGET>`: a run-wide budget (requests, blob attempts or
  bytes, metadata bytes, retries, waits, temporary disk) ran out; the deck
  being filled and every later deck are skipped instead of rejecting every
  later candidate. `PREPARATION_SPEND` shows the requests each stage used.
- `LOGICAL_RETRY_LIMIT`, `RUN_RETRY_LIMIT`, `WAIT_LIMIT`: a GitHub 5xx, network
  error, timeout, or rate limit was retried once and failed again, or the
  run's five retries or 30 s of waiting were spent.
- `WORKER_EXIT_<CODE>`: a Python worker exited non-zero with its own stable
  code (`WORKER_UNEXPECTED` for an unmapped exception). A bare `WORKER_EXIT`
  means its stderr was not a code.
- `PUBLIC_CONTAINMENT_*`: names the protected key and public field that
  collided.
- `GITHUB_SEARCH_*`: the discovery check that rejected a search response.
  `INCOMPLETE`, `TOTAL_CHANGED`, `ITEM_COUNT`, and `DUPLICATE` are provider
  inconsistencies; `SHAPE`, `IDENTITY`, and `DATE` are record drift.

Curated files fail with `FILE_*` codes (`FILE_TREE`, `FILE_PATH`, `FILE_BLOB`,
`FILE_AUTHOR`; `FILE_AUTHOR_AUTOMATED` means the file's last ten changes all
came from bots) or with the admission codes.

Rejection aggregates name the failing check: `LINEAGE_*` (`LINEAGE_CHANGE_WINDOW`
is a commit whose change does not fit one before-and-after window),
`ADMISSION_*` (`ADMISSION_REPOSITORY_LICENSE` is a repository licence outside
the allowlist), and `REVALIDATION_*` (`REVALIDATION_WINDOW` is a file with no
code window past its preamble). `REPOSITORY_SCREENED_OUT` counts later
candidates of a repository already rejected once.

Selection diagnostics are expected screening outcomes, not faults:

- `REPOSITORY_REPEATED`
- `SUBJECT_UNUSABLE`: a commit subject no hint can quote.
- `PROJECT_NAME_IN_EXCERPT`: code or a file name names an option, including
  a distinctive part of a name, such as `graphql` for graphql-ruby.
- `PROJECT_NAMED_BY_TEMPLATE`: the deck's own wording names the repository.
- `LANGUAGE_PAIR_AMBIGUOUS`: the code does not tell its language from the
  look-alike.
- `LANGUAGE_ROUNDS_REJECTED`
- `SOURCE_IDENTITY_UNREPORTABLE`
- `ALGORITHM_WINDOW`, `ALGORITHM_NAME_IN_CODE`, `ALGORITHM_FAMILY_SHORT`: a
  file with no masked window, code that still names an option, and a family
  dropped whole because one of its algorithms found no file.
- `OUTPUT_NO_DOCTEST`: a file with no function a round can ask about (most
  files). `OUTPUT_RANKS_UNBALANCED`: no choice of answers fills every rank in
  both orders, so the output deck is skipped.
- `FIX_PATCH_WIDE`: a dataset patch that changes more than one line (most).
  `FIX_CHANGE`, `FIX_DIFF`, `FIX_PARENT`: the upstream fix commit changes
  more of the file, differs from the dataset's line, or is a merge.
  `ADMISSION_LICENSE_SHAPE` here is usually an old commit whose licence file
  GitHub cannot identify. `FIX_RANKS_UNBALANCED`: no choice of windows
  balances the deck.
- `ADMISSION_AUTHOR_CONTACT`: an author recorded under an email address,
  which is never published.

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
