## What this changes

<!-- One or two sentences, and the issue it closes, such as `Closes #123`. -->

## Checklist

Tick each box, and under "Checks run" name any that does not apply to this change.

- [ ] **Checks run.** I ran the checks this change touches ([CONTRIBUTING.md](https://github.com/MysterionRise/code-guesser/blob/main/CONTRIBUTING.md#set-up-and-check)) and list them below.
- [ ] **Player-visible change.** After launch day (#100), a change a player can see adds a dated entry to `ops/experiment/changes.json`. Before launch the log stays empty.
- [ ] **Stack worker change.** A change to `ops/poc/stack/*.py` orphans the recorded worker outputs, so an offline replay needs one live `--resume` first, and this pull request says so.

## Checks run

<!-- The commands you ran, and any you could not run, such as `pnpm test:container` without Docker. -->
