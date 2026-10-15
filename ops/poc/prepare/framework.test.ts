import { readFileSync } from "node:fs";

import {
  frameworkCandidateId, frameworkDeckRule, parseArtifactDecks, spellsFramework, validateFramework, type CuratedFramework,
} from "../../../packages/artifact/src/index";
import { composeExperimentArtifact } from "./compose";
import { FRAMEWORK_MARKERS, tellsFrameworkApart } from "./framework-markers";
import { generateFrameworkRounds } from "./framework-rounds";
import { frameworkCode, frameworkWindow, maskFrameworkNames } from "./framework-window";
import { admitLicense, admitRepository } from "./github-admission";
import { parseCrawlProfile, poolSizes } from "./profile";
import {
  FRAMEWORK_REPOSITORY, FRAMEWORK_SECTION, composeInput, frameworkCandidates, loadCuratedProfile, sha1, snapshotIdFor,
} from "./testdata/deck-builders";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profile = loadCuratedProfile({}, { framework: true });
const candidates = () => frameworkCandidates(profile, snapshotIdFor(profile));
const terms = { names: ["React", "Vue", "Svelte", "Angular", "Backbone", "Lit", "jQuery", "Ember", "glimmer"], symbols: ["can"] };
const limits = { maxLines: 12, maxBytes: 4096, minBytes: 40 };
const COMPONENTS = ["react", "vue", "svelte", "angular"];

