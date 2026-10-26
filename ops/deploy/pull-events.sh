#!/bin/sh
# Copies the experiment's event log off the server (#170), for `pnpm experiment:report --dir=<local-dir>`:
#
#   ops/deploy/pull-events.sh <ssh-host> <container-or-volume> [<local-dir>]
#
# <container-or-volume> names the game's Docker volume, the one mounted on /data, or a running game container. A
# prefix of the container's name will do, since Swarm names a service's containers <service>.<n>.<task id>. Reading a
# volume needs root on the server; a container does not. Only the event files (events-<day>.jsonl and totals.jsonl)
# come back, never the state store, which holds live games. The local directory defaults to
# ops/experiment/tmp/events-<ssh-host>, which git ignores. SSH options go in CODEGUESSR_SSH (default `ssh`), such as
# CODEGUESSR_SSH="ssh -p 2222".
set -eu

usage() {
  echo "usage: ops/deploy/pull-events.sh <ssh-host> <container-or-volume> [<local-dir>]" >&2
  exit 2
}
[ $# -ge 2 ] && [ $# -le 3 ] || usage
host=$1
name=$2
# The name reaches the server's shell as an argument, so it is held to the characters Docker allows in a name.
case "$host" in '' | -*) usage ;; esac
case "$name" in '' | -* | *[!A-Za-z0-9_.-]*) usage ;; esac
dest=${3:-ops/experiment/tmp/events-$host}
ssh_command=${CODEGUESSR_SSH:-ssh}

mkdir -p "$dest"
# shellcheck disable=SC2086 # CODEGUESSR_SSH may carry options.
$ssh_command "$host" sh -s -- "$name" <<'REMOTE' | tar -xf - -C "$dest"
set -eu
name=$1
# Lists the event files of the directory it runs in as one tar stream; nothing else is ever listed.
send='files=$(ls | grep -E "^(events-[0-9]{4}-[0-9]{2}-[0-9]{2}|totals)[.]jsonl$" || true)
if [ -z "$files" ]; then echo PULL_EVENTS_NONE >&2; exit 1; fi
tar -cf - -- $files'
if docker volume inspect "$name" >/dev/null 2>&1; then
  cd "$(docker volume inspect --format '{{ .Mountpoint }}' "$name")/events"
  sh -c "$send"
else
  container=$(docker ps --quiet --filter "name=^$name" | head -n 1)
  if [ -z "$container" ]; then
    echo "PULL_EVENTS_NOT_FOUND" >&2
    exit 1
  fi
  docker exec "$container" sh -c "cd \"\${EXPERIMENT_EVENTS_DIR:-/data/events}\" && $send"
fi
REMOTE

count=$(find "$dest" -maxdepth 1 -type f -name '*.jsonl' | wc -l | tr -d ' ')
if [ "$count" = "0" ]; then
  echo "PULL_EVENTS_EMPTY" >&2
  exit 1
fi
echo "PULL_EVENTS_DONE $count file(s) in $dest"
echo "next: pnpm experiment:report --dir=$dest"
