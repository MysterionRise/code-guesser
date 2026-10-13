# Architecture

CodeGuessr runs in two separate phases. At preparation time, `pnpm prepare:poc`
reads public code over the network and freezes up to six decks into one JSON
artifact. At play time, the Next.js game serves that artifact from disk and
makes no outbound requests. Only two committed files pass from one phase to the
other: the artifact and its pinned hash.

## The flow

```text
PREPARATION TIME: pnpm prepare:poc, run by hand on one machine
  profile (ops/poc/profiles/local-real-rounds.v5.json) + ops/poc/limits.json
      |
      v
  ops/poc/prepare/pipeline.ts: prepareLocalExperiment
      |  each request passes runtime.ts: request policy, budgets, retries, journal
      |
      |  ~~~~~~~~~~~~~~~~~~~~~~~~ network ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      +--> Hugging Face: The Stack v2 metadata   (Python: stream_metadata.py)
      +--> Software Heritage S3: selected blobs  (Python: fetch_blob.py)
      +--> GitHub API: search, lineage, admission, revalidation, curated files
      |  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      |        ^ --resume and --offline replay accepted responses from
      |          ops/poc/stack/tmp/journal/run.jsonl (gitignored)
      v
  select-*.ts -> *-rounds.ts -> compose.ts, checked by packages/artifact
      |
      v
  apps/game/src/demo/generated/local-real-rounds.json       (committed)
  apps/game/src/demo/local-real-experiment.pin.server.ts    (committed hash)
=========================== no network below this line ===========================
PLAY TIME: the Next.js server on localhost, and the player's browser
  local-real-experiment-loader.server.ts: read the artifact once per process
      -> createLocalRealExperiment: canonical hash = pin? parse with packages/artifact
      -> page.tsx: the deck chooser, or dealSession(deck): five rounds, no answers
      -> browser: hints and a guess
      -> actions.ts: authorizeLocalExperimentReveal -> createReveal: answer, score, reveal
```

## Preparation

1. **Profile and limits.** The profile holds the searches, the Stack sample,
   the `curated` section, and the per-run budgets. Its canonical SHA-256 is
   the `profileHash`. `ops/poc/limits.json` holds the pinned Stack v2
   revision and the hard ceilings; `ops/poc/limits.ts` and
   `ops/poc/stack/limits.py` both read it.
2. **Network stages**, in the order `pipeline.ts` runs them:
   - preflight: the Hugging Face access check, always live;
   - Stack metadata: a Python worker reads each language's first parquet row
     group through byte ranges;
   - discovery: GitHub commit search;
   - admission: lineage and admission for the before-or-after deck;
   - blob retrieval: a Python worker fetches the chosen Stack files from
     Software Heritage, and each is revalidated on GitHub;
   - curated files: TheAlgorithms files and dataset bugs for the algorithm,
     output, and fix decks (`github-files.ts`, `github-fixes.ts`, both over
     `github-git.ts`).

   Every request goes through `runtime.ts`: `request-policy.ts` allows it,
   `capacity.ts` meters it against the budgets, and `retry.ts` retries a
   transient failure once.
3. **Journal.** `journal.ts` and `worker-journal.ts` record each accepted
   response and worker output with its hash. The hashes of accepted responses
   make up the crawl snapshot id, so a replay reproduces the same snapshot.
4. **Select and compose.** `select-stack.ts`, `select-github.ts`,
   `select-algorithm.ts`, `select-output.ts`, and `select-fix.ts` screen
   candidates and fill each deck's pool; a deck that cannot fill is skipped.
   The generators (`project-rounds.ts` and the other `*-rounds.ts`) turn
   candidates into rounds, and `compose.ts` builds the artifact and parses it
   with `packages/artifact`.
5. **Publish.** `artifact-store.ts` parses the artifact again and writes it
   atomically. `publishWithPin` in `dependencies.ts` writes the pin in the same
   step and restores the old pin if publication fails. The run report goes to
   the ignored `ops/poc/stack/tmp/local-experiment-run.json`.

## Play

6. **Load.** `local-real-experiment-loader.server.ts` reads the artifact once
   per server process. `createLocalRealExperiment` in
   `local-real-experiment.server.ts` checks the artifact's canonical SHA-256
   against `TRUSTED_ARTIFACT_HASH` and parses it with `packages/artifact`. A
   missing or rejected artifact leaves the page in its empty state.
7. **Deal.** On each page load, `dealSession` takes five rounds at random from
   the deck's pool and reshuffles the options of four-option rounds, except
   fix rounds. The browser receives only the public round: panes, prompt,
   options, hints, and points. The answer and the reveal text stay on the
   server.
8. **Reveal.** The server action `authorizeLocalExperimentReveal` in
   `apps/game/src/app/actions.ts` calls `createReveal`. It checks the round
   and its version, the chosen option, the hints used, and that the claimed
   score is reachable, then returns whether the guess was right, the answer,
   the round score, and the reveal text.

## The artifact

`packages/artifact/src/artifact.ts` is the authority: the parser
(`parseArtifactDecks`) and the canonical hash (`artifactHash`). The
constants and types it checks against are in `packages/artifact/src/domain.ts`,
and the source rules are in `packages/artifact/src/source.ts`. The preparer
and the game share this one parser. The outline below is a map of the key
names, not a schema:

