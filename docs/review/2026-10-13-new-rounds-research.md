# New rounds research

2026-10-13. The question was which new rounds, questions, and sources could join the three decks, for example
"guess the algorithm". Three research passes ran in parallel:

- game design: round types, objective answers, leakage;
- data sources: licences, access, and cost, checked against live APIs;
- the codebase: what adding a deck costs.

This note records what they found and what was chosen. The build plan is the sequence of pull requests that
starts with the curated-source slice. [The next-sources plan](2026-10-13-next-sources-plan.md) covers the
forges (GitLab, Software Heritage) and the era deck.

## Chosen: three new decks

| Deck | The player sees | The answer comes from | Source |
| --- | --- | --- | --- |
| Which algorithm? | A function with its name masked and its docstring removed; four algorithms from one family (quicksort, merge sort, heapsort, shell sort) | Where TheAlgorithms files the code (`sorts/quick_sort.py`) | TheAlgorithms Python, Java, Go (MIT), pinned commits |
| Predict the output | A function and one call; four values | The function's own doctest, which the repository's CI checks | TheAlgorithms/Python doctests, parsed statically and never run |
| Spot the fix | The version before a one-line bug fix, with line numbers; four lines | The fix commit's diff | Defects4J (MIT) and BugsInPy commit pointers; code from each upstream repository with its own licence check |

Decisions taken:
- The algorithm's own function name is masked in the displayed code (shown as `mystery_function`), and the
  reveal gives the real name.
- A curated file is credited to its last human author: one page of the file's history up to the pinned
  commit, skipping automation accounts.
- Spot the fix reads Defects4J and BugsInPy. BugsInPy's repository has no licence, so only its commit ids are
  read.
- Guess the commit message waits.

## Why these three

Each has an objective answer and no human labelling:
- a contributor's choice of directory;
- an expected output that upstream CI checks;
- a commit's diff.

Each can also be made leak-proof with machinery the game already has:
- the language deck's balanced option design;
- name screens like the project deck's;
- the before-or-after deck's position balance.

