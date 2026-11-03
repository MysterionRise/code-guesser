---
evidence: genui-anthropic-live-check
observed-at: 2026-11-03
outcome: success
artifact-published: false
credential-material-recorded: false
---

# Generative UI: the first live check against Anthropic's own API

PR #246 added Anthropic's Messages API as a second provider for generative UI (#101), beside OpenRouter, tested only
against a local stand-in (`tests/e2e/fake-anthropic.mjs`). This check ran it against the real service:
- the production build of the PR's branch (`79a959b`), on localhost, lab mode, events tagged `agent`;
- `ANTHROPIC_API_KEY` alone, read from `~/.config/anthropic/key` (the owner's monthly-capped key), so the provider
  was implied by the key, not named;
- the default model, `claude-haiku-5-5`, for the explainers, and `ANTHROPIC_MODEL_HOST=claude-sonnet-5-5` for the
  host, the shape agent playtest run 3 recommended (#120, #237); reasoning off everywhere, so Haiku ran with
  `thinking: disabled` and the Sonnet host with `between_tools`, its lowest setting.

A script drove the playtest driver (`ops/playtest/driver.mjs`) through one round per design: answered the first
option, then asked the design for its panel. Nothing was retried.

## What rendered

| Design | Deck | Calls | Tokens in / out | Time | What came back |
| --- | --- | --- | --- | --- | --- |
| catalog | algorithm | 5 | 2,795 / 936 | 7.4 s | a takeaway, both signal lists, and code views on the lines that give bucket sort away |
| composer | language | 1 | 7,025 / 1,313 | 8.7 s | a whole panel: verdict, the decisive lines 1–18, a comparison, and a quiz whose wrong answer drew the right feedback |
| visualizer | fix | 1 | 2,067 / 1,461 | 8.9 s | a stepped page showing line 13 before and after the fix, with the player's wrong pick for comparison |
| host, before the lock | exercise | 2 | 1,444 / 174 | | a cheer that declined to help with the answer, and one hint offer |
| host, after the lock | exercise | 3 | 2,449 / 517 | 10.8 s | a takeaway on what a saddle point is and how the code finds one |

Every call finished on its tool calls (`GENUI_FINISHED … tool-calls`), with no `GENUI_STREAM_FAILED` and no
`GENUI_RENDER_REJECTED`. The after-lock host turn finished on `stop` with its three calls made. Five `genui_call`
events were recorded; no event, driver log, or server log held the key or a provider body.

## Cost

At Anthropic's rates ($0.10 and $0.50 per million for Claude Haiku 5.5, $2 and $10 for Claude Sonnet 5.5), the
three Haiku panels together cost about $0.003 and the two Sonnet host turns about $0.015: a game of five rounds with
the host would be about $0.08, the same order as run 3's OpenRouter measurement.

## Checked and not changed

- The settings behaved as documented: the provider was implied by the Anthropic key alone, the host took its own
  model, and the shared default held for the explainers.
- The request shapes the unit tests pin (`thinking: disabled`, `between_tools` for Sonnet, one tool call at a time
  for the single-call designs) are what the service accepted.

## Not covered

- A spent or refused key (a 402 or 429 from Anthropic), covered by the stand-in only.
- The remaining decks, themes, and question layers: this was a provider check, not a playtest.
