---
evidence: v5-language-pairing-offline
observed-at: 2026-10-15
outcome: success
artifact-published: true
credential-material-recorded: false
---

# Language option sets: an offline rebuild

The 2026-10-13 audit (#80, #81) found that a player who never reads code could beat
chance just by remembering earlier reveals. On the language and algorithm decks,
each option set made up a fixed group of four rounds that answered each of its
languages once. Three reveals in a group gave the fourth away. This rebuild fixes
the language deck. It ran `--offline`, with no network and no token: 1,787 journal
entries replayed, none live.

## What changed

**Which language? (#81).** Each round still offers its answer's look-alike pair
and one more pair, but the second pair now comes from a derangement:
- Each pair's four rounds (two languages, two rounds each) take four different
  second pairs: every pair except itself and the one it skips. The pairs sit in a
  private cycle, keyed by blob identities, and each pair skips the next one.
- So every pair is the second pair in exactly four rounds, and every language
  still appears in exactly eight rounds.
- An option set now appears in at most two rounds, and when it does, their
  answers sit in different pairs. Before, every set appeared in four rounds.

Only the language deck changed: the same 24 rounds, the same panes, new option
sets. The new pin is
`4747549666813ab44d60fca7df89152a65ea5cf91570b316d8d1539aacd4f90a`.

## The memory player

`memoryPlayer` in `packages/artifact/test/solvers.ts` simulates 4,000 players
dealt uniform games.
- A player remembers every reveal and answers a repeated round from memory.
- Otherwise it rules out answers already revealed for rounds with the same
  options.
- On before-after, where every round has the same two options, it only replays.

The baseline is replay alone: in game *g*, a round was seen before with
probability 1 − (1 − 5/N)^(g−1).

| Deck | Game 2, before → after | Game 3, before → after | Replay baseline, game 2 / 3 |
| --- | --- | --- | --- |
| language | 48.1% → **42.1%** | 64.2% → **55.0%** | 40.6% / 53.0% |
| project | 42.6% | 55.6% | 40.6% / 53.0% |
| algorithm | 48.1% | 64.1% | 40.6% / 53.0% |
| output | 40.8% | 53.5% | 40.6% / 53.0% |
| fix | 40.7% | 53.3% | 40.6% / 53.0% |
| before-after | 74.9% | 87.4% | 75.0% / 87.5% |

The leakage test now requires each deck's memory player to stay within three
points of replay alone, in games two and three.
- **Pass:** language, project, output, and fix.
- **Expected failure, algorithm (#81):** its six families of four still make the
  same groups. Breaking them needs the two families the profile left out, which
  the journal does not hold.
- **Not covered, before-after:** remembering beyond replay buys nothing there.
  Its 75% comes from a 10-round pool (#75).

**A player who has memorised the whole pool.** Twenty-four rounds over 15 possible
sets must repeat some, so such a player can still avoid a repeated set's other
pair: 43.75%. Before, the same player named every answer (100%). The test pins
43.75% as a ceiling.

## Other solvers added (#80)

- **Before-after pane size (#75):** the bigger pane is the newer one in 75% of
  rounds by lines and 80% by characters. It runs as an expected failure until the
  deck is rebalanced from new commits.

## Still waiting for the live run

All of these need files or commits the journal does not hold:
- project panes that echo an option (#77);
- data-only, generated, and near-duplicate rounds (#84);
- output transforms (#78);
- before-after balance and size (#75);
- the algorithm families (#81).
