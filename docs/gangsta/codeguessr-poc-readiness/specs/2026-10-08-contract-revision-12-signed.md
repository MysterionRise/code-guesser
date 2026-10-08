---
heist: codeguessr-poc-readiness
date: 2026-10-08
status: signed
revision: 12
approach: "Three Guessing Decks: Which Project, Which Language, Is This AI-Generated"
signatories: [Don]
review-status: approved
revision-12-approved-at: 2026-10-08T20:33:38Z
revision-11-baseline: docs/gangsta/codeguessr-poc-readiness/specs/2026-08-15-contract-revision-11-signed.md
revision-11-baseline-sha256: 3acc586d8fb479e6edfd2dd43e9f38ed5d8d6268ee5b025b449d3a564b32fe41
drafted-at: 2026-10-08T19:40:00Z
---

# Contract Revision 12: Three Guessing Decks

## Why this revision exists

Revision 11 produced a working real-data PoC, but its rounds are not code
guessing. The three provenance rounds ask whether an unseen commit message
contains a configured marker, and a clue tells the player that code style is
irrelevant, so the answer cannot be worked out from the code. The two language
rounds offer only Python and TypeScript, and a clue names the answer. The
Don decided on 2026-10-08 that the demo must be about guessing from code and
chose three decks: "Which project?", "Which language?", and "Is this
AI-generated?".

## How this revision applies

This document amends revision 11 at the baseline SHA-256 above. Every clause of
revision 11 not replaced or added here carries forward unchanged, including all
credential, transport, retry, atomic-publication, containment, fail-closed,
localhost, no-review, no-runtime-acquisition, and Stack pin rules. Where a
carried-forward clause says "three provenance" or "two language" fixtures, it
reads as the deck composition defined by the replaced FR-002 below. On
signature, the binding Contract is revision 11 plus this amendment, and the
signed copy of this file is renamed with a `-signed` suffix and its SHA-256 is
recorded in `CLAUDE.md`.

## Replaced definitions

