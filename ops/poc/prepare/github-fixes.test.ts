import { bindFixCommit, GitHubFixError, readDatasetBugs } from "./github-fixes";
import { GitHubAdmissionError } from "./github-admission";
import { gitBlob, licenseResponse, repositoryResponse, treeId, treeResponse, type TreeEntry } from "./testdata/captured-responses";
import { loadDeckProfile } from "./testdata/deck-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const repository = "calc/calc";
const api = `https://api.github.com/repos/${repository}`;
const web = `https://github.com/${repository}`;
const parent = "1".repeat(40);
const fixCommit = "2".repeat(40);
const path = "src/calc/Calc.java";
const before = "class Calc {\n  int twice(int x) {\n    return x * 3;\n  }\n}\n";
const after = "class Calc {\n  int twice(int x) {\n    return x * 2;\n  }\n}\n";
const fix = { path, buggyLine: "    return x * 3;", fixedLine: "    return x * 2;" };
const pointer = { dataset: "defects4j" as const, bug: "Calc-1", repository, language: "Java" as const, fixCommit, fix };
const profile = loadDeckProfile();

const contents = (text: string, ref: string) => {
  const bytes = Buffer.from(text);
  const sha = gitBlob(bytes);
  return { type: "file", path, encoding: "base64", sha, size: bytes.byteLength, content: bytes.toString("base64"),
    url: `${api}/contents/${path}?ref=${ref}`, git_url: `${api}/git/blobs/${sha}` };
};
const commitResponse = (overrides: Record<string, unknown> = {}) => ({
  sha: fixCommit, url: `${api}/commits/${fixCommit}`, html_url: `${web}/commit/${fixCommit}`,
  commit: { tree: { sha: "3".repeat(40), url: `${api}/git/trees/${"3".repeat(40)}` }, message: "Fix twice", author: { name: "Ada Lovelace" } },
  author: { login: "ada", type: "User", url: "https://api.github.com/users/ada", html_url: "https://github.com/ada" },
  parents: [{ sha: parent, url: `${api}/commits/${parent}`, html_url: `${web}/commit/${parent}` }],
  files: [{ filename: path, status: "modified", additions: 1, deletions: 1, sha: gitBlob(Buffer.from(after)) },
    { filename: "src/test/CalcTest.java", status: "modified", additions: 4, deletions: 0, sha: "4".repeat(40) }],
  ...overrides,
});

/** A fix commit, the file at it and at its parent, the repository, and the licence at the parent. */
const fakeGitHub = (overrides: ReadonlyMap<string, unknown> = new Map()) => {
  const http = new Map<string, unknown>([
    [api, repositoryResponse(repository)],
    [`${api}/commits/${fixCommit}`, commitResponse()],
    [`${api}/contents/${path}?ref=${fixCommit}`, contents(after, fixCommit)],
    [`${api}/contents/${path}?ref=${parent}`, contents(before, parent)],
    [`${api}/license?ref=${parent}`, licenseResponse(repository, parent)],
  ]);
  for (const [url, value] of overrides) http.set(url, value);
  const requests: string[] = [];
  return {
    requests,
    options: {
      profile, profileHash: "a".repeat(64), retry: { execute: <Value>(operation: () => Promise<Value>) => operation() },
      transport: { requestJson: async (input: { url: string }) => {
        requests.push(input.url);
        if (!http.has(input.url)) throw new Error(`unexpected request ${input.url}`);
        return structuredClone(http.get(input.url));
      } },
    } as any,
  };
};
const codeOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(() => "BOUND", (error: { code?: unknown }) => error instanceof GitHubFixError || error instanceof GitHubAdmissionError ? error.code : String(error));

