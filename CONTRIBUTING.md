# Contributing to CodeGuessr

Branch from `main`, keep a pull request to one change, and fill in its
template. Report a vulnerability through [SECURITY.md](SECURITY.md), not a
public issue.

## Set up and check

The README's [prerequisites table](README.md#play-locally) lists the tools by
task, and its [Verification](README.md#verification) section every check, what
it covers, and the ports it uses. Run the checks your change touches:

- `pnpm test`, `pnpm typecheck`, and `pnpm --filter @codeguessr/game build`
  need only Node.js and pnpm. With uv installed, `pnpm test` also runs the
  Node-to-Python seam test against the real workers.
- `pnpm test:deploy`, `pnpm test:a11y`, `pnpm test:performance`, and
  `pnpm test:e2e` need Playwright's Chromium. Run `pnpm test:e2e` last, since
  `next dev` replaces the production build the other three reuse.
- `pnpm test:container` needs Docker as well.
- The Stack workers' own tests, the `uv run` line of that list, need uv.

## What CI does with a pull request

`.github/workflows/ci.yml` runs on every pull request, a fork's included, with
a read-only token and no secrets. It calls no provider and never runs a live
preparation, so a fork can run everything CI runs. A merge to `main` needs
three checks:

- **Node workspace:** the dependency audit, `pnpm test`, the build, the
  typecheck, the containment test, then the boot, accessibility, performance,
  and browser suites.
- **Container image:** builds the `Dockerfile` and runs `pnpm test:container`.
- **Stack worker:** the Python workers' unit tests.

A run takes about ten minutes. A first-time contributor's run waits for the
owner's approval, and until then the three checks show as waiting.

## Rules a change must keep

The README's [Guardrails](README.md#guardrails) has the full list. In short:

- **Public open-source code only,** with its licence and recorded author. Open
  an issue before widening the licence allowlist, raising a ceiling in
  `ops/poc/limits.json`, or adding a source.
- **Bounded reads.** Preparation never downloads a whole dataset, a whole
  language shard, or a repository archive. Fetched code is read, never run.
- **Nothing private in a commit or a log:** no token or key, no provider body
  (an API response or a fetched file), no contact data such as an email
  address, and never a preparation journal (`ops/poc/stack/tmp/`,
  `ops/poc/questions/tmp/`).
- **No accounts and no personal data in the game.** Nothing stores or logs an
  IP address, user agent, cookie, or persistent id. A feature that starts
  keeping or sending anything adds its entry to
  `apps/game/src/privacy/disclosures.ts`.
- After launch day (#100), a change a player can see adds a dated entry to
  `ops/experiment/changes.json`. Until then the log stays empty.

## Changing preparation

- **The preparer writes the artifact and its pin, never a person.**
  `pnpm prepare:poc` writes `local-real-rounds.json` and
  `local-real-experiment.pin.server.ts` together, and the game offers no
  rounds from an artifact whose hash differs from the pin.
  `pnpm prepare:questions` writes `question-layers.json` and its pin likewise.
- **A fork has no journal.** `--offline` and `--resume` replay the journal of
  an earlier live run, which is never committed, so on a fresh clone both fail
  with `JOURNAL_MISSING`. Rebuilding the committed artifact byte for byte is
  the owner's check: say in the pull request when a change should move it.
- **A worker change orphans recorded outputs.** The journal keys each Python
  worker's output to the worker's code. After a change to
  `ops/poc/stack/*.py` (the `test_*.py` files aside), `--offline` fails with
  `JOURNAL_MISS` until one live `--resume` records the outputs again.

## Recording media

`pnpm demo:record` rewrites the GIFs and the MP4 in `docs/media/`. `pnpm test`
holds each to a size budget (`tests/media/budget.test.mjs`): `demo.gif` under
10 MB, every other GIF under 4 MB, and the MP4 under 6 MB, at 1,000,000 bytes
a megabyte. The recorder's log counts 1,048,576 to its "MB", so compare bytes.
