import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { canonicalHash } from "./canonical";
import { parseCrawlProfile } from "./profile";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;
const modulePath: string = "./github-admission";
const admissionModule = await import(modulePath).catch(() => ({})) as Record<string, any>;
const admitGitHubCandidates = typeof admissionModule.admitGitHubCandidates === "function"
  ? admissionModule.admitGitHubCandidates
  : async (): Promise<never> => { throw new Error("GITHUB_ADMISSION_NOT_IMPLEMENTED"); };

const hash = (digit: string): string => digit.repeat(64);
const gitBlob = (bytes: Uint8Array): string => createHash("sha1")
  .update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const repository = "example/project";
const api = `https://api.github.com/repos/${repository}`;
const web = `https://github.com/${repository}`;
const childCommit = "c".repeat(40);
const parentCommit = "a".repeat(40);
const path = "src/value.ts";
const licenseBytes = new TextEncoder().encode("MIT License\n\nPermission is hereby granted.\n");
const licenseBlob = gitBlob(licenseBytes);

const profile = async () => parseCrawlProfile(JSON.parse(
  await readFile(new URL("../profiles/local-real-rounds.v2.json", import.meta.url), "utf8"),
));

const lineage = Object.freeze({
  queryId: "ordinary-change",
  queryIndex: 2,
  committerDate: "2026-07-30T10:00:00Z",
  repository,
  repositoryUrl: web,
  commit: childCommit,
  commitUrl: `${web}/commit/${childCommit}`,
  path,
  blob: "b".repeat(40),
  commitMessage: "Refine value",
  childCommit,
  childTree: "d".repeat(40),
  parentCommit,
  parentTree: "e".repeat(40),
  parentPath: path,
  childPath: path,
  parentMode: "100644",
  childMode: "100644",
  parentBlob: "9".repeat(40),
  childBlob: "b".repeat(40),
  parentRawContentHash: hash("1"),
  childRawContentHash: hash("2"),
  changedLineHash: hash("3"),
  excerpt: "export function value() {\n  return 2;\n}",
  excerptHash: hash("4"),
});

const repositoryResponse = (): Record<string, unknown> => ({
  full_name: repository,
  url: api,
  html_url: web,
  private: false,
  visibility: "public",
  disabled: false,
  archived: false,
  fork: false,
  license: {
    key: "mit",
    name: "MIT License",
    spdx_id: "MIT",
    url: "https://api.github.com/licenses/mit",
  },
});

const commitResponse = (): Record<string, unknown> => ({
  sha: childCommit,
  url: `${api}/commits/${childCommit}`,
  html_url: `${web}/commit/${childCommit}`,
  commit: {
    author: { name: "Ada Example", email: "discard@example.test", date: "2026-07-30T10:00:00Z" },
  },
  author: {
    login: "ada-example",
    url: "https://api.github.com/users/ada-example",
    html_url: "https://github.com/ada-example",
  },
});

const licenseResponse = (): Record<string, unknown> => ({
  name: "LICENSE",
  path: "LICENSE",
  sha: licenseBlob,
  size: licenseBytes.byteLength,
  url: `${api}/contents/LICENSE?ref=${childCommit}`,
  html_url: `${web}/blob/${childCommit}/LICENSE`,
  git_url: `${api}/git/blobs/${licenseBlob}`,
  download_url: `https://raw.githubusercontent.com/${repository}/${childCommit}/LICENSE`,
  type: "file",
  encoding: "base64",
  content: Buffer.from(licenseBytes).toString("base64"),
  license: {
    key: "mit",
    name: "MIT License",
    spdx_id: "MIT",
    url: "https://api.github.com/licenses/mit",
  },
});

const responses = (): Map<string, unknown> => new Map([
  [api, repositoryResponse()],
  [`${api}/commits/${childCommit}`, commitResponse()],
  [`${api}/license?ref=${childCommit}`, licenseResponse()],
]);

const mutableResponses = (): Map<string, any> => new Map(
  [...responses()].map(([url, value]) => [url, structuredClone(value)]),
);