describe("dataset fixes on GitHub", () => {
  it("binds a one-line fix to the file at the fix's parent, with the parent's licence and the fix's author", async () => {
    const github = fakeGitHub();
    const bound = await bindFixCommit(github.options, pointer);
    expect(bound).toMatchObject({ commit: parent, changedLine: 3, buggyBlob: gitBlob(Buffer.from(before)), fixBlob: gitBlob(Buffer.from(after)),
      licenseSpdx: "MIT", licenseFileUrl: `${web}/blob/${parent}/LICENSE`, author: { name: "Ada Lovelace", login: "ada" } });
    expect(Buffer.from(bound.bytes).toString()).toBe(before);
  });

  it("rejects a merge, a wider change, a different line, a tampered file, and an author who is a bot or an address", async () => {
    const cases: readonly (readonly [string, ReadonlyMap<string, unknown>, typeof pointer?])[] = [
      ["FIX_PARENT", new Map([[`${api}/commits/${fixCommit}`, commitResponse({ parents: [
        { sha: parent, url: `${api}/commits/${parent}`, html_url: `${web}/commit/${parent}` },
        { sha: "5".repeat(40), url: `${api}/commits/${"5".repeat(40)}`, html_url: `${web}/commit/${"5".repeat(40)}` }] })]])],
      ["FIX_CHANGE", new Map([[`${api}/commits/${fixCommit}`, commitResponse({ files: [{ filename: path, status: "modified", additions: 2, deletions: 1, sha: gitBlob(Buffer.from(after)) }] })]])],
      ["FIX_DIFF", new Map(), { ...pointer, fix: { ...fix, buggyLine: "    return x * 4;" } }],
      ["FIX_DIFF", new Map([[`${api}/contents/${path}?ref=${parent}`, contents(before.replace("class", "final class"), parent)]])],
      ["FIX_CONTENT", new Map([[`${api}/contents/${path}?ref=${parent}`, { ...contents(before, parent), sha: "6".repeat(40), git_url: `${api}/git/blobs/${"6".repeat(40)}` }]])],
      ["FIX_CONTENT", new Map([[`${api}/contents/${path}?ref=${fixCommit}`, contents(after.replace("2", "7"), fixCommit)]])],
      ["FIX_AUTHOR_AUTOMATED", new Map([[`${api}/commits/${fixCommit}`, commitResponse({ commit: { ...commitResponse().commit, author: { name: "renovate[bot]" } } })]])],
      ["ADMISSION_AUTHOR_CONTACT", new Map([[`${api}/commits/${fixCommit}`, commitResponse({ commit: { ...commitResponse().commit, author: { name: "ada@example.org" } } })]])],
    ];
    for (const [code, overrides, target] of cases) {
      expect(await codeOf(bindFixCommit(fakeGitHub(overrides).options, target ?? pointer))).toBe(code);
    }
  });

  it("lists BugsInPy's bugs from one recursive listing, checking every subtree against its hash", async () => {
    const datasetApi = "https://api.github.com/repos/bugs/bip";
    const blob = (text: string) => gitBlob(Buffer.from(text));
    const bug: TreeEntry[] = [
      { path: "bug.info", mode: "100644", type: "blob", sha: blob("info") },
      { path: "bug_patch.txt", mode: "100644", type: "blob", sha: blob("patch") },
    ];
    const bugs: TreeEntry[] = [{ path: "3", mode: "040000", type: "tree", sha: treeId(bug) }];
    const project: TreeEntry[] = [{ path: "bugs", mode: "040000", type: "tree", sha: treeId(bugs) }];
    const projects: TreeEntry[] = [{ path: "tool", mode: "040000", type: "tree", sha: treeId(project) },
      { path: "other", mode: "040000", type: "tree", sha: treeId(project) }];
    const root: TreeEntry[] = [{ path: "projects", mode: "040000", type: "tree", sha: treeId(projects) }];
    const recursive = (entries: readonly TreeEntry[]) => ({ sha: treeId(projects), url: `${datasetApi}/git/trees/${treeId(projects)}`, truncated: false,
      tree: entries.map((entry) => ({ ...entry, url: `${datasetApi}/git/${entry.type}s/${entry.sha}`, ...(entry.type === "blob" ? { size: 5 } : {}) })) });
    const listing = [...["tool", "other"].flatMap((name) => [
      { ...projects[0]!, path: name }, { ...project[0]!, path: `${name}/bugs` }, { ...bugs[0]!, path: `${name}/bugs/3` },
      { ...bug[0]!, path: `${name}/bugs/3/bug.info` }, { ...bug[1]!, path: `${name}/bugs/3/bug_patch.txt` }])];
    const pin = "7".repeat(40);
    const serve = (tree: unknown) => {
      const http = new Map<string, unknown>([
        [`${datasetApi}/commits/${pin}`, { sha: pin, url: `${datasetApi}/commits/${pin}`, html_url: `https://github.com/bugs/bip/commit/${pin}`,
          commit: { tree: { sha: treeId(root), url: `${datasetApi}/git/trees/${treeId(root)}` }, message: "Pin" }, parents: [], files: [] }],
        [`${datasetApi}/git/trees/${treeId(root)}`, treeResponse(datasetApi, treeId(root), root)],
        [`${datasetApi}/git/trees/${treeId(projects)}?recursive=1`, tree],
      ]);
      return { profile, retry: { execute: <Value>(operation: () => Promise<Value>) => operation() },
        transport: { requestJson: async ({ url }: { url: string }) => structuredClone(http.get(url) ?? (() => { throw new Error(url); })()) } } as any;
    };
    const dataset = { id: "bugsinpy" as const, repository: "bugs/bip", commit: pin, projects: [{ name: "tool", repository: "tool/tool", language: "Python" as const }] };
    expect(await readDatasetBugs(serve(recursive(listing)), dataset)).toEqual([{ dataset: "bugsinpy", project: "tool", bug: "tool-3",
      patchBlob: blob("patch"), patchSize: 5, revisionsBlob: blob("info") }]);
    // An entry whose blob does not belong to its directory's hash is caught.
    const tampered = listing.map((entry) => entry.path === "other/bugs/3/bug.info" ? { ...entry, sha: blob("forged") } : entry);
    expect(await codeOf(readDatasetBugs(serve(recursive(tampered)), dataset))).toBe("FIX_DATASET_TREE");
    expect(await codeOf(readDatasetBugs(serve({ ...recursive(listing), truncated: true }), dataset))).toBe("FIX_DATASET_TREE");
  });
});
