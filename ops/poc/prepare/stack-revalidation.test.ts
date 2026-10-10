import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { canonicalHash } from "./canonical";
import { parseCrawlProfile } from "./profile";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;
const sourcePath: string = "./stack-revalidation";
const sourceModule = await import(sourcePath).catch(() => ({})) as Record<string, any>;
const revalidateStackCandidate = typeof sourceModule.revalidateStackCandidate === "function"
  ? sourceModule.revalidateStackCandidate
  : async (): Promise<never> => { throw new Error("STACK_REVALIDATION_NOT_IMPLEMENTED"); };

const repository = "example/project";
const api = `https://api.github.com/repos/${repository}`;
const web = `https://github.com/${repository}`;
const commit = "c".repeat(40);
const path = "example.py";
const content = Buffer.from([
  "def compute(value):",
  "    return value + 1",
  "",
  "def format_value(value):",
  "    return f\"value={compute(value)}\"",
  "",
].join("\n"));
const licenseBytes = Buffer.from("MIT License\n\nPermission is hereby granted.\n");
const rawSha1 = (bytes: Uint8Array): string => createHash("sha1").update(bytes).digest("hex");
const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const gitObject = (kind: "blob" | "tree", bytes: Uint8Array): string => createHash("sha1")
  .update(`${kind} ${bytes.byteLength}\0`).update(bytes).digest("hex");
const blob = gitObject("blob", content);
const licenseBlob = gitObject("blob", licenseBytes);

const treeIdentity = (entries: readonly { path: string; mode: string; type: string; sha: string }[]): string => {
  const values = [...entries].sort((left, right) => left.path.localeCompare(right.path)).map((entry) =>
    Buffer.concat([Buffer.from(`${entry.mode === "040000" ? "40000" : entry.mode} ${entry.path}\0`),
      Buffer.from(entry.sha, "hex")]));
  return gitObject("tree", Buffer.concat(values));
};
const rootEntries = [{ path, mode: "100644", type: "blob", sha: blob }];
const rootTree = treeIdentity(rootEntries);
const profile = async () => parseCrawlProfile(JSON.parse(await readFile(
  new URL("../profiles/local-real-rounds.v2.json", import.meta.url), "utf8",
)));

const row = (overrides: Record<string, unknown> = {}) => {
  const fields = {
    swhBlobId: rawSha1(content),
    swhContentId: blob,
    swhDirectoryId: "d".repeat(40),
    swhSnapshotId: "e".repeat(40),
    swhRevisionId: commit,
    repository,
    path,
    detectedLicenses: ["MIT"],
    detectedLanguage: "Python",
    generated: false,
    vendor: false,
    sourceEncoding: "UTF-8",
    byteLength: content.byteLength,
    visitDate: "2023-09-06T10:44:38Z",
    revisionDate: "2023-09-05T09:30:00Z",
    committerDate: "2023-09-05T09:30:00Z",
    ...overrides,
  };
  return {
    stableRowId: sha256(JSON.stringify(Object.fromEntries(Object.entries(fields).sort()))),
    ...fields,
  };
};
const selected = (overrides: Record<string, unknown> = {}) => ({
  stableRowId: row().stableRowId,
  swhBlobId: rawSha1(content),
  contentBase64: content.toString("base64"),
  byteLength: content.byteLength,
  ...overrides,
});

