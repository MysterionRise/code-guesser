# Deploying CodeGuessr

This runbook puts the game on the owner's server (#170): one container, built from this repository's `Dockerfile`,
run by [Dokploy](https://dokploy.com) behind its Traefik proxy, with TLS from Let's Encrypt. The launch checklist is
#100, and the smoke test before launch is L13 in `docs/review/2026-10-20-next-phase-plan.md`.

`codeguessr.example` stands for the real domain throughout. The game reads it from one setting,
`CODEGUESSR_PUBLIC_ORIGIN`; Dokploy's domain entry names it once more for Traefik and the certificate.

## What runs where

- Dokploy clones the repository, builds the image with `docker build`, and runs it as a Docker Swarm service with one
  replica.
- Traefik takes requests on ports 443 and 80 (which only redirects to HTTPS) and forwards each to the container's
  port 3000 inside Dokploy's network. The container publishes no port on the host.
- The container runs Next.js's standalone server as the `node` user (uid 1000). Its entrypoint starts as root only to
  make `/data/state` and `/data/events` and hand them to `node`.
- `/data` is a Docker volume:
  - `/data/state/state.sqlite` holds the server's own state: each live game's last step and the duel play counts.
  - `/data/events/events-<day>.jsonl` and `totals.jsonl` hold the experiment's anonymous event log.
  - Neither holds an address, a user agent, or any other personal data.
- The image is about 290 MB, of which the Node base is about 250 MB.

## 1. Server prerequisites

- A Linux server with Dokploy installed. Dokploy's installer brings Docker (Engine 23 or later builds with BuildKit)
  and starts Traefik as a container on ports 80 and 443.
- A DNS `A` record for `codeguessr.example` that points at the server. Add no `AAAA` record unless Docker is set up
  for IPv6 (see [Client addresses](#5-client-addresses)).
- Ports 80 and 443 open. Let's Encrypt checks the domain over port 80.
- Dokploy's own panel listens on host port 3000, and ports that Docker publishes bypass `ufw`. Give the panel its own
  domain with HTTPS, or keep port 3000 closed to the internet in Docker's `DOCKER-USER` chain.
- Docker's default `json-file` log driver keeps logs forever. Set rotation in `/etc/docker/daemon.json`, for example
  `{"log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "3"}}`, then restart Docker.

## 2. Secrets

Secrets live only in Dokploy's environment for the app. None goes in a committed file, the image, a build argument,
or a `NEXT_PUBLIC_*` variable.

- **Session secret.** Make it once:

  ```bash
  openssl rand -base64 48
  ```

  Paste it into `CODEGUESSR_SESSION_SECRET`, and keep a copy in a password manager. It seals every game and every
  duel link, so changing it ends the games in progress and every challenge (7 days) and result (30 days) link.
- **OpenRouter key**, only if generative UI is on (`GENUI_ENABLED=1`):
  - make a separate key for production in OpenRouter, with a credit limit; the app has no spend cap of its own and
    falls back to the static reveal when the key is refused;
  - in OpenRouter's privacy settings, allow only providers with zero data retention (ZDR). The app also asks for
    `data_collection: "deny"` on each request. Check after the first deploy that the model (`OPENROUTER_MODEL`, default
    `anthropic/claude-haiku-5.5`) still has a ZDR endpoint: an explainer that never appears means it has none.
- Dokploy stores the environment encrypted, but anyone who can run `docker service inspect` on the server can read
  it. Keep Docker access to the owner.
- In the app's **Environment** tab, turn **Create Environment File** off. Otherwise Dokploy writes every variable to a
  `.env` file in the build directory on the host. `.dockerignore` keeps any `.env` out of the build either way.

## 3. Create the app in Dokploy

1. **Project → Create Service → Application.** Name it `codeguessr`. Dokploy shows the app name it uses for the Swarm
   service, such as `codeguessr-1a2b3c`; this runbook calls it `<app>`.
2. **General → Provider:** GitHub (through the GitHub App under Settings → Git Providers) or Git. Repository
   `MysterionRise/code-guesser`, branch `main`, Build Path `/`.
3. Turn **Autodeploy** off, so each deploy is one the owner starts.
4. **Build Type:** Dockerfile. Docker File `Dockerfile`, Docker Context Path `.`, Docker Build Stage empty (the last
   stage, `runtime`). No build-time arguments or secrets.
5. **Environment:** the variables in [section 4](#4-environment). Turn **Create Environment File** off.
6. **Advanced → Volumes → Add Volume:** Volume Mount, Volume Name `codeguessr-data`, Mount Path `/data`. A public
   container with nothing mounted on `/data` refuses to start (`GAME_ENVIRONMENT_REJECTED DATA_VOLUME_MISSING`).
7. **Advanced → Cluster Settings:** Replicas `1`. Under **Swarm Settings**:
   - **Update Config:** Parallelism `1`, Order `stop-first`, Failure Action `rollback`.
   - **Rollback Config:** Parallelism `1`, Order `stop-first`.
   - Leave **Health Check** empty: the image has its own (see [section 6](#6-one-instance-and-deploys)).
   - Leave the rest at Dokploy's defaults.
8. **Domains → Create Domain:** Host `codeguessr.example`, Path `/`, Container Port `3000`, HTTPS on, Certificate
   Provider Let's Encrypt.
9. **Deploy**, then check the rollout on the server, since Dokploy reports a deploy done before Swarm finishes it:

   ```bash
   docker service ps <app>        # one task Running, on the new image
   docker service logs <app>      # "Ready", and no GAME_ENVIRONMENT_REJECTED
   ```

10. Run the smoke test ([section 8](#8-smoke-test)).

## 4. Environment

The boot check (`checkEnvironment`, `apps/game/src/server/environment.server.ts`) refuses to start a public server
that lacks a required setting. Each failure prints `GAME_ENVIRONMENT_REJECTED <CODE>`, never a value, and the
container exits with status 78.

**Required in public mode:**

| Variable | Value | Purpose |
| --- | --- | --- |
| `CODEGUESSR_PUBLIC` | `1` | Public mode: the boot check, HSTS, `upgrade-insecure-requests`, and rate limits |
| `CODEGUESSR_SESSION_SECRET` | `openssl rand -base64 48` | Seals games and duel links; at least 32 characters |
| `CODEGUESSR_PUBLIC_ORIGIN` | `https://codeguessr.example` | The origin players use, with no path; shared links and link previews name it |
| `CODEGUESSR_CLIENT_IP_HEADER` | `X-Forwarded-For` | Where rate limits find the client's address; see [section 5](#5-client-addresses) |

**Set by the image; leave them unset:**

| Variable | Image value | Purpose |
| --- | --- | --- |
| `CODEGUESSR_STATE_DIR` | `/data/state` | The state store (required in public mode) |
| `EXPERIMENT_EVENTS_DIR` | `/data/events` | The event log (required in public mode) |
| `NODE_ENV` | `production` | |
| `NEXT_TELEMETRY_DISABLED` | `1` | No Next.js telemetry |
| `HOSTNAME`, `PORT` | `0.0.0.0`, `3000` | The address the server binds inside the container; Traefik forwards to port 3000 |

**Optional:**

| Variable | Default | Purpose |
| --- | --- | --- |
| `GENUI_ENABLED` | off | `1` turns on generative UI (#101); needs `OPENROUTER_API_KEY` |
| `OPENROUTER_API_KEY` | none | The production key from [section 2](#2-secrets) |
| `OPENROUTER_MODEL` | `anthropic/claude-haiku-5.5` | The model generative UI asks |
| `OPENROUTER_BASE_URL` | OpenRouter's | Leave unset; a public server refuses any other address for real games |
| `EXPERIMENT_DISABLED` | none | `factor:level` pairs to switch off, such as `design:host,theme:arcade`; their weight goes to control |
| `CODEGUESSR_RATE_LIMITS` | `on` in public mode | A multiplier of every rate limit, such as `2` to loosen or `0.5` to tighten |
| `EXPERIMENT_SOURCE` | `real` | `synthetic` only for the pre-launch smoke run ([section 8](#8-smoke-test)) |
| `EXPERIMENT_LAB` | off | Never on in production, except the pre-launch smoke run with `EXPERIMENT_SOURCE=synthetic`; the boot check refuses it otherwise |

## 5. Client addresses

Rate limits (#98) key each client by the last entry of `CODEGUESSR_CLIENT_IP_HEADER`, the one the nearest proxy
appended. The game reads it in one module, keeps only a salted hash in memory, and never logs or stores it.

- **Traefik alone (the default):** `CODEGUESSR_CLIENT_IP_HEADER=X-Forwarded-For`. Dokploy's Traefik trusts no
  forwarded headers, so it drops whatever `X-Forwarded-For` a client sends and passes on the address it saw. Don't
  add `forwardedHeaders.insecure` or `trustedIPs` to Traefik's entry points.
- **IPv6:** Docker hands an IPv6 connection to an IPv4-only network through its proxy, so Traefik sees the bridge's
  gateway (such as `172.18.0.1`) for every IPv6 player, and they would share one rate limit. Publish no `AAAA` record,
  or make Docker's networks dual-stack first (`"ip6tables": true`, then IPv6 on `dokploy-network`; Dokploy issue
  #2349).
- **Cloudflare's proxy in front:** Traefik then sees Cloudflare's edge, and `X-Forwarded-For` ends with the edge's
  address, so every player behind one edge would share a limit. Set
  `CODEGUESSR_CLIENT_IP_HEADER=CF-Connecting-IP`, which Cloudflare sets to the client's address and Traefik passes on
  untouched. Anyone who reaches the server directly could forge that header, so the server must take traffic only from
  Cloudflare:
  - a Cloudflare Tunnel (`cloudflared` as a Dokploy app, ports 80 and 443 closed), or
  - a firewall that allows 80 and 443 only from [Cloudflare's ranges](https://www.cloudflare.com/ips/), in Docker's
    `DOCKER-USER` chain, since published ports bypass `ufw`.

  Also: SSL mode Full (strict); Rocket Loader, Email Address Obfuscation, and automatic Web Analytics off. Each rewrites
  pages or adds a script, which the nonce policy blocks.

### Logs hold no address

- Traefik's access log is off by default. Dokploy's **Requests** page turns it on and writes every client's address
  to `/etc/dokploy/traefik/dynamic/access.log`, so keep it deactivated. If it was ever activated: deactivate it, reload
  Traefik (Settings → Web Server → Traefik → Reload), and delete that file.
- The game prints codes only: `GAME_ENVIRONMENT_REJECTED <CODE>`, `LOCAL_REAL_EXPERIMENT_UNAVAILABLE <CODE>`,
  `QUESTION_LAYERS_UNAVAILABLE <CODE>`, `EXPERIMENT_EVENT_FAILED <CODE>`, `GENUI_*`, `DUEL_REFUSED <CODE>`, and
  Next.js's `Failed to find Server Action` after a deploy (below). Read them in Dokploy's
  **Logs** tab or with `docker service logs <app>`.

## 6. One instance, and deploys

**Replicas stay at 1.** Rate limits, each game's recent steps, and the duel play counts live in the process, and the
state store is one SQLite file on one volume. A second instance needs shared stores first.

**Update order: stop-first.** Dokploy's default is start-first: the new container starts, passes its health check,
and only then does the old one stop. For 10 to 20 seconds both would serve from the same volume. SQLite copes with
that (WAL, file locks, one host), but each process keeps its own rate limits and its own memory of recent game steps,
so a client would get twice the limits, and the old process could accept a stale game step once. Stop-first stops the
old container before starting the new one. Players see a few seconds of errors; a hint or answer in that window says
"Couldn't … Try again."

**Health check.** The image checks `GET /api/health` every 10 seconds from inside the container (30 seconds' grace at
start, 3 retries). It answers `ok`, or 503 with one code: `ARTIFACT_MISSING`, `ARTIFACT_HASH_MISMATCH`,
`ARTIFACT_SCHEMA`, `STATE_DIR_UNWRITABLE`, `STATE_STORE_UNAVAILABLE`, or `EVENTS_DIR_UNWRITABLE`. Swarm uses it as it
is, so Dokploy's Health Check stays empty. If you ever set one, the image has no `curl`; use
`node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"`.

**Stopping.** The server stops on `SIGTERM` in well under a second, inside Swarm's 10-second grace.

**Pages loaded before a deploy.** Next.js 15 names each server action with a key it makes afresh for every build, so
two builds of the same commit name them differently. A hint, an answer, or a duel link asked for from a page loaded
before the deploy reaches an action the new server doesn't have. The game then says "CodeGuessr was updated. Reload the
page to keep playing." and offers a reload, which deals the same game again; Next.js logs `Failed to find Server
Action` for each such request. Games and duel links themselves survive deploys: the secret and the state store don't
change.

**Each deploy:**

1. CI is green on the commit (it builds this image and runs it, `pnpm test:container`).
2. Dokploy → **Deploy**.
3. `docker service ps <app>` shows one Running task; the logs show `Ready`.
4. `node ops/deploy/smoke.mjs https://codeguessr.example` passes.
5. After launch day, any change players can see gets a dated entry in `ops/experiment/changes.json` (#169).

## 7. Backups and rollback

**The event log is the experiment's data; back it up daily.** From a laptop with this repository:

```bash
ops/deploy/pull-events.sh <ssh-host> codeguessr-data   # the volume; needs root on the server
ops/deploy/pull-events.sh <ssh-host> <app>             # or the running container
pnpm experiment:report --dir=ops/experiment/tmp/events-<ssh-host>
```

It copies only `events-<day>.jsonl` and `totals.jsonl`, never the state store, into
`ops/experiment/tmp/events-<ssh-host>`, which git ignores. SSH options go in `CODEGUESSR_SSH`, such as
`CODEGUESSR_SSH="ssh -p 2222"`. On the server, a nightly cron line keeps copies too:

```bash
tar -czf /root/backups/codeguessr-events-$(date +%F).tgz \
  -C "$(docker volume inspect --format '{{ .Mountpoint }}' codeguessr-data)" events
```

**The state store** holds only live games and duel play counts. Losing it ends the games in progress and restarts
the counts, nothing more. To copy it while the server runs:

```bash
container=$(docker ps --quiet --filter name=<app> | head -n 1)
docker exec --user node "$container" node --eval \
  "const s = require('node:sqlite'); s.backup(new s.DatabaseSync('/data/state/state.sqlite'), '/data/state/backup.sqlite')"
docker cp "$container:/data/state/backup.sqlite" ./state.sqlite && docker exec "$container" rm /data/state/backup.sqlite
```

**Restore:** stop the app in Dokploy, copy the files into the volume (the directory
`docker volume inspect --format '{{ .Mountpoint }}' codeguessr-data` names), and start it again. The entrypoint hands
them to `node` as it starts.

**Rollback.** Dokploy tags every build `<app>:latest`, so Swarm's automatic rollback after a failed health check runs
the same new image again. To go back, revert the bad commit on `main` and deploy, or set the branch to a known-good one
and deploy. Dokploy's own **Rollbacks** need a registry for its tagged images; they are optional. Keep the session
secret and the volume: games and events carry over. A rollback across a change of game state's version ends the games
in progress, as a restart would.

## 8. Smoke test

`ops/deploy/smoke.mjs` checks a running server and is safe against the live one:

```bash
pnpm exec playwright install chromium     # once
node ops/deploy/smoke.mjs https://codeguessr.example
```

- `GET /api/health` answers `ok`.
- The page's policy, its nonce on every script, HSTS, and the other security headers; two pages never share a nonce.
- About, Credits, Privacy, `robots.txt`, and the 404; the image optimizer answers 404.
- A deck's address redirects to a seeded deal, which deals a game.
- One game played through in Chromium: a hint and five answers through the server actions, with no page error and no
  policy violation. It sends `Sec-GPC: 1`, so it records no events.
- No response echoes the client's forwarded address, and no page outside a round holds an address.

Its options:

- `--record` leaves `Sec-GPC` off, so the game records events. Use it only on the pre-launch run, with
  `EXPERIMENT_SOURCE=synthetic`.
- `--rate-limits` sends beacons until one gets a 429 with `Retry-After`. It spends this client's beacon allowance for
  a minute, so run it before launch.
- `--events=<dir>` also reads pulled event files and fails on any address-shaped string.
- `--deck=<id>` picks the deck (default `project`); `--no-browser` skips the game.

**Before launch (L13),** with DNS and TLS in place:

1. Deploy with `EXPERIMENT_SOURCE=synthetic` and `EXPERIMENT_LAB=1` added: the one time lab mode is on in production.
2. `node ops/deploy/smoke.mjs https://codeguessr.example --record --rate-limits`.
3. Play one game per design, theme, and layer with lab picks (`?design=`, `?theme=`, `?layer=`), by hand or with
   `ops/playtest/driver.mjs`. Restart the service mid-game: the game continues, and a stale token gets `STALE_STEP`.
4. Pull the events; `pnpm experiment:report --dir=<dir> --source=synthetic` shows every arm, and
   `node ops/deploy/smoke.mjs https://codeguessr.example --no-browser --events=<dir>` finds no address.
5. Remove `EXPERIMENT_SOURCE` and `EXPERIMENT_LAB`, deploy, and run the smoke test once more without flags.
6. Record day 0 in `ops/experiment/changes.json`.

## 9. Trying the image locally

```bash
docker build --tag codeguessr .
docker volume create codeguessr-local
docker run --rm --publish 127.0.0.1:3800:3000 --volume codeguessr-local:/data \
  --env CODEGUESSR_PUBLIC=1 --env CODEGUESSR_SESSION_SECRET="$(openssl rand -base64 48)" \
  --env CODEGUESSR_PUBLIC_ORIGIN=https://codeguessr.example --env CODEGUESSR_CLIENT_IP_HEADER=X-Forwarded-For \
  codeguessr
node ops/deploy/smoke.mjs http://127.0.0.1:3800
```

`pnpm test:container` does the same and more: it builds the image (or uses `CODEGUESSR_IMAGE`), checks that a missing
secret or volume exits 78, and runs the smoke test and `pull-events.sh` against a public container.

The build context is only what `.dockerignore` lets in: the game, the artifact parser, the workspace manifests, and
the entrypoint. A journal, a key, `.env`, the media, or local state never reaches it;
`tests/deploy/docker-context.test.mjs` holds the file to that.