const invoke = async (
  providerResponses: ReadonlyMap<string, unknown> = responses(),
  observed: Array<{ url: string; headers: Readonly<Record<string, string>> }> = [],
  profileHashOverride?: string,
) => {
  const parsedProfile = await profile();
  return admitGitHubCandidates({
    profile: parsedProfile,
    profileHash: profileHashOverride ?? canonicalHash(parsedProfile),
    crawlSnapshotId: hash("f"),
    candidates: [lineage],
    transport: { requestJson: async (request: {
      url: string;
      headers: Readonly<Record<string, string>>;
    }) => {
      observed.push(request);
      return structuredClone(providerResponses.get(request.url));
    } },
    retry: { execute: async (operation: () => Promise<unknown>) => operation() },
  });
};

describe("GitHub public repository admission", () => {

  it("decodes the provider's line-wrapped base64 licence content and rejects empty or non-string content", async () => {
    const wrapped = Buffer.from(licenseBytes).toString("base64").replace(/(.{60})/gu, "$1\n") + "\n";
    const providerResponses = mutableResponses();
    providerResponses.get(`${api}/license?ref=${childCommit}`).content = wrapped;
    const [admitted] = await invoke(providerResponses);
    expect(admitted.source.licenseSpdx).toBe("MIT");

    for (const content of ["", "   ", 42, null]) {
      const broken = mutableResponses();
      broken.get(`${api}/license?ref=${childCommit}`).content = content;
      await expect(invoke(broken)).rejects.toBeInstanceOf(admissionModule.GitHubAdmissionError);
    }
  });

  it("binds public metadata, pinned licence evidence, and selected-commit author", async () => {
    const requests: Array<{ url: string; headers: Readonly<Record<string, string>> }> = [];
    const output = await invoke(responses(), requests);

    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      admissionDecision: "AUTOMATED_POC_ADMISSION_ONLY",
      source: {
        discoverySource: "GITHUB_COMMIT_SEARCH",
        repository,
        repositoryUrl: web,
        authorName: "Ada Example",
        authorLogin: "ada-example",
        authorBasis: "SELECTED_COMMIT",
        authorSourceUrl: `${web}/commit/${childCommit}`,
        licenseName: "MIT License",
        licenseSpdx: "MIT",
        licenseFileUrl: `${web}/blob/${childCommit}/LICENSE`,
        commit: childCommit,
        blobUrl: `${web}/blob/${childCommit}/${path}`,
        profileVersion: "local-real-rounds.v2",
        crawlSnapshotId: hash("f"),
      },
    });
    expect(JSON.stringify(output)).not.toMatch(/discard@example|rights|legal decision|authored exclusively/iu);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output[0])).toBe(true);
    expect(Object.isFrozen(output[0].source)).toBe(true);
    expect(requests.map(({ url }) => url)).toEqual([
      api,
      `${api}/commits/${childCommit}`,
      `${api}/license?ref=${childCommit}`,
    ]);
    expect(requests.map(({ headers }) => headers)).toEqual(Array(3).fill({
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    }));
  });

  it("binds the licence bytes to both Git and raw identities", async () => {
    const output = await invoke();
    expect(output[0].source).toMatchObject({
      licenseFileUrl: `${web}/blob/${childCommit}/LICENSE`,
      licenseSpdx: "MIT",
    });
    expect(licenseBlob).toBe(gitBlob(licenseBytes));
    expect(sha256(licenseBytes)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it.each([
    ["private", (response: any) => { response.private = true; }],
    ["visibility", (response: any) => { response.visibility = "private"; }],
    ["disabled", (response: any) => { response.disabled = true; }],
    ["archived", (response: any) => { response.archived = true; }],
    ["fork", (response: any) => { response.fork = true; }],
    ["repository identity", (response: any) => { response.full_name = "example/other"; }],
    ["repository API URL", (response: any) => { response.url = `${api}/other`; }],
    ["repository HTML URL", (response: any) => { response.html_url = `${web}/other`; }],
  ])("rejects a %s repository state", async (
    _name: string,
    mutate: (response: any) => void,
  ) => {
    const providerResponses = mutableResponses();
    mutate(providerResponses.get(api));
    await expect(invoke(providerResponses)).rejects.toBeInstanceOf(admissionModule.GitHubAdmissionError);
  });

  it.each([
    ["missing", (providerResponses: Map<string, any>) => { providerResponses.get(api).license = null; }],
    ["unknown", (providerResponses: Map<string, any>) => {
      providerResponses.get(api).license.spdx_id = "NOASSERTION";
    }],
    ["absent SPDX", (providerResponses: Map<string, any>) => {
      providerResponses.get(api).license.spdx_id = null;
    }],
    ["disallowed", (providerResponses: Map<string, any>) => {
      providerResponses.get(api).license.spdx_id = "GPL-3.0";
    }],
    ["conflicting SPDX", (providerResponses: Map<string, any>) => {
      providerResponses.get(`${api}/license?ref=${childCommit}`).license.spdx_id = "Apache-2.0";
    }],
    ["conflicting name", (providerResponses: Map<string, any>) => {
      providerResponses.get(`${api}/license?ref=${childCommit}`).license.name = "Other License";
    }],
  ])("rejects %s licence metadata", async (
    _name: string,
    mutate: (providerResponses: Map<string, any>) => void,
  ) => {
    const providerResponses = mutableResponses();
    mutate(providerResponses);
    await expect(invoke(providerResponses)).rejects.toThrow();
  });

  it.each([
    ["name", (response: any) => { response.name = "COPYING"; }],
    ["path", (response: any) => { response.path = "COPYING"; }],
    ["blob", (response: any) => { response.sha = "0".repeat(40); }],
    ["size", (response: any) => { response.size += 1; }],
    ["contents URL", (response: any) => { response.url = `${api}/contents/LICENSE?ref=main`; }],
    ["HTML URL", (response: any) => { response.html_url = `${web}/blob/main/LICENSE`; }],
    ["Git URL", (response: any) => { response.git_url = `${api}/git/blobs/${"0".repeat(40)}`; }],
    ["raw URL", (response: any) => { response.download_url += "?mutable=true"; }],
    ["type", (response: any) => { response.type = "symlink"; }],
    ["encoding", (response: any) => { response.encoding = "utf-8"; }],
    ["base64", (response: any) => { response.content = "%%%"; }],
    ["Git object identity", (response: any) => {
      response.content = Buffer.from(new Uint8Array(licenseBytes.byteLength).fill(65)).toString("base64");
    }],
  ])("rejects a pinned licence %s mismatch", async (
    _name: string,
    mutate: (response: any) => void,
  ) => {
    const providerResponses = mutableResponses();
    mutate(providerResponses.get(`${api}/license?ref=${childCommit}`));
    await expect(invoke(providerResponses)).rejects.toThrow();
  });

  it.each([
    ["SHA", (response: any) => { response.sha = parentCommit; }],
    ["API URL", (response: any) => { response.url = `${api}/commits/${parentCommit}`; }],
    ["HTML URL", (response: any) => { response.html_url = `${web}/commit/${parentCommit}`; }],
    ["author missing", (response: any) => { response.commit.author = null; }],
    ["author blank", (response: any) => { response.commit.author.name = ""; }],
    ["login API URL", (response: any) => { response.author.url = "https://api.github.com/users/other"; }],
    ["login HTML URL", (response: any) => { response.author.html_url = "https://github.com/other"; }],
  ])("rejects a selected-commit %s mismatch", async (
    _name: string,
    mutate: (response: any) => void,
  ) => {
    const providerResponses = mutableResponses();
    mutate(providerResponses.get(`${api}/commits/${childCommit}`));
    await expect(invoke(providerResponses)).rejects.toBeInstanceOf(admissionModule.GitHubAdmissionError);
  });

  it("retains the public display name when GitHub has no linked login", async () => {
    const providerResponses = mutableResponses();
    providerResponses.get(`${api}/commits/${childCommit}`).author = null;
    const output = await invoke(providerResponses);
    expect(output[0].source.authorName).toBe("Ada Example");
    expect(output[0].source.authorLogin).toBeNull();
    expect(JSON.stringify(output)).not.toContain("discard@example.test");
  });

  it("rejects a profile hash that does not bind the supplied profile", async () => {
    await expect(invoke(responses(), [], hash("0"))).rejects
      .toBeInstanceOf(admissionModule.GitHubAdmissionError);
  });
});