const repositoryResponse = () => ({
  full_name: repository, url: api, html_url: web, private: false, visibility: "public",
  disabled: false, archived: false, fork: false,
  license: { key: "mit", name: "MIT License", spdx_id: "MIT", url: "https://api.github.com/licenses/mit" },
});
const commitResponse = () => ({
  sha: commit, url: `${api}/commits/${commit}`, html_url: `${web}/commit/${commit}`,
  commit: {
    tree: { sha: rootTree, url: `${api}/git/trees/${rootTree}` },
    author: { name: "Ada Example", email: "discard@example.test" },
  },
  author: {
    login: "ada-example", url: "https://api.github.com/users/ada-example",
    html_url: "https://github.com/ada-example",
  },
});
const treeResponse = () => ({
  sha: rootTree, url: `${api}/git/trees/${rootTree}`, truncated: false,
  tree: rootEntries.map((entry) => ({ ...entry, url: `${api}/git/blobs/${entry.sha}` })),
});
const blobResponse = (bytes = content) => ({
  sha: blob, url: `${api}/git/blobs/${blob}`, encoding: "base64", size: bytes.byteLength,
  content: Buffer.from(bytes).toString("base64"),
});
const licenseResponse = () => ({
  name: "LICENSE", path: "LICENSE", sha: licenseBlob, size: licenseBytes.byteLength,
  url: `${api}/contents/LICENSE?ref=${commit}`,
  html_url: `${web}/blob/${commit}/LICENSE`, git_url: `${api}/git/blobs/${licenseBlob}`,
  download_url: `https://raw.githubusercontent.com/${repository}/${commit}/LICENSE`,
  type: "file", encoding: "base64", content: licenseBytes.toString("base64"),
  license: { key: "mit", name: "MIT License", spdx_id: "MIT", url: "https://api.github.com/licenses/mit" },
});
const responses = () => new Map<string, any>([
  [api, repositoryResponse()],
  [`${api}/commits/${commit}`, commitResponse()],
  [`${api}/git/trees/${rootTree}`, treeResponse()],
  [`${api}/git/blobs/${blob}`, blobResponse()],
  [`${api}/license?ref=${commit}`, licenseResponse()],
]);
const alternateScenario = (
  bytes: Buffer,
  filePath: string,
  language: "Python" | "TypeScript",
) => {
  const alternateBlob = gitObject("blob", bytes);
  const entries = [{ path: filePath, mode: "100644", type: "blob", sha: alternateBlob }];
  const alternateTree = treeIdentity(entries);
  const metadata = row({
    swhBlobId: rawSha1(bytes), swhContentId: alternateBlob, path: filePath,
    detectedLanguage: language, byteLength: bytes.byteLength,
  });
  const selectedBlob = selected({
    stableRowId: metadata.stableRowId, swhBlobId: rawSha1(bytes),
    contentBase64: bytes.toString("base64"), byteLength: bytes.byteLength,
  });
  const values = responses();
  values.get(`${api}/commits/${commit}`).commit.tree = {
    sha: alternateTree, url: `${api}/git/trees/${alternateTree}`,
  };
  values.delete(`${api}/git/trees/${rootTree}`);
  values.delete(`${api}/git/blobs/${blob}`);
  values.set(`${api}/git/trees/${alternateTree}`, {
    sha: alternateTree, url: `${api}/git/trees/${alternateTree}`, truncated: false,
    tree: entries.map((entry) => ({ ...entry, url: `${api}/git/blobs/${entry.sha}` })),
  });
  values.set(`${api}/git/blobs/${alternateBlob}`, {
    sha: alternateBlob, url: `${api}/git/blobs/${alternateBlob}`, encoding: "base64",
    size: bytes.byteLength, content: bytes.toString("base64"),
  });
  return { values, metadata, selectedBlob };
};

const invoke = async (
  providerResponses = responses(),
  metadata: Record<string, unknown> = row(),
  selectedBlob: Record<string, unknown> = selected(),
  requests: string[] = [],
  observed: any[] = [],
  optionOverrides: Record<string, unknown> = {},
) => {
  const parsedProfile = await profile();
  return revalidateStackCandidate({
    profile: parsedProfile,
    profileHash: canonicalHash(parsedProfile),
    crawlSnapshotId: "f".repeat(64),
    metadata,
    selectedBlob,
    transport: { requestJson: async (request: { url: string }) => {
      const { url } = request;
      requests.push(url);
      observed.push(request);
      return structuredClone(providerResponses.get(url));
    } },
    retry: { execute: async (operation: () => Promise<unknown>) => operation() },
    ...optionOverrides,
  });
};

