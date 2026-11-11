# Reviews and plans

Current state, 2026-11-11: Phases 0 to 3b of the deck pipeline are merged into
`main`, and the v7 data run (v1.1, #167) has frozen ten decks in one committed artifact
(schema `local-experiment-artifact.v6`, profile `local-real-rounds.v7`): 422
rounds, each deck a pool of 30 to 52, and a game deals five. The v7 rules of #200
rebuilt it on 2026-10-26 with the same pools, refusing rounds that echoed an option
or repeated an idea. The v1.0 data run's
artifact held 296. The public-app track (#109) has
merged Phases 1 and 2. **v1.0** (milestone #4, checklist #130) is merged:
- more decks and bigger pools;
- a cleaner UI;
- visual themes as experiment arms;
- question layers generated at preparation time;
- the experiment pipeline;
- agent playtest run 2 and its fixes.

Its [release notes](../releases/v1.0.0.md) cover it all, and the `v1.0.0` tag
and GitHub release went out on 2026-10-20. Its data work replaced Phase 3c's open decisions
with the ones in #129.

**v1.1** (milestone v1.1, checklist #174) is merged too: the hardening for anonymous public play, duel challenge
links, profile v7's bigger pools, and the fun pass. It is ready for public play and still served locally. Its
[release notes](../releases/v1.1.0.md) cover it, and the `v1.1.0` tag marks the commit that merged them. The launch
itself, a server and day 0, has its own milestone (Launch, #100), and the next release planned is the data-quality
one (milestone v1.2).

Ahead of launch, [agent playtest run 3](evidence/2026-11-02-agent-playtest-run-3-fun.md) (2026-11-02)
judged fun for the first time, against a release bar: four of its nine lines failed; the code-side fixes are merged
(#242–#245) and the data-level ones wait for the next preparation run (#228–#231, #240). The
[Anthropic live check](evidence/2026-11-03-genui-anthropic-live-check.md) (2026-11-03) ran generative UI through
Anthropic's own API, the second provider (#246): every design rendered on the first try.

The [next steps review](2026-11-10-next-steps-review.md) (2026-11-10) read the milestones, the pull requests, and
every open issue with four reviewer agents: v1.1 is finished except for the server, and the next phase it proposes
is a data-quality release under one new profile version. Its tests are
[agent playtest run 3b](evidence/2026-11-10-agent-playtest-run-3b.md): the question layers on unseen rounds, the
duel by keyboard, the phone pages, the answer-lock guard through Anthropic's API, and a pipeline replay after the
worker's lock moved (#251), which found that a resume on a later day changes the artifact's hash (#252).

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
| v1.1 | Ready for public play, still local: the hardening for one instance of the owner's server, async duel challenge links, bigger pools from the current sources (profile v7, 422 rounds), Node 24, a dated change log for the experiment, the fun pass, and Anthropic's own API as a second provider | #176–#220, #223–#227, #242–#246, #250, #251, #254; [release notes](../releases/v1.1.0.md) | #164–#174 (checklist #174); [next-phase plan](2026-10-20-next-phase-plan.md), [v7 dry run](evidence/2026-10-21-v7-dry-run.md), [v7 data run](evidence/2026-10-21-v7-data-run.md), [v7 round fixes](evidence/2026-10-26-v7-round-fixes.md), [agent playtest run 3](evidence/2026-11-02-agent-playtest-run-3-fun.md), [Anthropic live check](evidence/2026-11-03-genui-anthropic-live-check.md), [agent playtest run 3b](evidence/2026-11-10-agent-playtest-run-3b.md) |
| v1.2 | Planned 2026-11-10: the data-quality release. Hints and reveal sentences under one new profile version and one re-pin, after the engineering that data run needs. Started 2026-11-11 with that engineering (quiet uv, preflight causes, replays that survive a lock move or a later day), contributor docs, and media size budgets | #260, #261 so far | milestone v1.2 (#228–#231, #240, #82, #80, #159, #160, #194, #255's last step, and more); [next steps review](2026-11-10-next-steps-review.md) |
| Launch | The owner's server, the smoke test on it, and day 0, moved out of v1.1 when the owner deferred the server. Ahead of it, since 2026-11-11: local play on Anthropic's own API (`pnpm play`), and CI makes the image's model call against each provider's stand-in | #259, #262 so far | #100, #170, #120; [deploy runbook](../deploy.md) |

- [Architecture](../architecture.md): the flow from preparation to play, the
  artifact's shape, and a glossary.
- [State review](2026-10-11-codeguessr-state-review.md): the 2026-10-11
  decisions and roadmap, and the historical findings they came from.
- [New rounds research](2026-10-13-new-rounds-research.md): the three decks
  Phase 3b added, the sources checked, and the deck backlog.
- [Next sources plan](2026-10-13-next-sources-plan.md): Phase 3c and its open
  decisions.
- [Next-phase plan](2026-10-20-next-phase-plan.md): v1.1's four tracks (launch,
  data, player features, duels), the owner's decisions, and their order.
- [Next steps review](2026-11-10-next-steps-review.md): the state on 2026-11-10, the milestones as they
  are and as proposed, the next phase in ordered batches, and the owner's thirteen open decisions.

Open work is tracked as issues: https://github.com/MysterionRise/code-guesser/issues