- **Deck:** one of three fixed five-round sessions of a single round kind:
  `project` ("Which project?"), `language` ("Which language?"), and `ai` ("Is
  this AI-generated?").
- **Ingestion artifact:** as in revision 11, except that it contains exactly
  fifteen fixtures grouped into the three decks in the fixed order `project`,
  `language`, `ai`, and uses schema `local-experiment-artifact.v2`.
- **AI-credit marker:** a profile-defined trailer pattern that names one AI
  coding assistant. It replaces revision 11's "configured provenance marker".
  A recorded AI credit is a statement in the commit record, not evidence of how
  the code was produced.
- **Crawl profile:** as in revision 11, but profile `local-real-rounds.v2` at
  `ops/poc/profiles/local-real-rounds.v2.json` replaces `local-real-rounds.v1`.

## Replaced and new requirements

1. **FR-001 — Direct local experience (replaced).** The root route shall show a
   deck chooser with the three decks and their one-line descriptions. Choosing
   a deck plays its five rounds through the existing arcade shell. A `deck`
   query parameter with value `project`, `language`, or `ai` may preselect a
   deck. Completion shall offer "Play again" and "Choose another deck".
2. **FR-002 — Exact session composition (replaced).** The experiment shall
   contain exactly fifteen crawler-generated real fixtures: five project rounds
   discovered through GitHub commit search, five language rounds discovered
   through The Stack v2, and five AI rounds discovered through GitHub commit
   search. No synthetic, wrong-source, or manually substituted round may enter
   any deck.
3. **FR-004 — Permanent notice (amended).** The revision 11 notice remains, and
   the AI deck additionally shows, throughout play: "AI answers come from AI
   co-author credits in commit messages, not from analyzing the code."
4. **FR-007, FR-008, FR-010 — Authority and reveals (amended).** The single
   server-only authority shall require exactly three decks of five fixtures with
   the source lineage of FR-002. Round identities are unique across all fifteen
   rounds; within each deck the five public identities shall equal the five
   private reveal identities. The reveal request shape is unchanged; the deck is
   derived from the round identity, and round order, score, and clue checks
   apply within that deck.
5. **FR-009 — Pre-answer containment (amended).** A repository `owner/name` may
   appear before an answer only as one of the four candidate labels of a
   project round. Every other protected field of revision 11 remains forbidden
   in public data, and no round's excerpt, prompt, or clues may contain any of
   its own candidates' owner or repository names as a whole word.
6. **FR-012 — Honest AI-credit semantics (replaces honest provenance
   semantics).** The AI deck may ask "Is this AI-generated?" as a guessing
   prompt. Its answers, evidence, and explanations shall describe only what the
   commit record credits. The yes answer means at least one AI-credit marker is
   present in the pinned child commit message. The no answer means none is
   present and shall never be labelled or described as human-written. The game
   shall not claim to detect AI from code and shall never derive an answer from
   code style.
7. **FR-020 — Search-driven discovery (replaced query set).** Profile
   `local-real-rounds.v2` authorizes exactly these literal query tuples, each
   sorted by `committer-date` in `desc` order with three pages and a 300-result
   ceiling. Each was observed complete and under the ceiling on 2026-10-08.

   | Identifier | Role | Query |
   | --- | --- | --- |
   | `ai-copilot-github` | ai-credit | `"Co-authored-by: Copilot" org:github committer-date:2026-09-01 merge:false is:public` |
   | `ai-copilot-microsoft` | ai-credit | `"Co-authored-by: Copilot" org:microsoft committer-date:2026-09-06 merge:false is:public` |
   | `ai-claude-github` | ai-credit | `"Co-Authored-By: Claude" org:github committer-date:2026-09-01..2026-09-30 merge:false is:public` |
   | `ai-claude-vercel` | ai-credit | `"Co-Authored-By: Claude" org:vercel committer-date:2026-09-01..2026-09-30 merge:false is:public` |
   | `ordinary-facebook` | ordinary | `refactor org:facebook committer-date:2026-07-01..2026-07-31 merge:false is:public` |
   | `ordinary-google` | ordinary | `refactor org:google committer-date:2026-09-01..2026-09-07 merge:false is:public` |
   | `ordinary-vercel` | ordinary | `refactor org:vercel committer-date:2026-09-01..2026-09-30 merge:false is:public` |
   | `ordinary-github` | ordinary | `refactor org:github committer-date:2026-09-01..2026-09-07 merge:false is:public` |

   Project rounds draw only from `ordinary` queries. AI rounds draw credited
   commits from `ai-credit` queries and uncredited commits from `ordinary`
   queries. Revision 11's committer-timestamp forms carry forward. Any change to
   the profile version, path, identifier, role, query, sort, or order requires a
   new revision.
8. **FR-023 — Screening (amended).** In addition to revision 11's exclusions,
   the experiment shall reject a file whose first thirty lines contain, case
   insensitively, "automatically generated", "auto-generated", "@generated",
   "do not edit", or "code generated by". This screen lives in the experiment
   and does not change the controlled acquisition utilities.
9. **FR-024 — AI-credit round generation (replaced).** The five AI rounds use
   the prompt "Is this AI-generated?" and exactly two experiment-specific
   candidates: `local-experiment.ai-credit-recorded.v2` labelled "Yes, the
   commit credits an AI assistant" and `local-experiment.ai-credit-absent.v2`
   labelled "No AI credit on this commit". At least two rounds shall carry each
   outcome. Every AI fixture keeps revision 11's exact single-parent lineage,
   same-path blob, raw-content, and changed-line bindings. Clue 1 states how
   many files the commit changed. Clue 2 quotes the commit subject line when it
   is at most 100 characters and contains no URL, email address, `@` handle,
   AI-credit marker, AI tool name, or candidate owner or repository name;
   otherwise clue 2 states how many lines the change added and removed.
   Recorded evidence names the credited assistant, for example "The commit
   message lists GitHub Copilot as a co-author." Absent evidence states "The
   commit message credits no AI assistant. That does not show the code was
   written without AI." The explanation states that the answer comes from the
   commit's AI credit, not from analyzing the code.
10. **FR-025 — Language deck generation (replaced).** The five language rounds
    come only from The Stack v2 and use five distinct configured languages:
    Python, TypeScript, Go, Rust, and Ruby. Each answer derives from the exact
    versioned extension mapping (`.py`; `.ts` and `.tsx`; `.go`; `.rs`; `.rb`)
    and shall agree with Stack's detected language and the revalidated GitHub
    record. Each round offers exactly four candidates: the answer and three
    profile-defined, deterministic distractors from Python, TypeScript,
    JavaScript, Go, Rust, Java, Ruby, C#, Kotlin, Swift, PHP, and C++. The two
    clues come from profile templates per language and shall name neither the
    answer, its extension, nor any candidate. The excerpt starts at the first
    line that is not blank, a comment, a shebang, or part of a leading licence
    header; spans at most twenty lines and 4,096 bytes and at least 64 bytes;
    and shall not contain any candidate label or the file extension as a whole
    word.
11. **FR-026 — Deterministic selection (amended).** Deduplication by
    repository, commit, path, blob, raw-content, and excerpt hashes applies
    within each deck. Across decks, commits, blobs, raw content, and excerpts
    shall not repeat; a repository may appear in more than one deck. Each deck
    has one documented stable ordering per source.
12. **FR-028 — Stack metadata (amended).** "The two configured language
    subsets" reads "the five configured language subsets".
13. **FR-032 — Project round generation (new).** The five project rounds use
    the prompt "Which project is this code from?" and five distinct correct
    repositories. Each round offers exactly four `owner/name` candidates: the
    answer and three distinct distractors chosen deterministically from
    repositories returned by the run's `ordinary` queries, excluding the answer.
    The answer derives only from the pinned GitHub repository record of the
    admitted commit, never from style. Clue 1 states the changed file's
    extension. Clue 2 states the repository owner. The excerpt is the
    reconstructed changed-line excerpt of revision 11 and shall pass FR-009 as
    amended.
14. **FR-033 — Deck play (new).** Each deck keeps revision 11's zero-, one-, and
    two-clue scoring of 1,000, 800, and 500 points, a 5,000-point maximum,
    completion, replay, minimum viewport, reduced motion, keyboard, error, and
    no-JavaScript behavior. Deck scores are independent.
15. **FR-034 — AI-credit marker matching (new, replaces the 2026-10-08
    refinements awaiting confirmation).** Each profile marker names an
    assistant, a trailer key, a tool name, and a service domain. A commit
    message line matches when its trailer key equals the marker's key ignoring
    case; its value starts with the tool name, optionally followed by at most
    three version words of letters, digits, dots, or hyphens; and it ends with
    exactly one space and one angle-bracket address at the marker's service
    domain. A line equal to the literal `Generated-by: Copilot` also matches.
    Profile v2 defines GitHub Copilot (keys `Co-authored-by`, names `Copilot`,
    `Copilot App`, and `GitHub Copilot`, domain `users.noreply.github.com`) and
    Claude (key `Co-authored-by`, name `Claude`, domain `anthropic.com`). Only
    the assistant name enters a fixture; no address is recorded.

## Replaced capacity ceilings (NFR-014 and the profile)

| Ceiling | Revision 11 | Revision 12 | Reason |
| --- | --- | --- | --- |
| Requests per run | 200 | 600 | Fifteen fixtures instead of five |
| Stack metadata bytes | 64 MiB | 96 MiB | One row group per language costs 14.6 to 17.3 MiB; five languages need about 82 MiB |
| Stack rows per language | 10,000 | 10,000 | Unchanged |
| Blob attempts / per-blob / total blob bytes | 50 / 256 KiB / 16 MiB | Unchanged | Five language fixtures fit |
| GitHub pages and results per query | 3 / 300 | Unchanged | All eight queries observed under 300 |
| Temporary disk | 32 MiB | Unchanged | Observed peak was 0 |

Retry, wait, response-size, concurrency, and timeout limits are unchanged.

## Replaced acceptance criteria

- **AC-8 (replaced).** AI-generation tests produce exactly five rounds with the
  two v2 candidates and at least two of each outcome, cover FR-034 matching and
  every non-match, and reject any human-authorship, AI-detection, or style
  claim in prompts, labels, clues, evidence, or explanations.
- **AC-9 (replaced).** Language-generation tests produce five rounds in five
  distinct languages with four candidates each, prove that no clue or excerpt
  names a candidate or extension, prove the header-skipping excerpt window,
  and cover the FR-023 generated-file screen.
- **AC-9a (new).** Project-generation tests produce five rounds with five
  distinct answers and four distinct candidates each, prove deterministic
  distractor choice from `ordinary` query repositories, and reject an excerpt
  or clue containing a candidate's owner or repository name.
- **AC-10, AC-13, AC-16 (amended).** "Exactly three provenance and two
  language fixtures" reads "exactly three decks of five fixtures with the FR-002
  lineage".
- **AC-14 and AC-19 (amended).** The root route offers the three decks, shows
  the notice and the AI-deck line, and every deck completes through clues,
  scoring, completion, replay, and "Choose another deck" in the browser suite.

## Additional open risks

1. **AI credit is not AI authorship — MEDIUM.** Many AI-assisted commits carry
   no credit, and a credit does not say how much code the assistant wrote. The
   no answer is therefore worded as "No AI credit on this commit".
2. **Project guessability — LOW.** Owner-heavy pools can make distractors easy
   to rule out; clue 2 names the owner and costs points.
3. **Larger runs — MEDIUM.** Fifteen fixtures need more requests and more
   candidates to survive screening; a run may fail by design at the ceilings
   and leave the previous artifact in place.

## Signature

Signing this revision authorizes implementation under work packages WP-036 to
WP-045 in `plans/2026-10-08-execution-plan-revision-12.md`, one live preparation
run under the existing operator authorization, and replacement of the current
five-round artifact. It authorizes no merge, deployment, or public players.

| Role | Decision | Timestamp |
| --- | --- | --- |
| Don | signed as drafted | 2026-10-08T20:33:38Z |
