import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parseCrawlProfile } from "./profile";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;
const modulePath: string = "./github-lineage";
const lineageModule = await import(modulePath).catch(() => ({})) as Record<string, any>;
const bindGitHubLineage = typeof lineageModule.bindGitHubLineage === "function"
  ? lineageModule.bindGitHubLineage
  : async (): Promise<never> => { throw new Error("GITHUB_LINEAGE_NOT_IMPLEMENTED"); };

const gitBlob = (bytes: Uint8Array): string => createHash("sha1")
  .update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
const gitTree = (entries: readonly { mode: string; path: string; sha: string }[]): string => {
  const bytes = [...entries].sort((left, right) => left.path.localeCompare(right.path)).map((entry) => Buffer.concat([
    Buffer.from(`${entry.mode} ${entry.path}\0`),
    Buffer.from(entry.sha, "hex"),
  ]));
  return createHash("sha1").update(`tree ${Buffer.concat(bytes).byteLength}\0`)
    .update(Buffer.concat(bytes)).digest("hex");
};
const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const ids = {
  childCommit: "c".repeat(40),
  parentCommit: "a".repeat(40),
};
const encoder = new TextEncoder();
const parentBytes = encoder.encode("export function value() {\n  return 1;\n}\n");
const childBytes = encoder.encode("export function value() {\n  return 2;\n}\n");
const parentBlob = gitBlob(parentBytes);
const childBlob = gitBlob(childBytes);
const parentSourceTree = gitTree([{ mode: "100644", path: "value.ts", sha: parentBlob }]);
const childSourceTree = gitTree([{ mode: "100644", path: "value.ts", sha: childBlob }]);
const parentTree = gitTree([{ mode: "40000", path: "src", sha: parentSourceTree }]);
const childTree = gitTree([{ mode: "40000", path: "src", sha: childSourceTree }]);
const repository = "example/project";
const api = `https://api.github.com/repos/${repository}`;
const web = `https://github.com/${repository}`;

const commitResponse = (
  commit: string,
  tree: string,
  parents: readonly string[],
  files: readonly Record<string, unknown>[],
): Record<string, unknown> => ({
  sha: commit,
  url: `${api}/commits/${commit}`,
  html_url: `${web}/commit/${commit}`,
  commit: { message: "Refine value", tree: { sha: tree, url: `${api}/git/trees/${tree}` } },
  parents: parents.map((sha) => ({
    sha,
    url: `${api}/commits/${sha}`,
    html_url: `${web}/commit/${sha}`,
  })),
  files,
});

const treeResponse = (
  sha: string,
  entries: readonly { mode: string; path: string; type: string; sha: string }[],
): Record<string, unknown> => ({
  sha,
  url: `${api}/git/trees/${sha}`,
  truncated: false,
  tree: entries.map((entry) => ({ ...entry, url: `${api}/git/${entry.type}s/${entry.sha}` })),
});

const blobResponse = (sha: string, bytes: Uint8Array): Record<string, unknown> => ({
  sha,
  url: `${api}/git/blobs/${sha}`,
  encoding: "base64",
  size: bytes.byteLength,
  content: Buffer.from(bytes).toString("base64"),
});

const profile = async () => parseCrawlProfile(JSON.parse(
  await readFile(new URL("../profiles/local-real-rounds.v1.json", import.meta.url), "utf8"),
));

