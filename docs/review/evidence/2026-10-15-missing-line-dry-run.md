---
evidence: missing-line-dry-run
observed-at: 2026-10-15
outcome: success
artifact-published: false
credential-material-recorded: false
---

# "Missing line": a dry run on real files (#57)

A new Reason deck for v1.0. One line of a real function is hidden, and the player
picks, from four lines of the same file, the one that fills the gap. The truth is
the file itself. This dry run read TheAlgorithms/Python at the profile's pin
`3935d28` (MIT), read-only. It ran the real windows, the balance search, the
generator, and the shared parser. Nothing was published. The deck goes live with
the v6 data run (#129).

## The run

- **Directories:** `sorts`, `ciphers`, `graphs`, `matrix`, `backtracking`,
  `greedy_methods`. None are directories another deck reads.
- **Files:** 231 eligible after skipping files another deck shows. 32 were read in
  hash order; 8 had no usable gap (`MISSING_LINE_NO_GAP`).
- **Requests:** 38 GitHub reads. A live run adds about one history page per file
  to bind its licence and last human author, so about 70.
- **Output:** 24 rounds, all accepted by `validateMissingLine` and by the deck's
  balance rule.

## How a round is built

- **The pane:** 12 lines of the file with its commentary removed, so no comment
  describes the hidden line. The gap marker `⟨ missing line ⟩` stands at the
  hidden line's own indentation, at least two lines from either edge.
- **The hidden line** must:
  - start a statement (outside any bracket an earlier line opened);
  - close its own brackets;
  - appear once in the file;
  - share a name with the rest of the pane, so reading can decide it.
- **The decoys:** three lines from elsewhere in the file, at the same
  indentation and within half its length. None is shown in the pane, and each
  meets the same statement rules. Lines sharing the most names with the pane
  come first.
- **Hint 1** names what the answer does ("gives a name a value", "returns
  from the function", …). At least one decoy does the same, so the hint never
  picks the answer.
- **Hint 2** names the answer and one decoy. The decoy is steered so the answer
  is the longer of the pair in about half the pool.
- **The balance search** picks every round's gap and decoys together. The answer
  takes each rank equally often in text order and in length order. By names
  shared with the pane it may lean two rounds, with ties counted against the
  answer.

## Code-blind solvers on the 24 rounds

| Solver | Accuracy | Bound |
| --- | --- | --- |
| Most names shared with the pane | 15.6% | 35% |
| Fewest names shared | 21.9% | 35% |
| First / last in text order | 25.0% / 25.0% | 35% |
| Longest / shortest | 25.0% / 25.0% | 35% |
| Hint 1, then a guess among same-kind lines | 39.6% | partial by design |
| Hint 2, then the longer of the pair | 52.1% | 60% |

#57's own dry run, with naive decoys, measured the shared-names solver at 53%.
The design moves came from reading rounds:
- **Decoys that share names with the pane, and ties counted against the answer:**
  the solver fell from 53% to 16%.
- **Whole statements only:** parameter lines such as `goal_x: int,` were
  decoys anyone could rule out.
- **An anchor in the pane:** a hidden `result = []`, never used in view, let a
  decoy like `text = text.upper()` fit just as well.

## A read sample

- `backtracking/sudoku.py`, in `find_empty_location`, under `for i in range(9):`.
  The answer is `for j in range(9):` against `for j in range(3):`, `for cell in
  row:`, and `row, column = location`.
- `ciphers/beaufort_cipher.py`, in `main()`, before `key_new =
  generate_key(message, key)`. The answer is `key = "SECRET"` against
  `x = len(message)`, `return key`, and `for letter in message:`.
- `matrix/matrix_class.py`, after the row checks and before `else: self.rows =
  []`. The answer is `self.rows = rows` against `self.rows.append(row)`,
  `cols = len(rows[0])`, and `return NotImplemented`.

## Open

- Some rounds stay ambiguous: more than one line could fit, and only the file
  says which. Hint 1 helps there. Agent playtest run 2 (#122) should rate
  fairness.
- Go and Java pins can follow; their source-file rules are in
  `select-missing-line.ts`, but nothing has been read from them yet.
