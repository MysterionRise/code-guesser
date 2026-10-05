# CodeGuessr

[![CI](https://github.com/MysterionRise/code-guesser/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MysterionRise/code-guesser/actions/workflows/ci.yml)

CodeGuessr is “GeoGuessr for code”: inspect an unfamiliar code sample, reveal
progressive clues, and guess where it came from.

This branch contains two distinct local experiences:

- The synthetic five-round demo is runnable now.
- The real-round experiment pipeline is implemented and tested, but its live
  five-round artifact has not been generated. The latest bounded attempt stops
  at GitHub Search with `TransportError: UNSUPPORTED_STATUS`.

The real experiment is therefore a work in progress, not a runnable real-data
demo yet. It remains localhost-only, automatically prepared, unreviewed, and
unsuitable for public players.

## Synthetic demo

Prerequisites:

- Node.js `20.18.0`
- pnpm `9.15.9`

```bash
pnpm install --frozen-lockfile
pnpm --filter @codeguessr/game dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The root route currently
uses the synthetic rehearsal catalogue.

For a production-mode local run:

```bash
pnpm --filter @codeguessr/game build
pnpm --filter @codeguessr/game start
```

## Real-round experiment

The operator-only preparer is designed to produce exactly five frozen rounds:

- Three provenance rounds discovered through public GitHub commit search.
- Two language rounds discovered through streamed The Stack v2 metadata and
  selected Software Heritage blob retrieval.

Every selected source is revalidated against immutable public GitHub records.
Gameplay consumes only the resulting local artifact and performs no network
requests during rounds.

The signed design requires bounded selected-blob access and forbids complete
Stack datasets, language shards, and repository archives. The TypeScript and
GitHub path enforces its declared request and response ceilings, but the Python
Stack workers do not yet enforce or demonstrate the same endpoint, redirect,
network-byte, request, credential-forwarding, and temporary-disk boundaries.
Treat this as a blocking implementation gap, not as a completed safety claim.

### Access prerequisites

Provide credentials only through environment variables or provider-standard
credential stores. Never add them to repository files or command arguments.

| Input | Requirement |
| --- | --- |
| `HF_TOKEN` | Required token for the already-accepted `bigcode/the-stack-v2` gated dataset. |
| `STACK_V2_ACKNOWLEDGED_USABLE_REVISION` | Required non-secret acknowledgement. Its exact value must be `e565caa3a78c2423bd374333a472b049eb090e47`. |
| Software Heritage AWS access | Required through the standard AWS credential chain, such as `~/.aws/credentials` or the normal AWS environment variables. |
| `GITHUB_TOKEN` | Optional read-only token. Whether authentication was supplied has not yet been classified for the latest GitHub failure. |

Run preparation with:

```bash
pnpm prepare:poc
```

The intended successful outputs are:

- `apps/game/src/demo/generated/local-real-rounds.json`
- `ops/poc/stack/tmp/local-experiment-run.json`

Neither file exists in this handoff. The artifact publisher is atomic, but the
current orchestration writes a success report before publishing the artifact;
a publication failure can therefore leave an orphan success report. Do not
manually fabricate or substitute either output. The real experiment must not be
mounted as the active route until preparation succeeds, report/artifact
publication is transactional, and the artifact passes the existing server-side
validation and browser/containment sweep.

## Current blockers

The Stack access preflight completes. The first GitHub Search request receives
an HTTP status outside the transport's accepted success range, classified as
`GITHUB_SEARCH | TransportError | UNSUPPORTED_STATUS`. The response body was
not used for diagnosis, no retry was made, and failed attempts left no partial
artifact, report, or temporary output.

The next investigation should determine the HTTP status and whether it is an
authentication or rate-limit condition without exposing credentials, provider
bodies, repository identities, or source content. Provider access requires the
operator's explicit authorization.

An independent handoff audit found two additional blockers:

- The Python Stack metadata and selected-blob workers bypass the bounded
  TypeScript transport and do not yet prove the signed network and temporary-
  disk ceilings.
- The success report is written before artifact publication and is not rolled
  back if publication fails.

See the [handoff audit](docs/gangsta/codeguessr-poc-readiness/reviews/2026-09-04-handoff-audit.md)
for exact code references. Both require failing regression tests before fixes.

## Verification

The offline preparation suite can be run independently:

```bash
pnpm exec vitest run ops/poc/prepare
pnpm exec tsc --noEmit -p ops/tsconfig.json
uv run --project ops/poc/stack python -m unittest discover -s ops/poc/stack
```

The complete workspace verification matrix is:

```bash
pnpm test
pnpm typecheck
pnpm test:a11y
pnpm test:performance
pnpm test:e2e
pnpm exec node --test tests/containment/acquisition-boundary.test.mjs
pnpm --filter @codeguessr/game build
```

Fresh handoff verification on 2026-09-04 produced:

- 2,279/2,279 workspace tests on the final full rerun;
- all workspace and operator TypeScript checks passing;
- 16/16 locked Python worker tests;
- 37/37 accessibility checks and 6/6 performance checks;
- 3/3 acquisition-containment checks;
- a successful production build; and
- 13/13 Playwright scenarios against the local Next server.

An immediately preceding full workspace run reproduced the known intermittent
audit-chain concurrency assertion: both append operations succeeded when the
test expects one rejection. Its focused rerun and the final full rerun passed.
This remains engineering debt and is not represented as resolved.

If Playwright reports that Chromium is missing on a fresh machine:

```bash
pnpm exec playwright install chromium
```

## Handoff and project record

Claude-based agents should begin with [CLAUDE.md](CLAUDE.md), then read the
[latest checkpoint](docs/gangsta/codeguessr-poc-readiness/checkpoints/2026-09-04-checkpoint-handoff.md),
the [handoff audit](docs/gangsta/codeguessr-poc-readiness/reviews/2026-09-04-handoff-audit.md),
the [signed revision-11 Contract](docs/gangsta/codeguessr-poc-readiness/specs/2026-08-15-contract-revision-11-signed.md),
and the [execution plan](docs/gangsta/codeguessr-poc-readiness/plans/2026-07-31-execution-plan.md).

The signed Contract SHA-256 is
`3acc586d8fb479e6edfd2dd43e9f38ed5d8d6268ee5b025b449d3a564b32fe41`.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/game` | Next.js game, arcade UI, reveal authorization, and local experiment validation |
| `ops/poc/prepare` | GitHub/Stack orchestration, validation, selection, reporting, and publication |
| `ops/poc/stack` | Locked Python worker for streamed Stack metadata and selected blob retrieval |
| `ops/poc/profiles` | Versioned local experiment crawl profile |
| `packages/content` | Server-only acquisition support and broader content boundaries |
| `tests` | Accessibility, browser, performance, and containment suites |
| `docs/gangsta` | Contracts, plans, checkpoints, reviews, reports, and evidence |
