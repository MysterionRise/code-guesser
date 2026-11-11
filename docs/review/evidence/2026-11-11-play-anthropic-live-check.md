---
evidence: play-anthropic-live-check
observed-at: 2026-11-11
outcome: success
artifact-published: false
credential-material-recorded: false
---

# `pnpm play` on Anthropic's own API, and the Sonnet host at `low`

Two things had not been run against the real service:
- `pnpm play`, the new command that serves the game locally with a key from its standard store;
- the host on `claude-sonnet-5-5` with reasoning `low`, the pair `docs/deploy.md` recommends. The first live check
  (2026-11-03) and agent playtest run 3b ran the Sonnet host with reasoning off.

## Setup

- The branch of `pnpm play`, on `main` @ `d5b2508`, with no key in the environment:
  `ANTHROPIC_MODEL_HOST=claude-sonnet-5-5 ANTHROPIC_REASONING_HOST=low pnpm play`.
- The command printed `PLAY_GENUI anthropic key=store` and `PLAY_SERVER http://127.0.0.1:3001`: it took the Anthropic
  key from `~/.config/anthropic/key` (mode 0600) although an OpenRouter key sat in its own store too, and port 3001
  because another program held 3000.
- The explainers ran on the default model, `claude-haiku-5-5`, with reasoning off.
- A script drove the playtest driver (`ops/playtest/driver.mjs`) through one round of each design below, on the
  decks' recorded demo seeds. Nothing was retried.

## What came back

| Design | Deck | Calls | Tokens in / out | Time | What came back |
| --- | --- | --- | --- | --- | --- |
| catalog | algorithm | 5 | 2,900 / 1,014 | 13.6 s with the deal and the answer | a takeaway and both signal lists: a plain list popped from the end, no distances or priority queue, so depth-first search and not Dijkstra's |
| host, before the lock | output | 2 | 1,441 / 151 | 2.7 s | asked for the answer outright, it declined, said it could not point at any option, and offered hint 1 at its price |
| host, after the lock | output | 3 | 2,331 / 709 | 7.1 s | a walk through `trailing_zeroes(0)` by line number, both signal lists, and a takeaway on early-return guards |

Every call finished on its tool calls (`GENUI_FINISHED … tool-calls`), with no `GENUI_STREAM_FAILED` and no
`GENUI_RENDER_REJECTED`. The host's hint offer closed once the round was answered.

## Cost

At the rates the first live check used ($0.10 and $0.50 per million tokens for Claude Haiku 5.5, $2 and $10 for
Claude Sonnet 5.5), the catalog panel cost about $0.001 and the two host turns about $0.016.

## Checked and not changed

- No key or provider body is in the server log, the driver's log, or the driver's event file: a search for
  key-shaped strings in the run folder found none. The run folder is `ops/playtest/tmp/2026-11-11-play-check/`,
  ignored by git.
- The server logs codes and token counts only, so the log shows that each turn finished, not which model or
  reasoning setting answered it. Those are known from the command above.

## Still open

- One host round is a smoke check, not a measurement: #120 (the model per design) is the owner's decision, and run
  3's pilot is still its evidence.
- The container image's first model call is #256's subject.
