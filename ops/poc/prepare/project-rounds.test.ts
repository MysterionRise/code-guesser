import { generateProjectRounds, optionDetail, projectRoundAllowed, ProjectRoundsError } from "./project-rounds";
import { STACK_LANGUAGES } from "./profile";
import { loadV3Profile, projectRoundInputs, snapshotIdFor } from "./testdata/v3-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profile = loadV3Profile();
const snapshotId = snapshotIdFor(profile);
const rounds = () => projectRoundInputs(profile, snapshotId);

describe("project rounds v3", () => {
  it("offers every round of a language the same four repositories, so none appears more often", () => {
    const { fixtures } = generateProjectRounds({ profile, rounds: rounds() });
    expect(fixtures).toHaveLength(10);
    const counts = new Map<string, number>();
    for (const fixture of fixtures) {
      expect(fixture.candidates).toHaveLength(4);
      expect(fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label).toBe(fixture.source.repository);
      for (const { label } of fixture.candidates) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    expect(new Set(counts.values())).toEqual(new Set([2]));
    for (const language of STACK_LANGUAGES) {
      const sets = fixtures.filter(({ source }) => source.configuration === language)
        .map((fixture) => fixture.candidates.map(({ label }) => label).sort().join("|"));
      expect(new Set(sets).size).toBe(1);
    }
  });

  it("shows each option's description and hints at the file name and popularity", () => {
    const { fixtures } = generateProjectRounds({ profile, rounds: rounds() });
    const fixture = fixtures[0]!;
    expect(fixture.candidates.every(({ detail }) => typeof detail === "string" && detail.length > 0)).toBe(true);
    expect(fixture.clues[0]).toMatch(/^The file is named [a-z]+\.[a-z]+\.$/u);
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
    const leaking = rounds().map((round, index) => index === 0
      ? { ...round, distractors: [{ repository: "pkg/compute", description: null }, ...round.distractors.slice(1)] }
      : round);
    expect(() => generateProjectRounds({ profile, rounds: leaking })).toThrow(ProjectRoundsError);
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
