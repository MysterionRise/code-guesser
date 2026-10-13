# Next sources plan

2026-10-13. Revised the same day, after Phase 3b (PRs #12–#18) went live: the
seam needs schema v5, the snapshot already has a `curated` section, Step 2
reuses the curated-file readers, and Which era? would be the seventh deck.

Phase 3 of the [state review](2026-10-11-codeguessr-state-review.md) roadmap
has two parts. The first, growing The Stack v2, is done (PR #10):

- Twelve languages in six look-alike pairs.
- Each language's whole first row group (100,000 rows) is inspected.
- The worker returns a bounded sample.

This plan covers the second part: sources beyond The Stack v2 and GitHub
search. Phase 3b came first and added three decks from pinned GitHub
repositories and bug datasets
([new rounds research](2026-10-13-new-rounds-research.md)). Nothing in this
plan is built yet, though Step 2 can reuse what 3b built. Each step ends with
a decision point.

## What a new source should add

More rows of the same kind no longer help, because The Stack v2 now fills the
project and language decks with room to spare. A new source is worth adding
when it gives the game something it lacks:

1. **"Before or after?" beyond GitHub search.** The deck depends on one search
   endpoint (30 requests a minute, 1,000 results per query) and on eight
   organisations. When a search drifts, the deck shrinks.
2. **Projects that are famous and not hosted on GitHub.** GNOME, KDE,
   Inkscape, Wireshark, and F-Droid live on GitLab instances. The project deck
   can only offer GitHub repositories today.
3. **Time.** No deck asks *when* code was written. Software Heritage and a few
   long-history repositories make a "Which era?" deck possible: guess the
   decade of a real excerpt from its idioms.

## Step 1: the `SourceAdapter` seam

A refactor that adds no new source.

GitHub is assumed in three places:

- `validateGitHubBinding` in `packages/artifact/src/source.ts` checks every URL
  against `https://github.com/...`.
- The artifact snapshot has `github`, `stack`, and `curated` sections and no
  forge field. The `curated` section's pins and bug datasets are all GitHub
  repositories.
- The preparer's admission, revalidation, and curated-file reads call GitHub
  endpoints directly. The curated reads go through `github-git.ts`.

The seam:

```ts
interface ForgeBinding {
  readonly forge: "github" | "gitlab" | "codeberg" | "swh";
  readonly host: string;                       // e.g. gitlab.gnome.org
  repositoryUrl(repository: string): string;
  commitUrl(repository: string, commit: string): string;
  blobUrl(repository: string, commit: string, path: string): string;
}

interface SourceAdapter<Candidate, Source> {
  readonly id: string;                         // the profile's source id
  readonly binding: ForgeBinding;
  discover(context: Context): Promise<readonly Candidate[]>;
  admit(context: Context, candidate: Candidate): Promise<Source>; // licence, author, lineage
  revalidate(context: Context, source: Source): Promise<Source>;  // the finalize replay
  snapshotSection(): JsonRecord;               // what the artifact's snapshot records
}
```

- **Artifact schema v5** (v4 went live with Phase 3b, PR #17):
  - The source's `discoverySource` names the adapter. Today it is one of
    `GITHUB_COMMIT_SEARCH`, `STACK_V2`, `CURATED_GITHUB`, and
    `CURATED_DATASET`.
  - Its URLs are checked against that adapter's `ForgeBinding`, not against
    GitHub.
  - The snapshot lists `sources: [{ id, forge, host, ... }]`; today's
    `github`, `stack`, and `curated` sections become entries.
  - The game only changes where it builds the attribution link.
- **Transport:** every adapter sends requests through the existing runtime
  (metering, retry policy, journal), so `--resume` and `--offline` work for
  every source unchanged.
- **Credentials:** each adapter gets only its own token from
  `projectPreparationEnvironment`, as the blob worker gets only AWS
  variables today.
- **Exit test:** GitHub search, The Stack v2, and the curated readers move
  onto the seam, and `pnpm prepare:poc --offline` rebuilds the committed
  artifact on the machine that holds the v5 run's journal. Its bytes change
  only where schema v5 renames fields; the rounds and their order stay the
  same. A refactor that changes a round has a bug.

## Step 2: curated GitHub repositories and a "Which era?" deck

No new provider, and Phase 3b built part of this step. The profile's
`curated` section already names repositories at pinned commits
(`curated.repositories`), and two readers in `ops/poc/prepare/` do the
verified reads:

- `github-git.ts`: `gitReader` reads a commit (with the files it changed),
  trees checked against their hashes, and blobs checked against their ids.
- `github-files.ts`: `bindGitHubFile` reads one file at a commit through
  those trees, with repository admission, the licence file at that commit,
  and the file's last human author.

What is new is discovery by date and the deck itself.

- **Discovery:**
  1. For each era bucket (1990s, 2000s, 2010s, 2020s), list one page of
     commits up to a date: `GET /repos/{r}/commits?until=…&per_page=100`.
     This is a new request shape: `request-policy.ts` allows only the
     file-history form of `/commits` (`path`, `sha`, `per_page` up to 10).
  2. Pick a commit and a file changed in it, from `gitReader`'s commit read.
  3. Read that file at that commit with `bindGitHubFile`.
- **Artifact:** the parser accepts a curated file only at one of the
  snapshot's pins (`validateCuratedSource` in
  `packages/artifact/src/source.ts`). Era rounds find their commits by date,
  so they need their own source rule in schema v5.
- **Answer:** the commit's committer date, bucketed by decade, from the
  recorded commit. Author dates can be rewritten by imports, so the deck
  uses committer dates and screens out commits whose author and committer
  dates are years apart.
- **Leakage screens:**
  - No four-digit year from 1970 to 2029 in the excerpt (copyright headers,
    changelogs).
  - No version strings.
  - The leakage test gains a "most recent option" solver and a "file
    extension" solver.
- **Repositories with permissive licences and long history:**

  | Repository | Licence | History from |
  | --- | --- | --- |
  | `apache/httpd` | Apache-2.0 | 1996 |
  | `golang/go` | BSD-3-Clause | 2008, with older imports |
  | `rails/rails` | MIT | 2004 |
  | `django/django` | BSD-3-Clause | 2005 |
  | `jquery/jquery` | MIT | 2006 |
  | `numpy/numpy` | BSD-3-Clause | 2006 |
  | `nodejs/node` | MIT | 2009 |

  The most interesting old code is outside today's allowlist (MIT,
  Apache-2.0, BSD-3-Clause):

  | Repository | Licence | History from |
  | --- | --- | --- |
  | `freebsd/freebsd-src` | BSD-2-Clause | 1993 |
  | `postgres/postgres` | PostgreSQL | 1996 |
  | `dspinellis/unix-history-repo` | mixed by era | 1970 |

- **Old licence files:** at old commits GitHub often cannot identify the
  licence file. Phase 3b's fix deck lost most Apache Commons fixes this way
  (`ADMISSION_LICENSE_SHAPE`), so the oldest buckets may fill slowly.
- **Budget:** `bindGitHubFile` costs about 4 + s requests per round, where s
  is the number of segments in the file's path: the commit, one tree per
  segment, the blob, the licence at that commit, and one page of the file's
  history. With paths three or four segments deep, a 20-round pool costs
  about 150 requests, plus one commit list page per repository and bucket:
  under 200 in all.
- **Also from this step:** a curated "famous projects" list for the project
  deck, for projects whose star events in one row group undercount them.

## Step 3: GitLab adapter

GitLab.com first; `gitlab.gnome.org` and `invent.kde.org` are separate
instances behind the same adapter later.

- **Discovery:**
  - A curated project list in the profile, such as `gitlab-org/gitlab`,
    `inkscape/inkscape`, `wireshark/wireshark`, and `fdroid/fdroidclient`.
  - List commits per project in a date window:
    `GET /projects/:id/repository/commits?since=…&until=…`.
  - Filter by subject on our side. GitLab.com has no global commit search,
    and commit search through the API depends on Elasticsearch, so the plan
    does not use it.
- **Lineage:** `parent_ids` comes from the commit,
  `/repository/commits/:sha/diff` gives the change, and
  `/repository/files/:path/raw?ref=` gives the parent and child versions.
  The existing change-window code applies unchanged.
- **Admission:**
  - `GET /projects/:id?license=true` gives the licence, and the allowlist
    still applies.
  - The author comes from the commit.
  - `star_count` and `forks_count` give popularity for the project deck.
- **Limits:**
  - GitLab documents 60 unauthenticated requests per hour per IP address,
    which is too few, so the adapter needs a token.
  - Authenticated Free-tier users get 5,000 requests per hour with bursts of
    100 a minute. GitLab marks this table as a plan, so the adapter reads
    `RateLimit-Remaining` and honours `Retry-After` within the existing
    15-second wait ceiling.
  - Expanded diff pages are limited to 6 a minute, so the adapter uses the
    REST diff endpoint instead.
- **Credential:** a GitLab token from the `glab` CLI's own store, passed
  through the environment like `gh auth token`. It is never logged and
  never stored in the journal.
- **Exit:** a before-or-after deck that mixes GitHub and GitLab commits and
  passes the leakage test and offline replay.

## Step 4: Software Heritage

Last, because its API budget is the tightest.

- **What it gives:**
  - Every forge and package registry Software Heritage archives.
  - Decades of history.
  - SWHIDs as permanent attribution links.
- **Content bytes:** these already come from the anonymous `softwareheritage`
  S3 bucket the blob worker uses, so they cost no API requests.
- **Limits:**
  - 120 requests per hour anonymously and 1,200 with a token, reported in
    `X-RateLimit-*` headers.
  - A third-party description of the API reports a lower limit for
    `/origin/search/`. The adapter must not rely on search.
- **Use:**
  1. Resolve an origin's latest visit, then its snapshot, then a revision.
  2. Walk the revision log for dated revisions, then the directory to one
     file.
  3. Fetch that file's bytes from S3.

  That costs about 5 to 8 API requests per round, so a 20-round pool spends
  about 160. The journal makes reruns free.
- **Feeds:**
  - The "Which era?" deck from origins outside GitHub.
  - SWHID links on every round's reveal.
- **Exit:** one deck that contains Software Heritage rounds, built within
  1,000 requests, and that replays offline.

## Not now

- **Codeberg** (Forgejo API, rate limits unpublished): small. It fits the
  GitLab adapter's shape after Step 3.
- **npm and PyPI with provenance attestations:** needs screens for built and
  minified files first.
- **Rosetta Code:** GFDL licence, outside the allowlist.

## Decisions needed

1. **Licence allowlist.** Add the permissive BSD-2-Clause, ISC, PostgreSQL,
   and Unlicense? That opens FreeBSD and Postgres history to the era deck.
   GPL code stays out unless you say otherwise.
2. **A seventh deck.** Should "Which era?" join the chooser?
3. **Accounts.**
   - Step 3 needs a GitLab.com token: `glab auth login` once.
   - Step 4 works without a Software Heritage account, but it is ten times
     faster with a token.
4. **Order.** Step 1 always comes first. After it, Step 2 (no new provider)
   gives the most new gameplay per request.