const validResponses = (): ReadonlyMap<string, unknown> => new Map([
  [`${api}/commits/${ids.childCommit}`, commitResponse(ids.childCommit, childTree,
    [ids.parentCommit], [{
      sha: childBlob,
      filename: "src/value.ts",
      status: "modified",
      blob_url: `${web}/blob/${ids.childCommit}/src%2Fvalue.ts`,
      raw_url: `${web}/raw/${ids.childCommit}/src%2Fvalue.ts`,
      contents_url: `${api}/contents/src%2Fvalue.ts?ref=${ids.childCommit}`,
    }])],
  [`${api}/commits/${ids.parentCommit}`, commitResponse(ids.parentCommit, parentTree, [], [])],
  [`${api}/git/trees/${childTree}`, treeResponse(childTree,
    [{ mode: "040000", path: "src", type: "tree", sha: childSourceTree }])],
  [`${api}/git/trees/${parentTree}`, treeResponse(parentTree,
    [{ mode: "040000", path: "src", type: "tree", sha: parentSourceTree }])],
  [`${api}/git/trees/${childSourceTree}`, treeResponse(childSourceTree,
    [{ mode: "100644", path: "value.ts", type: "blob", sha: childBlob }])],
  [`${api}/git/trees/${parentSourceTree}`, treeResponse(parentSourceTree,
    [{ mode: "100644", path: "value.ts", type: "blob", sha: parentBlob }])],
  [`${api}/git/blobs/${childBlob}`, blobResponse(childBlob, childBytes)],
  [`${api}/git/blobs/${parentBlob}`, blobResponse(parentBlob, parentBytes)],
]);

const mutableResponses = (): Map<string, any> => new Map(
  [...validResponses()].map(([url, value]) => [url, structuredClone(value)]),
);

const relocatedResponses = (
  relocatedRepository: string,
  relocatedChild: string,
  relocatedParent: string,
): Map<string, unknown> => {
  const relocatedApi = `https://api.github.com/repos/${relocatedRepository}`;
  const relocatedWeb = `https://github.com/${relocatedRepository}`;
  const replace = (value: string): string => value
    .replaceAll(api, relocatedApi)
    .replaceAll(web, relocatedWeb)
    .replaceAll(ids.childCommit, relocatedChild)
    .replaceAll(ids.parentCommit, relocatedParent);
  return new Map([...validResponses()].map(([url, value]) => [
    replace(url),
    JSON.parse(replace(JSON.stringify(value))) as unknown,
  ]));
};

const responsesForBytes = (parent: Uint8Array, child: Uint8Array): Map<string, any> => {
  const parentObject = gitBlob(parent);
  const childObject = gitBlob(child);
  const parentLeaf = gitTree([{ mode: "100644", path: "value.ts", sha: parentObject }]);
  const childLeaf = gitTree([{ mode: "100644", path: "value.ts", sha: childObject }]);
  const parentRoot = gitTree([{ mode: "40000", path: "src", sha: parentLeaf }]);
  const childRoot = gitTree([{ mode: "40000", path: "src", sha: childLeaf }]);
  return new Map([
    [`${api}/commits/${ids.childCommit}`, commitResponse(ids.childCommit, childRoot,
      [ids.parentCommit], [{
        sha: childObject, filename: "src/value.ts", status: "modified",
        blob_url: `${web}/blob/${ids.childCommit}/src%2Fvalue.ts`,
        raw_url: `${web}/raw/${ids.childCommit}/src%2Fvalue.ts`,
        contents_url: `${api}/contents/src%2Fvalue.ts?ref=${ids.childCommit}`,
      }])],
    [`${api}/commits/${ids.parentCommit}`, commitResponse(ids.parentCommit, parentRoot, [], [])],
    [`${api}/git/trees/${childRoot}`, treeResponse(childRoot,
      [{ mode: "040000", path: "src", type: "tree", sha: childLeaf }])],
    [`${api}/git/trees/${parentRoot}`, treeResponse(parentRoot,
      [{ mode: "040000", path: "src", type: "tree", sha: parentLeaf }])],
    [`${api}/git/trees/${childLeaf}`, treeResponse(childLeaf,
      [{ mode: "100644", path: "value.ts", type: "blob", sha: childObject }])],
    [`${api}/git/trees/${parentLeaf}`, treeResponse(parentLeaf,
      [{ mode: "100644", path: "value.ts", type: "blob", sha: parentObject }])],
    [`${api}/git/blobs/${childObject}`, blobResponse(childObject, child)],
    [`${api}/git/blobs/${parentObject}`, blobResponse(parentObject, parent)],
  ]);
};

const candidate = Object.freeze({
  queryId: "ordinary-change",
  queryIndex: 2,
  committerDate: "2026-07-30T10:00:00Z",
  repository,
  repositoryUrl: web,
  commit: ids.childCommit,
  commitUrl: `${web}/commit/${ids.childCommit}`,
});

