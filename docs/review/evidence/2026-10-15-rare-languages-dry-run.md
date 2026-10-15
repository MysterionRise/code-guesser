---
evidence: rare-languages-dry-run
observed-at: 2026-10-15
outcome: success
artifact-published: false
credential-material-recorded: false
---

# Rarer languages for "Which language?": a dry run (v1.0, #129)

The owner asked for "more crazy and rare languages" and chose to grow the
language deck rather than add a separate hard deck. This change teaches the
preparer seven new look-alike pairs. The v6 data run will configure them for
the language deck alone. The committed v5 artifact is unchanged and still
rebuilds offline byte for byte.

| Pair | Telltale syntax, one side / the other |
| --- | --- |
| Haskell / Elm | `name :: Type`, `where`, `do`, `<$>` / `name : Type`, `type alias`, `{ model \| … }` |
| OCaml / F# | `;;`, `a.(i)`, `~label:`, `Printf.printf` / `printfn`, `member this.`, `[<…>]`, `elif` |
| Erlang / Prolog | `receive`, `fun(`, `io:format`, `#{` / `:-`, `X is`, `findall(`, `\+` |
| Clojure / Racket | `(defn`, `(let [`, `:keyword`, `nil` / `(define`, `#t`, `(let ([`, `(cond [` |
| Julia / MATLAB | `::Type`, `push!(`, `x[i]`, `!=` / `%` comments, `~=`, `function [a, b] =` |
| Ada / Pascal | `end if;`, `elsif`, `=>`, `procedure … is` / `writeln(`, `function f: Type`, `var`, `then begin` |
| Elixir / Crystal | `def … do`, `\|>`, `fn … ->`, `{:ok,` / `: Int32`, `property`, `do \|x\|`, `class X < Y` |

## Data: The Stack v2 at the pinned revision, read-only

- **Directories:** every candidate has a directory at `e565caa`, with one shard
  each. Their parquet footers show 146,378 (Crystal) to 5,241,819 (MATLAB)
  rows. So the worker's 100,000-row read never runs out of rows, and its row
  contract stands as it is (PureScript, with 66,367, was not proposed).
- **The real metadata worker** ran on all 14 languages with the v1.0 allowlist
  (MIT, Apache-2.0, BSD-2/3-Clause, ISC, Python-2.0):
  - every language gave 200 ordinary rows, the language deck's source;
  - 8.5–16.5 MB of metadata and 5–7 requests each.
- **Popular repositories** (1,000+ star events) are mostly other languages'
  projects carrying a few files: Elm's top three are parcel, bat and
  openapi-generator, and Racket's include bat's syntax tests. "Which project?"
  over "popular Elm projects" would mislead. So a rare language is configured
  `"projectDeck": false` and feeds the language deck alone.

## The language deck's checks on real files

I took 30 ordinary-row files per language from the public Software Heritage
bucket (420 files, every one hash-checked against its row) and ran the real
chain: the content screen, the generated-file check, the code window, the
spoiler checks, and `tellsApart`.

| Language | Pass | Language | Pass |
| --- | --- | --- | --- |
| Haskell | 19/30 | Elm | 20/30 |
| OCaml | 18/30 | F# | 19/30 |
| Erlang | 22/30 | Prolog | 14/30 |
| Clojure | 20/30 | Racket | 13/30 |
| Julia | 22/30 | MATLAB | 12/30 |
| Ada | 12/30 | Pascal | 17/30 |
| Elixir | 20/30 | Crystal | 18/30 |

A language needs two rounds, so every pair fills easily. The losses:
- email addresses in files (`PERSONAL_DATA`);
- paths the screen refuses (`INVALID_PATH`, mostly MATLAB's `+package` folders);
- no window past the preamble (`WINDOW`);
- code that names a language: Ada's standard library is `Ada.Text_IO`.

Reading the windows found:
- **Markers are genuine:** OCaml's `M.(…)` local open, Julia's comprehension
  `x[1]`, and Prolog's `:-` in an LPS dialect file.
- **Clojure docstrings say `clojure.core/map`**, which a case-sensitive name
  check misses. A rare language's name in any case now refuses a window. The
  first twelve keep the old check, so v5 is unchanged.
- **Some fixtures are low-value** (a generated `.pb.cr`, an ASCII-art test
  asset in Haskell). They are rare and still real code in the language.

## Option sets with thirteen pairs

Each language round offers its own pair and one more. With six pairs, each
pair's four rounds took "every other pair but the next one". Now a pair takes
the second pairs two to five places along a hash-ordered cycle. For six pairs
that is exactly v5's set, in v5's order. For thirteen, no two pairs ever meet
twice, and every pair is still the second pair in exactly four rounds.

Some pairs read alike as families, so they never share a round:
- Elixir/Crystal and Julia/MATLAB with Python/Ruby;
- Haskell/Elm with OCaml/F#;
- Erlang/Prolog with Elixir/Crystal.

The cycle is searched until none does. A first version banned any second pair
whose markers the code showed. On real windows it failed one sample set in
four: Julia's `!=` and `x[i]` appear in most C-like code. The family list
depends only on which pairs are configured, so it can't fail on code content.
Every real sample set I tried paired successfully: the committed deck's 24
mainstream rounds plus two accepted windows per rare language, 52 rounds each.

## The journal

The worker journal is keyed to a hash of the worker's code, so teaching the
worker new languages orphaned v5's recorded outputs.
- I copied `run.jsonl` aside as `run.jsonl.before-rare-languages` and ran
  `--resume`. It re-recorded 111 worker outputs: 110 byte-identical, and
  Java's metadata rows identical with only its network counters differing.
- A resume refetches the Hugging Face access check, so its snapshot differs.
  I kept the committed artifact and merged the re-recorded outputs into the
  13 October journal, with Java's original output.
- `--offline` then rebuilt the committed artifact byte for byte, with 1,787
  responses replayed and none live.

## What the v6 run needs (#129)

About 700 more requests, about 155 MB more Stack metadata (v5 used 216 MB of
256 MB), and about 50 more successful blobs (cap 120). These ceilings rise in
the data-run PR.
