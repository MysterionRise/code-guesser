import { createHash } from "node:crypto";

import { STACK_LANGUAGES, type CrawlProfile, type StackLanguage } from "../profile";
import type { SelectedStackBlob } from "../stack-revalidation";
import type { StackMetadataRow } from "../stack-metadata";
import { CAPTURED_AUTHOR_EMAIL } from "./captured-values";

type JsonValue = Readonly<Record<string, unknown>>;
type TreeEntry = Readonly<{ path: string; mode: "100644"; type: "blob"; sha: string }>;

export interface CapturedResponses {
  readonly http: ReadonlyMap<string, JsonValue | string>;
  readonly metadata: Readonly<Record<StackLanguage, StackMetadataRow>>;
  readonly selectedBlobs: ReadonlyMap<string, SelectedStackBlob>;
}

const REVISION = "e565caa3a78c2423bd374333a472b049eb090e47";
const LICENSE_BYTES = Buffer.from("MIT License\n\nPermission is hereby granted.\n");
const digest = (algorithm: "sha1" | "sha256", value: Uint8Array | string): string =>
  createHash(algorithm).update(value).digest("hex");
const gitObject = (kind: "blob" | "tree", bytes: Uint8Array): string => createHash("sha1")
  .update(`${kind} ${bytes.byteLength}\0`).update(bytes).digest("hex");
const gitBlob = (bytes: Uint8Array): string => gitObject("blob", bytes);
const treeId = (entries: readonly TreeEntry[]): string => {
  const parts = [...entries].sort((left, right) => left.path.localeCompare(right.path)).map((entry) =>
    Buffer.concat([Buffer.from(`${entry.mode} ${entry.path}\0`), Buffer.from(entry.sha, "hex")]));
  return gitObject("tree", Buffer.concat(parts));
};
const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const repositoryResponse = (repository: string): JsonValue => {
  const api = `https://api.github.com/repos/${repository}`;
  return {
    full_name: repository, url: api, html_url: `https://github.com/${repository}`,
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
  tree: entries.map((entry) => ({ ...entry, url: `${api}/git/blobs/${entry.sha}` })),
});
const blobResponse = (api: string, identity: string, bytes: Uint8Array): JsonValue => ({
  sha: identity, url: `${api}/git/blobs/${identity}`, encoding: "base64",
  size: bytes.byteLength, content: Buffer.from(bytes).toString("base64"),
});

const addCommit = (
  http: Map<string, JsonValue | string>, index: number, repository: string, message: string,
): Readonly<{ repository: string; commit: string }> => {
  const api = `https://api.github.com/repos/${repository}`;
  const web = `https://github.com/${repository}`;
  const commit = digest("sha1", `capture-commit-${repository}`);
  const parentCommit = digest("sha1", `capture-parent-${repository}`);
  const path = `round-${index}.ts`;
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
  const parentEntries: TreeEntry[] = [{ path, mode: "100644", type: "blob", sha: parentBlob }];
  const childEntries: TreeEntry[] = [{ path, mode: "100644", type: "blob", sha: childBlob }];
  const parentTree = treeId(parentEntries);
  const childTree = treeId(childEntries);
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
  http.set(`${api}/git/trees/${childTree}`, treeResponse(api, childTree, childEntries));
  http.set(`${api}/git/trees/${parentTree}`, treeResponse(api, parentTree, parentEntries));
  http.set(`${api}/git/blobs/${childBlob}`, blobResponse(api, childBlob, childBytes));
  http.set(`${api}/git/blobs/${parentBlob}`, blobResponse(api, parentBlob, parentBytes));
  http.set(`${api}/license?ref=${commit}`, licenseResponse(repository, commit));
  return Object.freeze({ repository, commit });
};

const metadataRow = (
  repository: string, commit: string, path: string, language: StackLanguage, bytes: Buffer,
): StackMetadataRow => {
  const fields = {
    swhBlobId: digest("sha1", bytes), swhContentId: gitBlob(bytes),
    swhDirectoryId: digest("sha1", `${repository}:directory`),
    swhSnapshotId: digest("sha1", `${repository}:snapshot`), swhRevisionId: commit,
    repository, path, detectedLicenses: ["MIT"], detectedLanguage: language,
    generated: false, vendor: false, sourceEncoding: "UTF-8", byteLength: bytes.byteLength,
    visitDate: "2023-09-06T10:44:38Z", revisionDate: "2023-09-05T09:30:00Z",
    committerDate: "2023-09-05T09:30:00Z",
  } as const;
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(fields).sort()));
  return Object.freeze({ stableRowId: digest("sha256", canonical), ...fields });
};
const addLanguage = (
  http: Map<string, JsonValue | string>, index: number, language: StackLanguage,
  path: string, bytes: Buffer,
): Readonly<{ row: StackMetadataRow; selected: SelectedStackBlob }> => {
  const repository = `capture/language-${index}`;
  const api = `https://api.github.com/repos/${repository}`;
  const web = `https://github.com/${repository}`;
  const commit = digest("sha1", `capture-language-commit-${index}`);
  const blob = gitBlob(bytes);
  const entries: TreeEntry[] = [{ path, mode: "100644", type: "blob", sha: blob }];
  const tree = treeId(entries);
  http.set(api, repositoryResponse(repository));
  http.set(`${api}/commits/${commit}`, {
    sha: commit, url: `${api}/commits/${commit}`, html_url: `${web}/commit/${commit}`,
    commit: { tree: { sha: tree, url: `${api}/git/trees/${tree}` },
      author: { name: `Capture Author ${index + 3}`, email: CAPTURED_AUTHOR_EMAIL } },
    author: author(index + 3),
  });
  http.set(`${api}/git/trees/${tree}`, treeResponse(api, tree, entries));
  http.set(`${api}/git/blobs/${blob}`, blobResponse(api, blob, bytes));
  http.set(`${api}/license?ref=${commit}`, licenseResponse(repository, commit));
  const row = metadataRow(repository, commit, path, language, bytes);
  return Object.freeze({ row, selected: Object.freeze({ stableRowId: row.stableRowId,
    swhBlobId: row.swhBlobId, contentBase64: bytes.toString("base64"), byteLength: bytes.byteLength }) });
};

