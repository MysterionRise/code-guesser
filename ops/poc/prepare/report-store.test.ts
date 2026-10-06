import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReportStoreError, stageRunReport } from "./report-store";

const testModuleName: string = "vitest";
const { afterEach, describe, expect, it } = await import(testModuleName) as any;

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true }))));

const makeDirectory = async (previous?: string): Promise<{ directory: string; target: string }> => {
  const directory = await mkdtemp(join(tmpdir(), "codeguessr-report-"));
  temporaryDirectories.push(directory);
  const target = join(directory, "local-experiment-run.json");
  if (previous !== undefined) await writeFile(target, previous, "utf8");
  return { directory, target };
};
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const uniqueId = (): string => "11111111-1111-4111-8111-111111111111";

describe("two-phase run-report publication", () => {
  it("stages beside the target with mode 0600 without replacing the previous report", async () => {
    const { directory, target } = await makeDirectory("previous-report");

    const staged = await stageRunReport({ bytes: bytes("next-report"), targetPath: target, uniqueId });

    expect(await readFile(target, "utf8")).toBe("previous-report");
    const names = await readdir(directory);
    expect(names).toEqual([".local-experiment-run.json.11111111-1111-4111-8111-111111111111.tmp", "local-experiment-run.json"]);
    expect((await stat(join(directory, names[0]!))).mode & 0o777).toBe(0o600);
    await staged.rollback();
  });

  it("commits by backing up and renaming, then finalize removes the backup", async () => {
    const { directory, target } = await makeDirectory("previous-report");
    const staged = await stageRunReport({ bytes: bytes("next-report"), targetPath: target, uniqueId });

    await staged.commit();
    expect(await readFile(target, "utf8")).toBe("next-report");
    expect(await readdir(directory)).toEqual([".local-experiment-run.json.11111111-1111-4111-8111-111111111111.bak", "local-experiment-run.json"]);

    await staged.finalize();
    expect(await readdir(directory)).toEqual(["local-experiment-run.json"]);
    expect(await readFile(target, "utf8")).toBe("next-report");
  });

  it("commits a first report when no previous report exists", async () => {
    const { directory, target } = await makeDirectory();
    const staged = await stageRunReport({ bytes: bytes("first-report"), targetPath: target, uniqueId });

    await staged.commit();
    await staged.finalize();

    expect(await readdir(directory)).toEqual(["local-experiment-run.json"]);
    expect(await readFile(target, "utf8")).toBe("first-report");
  });

  it("rollback before commit removes only the staged file", async () => {
    const { directory, target } = await makeDirectory("previous-report");
    const staged = await stageRunReport({ bytes: bytes("next-report"), targetPath: target, uniqueId });

    await staged.rollback();

    expect(await readdir(directory)).toEqual(["local-experiment-run.json"]);
    expect(await readFile(target, "utf8")).toBe("previous-report");
  });

  it("rollback after commit restores the previous bytes or removes a first report", async () => {
    const replaced = await makeDirectory("previous-report");
    const staged = await stageRunReport({ bytes: bytes("next-report"), targetPath: replaced.target, uniqueId });
    await staged.commit();
    await staged.rollback();
    expect(await readdir(replaced.directory)).toEqual(["local-experiment-run.json"]);
    expect(await readFile(replaced.target, "utf8")).toBe("previous-report");

    const first = await makeDirectory();
    const firstStaged = await stageRunReport({ bytes: bytes("first-report"), targetPath: first.target, uniqueId });
    await firstStaged.commit();
    await firstStaged.rollback();
    expect(await readdir(first.directory)).toEqual([]);
  });

  it("rejects relative targets, malformed ids, and keeps only stable codes in failures", async () => {
    await expect(stageRunReport({ bytes: bytes("x"), targetPath: "relative/run.json", uniqueId }))
      .rejects.toMatchObject({ code: "INVALID_TARGET" });
    await expect(stageRunReport({ bytes: bytes("x"), targetPath: "/tmp/run.json", uniqueId: () => "../escape" }))
      .rejects.toMatchObject({ code: "INVALID_TEMP_ID" });

    const { directory, target } = await makeDirectory("previous-report");
    const failing = await stageRunReport({ bytes: bytes("next-report"), targetPath: target, uniqueId,
      fileSystem: { link: async () => { throw new Error("Bearer raw-secret /private/path"); }, open: (await import("node:fs/promises")).open,
        rename: (await import("node:fs/promises")).rename, unlink: (await import("node:fs/promises")).unlink } });
    let failure: unknown;
    try { await failing.commit(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ReportStoreError);
    expect((failure as ReportStoreError).code).toBe("REPORT_COMMIT_FAILED");
    expect(JSON.stringify({ ...(failure as object), message: (failure as Error).message, stack: "" })).not.toMatch(/raw-secret|private\/path/u);
    await failing.rollback();
    expect(await readdir(directory)).toEqual(["local-experiment-run.json"]);
    expect(await readFile(target, "utf8")).toBe("previous-report");
  });
});
