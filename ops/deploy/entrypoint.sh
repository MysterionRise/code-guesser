#!/bin/sh
# The container's entrypoint (#170). It makes the state and event directories, hands them to the `node` user, and runs
# the server as `node`, never as root. It prints codes only, never a setting's value.
set -eu

state="${CODEGUESSR_STATE_DIR:-/data/state}"
events="${EXPERIMENT_EVENTS_DIR:-/data/events}"

# A public server keeps its games and the experiment's events on a mounted volume. Without one they would live in the
# container and vanish at the next deploy, so it refuses to start, as the boot check does (exit 78, EX_CONFIG).
if [ "${CODEGUESSR_PUBLIC:-}" = "1" ]; then
  for directory in "$state" "$events"; do
    case "$directory" in
      /*) ;;
      *) continue ;; # A relative directory fails the server's own boot check, which names it.
    esac
    mkdir -p "$directory"
    if [ "$(findmnt --noheadings --output TARGET --target "$directory")" = "/" ]; then
      echo "GAME_ENVIRONMENT_REJECTED DATA_VOLUME_MISSING" >&2
      exit 78
    fi
  done
fi

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$state" "$events"
  chown -R node:node "$state" "$events"
  exec setpriv --reuid=node --regid=node --init-groups --no-new-privs --inh-caps=-all --bounding-set=-all -- "$@"
fi
exec "$@"
