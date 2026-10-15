---
evidence: exercise-dry-run
observed-at: 2026-10-15
outcome: success
artifact-published: false
credential-material-recorded: false
---

# "Which exercise?": a dry run on real files (#58)

A new Recognise deck for v1.0. Exercism keeps a reference solution for every
practice exercise in each language track, under
`exercises/practice/<slug>/.meta/`. A round shows one track's solution with
every option's names masked as `mystery`, and offers one family of four
exercises. The truth is the directory the solution sits in.

This dry run read six tracks at pinned commits, read-only: Python, Go, Rust,
Ruby, JavaScript, and C#, all MIT, with each licence checked at its pin by the
usual admission. It ran the real selector, the licence and author binding, the
generator, the composer, and the shared parser. Nothing was published; the deck
goes live with the v6 data run (#129). The section the run will configure is
`ops/poc/prepare/testdata/exercise-section.json`.

## The deck

Six families of four, as #58 proposed. Exercises that overlap the algorithm
deck's labels (sieve, binary search) are left out.

| Family | Exercises |
| --- | --- |
| Words | Isogram, Pangram, Anagram, Acronym |
| Arithmetic | Armstrong numbers, Perfect numbers, Collatz conjecture, Leap |
| Ciphers | Atbash, Rotational, Affine, Rail fence |
| Grids | Minesweeper, Saddle points, Matrix, Word search |
| Replies | Bob, Raindrops, Two-fer, Proverb |
| Series | Sum of multiples, Difference of squares, Nth prime, Grains |

Each exercise is the answer twice, from two different tracks, so the pool holds
48 rounds, the size #129 aims for. Tracks take turns being tried first, so the
deck spreads across languages: C# 10, Rust 9, JavaScript 8, Ruby 8, Python 7,
Go 6.

## How a round is built

- **Masking:** every option's names and label stems, in code and strings, as in
  the algorithm deck. `is_isogram` becomes `is_mystery`, Go's `package isogram`
  is skipped as preamble, and C#'s `public static class Bob` becomes
  `class Mystery`. Because all four options are masked alike, a mask never
  singles one out.
- **The window:** up to 18 lines past the preamble, opening at a definition of
  the answer's own names.
  - In a first draft the window could open at any masked definition. Go's
    saddle-points solution starts with a copy of the matrix exercise's parser
    (`type Matrix [][]int`), so its window showed only the parser, which reads
    as the Matrix exercise, a decoy.
  - The window now opens at the answer's own name only, Go methods included
    (`func (m *Matrix) Saddle()`). The algorithm deck has the same blind spot
    for Go methods, but fixing it there would change today's committed rounds,
    so that waits for the v6 run.
- **A solution needs no masked name.** Many name their function for the task
  (`abbreviate`, `encode`, `steps`), unlike TheAlgorithms files.
- **Hints** are profile copy:
  - hint 1 says what the exercise asks ("No letter may appear more than once,
    ignoring spaces and hyphens.");
  - hint 2 says what a solution takes and gives back ("It takes a word or phrase
    and returns true or false.").
  - No hint, prompt, or note may use an option's label word. "The 64 squares of
    a chessboard" for Grains would point to "Difference of squares", so it says
    "cells".
- **Replies keep their strings** ("Whoa, chill out!", "Pling"), as #58 allows:
  they help only a player who already knows the exercise.

## The run

- **Requests:** 248 distinct GitHub reads. For each track: the repository, the
  pinned commit, its licence, and the trees down to each exercise. For each file:
  its blob and one history page for its last human author.
- **Rejections:**
  - Ruby has no word-search exercise (`FILE_*`);
  - five solutions were too short for a window (`EXERCISE_WINDOW`): Go's
    leap year, and Two-fer in Python, Go, Ruby, and JavaScript, each a single
    formatted string;
  - each was replaced from the next track in turn, so Two-fer's two rounds
    come from Rust and C#.
- **Output:** 48 rounds, accepted by the generator, the composer's containment
  check, and the shared parser, including the rule that each family's exercises
  are answered equally often.
- **Authors credited:**
  - each file's last human author;
  - Erik Schierboom for 17 rounds, then Daniel Berg, Job van der Wal,
    Derk-Jan Karrenbeld, and others.

## Code-blind solvers on the 48 rounds

| Solver | Accuracy |
| --- | --- |
| Option frequency, most or least offered | 25.0% |
| Text order | 25.0% |
| Longest or shortest label | 25.0% |
| A label's letters in the pane, most | 29.3% |
| A label's letters in the pane, fewest | 22.0% |
| Remembering reveals, game 2 (replaying them: 32.8%) | 36.5% |
| Remembering reveals, game 3 (replaying them: 39.8%) | 46.1% |

Every solver that reads a single round stays within chance plus 10, the bound
#58 asked for. As in the algorithm and framework decks, a family's options
recur, so remembering which were answered helps a little; the leakage test
records this as the same expected failure (#81).

## A read sample

- **Saddle points**, Go: `func (m *Mystery) Mystery() (p []Pair)` collects
  `colMin` from `m.Cols()` and keeps a row's maxima that are also their column's
  minimum.
- **Rail fence cipher**, Python: `mystery_pattern(mysterys, size)` zips a
  `cycle(chain(range(…), range(… - 2, 0, -1)))` zig-zag with the message's
  positions.
- **Grains**, C#: `public static ulong Square(int n)` refuses `n > 64`. The
  method's own name, `Square`, is a fair trap beside "Difference of squares".
- **Two-fer**, Rust: a `match` that returns `"One for you, one for me."` for an
  empty name.

## Open

- Java, Kotlin, and Swift keep their solutions under class-named paths
  (`.meta/src/reference/java/IsogramChecker.java`), which a `{slug}` template
  can't name. They would need a directory listing per exercise.
- #58's proposal also quoted each exercise's `blurb` in the reveal. The reveal
  gives the profile's own description instead, which saves a read per round.
