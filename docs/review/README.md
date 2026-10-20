# Reviews and plans

Current state, 2026-10-20: Phases 0 to 3b of the deck pipeline are merged into
`main`, and the v1.0 data run has frozen ten decks in one committed artifact
(schema `local-experiment-artifact.v5`, profile `local-real-rounds.v6`): 296
rounds, each deck a pool of 20 to 52, and a game deals five. The public-app track (#109) has
merged Phases 1 and 2. **v1.0** (milestone #4, checklist #130) is merged:
- more decks and bigger pools;
- a cleaner UI;
- visual themes as experiment arms;
- question layers generated at preparation time;
- the experiment pipeline;
- agent playtest run 2 and its fixes.

Its [release notes](../releases/v1.0.0.md) cover it all, and the `v1.0.0` tag
waits for the owner's go-ahead. Its data work replaced Phase 3c's open decisions
with the ones in #129.

| Phase | What it did | PRs | Run record |
| --- | --- | --- | --- |
| 0 | Reliability, request savings, UI quick wins | #7 | [three-deck live run](evidence/2026-10-11-three-deck-live-run.md) |
| 1 | Run journal, per-deck publication, one artifact model | #8 | [journal runs](evidence/2026-10-11-phase-1-journal-runs.md) |
| 2 | Deck redesign: pools, Before or after?, popular projects | #9 | [v3 decks run](evidence/2026-10-11-v3-decks-run.md) |
| 3a | The Stack v2 grown to twelve languages in look-alike pairs | #10; docs #11 | [v4 Stack growth run](evidence/2026-10-13-v4-stack-growth-run.md) |
| 3b | Which algorithm?, Predict the output, Spot the fix | #12–#18; docs #19 | [v5 six decks run](evidence/2026-10-13-v5-six-decks-run.md) |
| 3c | Other forges (GitLab, Software Heritage) and Which era? | planned | [next-sources plan](2026-10-13-next-sources-plan.md) |

Phase 3b by PR: #12 curated sources, #13 algorithm deck, #14 output deck,
#15 fix deck, #16 game UX, #17 go-live, #18 the vertical `demo.gif`.

### Public app track (#109)

The 2026-10-14 decision: take the game public, add generative UI, and compare
designs with an anonymous first-party event log.

| Phase | What it did | PRs | Issues |
| --- | --- | --- | --- |
| 1 | Server-held game state; the answer-lock guard; generative UI on the Vercel AI SDK through OpenRouter, behind `GENUI_ENABLED`; fixes from the first live check | #110, #111, #112, and this phase's completion PR | #96, #102, #101; [live check](evidence/2026-10-14-genui-live-check.md) |
| 2 | Open-ended designs compared locally: a design switcher, the json-render composer, a sandboxed visualizer, and the host chat; a Claude Code agent playtest team and the fixes from its first run | #117, #118, #119, and #116's PR | #114, #115, #104, #116; [agent playtest](evidence/2026-10-14-agent-playtest.md) |
| v1.0 | Arm assignment and the event log, the report, themes, question layers, the UI pass, the v6 data run, and agent playtest run 2; hardening comes after | #131–#162; [release notes](../releases/v1.0.0.md) | #106–#108, #125–#130; [language option sets](evidence/2026-10-15-language-pairing-offline.md), [v6 leak rules dry run](evidence/2026-10-19-v6-leak-rules-dry-run.md), [v6 data run](evidence/2026-10-19-v6-data-run.md), [agent playtest run 2](evidence/2026-10-20-agent-playtest-run-2.md) |

- [Architecture](../architecture.md): the flow from preparation to play, the
  artifact's shape, and a glossary.
- [State review](2026-10-11-codeguessr-state-review.md): the 2026-10-11
  decisions and roadmap, and the historical findings they came from.
- [New rounds research](2026-10-13-new-rounds-research.md): the three decks
  Phase 3b added, the sources checked, and the deck backlog.
- [Next sources plan](2026-10-13-next-sources-plan.md): Phase 3c and its open
  decisions.

Open work is tracked as issues: https://github.com/MysterionRise/code-guesser/issues
