---
heist: codeguessr-poc-readiness
date: 2026-10-08
status: draft
revision: 13
approach: "Three Guessing Decks with date-disjoint discovery windows"
signatories: [Don]
review-status: awaiting-signature
revision-12-baseline: docs/gangsta/codeguessr-poc-readiness/specs/2026-10-08-contract-revision-12-signed.md
revision-12-baseline-sha256: 045ff6a7801f07096f0eb178fa358458e9661ed11d2de7830747538c7ce30e78
---

# Contract Revision 13: Date-Disjoint Discovery Windows

## Why this revision exists

Revision 11's FR-020 makes duplicated identities across the accepted query set
fail closed, and revision 12 carries that rule forward. Count-only probes on
2026-10-08 found that revision 12's windows share commits: two commits match
both `ai-copilot-github` and `ordinary-github`, and four match both
`ai-claude-vercel` and `ordinary-vercel`. Every live run under revision 12
would therefore fail at discovery. This was a drafting error in revision 12.

## Change

Only three query literals in revision 12's FR-020 table change. The duplicate
rule, every other query, every role, and every other clause of revisions 11 and
12 stay exactly as signed.

| Identifier | Revision 12 query | Revision 13 query | Observed results |
| --- | --- | --- | --- |
| `ai-claude-github` | `"Co-Authored-By: Claude" org:github committer-date:2026-09-01..2026-09-30 merge:false is:public` | `"Co-Authored-By: Claude" org:github committer-date:2026-09-02..2026-09-30 merge:false is:public` | 35, complete |
| `ordinary-vercel` | `refactor org:vercel committer-date:2026-09-01..2026-09-30 merge:false is:public` | `refactor org:vercel committer-date:2026-08-01..2026-08-31 merge:false is:public` | 65, complete |
| `ordinary-github` | `refactor org:github committer-date:2026-09-01..2026-09-07 merge:false is:public` | `refactor org:github committer-date:2026-08-01..2026-08-31 merge:false is:public` | 119, complete |

After this change, every pair of queries either targets different
organizations or covers committer-date ranges that do not intersect. A commit
has exactly one committer date, so no commit can be returned by two queries,
and the carried-forward duplicate rule can only fire on a provider defect.

## Signature

Signing this revision authorizes the corrected query set for profile
`local-real-rounds.v2` under the work packages already authorized by
revision 12.

| Role | Decision | Timestamp |
| --- | --- | --- |
| Don | pending | |
