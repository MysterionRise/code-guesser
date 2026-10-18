---
evidence: vulnerable-line-dry-run
observed-at: 2026-10-18
outcome: deferred
artifact-published: false
credential-material-recorded: false
---

# "Spot the vulnerable line": a dry run on real advisories (#59)

A Reason deck built as #59 proposed. A round shows a file as it stood before a one-line fix that a reviewed GitHub
advisory links, and offers four of its lines, as "Spot the fix" does. The truth is the line the fix commit replaced.

This dry run read GitHub's advisory listings and fix commits read-only, through the real selector, the fix binder
(repository, licence at the parent, both files, the fix's author), and the shared window and balance search. It
published nothing. The deck works, but filling it costs several times what #59 estimated, so on 2026-10-18 the owner
deferred it past v1.0. The code is merged and tested; the v6 profile leaves the deck out.

## The deck

- **Listings:** `GET /advisories?type=reviewed&ecosystem=…&published=<day>..<day>&sort=published&direction=asc&per_page=100`.
  The endpoint pages by cursor only (`page=` is ignored), so each ecosystem is listed once per publication window,
  the first page of 100 oldest first. The request policy allows exactly that shape. A listing keeps each advisory's
  id, packages in the ecosystem, CWEs, and fix commits, never its description or credits.
- **An advisory qualifies** when it is not withdrawn, its references link exactly one GitHub commit, and it names
  a CWE the profile gives a hint for. One round per repository.
- **The commit qualifies** when it has one parent, and every file it changes but one is a test, a note, or a
  manifest, the one being a source file modified by one line each way, not a version bump or whitespace. The fix
  binder then checks the file at the commit and its parent differ in exactly that line.
- **Hints:** hint 1 names the CWE in the profile's plain words ("The advisory files it under CWE-79: Text from
  outside reaches a page without being escaped."); hint 2 is the fix deck's pair hint.
- **Leaks closed:**
  - no pane, prompt, or hint may hold an advisory or CVE id or the advisory's package;
  - the advisory id is a protected value, like a repository;
  - answers balance as the fix deck's do.

## The runs

| Ecosystems | Windows | Commit reads | Fixes bound | Balanced rounds kept |
| --- | --- | --- | --- | --- |
| pip, npm, go, maven, rubygems, rust | 2023–2024, four half-years | 500 | 12 | 11 (before the rule below) |
| rubygems, npm, go | 2021–2024, eight half-years | 779, every qualifying advisory | 36 | 9 |

The second run used up its listings. It made 943 distinct GitHub reads: 24 listing pages, 779 commits, and the fix
binder's reads for 36 fixes.

### Why so few

- **Few fixes replace exactly one line.** In the second run, 70% of the commits change more code than one line (`VULNERABLE_CHANGE`),
  14% are merges (`VULNERABLE_PARENT`), and 9% are gone or renamed (a 404 or a redirect). The share of commits that
  pass varies by ecosystem:

  | Ecosystem | Commits read | One-line fixes |
  | --- | --- | --- |
  | RubyGems | 61 | 9 (15%) |
  | npm | 119 | 9 (8%) |
  | Go | 94 | 3 (3%) |
  | Maven | 72 | 1 (1%) |
  | pip | 120 | 0 |
  | Rust | 52 | 0 |

  pip's one-line candidates were version bumps beside a data file (certifi's `cacert.pem`) or code beside templates,
  which are part of the fix.
- **Half of those stand out.** A security fix often sits on the busiest or longest line around it: a regular
  expression, an XPath query built from a string, a long condition. In 6 of the first 17 fixes no line within 13
  lines is as busy as the changed one, so picking the busiest of four lines would win every time. The selector
  refuses a round whose line is the most extreme option in every window (`VULNERABLE_STANDS_OUT`, 15 of 36). The
  fix deck's balance check would refuse the deck otherwise.
- **Balance needs room.** The 9 rounds left could not be balanced even as a deck of 8: several have only 5 to 11
  windows, which fix their answer's position. The fix deck balances at 24 rounds.

So a balanced round costs about 87 commit reads. Sixteen rounds, the least #59 accepts, would take about 1,650
requests against #59's estimate of about 500, which takes the v6 run past its 5,000-request budget.

## A cheaper screen, for later

The fix commits are the cost. GitHub's GraphQL API gives a commit's parent count and total lines added and deleted,
for about 100 commits per query. Over the 899 commits read here:

- a screen of one parent, at most 2 deleted lines, and at most 3 files passes 29% of them;
- it keeps 54 of the 57 one-line fixes.

That would cut the commit reads by about 70%, leaving about 700 requests for 16 rounds. GraphQL needs `POST`, which
the request policy does not allow today, and the journal would have to record request bodies.

## A read sample

Fixes the runs bound, as the reveal would show them:

- **ruby-saml**, `lib/xml_security.rb` (XPath injection): ``document.at_xpath("//*[@ID='#{uri[1..-1]}']")``
  became a query with a bound `$uri` variable.
- **kredis**, `lib/kredis/type/json.rb`: `JSON.load(value)` became `JSON.parse(value)`.
- **follow-redirects**, `index.js`: the header strip on a cross-host redirect also drops `Proxy-Authorization`.
- **paranoidhttp**, `client.go` (SSRF): the forbidden-address check also refuses an unspecified IP.
- **inline_svg**, `helpers.rb` (XSS): a file name in a "not found" message is now escaped.
- **ms**, `index.js` (ReDoS): the input length limit dropped from 10,000 to 100.
- **postcss**, `lib/tokenize.js`: `RE_BAD_BRACKET` also matches `\r`.
- **redcloth**, `html.rb` (ReDoS): a possessive quantifier, `\w*+`, in a tag pattern.

The second run's 36 bound files were MIT (30) or Apache-2.0 (6): JavaScript 19, Ruby 6, TypeScript 5, Go 5, Java 1.

## Open

- The follow-up for a cheaper screen is filed as its own issue. Turning the deck on later is a profile section
  (`ops/poc/prepare/testdata/vulnerable-line-section.json` is the second run's) and a run.
- Exact one-line replacement is the deck's truth. Accepting a fix that removes one line and adds several would add
  about 8 fixes per 440 commits, but in some of them the removed line is not the vulnerable one, so it was not done.
