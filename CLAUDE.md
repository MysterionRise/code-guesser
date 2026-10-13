# Claude handoff: CodeGuessr local real-round PoC

## Mission

A local-only "guess from the code" game. One preparation run crawls real
open-source code before play and freezes three decks, each a pool of rounds
from which every game deals five:

- "Which project?": 24 rounds of popular repositories from The Stack v2.
- "Which language?": 24 rounds over twelve languages in look-alike pairs,
  from The Stack v2.
- "Before or after?": 10 refactor commits from GitHub search.

The goal is a demo on one machine, not public play.

## Read first

1. `docs/review/2026-10-11-codeguessr-state-review.md`: current product and
   engineering review, decisions, and the roadmap.
2. `docs/review/2026-10-13-new-rounds-research.md`: the new decks being built
   (Which algorithm?, Predict the output, Spot the fix), the sources checked,
   and the backlog.
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
  #10 Phase 3a, merged 2026-10-13). Start new work from `main`.
- The game plays profile `ops/poc/profiles/local-real-rounds.v4.json` and
  artifact schema `local-experiment-artifact.v3` from the root-route deck
  chooser (`/?deck=project|language|before-after`). A page load deals five
  rounds from the deck's pool; `dealSession` in
  `apps/game/src/demo/local-real-experiment.server.ts` does it server-side.
- The committed artifact `apps/game/src/demo/generated/local-real-rounds.json`
  came from the 2026-10-13 v4 run (1,146 of 3,000 requests).
  - Its canonical SHA-256
    `ba7ce4346ca492c5791eb64da220441443f780822ef9257fb8df5bd47a2fc3af` is
    pinned in `apps/game/src/demo/local-real-experiment.pin.server.ts`; the
    preparer writes the pin.
  - Evidence: `docs/review/evidence/2026-10-13-v4-stack-growth-run.md`.
  - The run's journal is in `ops/poc/stack/tmp/journal/run.jsonl` on this
    machine, so `STACK_V2_ACKNOWLEDGED_USABLE_REVISION=… pnpm prepare:poc
    --offline` rebuilds it byte for byte with no network.
- Phases 0–2 of the review roadmap and Phase 3a are done:
  - Phase 0: diagnostics, retries, yield, and UI quick wins.
  - Phase 1: the module split, the run journal (`--resume`, `--offline`),
    per-deck publication, the failure report, `ops/poc/limits.json`, and
    `packages/artifact` as the one parser and hash.
  - Phase 2: the v3 decks. The generators are `project-rounds.ts`,
    `language-rounds.ts`, and `before-after-rounds.ts`; the selectors are
    `select-stack.ts` and `select-github.ts`. The windows come from
    `code-windows.ts`. The game deals sessions, shows panes and option
    details, highlights the answer, and scores 250 × options per round. The
    leakage test is `packages/artifact/test/deck-leakage.test.ts`.
  - Phase 3a, growing The Stack v2:
    - **Rows:** twelve languages in look-alike pairs (`LANGUAGE_PAIRS` in
      `packages/artifact`). The worker reads each language's whole first row
      group and returns a bounded sample (`selection.popularRepositories`,
      `filesPerRepository`, `ordinaryRows`).
    - **Language deck:** two whole pairs per round in a private cycle. A
      round's code must tell its language from the look-alike
      (`language-markers.ts`).
    - **Project deck:** two rounds per language, each repository an option
      in one language only.
    - **Journal:** keeps failures for offline replay, and a journal miss
      fails the run.
- Port 3000 may be taken locally by an unrelated Docker container; run browser
  tests with `E2E_PORT=3200 pnpm test:e2e`.

## Next steps

Three new decks, one pull request each, from
`docs/review/2026-10-13-new-rounds-research.md`:

1. Done: the curated-source slice. `bindGitHubFile` in `github-files.ts`
   reads one file of a curated repository at a pinned commit, with its
   licence and last human author. The artifact's deduplication, panes, and
   source validators are per kind.
2. Which algorithm? (`algorithm`): TheAlgorithms Python, Java, and Go at
   pinned commits. Families of four, the function name masked.
3. Predict the output (`output`): TheAlgorithms/Python doctests, parsed
   statically in TypeScript and never executed.
4. Spot the fix (`fix`): Defects4J and BugsInPy one-line fixes, with a
   line-number gutter in the game.
5. Game UX for six decks, then the go-live run on profile v5.

Keep the committed profile and artifact unchanged until the go-live pull
request. Test each deck with in-test profiles and recorded fixtures. Ask
before widening the licence allowlist, raising the 3,000-request ceiling, or
adding a source not named in the research note.

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
