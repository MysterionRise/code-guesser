import { createHash } from "node:crypto";

import { STACK_LANGUAGES, type CrawlProfile, type StackLanguage } from "../profile";
import type { SelectedStackBlob } from "../stack-revalidation";
import type { StackMetadataRow } from "../stack-metadata";
import { CAPTURED_AUTHOR_EMAIL } from "./captured-values";

type JsonValue = Readonly<Record<string, unknown>>;
type TreeEntry = Readonly<{ path: string; mode: "100644" | "040000"; type: "blob" | "tree"; sha: string }>;

export interface CapturedResponses {
  readonly http: ReadonlyMap<string, JsonValue | string>;
  /** Every language's metadata rows, popular repositories first. */
  readonly metadata: Readonly<Record<StackLanguage, readonly StackMetadataRow[]>>;
  readonly selectedBlobs: ReadonlyMap<string, SelectedStackBlob>;
}

const REVISION = "e565caa3a78c2423bd374333a472b049eb090e47";
const LICENSE_BYTES = Buffer.from("MIT License\n\nPermission is hereby granted.\n");
const digest = (algorithm: "sha1" | "sha256", value: Uint8Array | string): string =>
  createHash(algorithm).update(value).digest("hex");
const gitObject = (kind: "blob" | "tree", bytes: Uint8Array): string => createHash("sha1")
  .update(`${kind} ${bytes.byteLength}\0`).update(bytes).digest("hex");
const gitBlob = (bytes: Uint8Array): string => gitObject("blob", bytes);
/** A git tree id, ordered and encoded the way git (and the lineage check) does. */
const treeId = (entries: readonly TreeEntry[]): string => {
  const key = (entry: TreeEntry): string => entry.type === "tree" ? `${entry.path}/` : entry.path;
  const parts = [...entries].sort((left, right) => key(left) < key(right) ? -1 : 1).map((entry) =>
    Buffer.concat([Buffer.from(`${entry.mode === "040000" ? "40000" : entry.mode} ${entry.path}\0`), Buffer.from(entry.sha, "hex")]));
  return gitObject("tree", Buffer.concat(parts));
};

const repositoryResponse = (repository: string): JsonValue => {
  const api = `https://api.github.com/repos/${repository}`;
  return {
    full_name: repository, url: api, html_url: `https://github.com/${repository}`, description: `Captured ${repository.split("/")[1]} toolkit`,
    private: false, visibility: "public", disabled: false, archived: false, fork: false,
    license: { key: "mit", name: "MIT License", spdx_id: "MIT", url: "https://api.github.com/licenses/mit" },
  };
};
const author = (index: number) => ({
  login: `capture-author-${index}`, url: `https://api.github.com/users/capture-author-${index}`,
  html_url: `https://github.com/capture-author-${index}`,
});
const licenseResponse = (repository: string, commit: string): JsonValue => {
  const api = `https://api.github.com/repos/${repository}`;
  const web = `https://github.com/${repository}`;
  const blob = gitBlob(LICENSE_BYTES);
  return {
    name: "LICENSE", path: "LICENSE", sha: blob, size: LICENSE_BYTES.byteLength,
    url: `${api}/contents/LICENSE?ref=${commit}`, html_url: `${web}/blob/${commit}/LICENSE`,
    git_url: `${api}/git/blobs/${blob}`,
    download_url: `https://raw.githubusercontent.com/${repository}/${commit}/LICENSE`,
    type: "file", encoding: "base64", content: LICENSE_BYTES.toString("base64"),
    license: { key: "mit", name: "MIT License", spdx_id: "MIT", url: "https://api.github.com/licenses/mit" },
  };
};
const treeResponse = (api: string, identity: string, entries: readonly TreeEntry[]): JsonValue => ({
  sha: identity, url: `${api}/git/trees/${identity}`, truncated: false,
  tree: entries.map((entry) => ({ ...entry, url: `${api}/git/${entry.type}s/${entry.sha}` })),
});
const blobResponse = (api: string, identity: string, bytes: Uint8Array): JsonValue => ({
  sha: identity, url: `${api}/git/blobs/${identity}`, encoding: "base64",
  size: bytes.byteLength, content: Buffer.from(bytes).toString("base64"),
});