const stackCard = (): string => [
  "The Stack v2 is regularly updated to enact validated data removal requests.",
  "Use the most recent usable version.",
  "I have read the License and agree with its terms: checkbox",
  "### Changelog", "Release  | Description", "--- | ---", "v2.2.0  | Captured current release.", "",
].join("\n");

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
  // Revision 12 discovery: three AI-credited commits and seven ordinary commits across the signed query set.
  const credit = "Co-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>";
  const perQuery: Readonly<Record<string, readonly Readonly<{ repository: string; message: string }>[]>> = {
    "ai-copilot-github": [0, 1].map((index) => ({ repository: `capture/ai-${index}`, message: `Captured fix ${index}\n\n${credit}` })),
    "ai-copilot-microsoft": [{ repository: "capture/ai-2", message: `Captured fix 2\n\n${credit}` }],
    "ordinary-facebook": [0, 1, 2, 3].map((index) => ({ repository: `capture/ordinary-${index}`, message: `Ordinary captured refactor ${index}` })),
    "ordinary-google": [4, 5, 6].map((index) => ({ repository: `capture/ordinary-${index}`, message: `Ordinary captured refactor ${index}` })),
  };
  let commitIndex = 0;
  profile.github.queries.forEach((query) => {
    const entries = perQuery[query.id] ?? [];
    const sources = entries.map(({ repository, message }) => addCommit(http, commitIndex++, repository, message));
    const url = new URL("https://api.github.com/search/commits");
    Object.entries({ q: query.query, sort: query.sort, order: query.order, page: "1", per_page: "100" })
      .forEach(([key, value]) => url.searchParams.set(key, value));
    http.set(url.href, { total_count: sources.length, incomplete_results: query.id === providerIncompleteQueryId, items: sources.map((source, index) => ({
      sha: source.commit, url: `https://api.github.com/repos/${source.repository}/commits/${source.commit}`,
      html_url: `https://github.com/${source.repository}/commit/${source.commit}`,
      commit: { committer: { date: `2026-07-${String(20 - index).padStart(2, "0")}T10:00:00Z` } },
      repository: { full_name: source.repository, url: `https://api.github.com/repos/${source.repository}`,
        html_url: `https://github.com/${source.repository}` },
    })) });
  });
  const repeated = (count: number, block: (index: number) => readonly string[]): Buffer =>
    Buffer.from(Array.from({ length: count }, (_, index) => block(index).join("\n")).join("\n"));
  const sources: Readonly<Record<StackLanguage, Readonly<{ path: string; bytes: Buffer }>>> = {
    Python: { path: "captured.py", bytes: repeated(40, (index) => [`def captured_${index}(value):`, `    adjusted = value + ${index + 7}`, "    return adjusted * 2", ""]) },
    TypeScript: { path: "captured.ts", bytes: repeated(30, (index) => [`export function captured${index}(value: number): number {`, `  const adjusted = value + ${index + 9};`, "  return adjusted * 3;", "}", ""]) },
    Go: { path: "captured.go", bytes: Buffer.from(["package captured", "", ...Array.from({ length: 20 }, (_, index) => `func captured${index}(value int) int {\n\tadjusted := value + ${index + 5}\n\treturn adjusted * 4\n}\n`)].join("\n")) },
    Rust: { path: "captured.rs", bytes: repeated(25, (index) => [`pub fn captured_${index}(value: i64) -> i64 {`, `    let adjusted = value + ${index + 3};`, "    adjusted * 5", "}", ""]) },
    Ruby: { path: "captured.rb", bytes: repeated(25, (index) => [`def captured_${index}(value)`, `  adjusted = value + ${index + 2}`, "  adjusted * 6", "end", ""]) },
  };
  const languages = STACK_LANGUAGES.map((language, index) => [language, addLanguage(http, index, language, sources[language].path, sources[language].bytes)] as const);
  return Object.freeze({
    http,
    metadata: Object.freeze(Object.fromEntries(languages.map(([language, { row }]) => [language, row]))) as Readonly<Record<StackLanguage, StackMetadataRow>>,
    selectedBlobs: new Map(languages.map(([, { row, selected }]) => [row.stableRowId, selected])),
  });
};