describe("framework windows (#62)", () => {
  it("drops comments of every kind but keeps strings, and masks every framework's name as lower-case mystery", () => {
    const code = frameworkCode([
      "// Backbone view", "var url = 'https://example.org/a//b'; /* trailing */", "<!-- svelte-ignore a11y -->", "{{! a note }}",
      "<style>", ".todo { color: red; }", "</style>", "var keep = \"// not a comment\";",
    ].join("\n"));
    expect(code).toBe("var url = 'https://example.org/a//b';\nvar keep = \"// not a comment\";");
    expect(maskFrameworkNames("class TodoApp extends LitElement {}\nstore('todos-jquery');\nBackbone.View.extend({", terms))
      .toBe("class TodoApp extends mysteryElement {}\nstore('todos-mystery');\nmystery.View.extend({");
    // A symbol is masked only whole: `can.route` names the framework, `canToggle` names nothing.
    expect(maskFrameworkNames("can.route.attr('filter'); this.canToggle = true;", terms))
      .toBe("mystery.route.attr('filter'); this.canToggle = true;");
    expect(maskFrameworkNames("const useReactiveThing = 1;", terms)).toBe("const useReactiveThing = 1;");
  });

  it("shows no import, module header, credit line, or style sheet, and never crosses a component's sections", () => {
    const amd = [
      "define([", "\t'dojo/_base/declare',", "\t'dojo/_base/lang'", "], function (declare, lang) {", "\t'use strict';",
      "\treturn declare([_WidgetBase, _TemplatedMixin], {", "\t\tstartup: function () {", "\t\t\tthis.inherited(arguments);",
      "\t\t\tthis.own(lang.hitch(this, this.render));", "\t\t},", "\t\tpostCreate: function () {", "\t\t\tthis.inherited(arguments);",
      "\t\t\tthis.own(lang.hitch(this, this.listen));", "\t\t}", "\t});", "});",
    ].join("\n");
    const window = frameworkWindow(amd, "dojo", ["dojo", "closure", "canjs", "marionette"], terms, limits)!;
    expect(window.excerpt.split("\n")[0]).toBe("return declare([_WidgetBase, _TemplatedMixin], {");
    expect(window.excerpt).not.toMatch(/define|use strict/u);
    const page = [
      "<section class=\"main\">", "\t<ul class=\"todo-list\">", "\t\t{{#items:i}}", "\t\t\t{{>item}}", "\t\t{{/items}}", "\t</ul>",
      "\t<button on-click=\"clear\">Clear</button>", "\t<input on-change=\"toggle\" type=\"checkbox\">", "\t<p>Written by Someone</p>",
      "\t<p>Double-click to edit</p>", "</section>",
    ].join("\n");
    // A framework's author signs its example: the window ends before the credit.
    const signed = frameworkWindow(page, "ractive", ["preact", "lit", "mithril", "ractive"], terms, limits)!;
    expect(signed.excerpt.split("\n").at(-1)).toBe("\t<input on-change=\"toggle\" type=\"checkbox\">");
    const vue = [
      "<script setup>", "const props = defineProps(['todo'])", "const emit = defineEmits(['toggle'])", "function toggle() {",
      "    emit('toggle', props.todo)", "}", "function edit() {", "    emit('edit', props.todo)", "}", "</script>", "<template>",
      "    <li v-if=\"todo\">{{ todo.title }}</li>", "</template>",
    ].join("\n");
    const vueWindow = frameworkWindow(vue, "vue", COMPONENTS, terms, limits)!;
    expect(vueWindow.excerpt).not.toMatch(/<\/?(?:script|template)/u);
    expect(vueWindow.windowStart).toBe(2);
  });

  it("keeps only a window that shows two of its own idioms and none that belongs to another framework of its family", () => {
    const hooks = "const [a, setA] = useState(0);\nconst b = useCallback(() => setA(1), []);";
    expect(tellsFrameworkApart(hooks, "react", COMPONENTS)).toBe(true);
    expect(tellsFrameworkApart("const [a, setA] = useState(0);", "react", COMPONENTS)).toBe(false);
    // TodoMVC's Vue template borrows React's `htmlFor=`, which a React reader would take for their own.
    expect(tellsFrameworkApart("<input v-model=\"all\" v-show=\"open\" />\n<label htmlFor=\"all\">All</label>", "vue", COMPONENTS)).toBe(false);
    // The same hooks tell Preact apart where React is not offered.
    expect(tellsFrameworkApart(`${hooks}\nconst c = useRef(null);`, "preact", ["preact", "lit", "mithril", "ractive"])).toBe(true);
    for (const id of Object.keys(FRAMEWORK_MARKERS)) expect(FRAMEWORK_MARKERS[id]!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("framework profile (#62)", () => {
  const raw = () => JSON.parse(readFileSync(new URL("../profiles/local-real-rounds.v5.json", import.meta.url), "utf8"));
  const withSection = (section: unknown, license: unknown = FRAMEWORK_REPOSITORY.license) => parseCrawlProfile({
    ...raw(), curated: { repositories: [{ ...FRAMEWORK_REPOSITORY, license }], framework: section },
  });

  it("reads the deck and its pin's declared licence; a profile without them parses as before", () => {
    expect(poolSizes(profile).framework).toBe(8);
    expect(profile.curated!.repositories.at(-1)!.license).toEqual(FRAMEWORK_REPOSITORY.license);
    expect(poolSizes(parseCrawlProfile(raw())).framework).toBe(0);
  });

  it("reads the section the v6 run will configure: sixteen frameworks in four families, two rounds each", () => {
    const real = JSON.parse(readFileSync(new URL("./testdata/framework-section.json", import.meta.url), "utf8"));
    const parsed = parseCrawlProfile({ ...raw(), curated: { repositories: [real.repository], framework: real.framework } });
    expect(poolSizes(parsed).framework).toBe(32);
    expect(parsed.curated!.framework!.families.flatMap(({ frameworks }) => frameworks.map(({ id }) => id)).sort())
      .toEqual(Object.keys(FRAMEWORK_MARKERS).sort());
  });

  it("refuses an unknown framework, a file outside its examples, a hint that names a framework, and an odd pool", () => {
    const section = () => structuredClone(FRAMEWORK_SECTION) as any;
    expect(() => withSection(section())).not.toThrow();
    const unknown = section();
    unknown.families[0].frameworks[0].id = "solid";
    expect(() => withSection(unknown)).toThrow();
    const outside = section();
    outside.families[0].frameworks[0].files = ["examples/vue/src/Item.vue"];
    expect(() => withSection(outside)).toThrow();
    const named = section();
    named.families[0].frameworks[1].idea = "Much like React, but with templates.";
    expect(() => withSection(named)).toThrow();
    const odd = section();
    odd.rounds = 12;
    expect(() => withSection(odd)).toThrow();
    expect(() => withSection(section(), { ...FRAMEWORK_REPOSITORY.license, spdx: "GPL-3.0" })).toThrow();
  });
});

describe("framework rounds (#62)", () => {
  it("offers each round its family of four in text order, answers each framework once per family, and names none", () => {
    const { fixtures } = generateFrameworkRounds({ profile, candidates: candidates() });
    expect(fixtures).toHaveLength(8);
    const every = FRAMEWORK_SECTION.families.flatMap(({ frameworks }) => frameworks);
    for (const fixture of fixtures) {
      const labels = fixture.candidates.map(({ label }) => label);
      expect(labels).toEqual([...labels].sort());
      expect(fixture.clues[1]).toMatch(/^Look for `.+` in the code\.$/u);
      for (const part of [fixture.panes[0]!.text, fixture.prompt, ...fixture.clues]) {
        expect(every.some((framework) => spellsFramework(part, framework))).toBe(false);
      }
    }
    expect(new Set(fixtures.map(({ correctCandidateId }) => correctCandidateId)).size).toBe(8);
  });

  it("refuses a family answered unevenly and code that still names a framework", () => {
    const pool = candidates();
    const twice = pool.map((candidate) => candidate.framework === "vue" ? { ...pool[0]!, path: "x.jsx", blob: sha1("x"), rawContentHash: "f".repeat(64),
      excerptHash: pool[0]!.excerptHash.replace(/.$/u, "0") } : candidate);
    expect(() => generateFrameworkRounds({ profile, candidates: twice })).toThrow();
    const named = pool.map((candidate) => candidate.framework !== "react" ? candidate
      : { ...candidate, excerpt: `${candidate.excerpt}\nReact.render(app);`, excerptHash: "" });
    expect(() => generateFrameworkRounds({ profile, candidates: named })).toThrow();
  });

  it("composes rounds the shared parser accepts, and the parser refuses a mixed option set, a named framework, or an uneven family", () => {
    const { artifact } = composeExperimentArtifact(composeInput(profile));
    const [deck] = parseArtifactDecks(artifact).filter(({ id }) => id === "framework");
    expect(deck!.fixtures).toHaveLength(8);
    const frameworks = new Map<string, CuratedFramework>((artifact.crawlSnapshot as any).curated.frameworks.map((entry: CuratedFramework) => [entry.id, entry]));
    const fixture = deck!.fixtures[0]!;
    const semantics = { frameworks, panes: fixture.panes, prompt: fixture.prompt, candidates: fixture.candidates, clues: fixture.clues,
      correctCandidateId: fixture.correctCandidateId, source: fixture.source };
    expect(() => validateFramework(semantics)).not.toThrow();
    const mixed = fixture.candidates.map((candidate, index) => index > 0 || candidate.id === fixture.correctCandidateId ? candidate
      : { id: frameworkCandidateId("ember"), label: "Ember", detail: null });
    expect(() => validateFramework({ ...semantics, candidates: mixed })).toThrow();
    expect(() => validateFramework({ ...semantics, panes: [{ label: null, text: `${fixture.panes[0]!.text}\n// Vue` }] })).toThrow();
    expect(() => validateFramework({ ...semantics, clues: [fixture.clues[0]!, "Look for `nowhere(` in the code."] })).toThrow();
    expect(() => frameworkDeckRule(deck!.fixtures)).not.toThrow();
    const uneven = deck!.fixtures.map((round) => round.roundId === fixture.roundId ? round : { ...round,
      correctCandidateId: round.candidates.some(({ id }) => id === fixture.correctCandidateId) ? fixture.correctCandidateId : round.correctCandidateId });
    expect(() => frameworkDeckRule(uneven)).toThrow();
  });
});

describe("a declared licence (#62)", () => {
  const api = "https://api.github.com/repos/todo/examples";
  const web = "https://github.com/todo/examples";
  const repository = (license: unknown) => ({ full_name: "todo/examples", url: api, html_url: web, private: false, visibility: "public",
    disabled: false, archived: false, fork: false, license });
  const other = { key: "other", name: "Other", spdx_id: "NOASSERTION", url: null };
  const declared = FRAMEWORK_REPOSITORY.license;

  it("admits a repository GitHub names no licence for under the licence its pin declares, and nothing else", () => {
    expect(admitRepository(repository(other), "todo/examples", api, web, ["MIT"], declared)).toEqual({ licenseName: "MIT License", licenseSpdx: "MIT" });
    expect(() => admitRepository(repository(other), "todo/examples", api, web, ["MIT"])).toThrow();
    const mit = { key: "mit", name: "MIT License", spdx_id: "MIT", url: "https://api.github.com/licenses/mit" };
    // A declaration stands in only where GitHub names none.
    expect(() => admitRepository(repository(mit), "todo/examples", api, web, ["MIT"], declared)).toThrow();
    expect(() => admitRepository(repository(other), "todo/examples", api, web, ["Apache-2.0"], declared)).toThrow();
  });

  it("admits only the licence file the pin declares, byte for byte", () => {
    const text = "Everything in this repo is MIT License unless otherwise specified.\n";
    const bytes = Buffer.from(text);
    const blob = sha1(`blob ${bytes.byteLength}\0${text}`);
    const commit = FRAMEWORK_REPOSITORY.commit;
    const response = (sha: string) => ({ name: "license.md", path: "license.md", sha, type: "file",
      url: `${api}/contents/license.md?ref=${commit}`, html_url: `${web}/blob/${commit}/license.md`, git_url: `${api}/git/blobs/${sha}`,
      download_url: `https://raw.githubusercontent.com/todo/examples/${commit}/license.md`, license: other, encoding: "base64",
      size: bytes.byteLength, content: bytes.toString("base64") });
    const metadata = { licenseName: "MIT License", licenseSpdx: "MIT" };
    const policy = { profileVersion: "local-real-rounds.v5", profileHash: "a".repeat(64) };
    const target = { repository: "todo/examples", commit };
    expect(admitLicense(response(blob), metadata, target, policy, api, web, { ...declared, blob }).url).toBe(`${web}/blob/${commit}/license.md`);
    expect(() => admitLicense(response(blob), metadata, target, policy, api, web, declared)).toThrow();
  });
});