describe("Stack candidate GitHub revalidation", () => {

  it("decodes the provider's line-wrapped base64 for GitHub blobs and licence files", async () => {
    const wrap = (value: string) => value.replace(/(.{60})/gu, "$1\n") + "\n";
    const values = responses();
    values.get(`${api}/git/blobs/${blob}`).content = wrap(values.get(`${api}/git/blobs/${blob}`).content);
    values.get(`${api}/license?ref=${commit}`).content = wrap(values.get(`${api}/license?ref=${commit}`).content);
    const result = await invoke(values);
    expect(result.discoverySource).toBe("STACK_V2");
    for (const broken of ["", " \n", 7]) {
      const bad = responses();
      bad.get(`${api}/git/blobs/${blob}`).content = broken;
      await expect(invoke(bad)).rejects.toThrow("STACK_REVALIDATION_REJECTED");
    }
  });

  it("binds exact Stack bytes to a public pinned GitHub source and retains only a screened excerpt", async () => {
    const requests: string[] = [];
    const output = await invoke(responses(), row(), selected(), requests);

    expect(output).toMatchObject({
      discoverySource: "STACK_V2",
      repository,
      repositoryUrl: web,
      authorName: "Ada Example",
      authorLogin: "ada-example",
      authorBasis: "SELECTED_COMMIT",
      authorSourceUrl: `${web}/commit/${commit}`,
      path,
      blob,
      commit,
      commitUrl: `${web}/commit/${commit}`,
      blobUrl: `${web}/blob/${commit}/${path}`,
      licenseName: "MIT License",
      licenseSpdx: "MIT",
      licenseFileUrl: `${web}/blob/${commit}/LICENSE`,
      rawContentHash: sha256(content),
      excerpt: content.toString("utf8").replace(/\n+$/u, ""),
      stackRelease: "v2.2.0",
      stackRevision: "e565caa3a78c2423bd374333a472b049eb090e47",
      configuration: "Python",
      swhBlobId: rawSha1(content),
      swhContentId: blob,
    });
    expect(output).not.toHaveProperty("contentBase64");
    expect(output).not.toHaveProperty("rawBytes");
    expect(JSON.stringify(output)).not.toContain("discard@example.test");
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.detectedLicenses)).toBe(true);
    expect(requests).toEqual([
      api,
      `${api}/commits/${commit}`,
      `${api}/git/trees/${rootTree}`,
      `${api}/git/blobs/${blob}`,
      `${api}/license?ref=${commit}`,
    ]);
  });

  it("sends exact bounded GitHub requests and returns every Stack source field", async () => {
    const observed: any[] = [];
    const output = await invoke(responses(), row(), selected(), [], observed);
    expect(observed).toHaveLength(5);
    expect(observed).toEqual(observed.map(({ url }) => ({
      provider: "github",
      method: "GET",
      url,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    })));
    expect(output).toMatchObject({
      profileVersion: "local-real-rounds.v2",
      crawlSnapshotId: "f".repeat(64),
      excerptHash: sha256(content.toString("utf8").replace(/\n+$/u, "")),
      stableRowId: row().stableRowId,
      swhDirectoryId: "d".repeat(40),
      swhSnapshotId: "e".repeat(40),
      swhRevisionId: commit,
      stackRepository: repository,
      stackPath: path,
      detectedLicenses: ["MIT"],
      detectedLanguage: "Python",
      generated: false,
      vendor: false,
      sourceEncoding: "UTF-8",
      byteLength: content.byteLength,
      visitDate: "2023-09-06T10:44:38Z",
      revisionDate: "2023-09-05T09:30:00Z",
      committerDate: "2023-09-05T09:30:00Z",
    });
  });

  it("rejects nonexact metadata and valid-canonical wrong selected bytes before GitHub", async () => {
    const extraMetadata = row({ extra: true });
    const sameLengthWrong = Buffer.alloc(content.byteLength, 120);
    for (const [metadata, selectedBlob] of [
      [extraMetadata, selected({ stableRowId: extraMetadata.stableRowId })],
      [row(), selected({ contentBase64: sameLengthWrong.toString("base64") })],
      [row(), selected({ contentBase64: content.toString("base64").replace(/.{20}/u, "$&\n") })],
      ...[
        { swhDirectoryId: "bad" }, { swhSnapshotId: "A".repeat(40) },
        { visitDate: "2023-02-30T00:00:00Z" }, { revisionDate: "bad" },
        { committerDate: "bad" }, { repository: "not-a-repository" }, { path: "../example.py" },
      ].map((override) => {
        const metadata = row(override);
        return [metadata, selected({ stableRowId: metadata.stableRowId })];
      }),
    ]) {
      const requests: string[] = [];
      await expect(invoke(responses(), metadata, selectedBlob, requests)).rejects.toThrow();
      expect(requests).toEqual([]);
    }
  });

  it("resolves a nested path through exact trees", async () => {
    const childEntries = [{ path, mode: "100644", type: "blob", sha: blob }];
    const childTree = treeIdentity(childEntries);
    const nestedEntries = [{ path: "src", mode: "040000", type: "tree", sha: childTree }];
    const nestedRoot = treeIdentity(nestedEntries);
    const metadata = row({ path: `src/${path}` });
    const selectedBlob = selected({ stableRowId: metadata.stableRowId });
    const values = responses();
    values.get(`${api}/commits/${commit}`).commit.tree = {
      sha: nestedRoot, url: `${api}/git/trees/${nestedRoot}`,
    };
    values.delete(`${api}/git/trees/${rootTree}`);
    values.set(`${api}/git/trees/${nestedRoot}`, {
      sha: nestedRoot, url: `${api}/git/trees/${nestedRoot}`, truncated: false,
      tree: nestedEntries.map((entry) => ({ ...entry, url: `${api}/git/trees/${entry.sha}` })),
    });
    values.set(`${api}/git/trees/${childTree}`, {
      sha: childTree, url: `${api}/git/trees/${childTree}`, truncated: false,
      tree: childEntries.map((entry) => ({ ...entry, url: `${api}/git/blobs/${entry.sha}` })),
    });
    await expect(invoke(values, metadata, selectedBlob)).resolves.toMatchObject({ path: `src/${path}` });
  });

  it("accepts TypeScript extension agreement and a null GitHub login", async () => {
    const bytes = Buffer.from("export function compute(value: number) {\n  return value + 1;\n}\n".repeat(2));
    const scenario = alternateScenario(bytes, "example.ts", "TypeScript");
    scenario.values.get(`${api}/commits/${commit}`).author = null;
    await expect(invoke(scenario.values, scenario.metadata, scenario.selectedBlob)).resolves.toMatchObject({
      detectedLanguage: "TypeScript",
      configuration: "TypeScript",
      authorLogin: null,
    });
  });

  it("accepts unique allowed Stack licences when the GitHub SPDX is included", async () => {
    const metadata = row({ detectedLicenses: ["MIT", "Apache-2.0"] });
    await expect(invoke(responses(), metadata, selected({ stableRowId: metadata.stableRowId })))
      .resolves.toMatchObject({ detectedLicenses: ["MIT", "Apache-2.0"], licenseSpdx: "MIT" });
  });

  it("enforces screening deduplication and bounded nonempty excerpts", async () => {
    await expect(invoke(responses(), row(), selected(), [], [], {
      seenNormalizedHashes: new Set([sha256(content)]),
    })).rejects.toThrow();

    const longBytes = Buffer.from(
      "def compute(value):\n    return value + 1\n".repeat(140) + "def tail_only_marker():\n    return 9\n",
    );
    const long = alternateScenario(longBytes, path, "Python");
    const output = await invoke(long.values, long.metadata, long.selectedBlob);
    expect(Buffer.byteLength(output.excerpt)).toBeLessThanOrEqual(4096);
    expect(output.excerpt.split("\n").length).toBeLessThanOrEqual(20);
    expect(output.excerpt).not.toContain("tail_only_marker");

    const shortBytes = Buffer.from("def x():\n    return 1\n");
    const short = alternateScenario(shortBytes, path, "Python");
    await expect(invoke(short.values, short.metadata, short.selectedBlob)).rejects.toThrow();

    const vendor = alternateScenario(content, `vendor/${path}`, "Python");
    await expect(invoke(vendor.values, vendor.metadata, vendor.selectedBlob)).rejects.toThrow();

    for (const unsafe of [
      Buffer.from("def x():\n    api_key = 'abcdefghijk-secret'\n    return api_key\n"),
      Buffer.from("def x():\n    return 'person@example.test'\n"),
      Buffer.from("# Code generated automatically; do not edit\ndef x():\n    return 1\n"),
    ]) {
      const scenario = alternateScenario(unsafe, path, "Python");
      await expect(invoke(scenario.values, scenario.metadata, scenario.selectedBlob)).rejects.toThrow();
    }
  });

  it("rejects Stack metadata and selected-blob identity mismatches before GitHub", async () => {
    for (const [metadata, selectedBlob] of [
      [row({ generated: true }), selected()],
      [row({ vendor: true }), selected()],
      [row({ detectedLanguage: "TypeScript" }), selected()],
      [row(), selected({ stableRowId: "a".repeat(64) })],
      [row(), selected({ swhBlobId: "a".repeat(40) })],
      [row(), selected({ byteLength: content.byteLength + 1 })],
      [row(), selected({ contentBase64: "%%%" })],
    ]) {
      const requests: string[] = [];
      await expect(invoke(responses(), metadata, selectedBlob, requests)).rejects.toThrow();
      expect(requests).toEqual([]);
    }
  });

  it.each([
    ["private", (values: Map<string, any>) => { values.get(api).private = true; }],
    ["disabled", (values: Map<string, any>) => { values.get(api).disabled = true; }],
    ["archived", (values: Map<string, any>) => { values.get(api).archived = true; }],
    ["fork", (values: Map<string, any>) => { values.get(api).fork = true; }],
    ["repository", (values: Map<string, any>) => { values.get(api).full_name = "example/other"; }],
    ["redirect", (values: Map<string, any>) => { values.get(api).html_url = "https://example.test/project"; }],
    ["missing", (values: Map<string, any>) => { values.delete(api); }],
  ])("rejects a %s repository", async (_name: string, mutate: (values: Map<string, any>) => void) => {
    const values = responses();
    mutate(values);
    await expect(invoke(values)).rejects.toThrow();
  });

  it.each([
    ["revision", (values: Map<string, any>) => { values.get(`${api}/commits/${commit}`).sha = "a".repeat(40); }],
    ["commit URL", (values: Map<string, any>) => { values.get(`${api}/commits/${commit}`).html_url += "/redirect"; }],
    ["tree binding", (values: Map<string, any>) => { values.get(`${api}/commits/${commit}`).commit.tree.sha = "a".repeat(40); }],
    ["tree identity", (values: Map<string, any>) => { values.get(`${api}/git/trees/${rootTree}`).sha = "a".repeat(40); }],
    ["tree URL", (values: Map<string, any>) => { values.get(`${api}/git/trees/${rootTree}`).url += "/redirect"; }],
    ["tree entry shape", (values: Map<string, any>) => { values.get(`${api}/git/trees/${rootTree}`).tree[0].extra = true; }],
    ["tree entry URL", (values: Map<string, any>) => { values.get(`${api}/git/trees/${rootTree}`).tree[0].url += "/redirect"; }],
    ["truncated tree", (values: Map<string, any>) => { values.get(`${api}/git/trees/${rootTree}`).truncated = true; }],
    ["renamed path", (values: Map<string, any>) => { values.get(`${api}/git/trees/${rootTree}`).tree[0].path = "renamed.py"; }],
    ["symlink", (values: Map<string, any>) => { values.get(`${api}/git/trees/${rootTree}`).tree[0].mode = "120000"; }],
    ["blob binding", (values: Map<string, any>) => { values.get(`${api}/git/trees/${rootTree}`).tree[0].sha = "a".repeat(40); }],
    ["blob identity", (values: Map<string, any>) => { values.get(`${api}/git/blobs/${blob}`).sha = "a".repeat(40); }],
    ["blob URL", (values: Map<string, any>) => { values.get(`${api}/git/blobs/${blob}`).url += "/redirect"; }],
    ["blob encoding", (values: Map<string, any>) => { values.get(`${api}/git/blobs/${blob}`).encoding = "utf-8"; }],
    ["blob size", (values: Map<string, any>) => { values.get(`${api}/git/blobs/${blob}`).size += 1; }],
    ["GitHub bytes", (values: Map<string, any>) => {
      values.set(`${api}/git/blobs/${blob}`, blobResponse(Buffer.alloc(content.byteLength, 120)));
    }],
    ["missing author", (values: Map<string, any>) => {
      values.get(`${api}/commits/${commit}`).commit.author.name = "";
    }],
    ["author login", (values: Map<string, any>) => {
      values.get(`${api}/commits/${commit}`).author.html_url = "https://github.com/other";
    }],
  ])("rejects a %s mismatch", async (_name: string, mutate: (values: Map<string, any>) => void) => {
    const values = responses();
    mutate(values);
    await expect(invoke(values)).rejects.toThrow();
  });

  it.each([
    ["repository licence", (values: Map<string, any>) => { values.get(api).license.spdx_id = "GPL-3.0"; }],
    ["Stack licence", (_values: Map<string, any>, metadata: any) => { metadata.detectedLicenses = ["Apache-2.0"]; }],
    ["licence metadata", (values: Map<string, any>) => {
      values.get(`${api}/license?ref=${commit}`).license.spdx_id = "Apache-2.0";
    }],
    ["licence path", (values: Map<string, any>) => { values.get(`${api}/license?ref=${commit}`).path = "COPYING"; }],
    ["licence key", (values: Map<string, any>) => { values.get(`${api}/license?ref=${commit}`).license.key = "other"; }],
    ["licence API URL", (values: Map<string, any>) => {
      values.get(`${api}/license?ref=${commit}`).license.url = "https://api.github.com/licenses/other";
    }],
    ["licence raw URL", (values: Map<string, any>) => {
      values.get(`${api}/license?ref=${commit}`).download_url += "?redirect=true";
    }],
    ["licence bytes", (values: Map<string, any>) => {
      values.get(`${api}/license?ref=${commit}`).content = Buffer.from("different").toString("base64");
    }],
  ])("rejects a %s mismatch", async (
    _name: string,
    mutate: (values: Map<string, any>, metadata: any) => void,
  ) => {
    const values = responses();
    const metadata = structuredClone(row());
    mutate(values, metadata);
    await expect(invoke(values, metadata)).rejects.toThrow();
  });
});
