---
evidence: name-function-dry-run
observed-at: 2026-10-15
outcome: success
artifact-published: false
credential-material-recorded: false
---

# "Name the function": a dry run on real files (#73)

A new Reason deck for v1.0. One function of a real file is shown with its name
masked as `mystery`, and the player picks, from four functions the same file
declares, the name its author gave it. The truth is the declared name.

This dry run read TheAlgorithms/Java at `e43ec38` and TheAlgorithms/Go at
`5ba447e` (both MIT, both pinned in the v5 profile), read-only. It ran the real
function finder, balance search, generator, and shared parser. Nothing was
published. The deck goes live with the v6 data run (#129).

## The run

- **Directories:**
  - Java: 16 under `src/main/java/com/thealgorithms/` (`maths`, `strings`,
    `sorts`, `datastructures/trees`, `backtracking`, …).
  - Go: 14 (`math`, `graph`, `sort`, `structure/tree`, …).
  - Directory listings are flat, so the profile names nested packages one by one.
- **Files:** 707 eligible after skipping files another deck shows. 123 were
  read in hash order across both repositories; 99 had no function a round can
  ask about (`NAME_FUNCTION_NONE`).
- **Requests:** 125 GitHub reads. A live run adds tree reads for the listed
  directories and one history page per kept file to bind its licence and last
  human author, so about 200.
- **Output:** 24 rounds (19 Java, 5 Go), all accepted by `validateNameFunction`
  and by the deck's balance rule. The 45 files that qualified among the first
  240 read also balance at 28 and 32 rounds, so pools can grow (#129).

### Why most files don't qualify

Most TheAlgorithms files hold one algorithm in one or two functions. Of the
first 240 files read, about 17% of Java files and 18% of Go files declare four
or more. #73 had estimated the same for Python (13 of 140 files), so Python is
left out.

## How a round is built

- **The pane:** one function of 4 to 24 lines, with commentary removed and
  shared indentation stripped. Its name is masked as `mystery` wherever an
  identifier spells it, recursive calls and strings included. The mask is
  always lower case, so Go's exported names don't stand apart.
- **Its name** must be one the author chose:
  - no `@Override`;
  - no name an interface or convention fixes (`toString`, `compareTo`,
    `Len`/`Less`/`Swap`, `String`, `main`, …);
  - no test hooks, and no name used twice in the file.
- **The mask touches only the name.** A pane where masking would change another
  identifier is refused. In the first draft, `VectorCrossProduct` became
  `VectorMystery`, which tied the answer to the class's name.
- **The decoys:** three other names the file's author chose. The pane never
  spells any of them, since a call to one would rule it out. The four options
  stay distinct even ignoring case and underscores. In the first draft,
  `inOrderSort` sat beside `inorderSort`, and Go's `Merge` beside `merge`.
  Names sharing the most words with the pane come first.
- **Hint 1** says how many words the name joins ("The name joins two words."),
  and at least one decoy joins as many. **Hint 2** names the answer and one
  decoy. The decoy is steered so picking the longer name is a coin toss
  (exactly 12 of 24), with the most constrained rounds placed first.
- **The balance search** picks every round's function and decoys together:
  - text order and length order are balanced exactly;
  - four extreme solvers are held to a quarter of the pool plus a tenth:
    most or fewest words shared with the pane, and most or fewest words in the
    name, ties split. This is the fix deck's approach. Counting a tie against
    the answer, as missing-line does, was too blunt here, since most names
    share no word with their pane.

## Code-blind solvers on the 24 rounds

| Solver | Most | Least |
| --- | --- | --- |
| Words (3+ letters) shared with the pane | 25.7% | 20.8% |
| Words shared, prefixes counted (`sort` in `sorted`) | 25.7% | 25.7% |
| Length | 24.3% | 18.8% |
| Words in the name | 16.7% | 21.5% |
| Text order | 25.0% | 25.0% |
| Hint 1, then a guess among same-shape names | 39.2% | |
| Hint 2, then the longer of the pair | 50.0% | |

Every code-blind solver stays within chance plus 10, the bound #73 asked for.
The leakage test now runs these solvers on the deck once the artifact holds it.

## A read sample

- `backtracking/KnightsTour.java`: a `static void mystery()` that sets every
  cell of `grid` to zero, marks a two-cell border as `-1`, and resets `total`.
  The answer is `resetBoard` against `countNeighbors`, `neighbors`, and
  `orphanDetected`.
- `backtracking/CrosswordSolver.java`: `boolean mystery(char[][] puzzle, String
  word, int row, int col, boolean vertical)` that checks every cell the word
  would take is free. The answer is `isValid` against `placeWord`,
  `removeWord`, and `solveCrossword`.
- `datastructures/trees/HeavyLightDecomposition.java`: a recursive
  `mystery(int node, int start, int end)` that fills `segmentTree[node]` from
  its two halves. The answer is `buildSegmentTree` against `dfsSize`,
  `getPosition`, and `queryMaxInPath`.
- `graph/cycle.go`: a recursive method returning `(bool, [][]int)` that
  collects `parents`. The answer is `findAllCyclesHelper` against
  `FindAllCycles`, `HasCycle`, and `hasCycleHelper`, which is the hardest round
  in the sample.

## Open

- A few rounds are hard rather than unfair: a pane that only swaps two
  elements is `swap` in a file that also declares `HeapSort`, `Heapify`, and
  `Update`. Agent playtest run 2 (#122) should rate fairness.
- Stack v2 files (#73's other source) could widen the pool beyond
  TheAlgorithms; nothing has been read from them for this deck yet.
