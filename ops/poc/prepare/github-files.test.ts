import { bindGitHubFile, fileAuthor, GitHubFileError, listGitHubDirectory, readGitHubFile } from "./github-files";
import { GitHubAdmissionError } from "./github-admission";
import { blobResponse, gitBlob, licenseResponse, repositoryResponse, treeId, treeResponse, type TreeEntry } from "./testdata/captured-responses";
import { loadDeckProfile } from "./testdata/deck-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const repository = "TheAlgorithms/Python";
const api = `https://api.github.com/repos/${repository}`;
const web = `https://github.com/${repository}`;
const pin = "1".repeat(40);
const path = "sorts/quick_sort.py";
const code = Buffer.from("def quick_sort(collection):\n    return collection\n");
const profile = loadDeckProfile();

const person = (login: string, type = "User") => ({
  login, type, url: `https://api.github.com/users/${login}`, html_url: `https://github.com/${login}`,
});
const historyItem = (sha: string, name: string, user: ReturnType<typeof person> | null) => ({
  sha, url: `${api}/commits/${sha}`, html_url: `${web}/commit/${sha}`,
  commit: { author: { name }, message: "Update quick_sort.py" }, author: user,
});
const historyUrl = `${api}/commits?path=${encodeURIComponent(path)}&sha=${pin}&per_page=10`;

/** A pinned commit whose root tree holds `sorts/quick_sort.py`, plus the history and licence GitHub answers with. */
const fakeGitHub = (overrides: ReadonlyMap<string, unknown> = new Map()) => {
  const http = new Map<string, unknown>();
  const blob = gitBlob(code);
  const leaf: TreeEntry[] = [{ path: "quick_sort.py", mode: "100644", type: "blob", sha: blob }];
  const root: TreeEntry[] = [{ path: "sorts", mode: "040000", type: "tree", sha: treeId(leaf) }];
  http.set(api, repositoryResponse(repository));
  http.set(`${api}/commits/${pin}`, {
    sha: pin, url: `${api}/commits/${pin}`, html_url: `${web}/commit/${pin}`,
    commit: { tree: { sha: treeId(root), url: `${api}/git/trees/${treeId(root)}` }, message: "Pin", author: { name: "Release bot" } },
    parents: [], files: [], author: null,
  });
  http.set(`${api}/git/trees/${treeId(root)}`, treeResponse(api, treeId(root), root));
  http.set(`${api}/git/trees/${treeId(leaf)}`, treeResponse(api, treeId(leaf), leaf));
  http.set(`${api}/git/blobs/${blob}`, blobResponse(api, blob, code));
  http.set(`${api}/license?ref=${pin}`, licenseResponse(repository, pin));
  http.set(historyUrl, [
    historyItem("2".repeat(40), "github-actions[bot]", person("github-actions[bot]", "Bot")),
    historyItem("3".repeat(40), "pre-commit-ci[bot]", null),
    historyItem("4".repeat(40), "Ada Lovelace", person("ada")),
    historyItem("5".repeat(40), "Grace Hopper", person("grace")),
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
  promise.then(() => "BOUND", (error: { code?: unknown }) => error.code);

describe("curated GitHub files", () => {
  it("binds a file at a pinned commit with its licence and its last human author", async () => {
    const github = fakeGitHub();
    const file = await bindGitHubFile(github.options, { repository, commit: pin, path });
    expect(file).toMatchObject({
      repository, commit: pin, path, mode: "100644", blob: gitBlob(code), licenseSpdx: "MIT",
      licenseFileUrl: `${web}/blob/${pin}/LICENSE`, author: { name: "Ada Lovelace", login: "ada", commit: "4".repeat(40) },
    });
    expect(Buffer.from(file.bytes).equals(code)).toBe(true);
    // One history page, read only up to the pin.
    expect(github.requests.filter((url) => url.includes("/commits?"))).toEqual([historyUrl]);
  });

  it("rejects a tampered blob, a missing path, a licence off the allowlist, and an unpinned commit", async () => {
    const tamperedBlob = gitBlob(code);
    const tampered = fakeGitHub(new Map([[`${api}/git/blobs/${tamperedBlob}`, blobResponse(api, tamperedBlob, Buffer.from("other"))]]));
    expect(await codeOf(bindGitHubFile(tampered.options, { repository, commit: pin, path }))).toBe("FILE_BLOB");
    expect(await codeOf(bindGitHubFile(fakeGitHub().options, { repository, commit: pin, path: "sorts/merge_sort.py" }))).toBe("FILE_PATH");
    const gpl = { ...(repositoryResponse(repository) as object),
      license: { key: "gpl-3.0", name: "GNU General Public License v3.0", spdx_id: "GPL-3.0", url: "https://api.github.com/licenses/gpl-3.0" } };
    const copyleft = fakeGitHub(new Map([[api, gpl]]));
    expect(await codeOf(bindGitHubFile(copyleft.options, { repository, commit: pin, path }))).toBe("ADMISSION_REPOSITORY_LICENSE");
    expect(await codeOf(bindGitHubFile(fakeGitHub().options, { repository, commit: "main", path }))).toBe("FILE_SHAPE");
  });

  it("credits no one when the file's recent history is all automation, and rejects a malformed history", async () => {
    const automated = fakeGitHub(new Map([[historyUrl, [historyItem("2".repeat(40), "github-actions[bot]", person("github-actions[bot]", "Bot"))]]]));
    expect(await codeOf(fileAuthor(automated.options, { repository, commit: pin, path }))).toBe("FILE_AUTHOR_AUTOMATED");
    for (const history of [[], {}, [{ sha: "short" }]]) {
      expect(await codeOf(fileAuthor(fakeGitHub(new Map([[historyUrl, history]])).options, { repository, commit: pin, path }))).toBe("FILE_AUTHOR");
    }
    const spoofed = fakeGitHub(new Map([[historyUrl, [{ ...historyItem("4".repeat(40), "Ada", person("ada")), html_url: "https://example.test/x" }]]]));
    await expect(fileAuthor(spoofed.options, { repository, commit: pin, path })).rejects.toBeInstanceOf(GitHubAdmissionError);
    expect(new GitHubFileError("FILE_PATH").message).toBe("GITHUB_FILE_REJECTED");
  });

  it("lists a directory's files from verified trees, and reads one file without its licence or author", async () => {
    const github = fakeGitHub();
    expect(await listGitHubDirectory(github.options, { repository, commit: pin, path: "sorts" })).toEqual(["sorts/quick_sort.py"]);
    const read = await readGitHubFile(github.options, { repository, commit: pin, path });
    expect(read.blob).toBe(gitBlob(code));
    expect(Buffer.from(read.bytes).equals(code)).toBe(true);
    // Neither the repository, the licence, nor the history is asked for until a file is bound.
    expect(github.requests.some((url) => url === api || url.includes("/license") || url.includes("/commits?"))).toBe(false);
    expect(await codeOf(listGitHubDirectory(github.options, { repository, commit: pin, path: "sorts/quick_sort.py" }))).toBe("FILE_PATH");
    expect(await codeOf(listGitHubDirectory(github.options, { repository, commit: pin, path: "../sorts" }))).toBe("FILE_PATH");
    expect(await codeOf(readGitHubFile(github.options, { repository, commit: "main", path }))).toBe("FILE_SHAPE");
    const tampered = fakeGitHub(new Map([[`${api}/git/blobs/${gitBlob(code)}`, blobResponse(api, gitBlob(code), Buffer.from("print('other')\n"))]]));
    expect(await codeOf(readGitHubFile(tampered.options, { repository, commit: pin, path }))).toBe("FILE_BLOB");
  });
});
