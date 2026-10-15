---
evidence: question-layers-first-build
observed-at: 2026-10-15
outcome: success
artifact-published: true
credential-material-recorded: false
---

# Question layers: the first build (#127, #128)

v1.0 adds generative UI inside the question. Each round gets a layer written at
preparation time by a model that knows the answer. The layer is checked and
frozen, so play never calls a model before the lock. This first build covers two
decks:
- **Which algorithm?** gets "Trace it";
- **Which language?** gets "Marker hunt".

The other four decks get their designs later in #128.

## What a layer is

| | Trace it (algorithm) | Marker hunt (language) |
| --- | --- | --- |
| Free scaffold | 1–3 names the code shows, each with its kind of value from a closed list (`an index`, `a lower bound`, …) | 3 questions from a closed bank of 12 that every language answers ("How does a block of code end?") |
| Hint 1 | What the code needs from its input or gives back, in one sentence | The 1–2 deciding lines; the game writes the sentence ("Look closely at lines 1 and 4.") |
| Hint 2 | A step-through on a tiny input: 2–8 frames of the watched names' state | The deciding feature in one sentence, naming no language |

The parser (`packages/artifact/src/question-layer.ts`) refuses a layer if:
- it names an option: its label, its known spellings, or its label stems, in any case;
- for language, it names any of the twelve languages or a file extension;
- it points at a name the code doesn't show, or at a line outside the pane;
- its text isn't plain and bounded.

A refused layer gets one repair, with the check named. If it still fails, its
round keeps the static hints.

## The pilots changed the design

Three pilots on 3–8 rounds a deck found problems before the full build.
- **Free-text roles described the mechanism.** "The index computed from the
  item's value relative to the ends" is interpolation search. The code-blind
  solver moved from 10% to 60–90% on the answer. Roles are now a closed list of
  kinds.
- **Tailored questions named features.** "Where is the annotation placed relative
  to the constructor?" tells even a code-blind reader the pair. Prompts now come
  from a bank that fits all twelve languages.
- **The hint-1 sentence said what was on the lines.** "Look at the use of double
  colons" points to C++. The game now words that hint itself.
- **The step-through was the strongest aid,** so it became hint 2. Hint 1 says
  what the code needs or returns.
- **The writer often flattened nested fields,** so the tool schema is flat.

## The audit

A code-blind solver (Claude Haiku 5.5) gives each option a probability three
times:
1. **Control:** only what the layer quotes from the code, which a reader sees
   anyway. For Trace it, that's the watched names.
2. With the scaffold.
3. With the scaffold and hint 1.

A round's layer is refused if the scaffold lifts the answer by more than 0.25
over the control, or hint 1 by more than 0.5. A deck's kept layers may lift it by
0.10 (scaffold) and 0.35 (hint 1) on average.

| Deck | Rounds | Kept | Refused | Control | Scaffold | Hint 1 |
| --- | --- | --- | --- | --- | --- | --- |
| Which language? | 24 | **24** | none | 0.250 | 0.256 (+0.006) | 0.254 (+0.004) |
| Which algorithm? | 24 | **20** | `NAMES_OPTION`, `SCAFFOLD` (four names), `SCAFFOLD_LEAK`, `TEXT`: 1 each | 0.552 | 0.578 (+0.026) | 0.656 (+0.104) |

The algorithm control is high because its code's own names are telling. A
`minIndex` already puts the solver at 0.90 on selection sort. Lifts are therefore
measured over the control.

## A read sample

**Which algorithm?** Options: insertion, selection, cocktail shaker, and bubble
sort; the answer is selection sort.
- **Scaffold:** `array` (the input), `minIndex` (an index), `i` (an index).
- **Hint 1:** "The code rearranges the list in place and returns it, and it works
  by repeatedly looking through the unsorted part for an extreme item."
- **Hint 2:** a step-through of `[4, 2, 7, 1]`: `minIndex` moves to 1, then 3,
  then position 0 swaps with 3.

**Which algorithm?** Options: interpolation, jump, linear, and binary search; the
answer is interpolation search.
- **Scaffold:** `point` (an index), `left` (a lower bound), `right` (an upper
  bound).
- **Hint 1:** "The code takes a sorted list and a target value, and gives back the
  position of that value or nothing."
- **Hint 2:** the step "point becomes 0 + ((40 - 10) * 4) // (50 - 10), so point
  is 3".

**Which language?** Options: C#, Ruby, Java, Python; the answer is Ruby.
- **Scaffold:** "How does a block of code end?", "How are names spelled…?", "How
  are strings written?"
- **Hint 1:** "Look closely at lines 1 and 4."
- **Hint 2:** "Blocks are opened by a line ending in a keyword with no braces or
  colons, and closed by a bare keyword on its own line…"

## Open

- **Hint strength varies.** The selection sort hint 1 above nearly names the
  algorithm, though the audit passes it because the code's `minIndex` already
  does. Agent playtest run 2 (#122) should judge whether hints feel fair.
- **Step-throughs aren't checked against the code.** A model-written trace can
  be wrong (one pilot trace mixed up a heap's order). Run 2's explanation judge
  should check traces, and a wrong one should be refused by hand.
- **The game doesn't show layers yet.** The rendering, the hint path for
  structured hints, and the experiment's `layer` arm (#106) come next.

## Reproduce

```bash
OPENROUTER_API_KEY="$(cat ~/.config/openrouter/key)" pnpm prepare:questions
pnpm prepare:questions --offline   # replays the journal; byte-identical
```

- **Calls:** 158 live and 38 replayed from the pilots; 184K tokens in and 22K out.
- **Spend:** the key's usage for the day was $0.056, covering all pilots and the
  full build.
- **Offline replay:** 196 answers replayed, none live, and the file and pin are
  byte-identical.
- **Pin:** `bccec41ff31fe44d6def6a485a0e266fd52fad364241f881c8f92613463ae527`,
  for artifact `4747549666813ab44d60fca7df89152a65ea5cf91570b316d8d1539aacd4f90a`.