```text
schemaVersion        "local-experiment-artifact.v4"
contentClass         "LOCAL_UNREVIEWED_EXPERIMENT"
profileHash
crawlSnapshot        id, profileVersion, profileHash, github, stack,
                     curated (when the profile has one), acceptedResponseHashes
decks[]              id, title, description, roundsPerSession, fixtures[]
  fixtures[]         kind, roundId, roundVersion, panes, prompt, candidates,
                     clues, correctCandidateId, evidence, explanation,
                     attribution, helpfulSignals, misleadingSignals, source
```

Beyond the shape, the parser checks:
- each round against its kind's rules;
- each source against the snapshot;
- each deck's duplicate and balance rules;
- that no commit, blob, or excerpt appears twice across decks
  (`CROSS_DECK_KEYS_BY_KIND`; algorithm and output rounds share a pinned
  commit, so they compare only blobs and excerpts);
- that no protected source value appears in text shown before the answer.

## Glossary

| Word in the docs | Field or code | Meaning |
| --- | --- | --- |
| Deck | `decks[]`, `id` | One of six game modes: `project`, `language`, `before-after`, `algorithm`, `output`, `fix` (`DECK_IDS`). |
| Pool | `decks[].fixtures` | All of a deck's rounds, from 5 to 40 (`MAXIMUM_POOL_SIZE`). |
| Round | `fixtures[]` | One question. The code calls it a fixture. |
| Session, game | `dealSession`, `roundsPerSession` | Five rounds dealt at random from one pool. |
| Kind | `fixtures[].kind` | The round type: `PROJECT`, `LANGUAGE`, `BEFORE_AFTER`, `ALGORITHM`, `OUTPUT`, or `FIX`. Each deck holds one kind (`DECK_KINDS`). |
| Pane | `fixtures[].panes[]` | A block of code the round shows: `{ label, text }`. Before-or-after rounds have panes `A` and `B`; the others have one unlabelled pane. |
| Window | `source.excerptHash`; `code-windows.ts` | The stretch of whole lines a pane shows, cut from a file within the profile's `screening` limits (at most 18 lines and 4,096 bytes), usually past the imports. |
| Option | `candidates[]` | A possible answer: `{ id, label, detail }`. Four per round, two for before-or-after. Only project options carry a `detail`, the repository description. |
| Answer | `correctCandidateId` | The right option's id. It never reaches the browser before the guess. |
| Hint | `clues[]` | Two per round. Each one used lowers the round's points. |
| Reveal | `evidence`, `explanation`, `attribution`, `helpfulSignals`, `misleadingSignals` | What the player sees after a guess: where the code came from, why the answer is right, and what pointed toward it or away from it. |
| Source | `fixtures[].source` | The round's provenance: repository, commit, path, blob, licence, author, and `discoverySource`. Its protected values (`PROTECTED_SOURCE_KEYS`) may not appear in public text. |
| Discovery source | `source.discoverySource` | How the source was found: `GITHUB_COMMIT_SEARCH`, `STACK_V2`, `CURATED_GITHUB`, or `CURATED_DATASET`. |
| Masking | `MASKED_NAME` | An algorithm round shows the algorithm's own names as `mystery`, cased like the name it replaces. |
| Profile | `profileVersion`, `profileHash` | The crawl settings in `ops/poc/profiles/local-real-rounds.v5.json`. Changing it changes every round's version. |
| Limits | `ops/poc/limits.json` | The pinned Stack v2 revision and hard ceilings that no profile may exceed. |
| Budget | profile `capacity`; `capacity.ts` | Per-run ceilings on requests, bytes, blob attempts, retries, and waits. Running out skips the deck being filled and every later deck (`BUDGET_EXHAUSTED_*`). |
| Journal | `ops/poc/stack/tmp/journal/run.jsonl` | Every response and worker output a run accepted, for `--resume` and `--offline`. Gitignored, because it holds provider bodies. |
| Crawl snapshot | `crawlSnapshot`, `source.crawlSnapshotId` | What one run read: the profile and the hashes of every accepted response, with the `github`, `stack`, and `curated` settings. Every source names its snapshot id. |
| Curated | profile `curated`; `crawlSnapshot.curated` | The pinned repositories and bug datasets behind the algorithm, output, and fix decks. The snapshot lists their `pins`, `algorithms`, and `datasets`. |
| Lineage | `github-lineage.ts`; `LINEAGE_*` | A before-or-after commit bound to its single parent and one file's two versions, with a change that fits one window. |
| Admission | `github-admission.ts`; `ADMISSION_*` | The repository check (public, not a fork, not archived, licence on the allowlist), the licence file at the commit, and the recorded author. |
| Revalidation | `stack-revalidation.ts`; `REVALIDATION_*` | Checking a Stack v2 file from Software Heritage against GitHub: the same bytes at the recorded commit and path, an agreeing licence, and a usable window. |
| Screening | `screenBlob`; selection diagnostics | Checks that drop a candidate before it becomes a round: the content screen (path, size, binary, generated, minified, secret-like, personal data, duplicate) and each deck's own rules. Expected outcomes, not faults. |
| Artifact | `apps/game/src/demo/generated/local-real-rounds.json` | The frozen decks the game plays. Committed. |
| Pin | `TRUSTED_ARTIFACT_HASH` | The artifact's canonical SHA-256 in `local-real-experiment.pin.server.ts`. The preparer writes it; the game plays only a matching artifact. |
| Leakage | `packages/artifact/test/deck-leakage.test.ts` | A way to pick the answer without reading the code, such as option position or length. The test keeps code-blind solvers within chance plus ten points. |