/** Records the trees for a file one folder deep (`folder/name`) and returns the root tree id. */
const addTrees = (http: Map<string, JsonValue | string>, api: string, path: string, blob: string): string => {
  const [folder, name] = path.split("/") as [string, string];
  const leafEntries: TreeEntry[] = [{ path: name, mode: "100644", type: "blob", sha: blob }];
  const leaf = treeId(leafEntries);
  const rootEntries: TreeEntry[] = [{ path: folder, mode: "040000", type: "tree", sha: leaf }];
  const root = treeId(rootEntries);
  http.set(`${api}/git/trees/${leaf}`, treeResponse(api, leaf, leafEntries));
  http.set(`${api}/git/trees/${root}`, treeResponse(api, root, rootEntries));
  return root;
};

/** One refactor commit: a file whose single changed line sits in a small window. */
const addCommit = (
  http: Map<string, JsonValue | string>, index: number, repository: string, message: string,
): Readonly<{ repository: string; commit: string; message: string }> => {
  const api = `https://api.github.com/repos/${repository}`;
  const web = `https://github.com/${repository}`;
  const commit = digest("sha1", `capture-commit-${repository}`);
  const parentCommit = digest("sha1", `capture-parent-${repository}`);
  const path = `src/round-${index}.ts`;
  const sourceLines = [
    "export function capturedValue(): number {", "  const scale = 2;",
    `  const base = ${index + 1};`, "  const offset = 3;", "  const adjusted = base + offset;",
    "  return adjusted * scale;", "}", `export const capturedIndex = ${index};`, "",
  ];
  const childLines = [...sourceLines];
  childLines[2] = `  const base = ${index + 11};`;
  const parentBytes = Buffer.from(sourceLines.join("\n"));
  const childBytes = Buffer.from(childLines.join("\n"));
  const parentBlob = gitBlob(parentBytes);
  const childBlob = gitBlob(childBytes);
  const parentTree = addTrees(http, api, path, parentBlob);
  const childTree = addTrees(http, api, path, childBlob);
  http.set(api, repositoryResponse(repository));
  http.set(`${api}/commits/${commit}`, {
    sha: commit, url: `${api}/commits/${commit}`, html_url: `${web}/commit/${commit}`,
    commit: { message, tree: { sha: childTree, url: `${api}/git/trees/${childTree}` },
      author: { name: `Capture Author ${index}`, email: CAPTURED_AUTHOR_EMAIL } },
    author: author(index), parents: [{ sha: parentCommit, url: `${api}/commits/${parentCommit}`,
      html_url: `${web}/commit/${parentCommit}` }],
    stats: { total: 2, additions: 1, deletions: 1 },
    files: [{ sha: childBlob, filename: path, status: "modified",
      blob_url: `${web}/blob/${commit}/${encodeURIComponent(path)}`, raw_url: `${web}/raw/${commit}/${encodeURIComponent(path)}`,
      contents_url: `${api}/contents/${encodeURIComponent(path)}?ref=${commit}` }],
  });
  http.set(`${api}/commits/${parentCommit}`, {
    sha: parentCommit, url: `${api}/commits/${parentCommit}`, html_url: `${web}/commit/${parentCommit}`,
    commit: { message: "Parent capture", tree: { sha: parentTree, url: `${api}/git/trees/${parentTree}` } },
    parents: [], files: [],
  });
  http.set(`${api}/git/blobs/${childBlob}`, blobResponse(api, childBlob, childBytes));
  http.set(`${api}/git/blobs/${parentBlob}`, blobResponse(api, parentBlob, parentBytes));
  http.set(`${api}/license?ref=${commit}`, licenseResponse(repository, commit));
  return Object.freeze({ repository, commit, message });
};

