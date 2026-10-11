---
evidence: phase-1-journal-runs
observed-at: 2026-10-11
outcome: success
artifact-published: true
credential-material-recorded: false
---

# Phase 1 journal runs

Three preparation runs on 2026-10-11 exercised the Phase 1 pipeline: the run
journal, per-deck publication, and the preparer-written pin. The live runs
used the Hugging Face token from the standard token file and the `gh` CLI's
GitHub token, both supplied through the environment. The offline run had
neither token in its environment.

## Runs

| Run | Command | Result | Spend | Journal |
| --- | --- | --- | --- | --- |
| 5 | `pnpm prepare:poc` | `PREPARATION_DECKS project,language,ai`, `PREPARATION_COMPLETE` | `PREFLIGHT=2 STACK_METADATA=35 DISCOVERY=11 ADMISSION=203 BLOB_RETRIEVAL=133 total=384` | `mode=fresh replayed=0 live=351` |
| 5r | `pnpm prepare:poc --resume` | same decks; artifact byte-identical to run 5 | `total=384`, per stage as run 5 | `mode=resume replayed=349 live=5` |
| 5o | `pnpm prepare:poc --offline` | same decks; artifact byte-identical to run 5 | `total=384`, per stage as run 5 | `mode=offline replayed=354 live=0` |

- Run 5 recorded 351 entries (29 MB): every accepted GitHub and Hugging Face
  response and every successful worker output.
- An earlier offline replay of run 5's journal also reproduced the artifact
  byte for byte, but spent 381 requests. Three GitHub requests had answered
  4xx, and the journal did not record failures, so offline replay rejected
  those three candidates with `JOURNAL_MISS` instead. The journal now records
  deterministic 404, 409, 410, 422, and 451 answers.
- Run 5r went live only for the two Stack access checks (always live on resume)
  and the three requests that had answered 4xx, and recorded those answers.
- Run 5o's run report equals run 5r's in every field except `executionId` and
  `observedAt`, including the three `GITHUB_REVALIDATION:UNSUPPORTED_STATUS`
  rejections. It took about two seconds.

## Result

| Item | Value |
| --- | --- |
| Artifact canonical SHA-256 (written to the pin by the preparer) | `602ca9f5fb48a699da68ded37b944d30ca236023f3618937d1d5ad5bbc8dfe06` |
| Crawl snapshot id | `f46281e199378a45a4df8d1722235f391c59976146579c61ca94e334b6dfa8c1` |
| Decks | project, language, ai; five fixtures each |

The fifteen rounds and their sources are the same as in the
[three-deck live run](2026-10-11-three-deck-live-run.md). Eight of the 15
accepted-response hashes differ from run 4, because those provider responses
returned different bytes. The changed hashes give a new crawl snapshot id, and
with it new round versions and a new artifact hash.

## Journal content check

All 1,470 structured `email` fields in the journal are stored as
`redacted@journal.invalid`. Commit messages are kept as published, including
GitHub `noreply` addresses in `Co-authored-by` trailers, because the AI-credit
check reads those trailers. The journal is in the ignored
`ops/poc/stack/tmp/` directory and was not committed.