No existing game asks for the algorithm, the output, or the fixed line of real code. Related games cover:
- the repository: [GitHubGuessr](https://alternativeto.net/software/githubguessr/about),
  [GitGuessr](https://feedbagel.com/post/gitguessr-a-geoguessr-inspired-game-for-improving-code-reading-skills);
- the language: [guess-that-lang](https://awesome.ecosyste.ms/projects/github.com%2Flioness100%2Fguess-that-lang);
- spotting a vulnerable line: [Spot the Vuln](https://cipherssecurity.com/games/).

Predicting output is an established
code-reasoning task ([CRUXEval](https://arxiv.org/abs/2401.03065)).

## Leakage, and the screen for each

| Deck | How a solver could cheat | Screen |
| --- | --- | --- |
| Which algorithm? | Identifiers and comments name the algorithm (`quick_sort`, `merge(`) | Mask the function's own name, strip its docstring, and reject the round if any option's name variant remains, matched inside identifiers. All options come from one family, and each algorithm is the answer once per family. |
| Predict the output | The longest, shortest, most common, or odd-typed option; the other doctests | Hide the other doctests. Decoys are the same function's real outputs, and the answer's rank cycles across the pool. |
| Spot the fix | The change sits in the middle of the window; decoy lines are trivial | Place the changed line at a hash-chosen offset. Decoys are non-trivial lines of similar length. The answer's rank is exactly balanced. |

## Sources checked

| Source | Labels | Licence | Access | Verdict |
| --- | --- | --- | --- | --- |
| [TheAlgorithms](https://github.com/TheAlgorithms) | Directory = category, file = algorithm; `DIRECTORY.md` index; Python CI runs doctests ([CONTRIBUTING](https://github.com/TheAlgorithms/Python/blob/master/CONTRIBUTING.md)) | MIT for Python, Java, C++, Go, Rust, TypeScript, Kotlin, Ruby, PHP, Dart. GPL-3.0 for C, JavaScript, C#; Swift has none. | One recursive tree per repository (Python: 1,974 entries), then one blob per file | Chosen (Python, Java, Go first) |
| [Defects4J](https://github.com/rjust/defects4j) | `active-bugs.csv`: buggy and fixed revisions per bug; 17 Java projects | MIT (drop Chart, LGPL) | A few dataset files at a pinned commit, then about 3 upstream requests per fix | Chosen |
| [BugsInPy](https://github.com/soarsmu/BugsInPy) | `bug.info`: buggy and fixed commits; 17 Python projects | No licence file: commit ids only, code from upstream (drop ansible, youtube-dl) | As above | Chosen |
| [ManySStuBs4J](https://zenodo.org/records/3653444) | 16 single-statement bug templates, fix and parent commits | CC-BY-4.0 metadata | Zenodo answers byte ranges on the 26 MB file | Later, for a "what kind of fix?" hint |
| [Exercism tracks](https://github.com/exercism) | `.meta/example.*` reference solutions; authors and a blurb in `.meta/config.json` | MIT (17 tracks checked) | One tree per track, about 3 requests per round | Backlog: Which exercise? |
| [GitHub Advisory Database](https://github.com/github/advisory-database) | CWE ids and fix-commit links | CC-BY-4.0; code licence per repository | The advisories API, within the core rate limit | Backlog: Vulnerable or fixed? |
| [HumanEval](https://huggingface.co/datasets/openai/openai_humaneval), [MBPP](https://huggingface.co/datasets/google-research-datasets/mbpp) | A task description and reference solution | MIT; CC-BY-4.0 | Bounded row reads | Filler at most; famous and memorised, and no per-task author |
| [CodeSearchNet](https://huggingface.co/datasets/code-search-net/code_search_net) | Function name, docstring, commit-pinned URL | Per repository; the dataset says "other" | Parquet row groups | Not needed: Stack v2 files already give function names |
| [CVEfixes](https://zenodo.org/records/13118970) | Vulnerability fixes | CC-BY-4.0 | One 12.7 GB zip, no bounded read | Rejected |
| [APPS](https://github.com/hendrycks/apps), [CodeContests](https://huggingface.co/datasets/deepmind/code_contests) | Problem tags | Solutions scraped, "copyright not specified" | — | Rejected: no authors |
| [Rosetta Code](https://rosettacode.org/wiki/Rosetta_Code:Copyrights) and its mirrors | The same task across languages | GFDL | — | Rejected |
| [codeparrot/github-code-clean](https://huggingface.co/datasets/codeparrot/github-code-clean) | Licence column | Mixed | 880 shards, no commit SHA | Rejected: no pin, no author |

## Backlog

| Idea | Notes |
| --- | --- |
| Guess the commit message | Two panes and four real subjects from the same search. About 200 requests, reusing journaled commits. Leak solvers: length and conventional prefix. |
| Which era? | Planned in the next-sources plan. Needs `Python-2.0` and `BSD-2-Clause` on the allowlist for cpython and BSD history; golang/go's 1972–1988 Easter-egg commits must be deny-listed. |
| Name the function | Hide a function's name and offer four names from the same file. No new source; parse Stack v2 files. |
| Which exercise? | Exercism, with authors in `.meta/config.json`. |
| Which framework? | The answer is the excerpt's hidden imports, cross-checked against GitHub's dependency-graph SBOM. |
| Vulnerable or fixed? | GitHub Advisory Database fix commits through the existing before/after code. |
| Missing line | Hide one line and offer four lines of the same file, matched on indentation. |

Rejected round types:

| Round | Why |
| --- | --- |
| Big-O | No objective answer; better as a line in an algorithm round's reveal. |
| Guess the licence | Nothing in code without headers to read it from. |
| Real vs mutated | Shows code no recorded author wrote; repeats the retired AI deck's flaw. |
| Which test covers it | Needs coverage runs; the test's name is both the answer and the leak. |

## What a new deck costs in this codebase

These are the findings from the codebase pass that shape the first pull request.

- **Deduplication.** Today's keys allow one round per repository in a deck, and one use of a commit across
  decks. A curated deck holds many files from one pinned commit, so deduplication and cross-deck keys become
  per kind.
- **Fetching.** The verified GitHub readers (commit, tree, path, blob) and the admission checks (repository,
  licence, author) existed only inside the lineage and admission modules. `github-git.ts` and
  `github-files.ts` now share them, and `bindGitHubFile` reads any file of a curated repository at a pinned
  commit with its licence and last human author.
- **Request policy.** One new request is allowed: a file's history up to a pinned commit, one page of at most
  ten (`commits?path=…&sha=<40-hex>&per_page=10`).
- **Python workers.** A new worker would change the worker-code hash in the journal key and break offline
  replay of the Stack decks. Doctests are therefore parsed in TypeScript.
- **Deck ids.** An id with two hyphens broke the skip-reason code; ids are replaced with `replaceAll` now.
- **Profile changes.** Any change rewrites every round's version, so the committed profile changes only when
  the new decks go live.