const metadataRow = (
  repository: string, commit: string, path: string, language: StackLanguage, bytes: Buffer, starEventsCount: number,
): StackMetadataRow => {
  const fields = {
    swhBlobId: digest("sha1", bytes), swhContentId: gitBlob(bytes),
    swhDirectoryId: digest("sha1", `${repository}:directory`),
    swhSnapshotId: digest("sha1", `${repository}:snapshot`), swhRevisionId: commit,
    repository, path, detectedLicenses: ["MIT"], detectedLanguage: language,
    generated: false, vendor: false, sourceEncoding: "UTF-8", byteLength: bytes.byteLength,
    visitDate: "2023-09-06T10:44:38Z", revisionDate: "2023-09-05T09:30:00Z",
    committerDate: "2023-09-05T09:30:00Z", starEventsCount, forkEventsCount: 2,
  } as const;
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(fields).sort()));
  return Object.freeze({ stableRowId: digest("sha256", canonical), ...fields });
};

/** One Stack file and everything GitHub answers about it, ready to fetch and revalidate. */
const addStackFile = (
  http: Map<string, JsonValue | string>, index: number, repository: string, language: StackLanguage,
  path: string, bytes: Buffer, starEventsCount: number,
): Readonly<{ row: StackMetadataRow; selected: SelectedStackBlob }> => {
  const api = `https://api.github.com/repos/${repository}`;
  const web = `https://github.com/${repository}`;
  const commit = digest("sha1", `capture-stack-commit-${repository}`);
  const blob = gitBlob(bytes);
  const tree = addTrees(http, api, path, blob);
  http.set(api, repositoryResponse(repository));
  http.set(`${api}/commits/${commit}`, {
    sha: commit, url: `${api}/commits/${commit}`, html_url: `${web}/commit/${commit}`,
    commit: { tree: { sha: tree, url: `${api}/git/trees/${tree}` },
      author: { name: `Capture Author ${index + 30}`, email: CAPTURED_AUTHOR_EMAIL } },
    author: author(index + 30),
  });
  http.set(`${api}/git/blobs/${blob}`, blobResponse(api, blob, bytes));
  http.set(`${api}/license?ref=${commit}`, licenseResponse(repository, commit));
  const row = metadataRow(repository, commit, path, language, bytes, starEventsCount);
  return Object.freeze({ row, selected: Object.freeze({ stableRowId: row.stableRowId,
    swhBlobId: row.swhBlobId, contentBase64: bytes.toString("base64"), byteLength: bytes.byteLength }) });
};

const stackCard = (): string => [
  "The Stack v2 is regularly updated to enact validated data removal requests.",
  "Use the most recent usable version.",
  "I have read the License and agree with its terms: checkbox",
  "### Changelog", "Release  | Description", "--- | ---", "v2.2.0  | Captured current release.", "",
].join("\n");

const repeated = (count: number, block: (index: number) => readonly string[]): Buffer =>
  Buffer.from(Array.from({ length: count }, (_, index) => block(index).join("\n")).join("\n"));
/** A file's code in each language, with a variant number so every file is distinct. */
const SOURCES: Readonly<Record<StackLanguage, (variant: number) => Readonly<{ name: string; bytes: Buffer }>>> = {
  Python: (variant) => ({ name: `module_${variant}.py`, bytes: repeated(40, (index) => [`def captured_${variant}_${index}(value):`, `    adjusted = value + ${index + 7}`, "    return adjusted * 2", ""]) }),
  TypeScript: (variant) => ({ name: `module-${variant}.ts`, bytes: repeated(30, (index) => [`export function captured${variant}x${index}(value: number): number {`, `  const adjusted = value + ${index + 9};`, "  return adjusted * 3;", "}", ""]) }),
  Go: (variant) => ({ name: `module_${variant}.go`, bytes: Buffer.from(["package captured", "", ...Array.from({ length: 20 }, (_, index) => `func captured${variant}x${index}(value int) int {\n\tadjusted := value + ${index + 5}\n\treturn adjusted * 4\n}\n`)].join("\n")) }),
  Rust: (variant) => ({ name: `module_${variant}.rs`, bytes: repeated(25, (index) => [`pub fn captured_${variant}_${index}(value: i64) -> i64 {`, `    let adjusted = value + ${index + 3};`, "    adjusted * 5", "}", ""]) }),
  Ruby: (variant) => ({ name: `module_${variant}.rb`, bytes: repeated(25, (index) => [`def captured_${variant}_${index}(value)`, `  adjusted = value + ${index + 2}`, "  adjusted * 6", "end", ""]) }),
};

