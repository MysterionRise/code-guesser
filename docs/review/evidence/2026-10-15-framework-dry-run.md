---
evidence: framework-dry-run
observed-at: 2026-10-15
outcome: success
artifact-published: false
credential-material-recorded: false
---

# "Which framework?": a dry run on real files (#62)

A new Recognise deck for v1.0. tastejs/todomvc builds the same to-do app in
dozens of front-end frameworks, so the app's names (`todos`, `toggle`,
`destroy`) say nothing, and only each framework's idioms tell them apart. The
owner chose this source on 2026-10-15 (route A in #62), with each example's own
licence checked.

This dry run read tastejs/todomvc at `ff43b02`, read-only. It ran the real
selector, the licence and author binding, the generator, the composer, and the
shared parser. Nothing was published; the deck goes live with the v6 data run
(#129). The section the run will configure is
`ops/poc/prepare/testdata/framework-section.json`.

## The deck

Sixteen frameworks in four families of four. A round offers one family, so two
look-alikes are never offered together: React and Preact sit in different
families, as do Backbone and Marionette (which builds on it) and Angular and
AngularJS.

| Family | Frameworks |
| --- | --- |
| Components | React, Vue, Svelte, Angular |
| Classics | Backbone, Ember, Knockout, AngularJS |
| Light | Preact, Lit, Mithril, Ractive |
| Toolkits | Dojo, Closure, CanJS, Marionette |

Each framework is the answer in two rounds, from two different files, so the
pool holds 32 rounds and each family's rounds answer each member equally often.
Frameworks with a TodoMVC example but no second telling file (jQuery, Riot,
Aurelia), or whose example is in another language (Elm, Reagent, js_of_ocaml,
AngularDart, GWT, Binding.scala), are left out. Polymer and Elm carry their own
licence files, and Web Components declares ISC in its `package.json`.

## The licence

`license.md` says "Everything in this repo is MIT License unless otherwise
specified", followed by the MIT text. GitHub matches no licence to that file
(`other`, `NOASSERTION`), so the usual admission refuses the repository.

- **The pin declares the licence:** `{ "spdx": "MIT", "path": "license.md",
  "blob": "9275d43…" }`. Admission accepts a declared licence only where GitHub
  names none, and only for that exact file at that blob.
- **"Unless otherwise specified":** a file is read only when no directory from
  its example down to the file holds a licence file, and the example's
  `package.json` declares no licence or MIT. None of the 17 example
  directories the run read from states another licence; Ember's `package.json`
  says MIT, and the other 16 declare none.

## How a round is built

- **Commentary goes:** `//` and `/* */` comments, HTML and Handlebars comments
  (`<!-- svelte-ignore … -->` names Svelte), and `<style>` blocks.
- **Names are masked as lower-case `mystery`** in every round, whichever family
  is offered: each framework's label and spellings across an identifier's words
  (`LitElement` becomes `mysteryElement`, `'todos-jquery'` becomes
  `'todos-mystery'`), and CanJS's `can` only as a whole identifier, so Ember's
  `canToggle` stays. Namespaces that spell no name (`ko.`, `m(`, `goog.`, `Mn.`,
  `$scope`) stay, because they are the idioms the deck is about.
- **The window:** up to 14 lines.
  - It never shows an import, an AMD `define([…])` header, `goog.provide` or
    `goog.require`, `'use strict'`, a style sheet in a `css` template literal, a
    script or link tag, a URL, or a credit line ("Written by …"). A framework's
    author signs its example, so a name in a footer can give the framework away.
  - It never crosses a single-file component's `<script>`/`<template>`
    sections, and never starts on a closing line or climbs out to a line
    indented less than its first.
- **Fairness:** a window must show at least two of its framework's markers and
  none of another family member's. TodoMVC's Vue template borrows React's
  `htmlFor=`, so that window is refused and Vue's other files are used.
- **Hint 1** describes how the framework builds a page, naming none ("Classes
  carry decorators, and templates bind events in parentheses and properties in
  square brackets."). **Hint 2** quotes one idiom exactly as the pane shows it
  ("Look for `@change="` …", not a pattern's label).

## The run

- **Requests:** 141 distinct GitHub reads: trees and blobs for the 32 files,
  the directory listings on their paths, 17 package manifests, and one history
  page per file for its last human author. Repeats are answered by the run's
  GET reuse.
- **Selection:** every framework filled its two rounds from the first two files
  the section lists, with no rejection.
- **Output:** 32 rounds, accepted by the generator, the composer's containment
  check, and the shared parser, including the deck rule that each family's
  frameworks are answered equally often.
- **Authors credited** are each file's last human author, among them Addy
  Osmani, Thorsten Kober, NullVoxPopuli, Chris Price, Pascal Hartig, and Akira
  Sudoh.

## Code-blind solvers on the 32 rounds

| Solver | Accuracy |
| --- | --- |
| Option frequency, most or least offered | 25.0% |
| Text order | 25.0% |
| Longest or shortest label | 25.0% |
| A label's letters in the pane, most or fewest | 25.0% |
| Hint 1 names an option | 25.0% |
| Remembering reveals, game 2 (replaying them: 36.7%) | 42.2% |
| Remembering reveals, game 3 (replaying them: 46.6%) | 54.7% |

Every solver that reads a single round is at chance. As in the algorithm deck, a
family's options recur, so a player who remembers which of them were answered
in earlier games can rule some out. The leakage test records this as the same
expected failure (#81) and runs the other solvers once the artifact holds the
deck.

## A read sample

- **Angular**, `todo-item.component.html`: `[class.completed]="…"`,
  `(dblclick)="startEdit()"`, `@if (isEditing) {`, `[(ngModel)]="title"`.
- **Knockout**, `js/app.js`: a view model of `ko.observableArray(…)`,
  `ko.observable('all')`, and `ko.computed(function () { switch
  (this.showMode()) …`.
- **Ractive**, `index.html`: the template, with `on-enter="newTodo"`,
  `{{#items:i}}` and the `{{>item}}` partial. The window ends before the
  page's credits.
- **Dojo**, `TodoEnter.js`: `return declare(_WidgetBase, { postCreate: …
  this.inherited(arguments); this.on('keydown', lang.hitch(this, …`.
- **CanJS**, `models/todo.js`: `var Todo = mystery.Model.LocalStorage.extend({
  storageName: 'todos-mystery' }, …`.

## Open

- The pool is 32 rounds against #129's 48. Most examples have two or three
  telling files, so 48 would need a third round per framework, and Ractive and
  Mithril have no third file that shows their idioms.
- Some windows are easy for anyone who has used the framework (`useState(`);
  the families decide the difficulty. Agent playtest run 2 (#122) should rate
  fairness for the toolkits family, whose frameworks are the least known.
