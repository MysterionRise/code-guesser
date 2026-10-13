# Reviews and plans

Current state, 2026-10-13: Phases 0 to 3b are merged into `main`. The game
plays six decks from one committed artifact (schema
`local-experiment-artifact.v4`, profile `local-real-rounds.v5`); each deck is a
pool of 10 or 24 rounds, and a game deals five. Phase 3c is planned and waits
on the owner's decisions.

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

- [Architecture](../architecture.md): the flow from preparation to play, the
  artifact's shape, and a glossary.
- [State review](2026-10-11-codeguessr-state-review.md): the 2026-10-11
  decisions and roadmap, and the historical findings they came from.
- [New rounds research](2026-10-13-new-rounds-research.md): the three decks
  Phase 3b added, the sources checked, and the deck backlog.
- [Next sources plan](2026-10-13-next-sources-plan.md): Phase 3c and its open
  decisions.

Open work is tracked as issues: https://github.com/MysterionRise/code-guesser/issues
