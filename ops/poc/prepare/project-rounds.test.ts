import { composeExperimentArtifact } from "./compose";
import { ExperimentRecordError, parseExperimentArtifact, sharedOptionWords } from "./model";
import { generateProjectRounds, namedByTemplates, optionDetail, projectRoundAllowed, ProjectRoundsError } from "./project-rounds";
import { MAINSTREAM_LANGUAGES } from "./profile";
import { composeInput, loadDeckProfile, projectRoundInputs, sha256, snapshotIdFor } from "./testdata/deck-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profile = loadDeckProfile();
const snapshotId = snapshotIdFor(profile);
const rounds = () => projectRoundInputs(profile, snapshotId);
const v6 = loadDeckProfile("local-real-rounds.v6");

describe("project rounds", () => {
  it("offers every round of a language the same four repositories, so none appears more often", () => {
    const { fixtures } = generateProjectRounds({ profile, rounds: rounds() });
    expect(fixtures).toHaveLength(24);
    const counts = new Map<string, number>();
    for (const fixture of fixtures) {
      expect(fixture.candidates).toHaveLength(4);
      expect(fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label).toBe(fixture.source.repository);
      for (const { label } of fixture.candidates) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    expect(new Set(counts.values())).toEqual(new Set([2]));
    for (const language of MAINSTREAM_LANGUAGES) {
      const sets = fixtures.filter(({ source }) => source.configuration === language)
        .map((fixture) => fixture.candidates.map(({ label }) => label).sort().join("|"));
      expect(new Set(sets).size).toBe(1);
    }
  });

  it("from profile v7 on, holds more rounds a language in groups of two, each group offering four repositories of its own (#167)", () => {
    const v7 = loadDeckProfile("local-real-rounds.v7", { projectRoundsPerLanguage: 4 });
    const inputs = projectRoundInputs(v7, snapshotIdFor(v7));
    const { fixtures } = generateProjectRounds({ profile: v7, rounds: inputs });
    expect(fixtures).toHaveLength(48);
    const optionsOf = (fixture: (typeof fixtures)[number]) => fixture.candidates.map(({ label }) => label).sort().join("|");
    for (const language of MAINSTREAM_LANGUAGES) {
      const sets = fixtures.filter(({ source }) => source.configuration === language).map(optionsOf);
      expect(sets).toHaveLength(4);
      // Two groups, each set offered by two rounds, and no repository in both.
      expect(new Set(sets).size).toBe(2);
      const [first, second] = [...new Set(sets)].map((set) => set.split("|"));
      expect(first!.some((repository) => second!.includes(repository))).toBe(false);
    }
    const counts = new Map<string, number>();
    for (const { label } of fixtures.flatMap(({ candidates }) => candidates)) counts.set(label, (counts.get(label) ?? 0) + 1);
    expect(new Set(counts.values())).toEqual(new Set([2]));
    const composed = composeExperimentArtifact(composeInput(v7));
    expect(composed.artifact.decks[0]!.fixtures).toHaveLength(48);
    // A round whose repository another group offers too would let counting find it.
    const shared = inputs.map((input, index) => index === 2
      ? { ...input, distractors: [inputs[0]!.distractors[1]!, ...input.distractors.slice(1)] } : input);
    expect(() => generateProjectRounds({ profile: v7, rounds: shared })).toThrow(ProjectRoundsError);
  });

  it("shows each option's description and hints at the file name and popularity", () => {
    const { fixtures } = generateProjectRounds({ profile, rounds: rounds() });
    const fixture = fixtures[0]!;
    expect(fixture.candidates.every(({ detail }) => typeof detail === "string" && detail.length > 0)).toBe(true);
    expect(fixture.clues[0]).toMatch(/^The file is named [A-Za-z]+\.[a-z]+\.$/u);
    expect(fixture.clues[1]).toMatch(/^Its repository has about [\d,]+ GitHub star events\.$/u);
    expect(fixture.evidence).toContain(String(fixture.source.repository));
  });

  it("keeps a round only when neither its code nor its file name names an option, and never a root-level file", () => {
    expect(projectRoundAllowed("const quasar = 1;", "src/a.py", ["orbitlabs/quasar"])).toBe(false);
    expect(projectRoundAllowed("const value = 1;", "src/orbitlabs.py", ["orbitlabs/quasar"])).toBe(false);
    expect(projectRoundAllowed("const value = 1;", "setup.py", ["orbitlabs/quasar"])).toBe(false);
    expect(projectRoundAllowed("const value = 1;", "src/a.py", ["orbitlabs/quasar"])).toBe(true);
    // A name inside an identifier gives the project away as surely as the name itself.
    expect(projectRoundAllowed("let deno_exe = path();", "src/a.rs", ["denoland/deno"])).toBe(false);
    expect(projectRoundAllowed("let x = denoLand();", "src/a.rs", ["denoland/deno"])).toBe(false);
    expect(projectRoundAllowed("let x = go_run();", "src/main.rs", ["golang/go"])).toBe(true);
    // A distinctive part of a hyphenated name gives it away; a language or a common word does not.
    expect(projectRoundAllowed("module GraphQL\n  module Tracing", "lib/a.rb", ["rmosolgo/graphql-ruby"])).toBe(false);
    expect(projectRoundAllowed("val view = LottieAnimationView(context)", "src/a.kt", ["airbnb/lottie-android"])).toBe(false);
    expect(projectRoundAllowed("class Tracing\n  def ruby_version; end", "lib/a.rb", ["rmosolgo/graphql-ruby"])).toBe(true);
    expect(projectRoundAllowed("// the core loop", "src/a.rs", ["tokio-rs/tokio-core"])).toBe(true);
    const leaking = rounds().map((round, index) => index === 0
      ? { ...round, distractors: [{ repository: "pkg/compute", description: null }, ...round.distractors.slice(1)] }
      : round);
    expect(() => generateProjectRounds({ profile, rounds: leaking })).toThrow(ProjectRoundsError);
  });

  it("finds the distinctive words a pane shares with an option's name and description (#77)", () => {
    // The three rounds #77 found, each echoing its own option.
    expect(sharedOptionWords("let client = Aws::SQS::Client.new(region: 'us-west-2')", "awsdocs/aws-doc-sdk-examples",
      "Welcome to the AWS Code Examples Repository.")).toEqual(["aws"]);
    expect(sharedOptionWords("pub enum Utility {\n    Static(Static),\n}", "tailwindlabs/tailwindcss",
      "A utility-first CSS framework for rapid UI development.")).toEqual(["utili"]);
    expect(sharedOptionWords("class Layout extends React.Component {", "gatsbyjs/gatsby",
      "React-based framework with performance, scalability, and security built in.")).toEqual(["react"]);
    // Common code and English words, short words, and numbers tie a pane to nothing.
    expect(sharedOptionWords("for (const item of items) return value + 10;", "orbitlabs/quasar", "A tool for the items you return in 10 ms.")).toEqual([]);
  });

  it("from profile v6 on, refuses a round whose code shares a word with any option, and v5 does not (#77)", () => {
    const v6Rounds = () => projectRoundInputs(v6, snapshotIdFor(v6));
    expect(generateProjectRounds({ profile: v6, rounds: v6Rounds() }).fixtures).toHaveLength(24);
    // A decoy whose description names something the first round's code does.
    const echoing = (inputs: ReturnType<typeof rounds>) => inputs.map((round, index) => index === 0
      ? { ...round, candidate: { ...round.candidate, excerpt: `${round.candidate.excerpt}\nharvest_crop()`,
        excerptHash: sha256(`${round.candidate.excerpt}\nharvest_crop()`) },
        distractors: [{ ...round.distractors[0]!, description: "Harvests every crop." }, ...round.distractors.slice(1)] }
      : round);
    expect(() => generateProjectRounds({ profile: v6, rounds: echoing(v6Rounds()) })).toThrow("PROJECT_WORDS_SHOWN");
    expect(generateProjectRounds({ profile, rounds: echoing(rounds()) }).fixtures).toHaveLength(24);
  });

  it("parses a v6 project round only when its pane names no option, even inside a word, and shares no word with one (#77)", () => {
    const composed = new Map([profile, v6].map((from) => [from, composeExperimentArtifact(composeInput(from)).artifact] as const));
    const artifact = (from: typeof profile): any => structuredClone(composed.get(from));
    const withPane = (value: any, extra: (fixture: any) => string, detail?: string) => {
      const fixture = value.decks.find(({ id }: any) => id === "project").fixtures[0];
      fixture.panes[0].text = `${fixture.panes[0].text}\n${extra(fixture)}`;
      fixture.source.excerptHash = sha256(fixture.panes[0].text);
      if (detail !== undefined) fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId).detail = detail;
      return value;
    };
    const decoyName = (fixture: any) => fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId).label.split("/")[1];
    // `Aws::SQS` beside a decoy that reads "AWS"; a decoy's name inside an identifier.
    const aws = (value: any) => withPane(value, () => "client = Aws::SQS::Client.new", "Welcome to the AWS Code Examples Repository.");
    const inside = (value: any) => withPane(value, (fixture) => `run_${decoyName(fixture)}_job()`);
    expect(() => parseExperimentArtifact(artifact(v6))).not.toThrow();
    for (const mutate of [aws, inside]) {
      expect(() => parseExperimentArtifact(mutate(artifact(v6)))).toThrow(ExperimentRecordError);
      expect(() => parseExperimentArtifact(mutate(artifact(profile)))).not.toThrow();
    }
  });

  it("never offers a repository the deck's own wording names", () => {
    // The popularity hint says "GitHub star events", so `github/…` could never be an option.
    expect(namedByTemplates(profile, "github/linguist")).toBe(true);
    expect(namedByTemplates(profile, "orbitlabs/quasar")).toBe(false);
    const named = rounds().map((round, index) => index === 0
      ? { ...round, distractors: [{ repository: "github/docs", description: null }, ...round.distractors.slice(1)] }
      : round);
    expect(() => generateProjectRounds({ profile, rounds: named })).toThrow(ProjectRoundsError);
  });

  it("trims descriptions to one short line and drops empty ones", () => {
    expect(optionDetail("  A   web\\nframework  ")).toBe("A web\\nframework");
    expect(optionDetail("   ")).toBeNull();
    expect(optionDetail(null)).toBeNull();
    expect(optionDetail("x".repeat(400))!.length).toBe(160);
  });

  it("rejects a pool of the wrong size or a repeated repository", () => {
    expect(() => generateProjectRounds({ profile, rounds: rounds().slice(0, 9) })).toThrow(ProjectRoundsError);
    const repeated = rounds().map((round, index) => index === 1 ? { ...round, candidate: rounds()[0]!.candidate } : round);
    expect(() => generateProjectRounds({ profile, rounds: repeated })).toThrow(ProjectRoundsError);
  });
});