/** Commits per query: six refactors across the first three searches, every subject usable as a hint. */
const COMMITS_PER_QUERY = [2, 2, 2];

export const createCapturedResponses = (
  profile: CrawlProfile,
  providerIncompleteQueryId?: string,
): CapturedResponses => {
  const http = new Map<string, JsonValue | string>();
  http.set("https://huggingface.co/api/datasets/bigcode/the-stack-v2/revision/e565caa3a78c2423bd374333a472b049eb090e47", {
    id: "bigcode/the-stack-v2", sha: REVISION, private: false, disabled: false, gated: "auto",
    cardData: { extra_gated_prompt: "The Stack v2 is regularly updated to enact validated data removal requests. Use the most recent usable version.",
      extra_gated_fields: { Email: "text", "I have read the License and agree with its terms": "checkbox" } },
    siblings: [{ rfilename: "README.md" }],
  });
  http.set("https://huggingface.co/datasets/bigcode/the-stack-v2/raw/main/README.md", stackCard());
  let commitIndex = 0;
  profile.github.queries.forEach((query, queryIndex) => {
    const count = COMMITS_PER_QUERY[queryIndex] ?? 0;
    const sources = Array.from({ length: count }, () => {
      const index = commitIndex++;
      return addCommit(http, index, `refactors/ordinary-${index}`, `Simplify the captured value helper ${index}\n\nLonger body`);
    });
    const url = new URL("https://api.github.com/search/commits");
    Object.entries({ q: query.query, sort: query.sort, order: query.order, page: "1", per_page: "100" })
      .forEach(([key, value]) => url.searchParams.set(key, value));
    http.set(url.href, { total_count: sources.length, incomplete_results: query.id === providerIncompleteQueryId, items: sources.map((source, index) => ({
      sha: source.commit, url: `https://api.github.com/repos/${source.repository}/commits/${source.commit}`,
      html_url: `https://github.com/${source.repository}/commit/${source.commit}`,
      commit: { message: source.message, committer: { date: `2026-07-${String(20 - index).padStart(2, "0")}T10:00:00Z` } },
      repository: { full_name: source.repository, url: `https://api.github.com/repos/${source.repository}`,
        html_url: `https://github.com/${source.repository}` },
    })) });
  });
  // Per language: four popular repositories (the project deck's answer and decoys), then one ordinary file.
  const languages = STACK_LANGUAGES.map((language, languageIndex) => {
    const lower = language.toLowerCase();
    const popular = [0, 1, 2, 3].map((rank) => {
      const source = SOURCES[language](rank);
      return addStackFile(http, languageIndex * 10 + rank, `famous-${lower}/project-${rank}`, language, `lib/${source.name}`, source.bytes, 8000 - rank * 1000);
    });
    const ordinarySource = SOURCES[language](9);
    const ordinary = addStackFile(http, languageIndex * 10 + 9, `everyday-${lower}/tools`, language, `src/${ordinarySource.name}`, ordinarySource.bytes, 3);
    return [language, [...popular, ordinary]] as const;
  });
  return Object.freeze({
    http,
    metadata: Object.freeze(Object.fromEntries(languages.map(([language, files]) => [language, Object.freeze(files.map(({ row }) => row))]))) as
      Readonly<Record<StackLanguage, readonly StackMetadataRow[]>>,
    selectedBlobs: new Map(languages.flatMap(([, files]) => files.map(({ row, selected }) => [row.stableRowId, selected] as const))),
  });
};