const invoke = async (
  responses: ReadonlyMap<string, unknown> = validResponses(),
  selected: Record<string, unknown> = candidate,
): Promise<any> => bindGitHubLineage({
  profile: await profile(),
  candidates: [selected],
  transport: { requestJson: async ({ url }: { url: string }) => {
    if (!responses.has(url)) throw new Error(`unexpected ${url}`);
    return structuredClone(responses.get(url));
  } },
  retry: { execute: async (operation: () => Promise<unknown>) => operation() },
});

describe("GitHub immutable lineage adapter", () => {
  it("binds a verified single-parent same-path change before reconstruction", async () => {
    const requests: string[] = [];
    const responses = validResponses();
    const output = await bindGitHubLineage({
      profile: await profile(),
      candidates: [candidate],
      transport: { requestJson: async ({ url }: { url: string }) => {
        requests.push(url);
        if (!responses.has(url)) throw new Error(`unexpected ${url}`);
        return structuredClone(responses.get(url));
      } },
      retry: { execute: async (operation: () => Promise<unknown>) => operation() },
    });

    expect(requests).toHaveLength(8);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      repository,
      path: "src/value.ts",
      childCommit: ids.childCommit,
      childTree,
      parentCommit: ids.parentCommit,
      parentTree,
      parentMode: "100644",
      childMode: "100644",
      parentBlob,
      childBlob,
      parentRawContentHash: sha256(parentBytes),
      childRawContentHash: sha256(childBytes),
      excerpt: expect.stringContaining("return 2;"),
    });
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output[0])).toBe(true);
  });

  it("applies query, date, repository, and commit ordering after enrichment", async () => {
    const details = [
      ["example/zeta", "5", "0", 1, "2026-07-31T10:00:00Z"],
      ["example/zeta", "6", "1", 0, "2026-07-29T10:00:00Z"],
      ["example/zeta", "7", "2", 0, "2026-07-30T10:00:00Z"],
      ["example/alpha", "8", "3", 0, "2026-07-30T10:00:00Z"],
      ["example/alpha", "9", "4", 0, "2026-07-30T10:00:00Z"],
    ] as const;
    const candidates = details.map(([name, childDigit, parentDigit, queryIndex, committerDate]) => ({
      ...candidate,
      queryIndex,
      committerDate,
      repository: name,
      repositoryUrl: `https://github.com/${name}`,
      commit: childDigit.repeat(40),
      commitUrl: `https://github.com/${name}/commit/${childDigit.repeat(40)}`,
    }));
    const responses = new Map<string, unknown>();
    details.forEach(([name, childDigit, parentDigit]) => relocatedResponses(
      name, childDigit.repeat(40), parentDigit.repeat(40),
    ).forEach((value, key) => responses.set(key, value)));
    const output = await bindGitHubLineage({
      profile: await profile(), candidates,
      transport: { requestJson: async ({ url }: { url: string }) => structuredClone(responses.get(url)) },
      retry: { execute: async (operation: () => Promise<unknown>) => operation() },
    });
    expect(output.map(({ repository, commit }: { repository: string; commit: string }) =>
      `${repository}@${commit[0]}`)).toEqual([
      "example/alpha@8", "example/alpha@9", "example/zeta@7",
      "example/zeta@6", "example/zeta@5",
    ]);
  });

  it.each([
    ["root", (responses: Map<string, any>) => { responses.get(`${api}/commits/${ids.childCommit}`).parents = []; }],
    ["merge", (responses: Map<string, any>) => {
      responses.get(`${api}/commits/${ids.childCommit}`).parents.push({
        sha: "b".repeat(40),
        url: `${api}/commits/${"b".repeat(40)}`,
        html_url: `${web}/commit/${"b".repeat(40)}`,
      });
    }],
  ])("rejects a %s child commit", async (
    _name: string,
    mutate: (responses: Map<string, any>) => void,
  ) => {
    const responses = mutableResponses();
    mutate(responses);
    await expect(invoke(responses)).rejects.toBeInstanceOf(lineageModule.GitHubLineageError);
  });

  it.each(["renamed", "copied", "added", "removed"])(
    "rejects a %s file instead of treating it as a same-path modification",
    async (status: string) => {
      const responses = mutableResponses();
      responses.get(`${api}/commits/${ids.childCommit}`).files[0].status = status;
      await expect(invoke(responses)).rejects.toBeInstanceOf(lineageModule.GitHubLineageError);
    },
  );

  it("binds the first screenable same-path modification by path order from a multi-file commit", async () => {
    const responses = mutableResponses();
    const commit = responses.get(`${api}/commits/${ids.childCommit}`);
    const original = commit.files[0];
    const file = (filename: string, overrides: Record<string, unknown> = {}) => ({
      ...structuredClone(original),
      filename,
      blob_url: `${web}/blob/${ids.childCommit}/${encodeURIComponent(filename)}`,
      raw_url: `${web}/raw/${ids.childCommit}/${encodeURIComponent(filename)}`,
      contents_url: `${api}/contents/${encodeURIComponent(filename)}?ref=${ids.childCommit}`,
      ...overrides,
    });
    commit.files = [
      file("src/zeta.ts"),
      file("docs/guide.ts"),
      file("src/a.ts", { status: "added" }),
      file("src/b.ts", { previous_filename: "src/old.ts" }),
      file("src/notes.md"),
      original,
    ];

    const [bound] = await invoke(responses);

    expect(bound.path).toBe("src/value.ts");
    expect(bound.childBlob).toBe(childBlob);

    const unsupportedOnly = mutableResponses();
    unsupportedOnly.get(`${api}/commits/${ids.childCommit}`).files = [file("src/notes.md"), file("docs/guide.ts")];
    await expect(invoke(unsupportedOnly)).rejects.toBeInstanceOf(lineageModule.GitHubLineageError);
  });

  it("requires the provider's percent-encoded file URLs and rejects literal-slash variants", async () => {
    for (const key of ["blob_url", "raw_url", "contents_url"]) {
      const responses = mutableResponses();
      const file = responses.get(`${api}/commits/${ids.childCommit}`).files[0];
      file[key] = String(file[key]).replace("src%2Fvalue.ts", "src/value.ts");
      await expect(invoke(responses)).rejects.toBeInstanceOf(lineageModule.GitHubLineageError);
    }
  });

  it("rejects ambiguous changed-file populations and previous-path metadata", async () => {
    const multiple = mutableResponses();
    multiple.get(`${api}/commits/${ids.childCommit}`).files.push(
      structuredClone(multiple.get(`${api}/commits/${ids.childCommit}`).files[0]),
    );
    await expect(invoke(multiple)).rejects.toBeInstanceOf(lineageModule.GitHubLineageError);

    const previous = mutableResponses();
    previous.get(`${api}/commits/${ids.childCommit}`).files[0].previous_filename = "src/old.ts";
    await expect(invoke(previous)).rejects.toBeInstanceOf(lineageModule.GitHubLineageError);
  });

  it.each([
    ["symlink", "120000", "blob"],
    ["submodule", "160000", "commit"],
  ])("rejects a %s tree entry", async (_name: string, mode: string, type: string) => {
    const responses = mutableResponses();
    const entry = responses.get(`${api}/git/trees/${childSourceTree}`).tree[0];
    entry.mode = mode;
    entry.type = type;
    entry.url = `${api}/git/${type}s/${entry.sha}`;
    await expect(invoke(responses)).rejects.toBeInstanceOf(lineageModule.GitHubLineageError);
  });

  it("rejects a non-regular parent entry", async () => {
    const responses = mutableResponses();
    const entry = responses.get(`${api}/git/trees/${parentSourceTree}`).tree[0];
    entry.mode = "120000";
    await expect(invoke(responses)).rejects.toBeInstanceOf(lineageModule.GitHubLineageError);
  });

  it("rejects malformed and duplicate tree entries", async () => {
    const malformed = mutableResponses();
    malformed.get(`${api}/git/trees/${childSourceTree}`).tree[0].path = "";
    await expect(invoke(malformed)).rejects.toBeInstanceOf(lineageModule.GitHubLineageError);

    const duplicate = mutableResponses();
    const tree = duplicate.get(`${api}/git/trees/${childSourceTree}`).tree;
    tree.push(structuredClone(tree[0]));
    await expect(invoke(duplicate)).rejects.toBeInstanceOf(lineageModule.GitHubLineageError);
  });

  it("rejects truncated trees", async () => {
    const responses = mutableResponses();
    responses.get(`${api}/git/trees/${childTree}`).truncated = true;
    await expect(invoke(responses)).rejects.toBeInstanceOf(lineageModule.GitHubLineageError);
  });

  it("rejects binary and unchanged child blobs", async () => {
    const binary = encoder.encode("export const value = 1;\0\n");
    await expect(invoke(responsesForBytes(parentBytes, binary))).rejects.toThrow();
    await expect(invoke(responsesForBytes(parentBytes, parentBytes))).rejects.toThrow();
  });

  it.each([
    ["commit tree", (responses: Map<string, any>) => {
      responses.get(`${api}/commits/${ids.childCommit}`).commit.tree.url = `${api}/git/trees/${parentTree}`;
    }],
    ["tree path", (responses: Map<string, any>) => {
      const file = responses.get(`${api}/commits/${ids.childCommit}`).files[0];
      file.filename = "src/missing.ts";
      file.blob_url = `${web}/blob/${ids.childCommit}/src/missing.ts`;
      file.raw_url = `${web}/raw/${ids.childCommit}/src/missing.ts`;
      file.contents_url = `${api}/contents/src/missing.ts?ref=${ids.childCommit}`;
    }],
    ["file-to-tree blob", (responses: Map<string, any>) => {
      const file = responses.get(`${api}/commits/${ids.childCommit}`).files[0];
      file.sha = parentBlob;
      file.blob_url = `${web}/blob/${ids.childCommit}/src/value.ts`;
    }],
    ["blob response", (responses: Map<string, any>) => {
      responses.get(`${api}/git/blobs/${childBlob}`).sha = parentBlob;
    }],
    ["raw bytes", (responses: Map<string, any>) => {
      responses.get(`${api}/git/blobs/${childBlob}`).content = Buffer.from(parentBytes).toString("base64");
    }],
  ])("rejects a %s identity mismatch", async (
    _name: string,
    mutate: (responses: Map<string, any>) => void,
  ) => {
    const responses = mutableResponses();
    mutate(responses);
    await expect(invoke(responses)).rejects.toBeInstanceOf(lineageModule.GitHubLineageError);
  });

  it.each([
    ["owner", { repository: "../project" }],
    ["repository URL", { repositoryUrl: "https://github.com/example/other" }],
    ["commit URL", { commitUrl: `${web}/commit/${ids.parentCommit}` }],
  ])("rejects a mismatched %s binding", async (
    _name: string,
    mutation: Record<string, unknown>,
  ) => {
    await expect(invoke(validResponses(), { ...candidate, ...mutation }))
      .rejects.toBeInstanceOf(lineageModule.GitHubLineageError);
  });

  it.each([
    ["commit", `${api}/commits/${ids.childCommit}`, "url", `${api}/commits/${ids.parentCommit}`],
    ["commit HTML", `${api}/commits/${ids.childCommit}`, "html_url", `${web}/commit/${ids.parentCommit}`],
    ["parent", `${api}/commits/${ids.childCommit}`, "parents", [{
      sha: ids.parentCommit,
      url: `${api}/commits/${ids.childCommit}`,
      html_url: `${web}/commit/${ids.parentCommit}`,
    }]],
    ["tree", `${api}/git/trees/${childTree}`, "url", `${api}/git/trees/${parentTree}`],
    ["blob", `${api}/git/blobs/${childBlob}`, "url", `${api}/git/blobs/${parentBlob}`],
  ])("rejects an inexact %s response URL", async (
    _name: string,
    key: string,
    field: string,
    value: unknown,
  ) => {
    const responses = mutableResponses();
    responses.get(key)[field] = value;
    await expect(invoke(responses)).rejects.toBeInstanceOf(lineageModule.GitHubLineageError);
  });
});
