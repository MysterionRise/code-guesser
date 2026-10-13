import { link, mkdtemp, open, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalArtifactBytes, canonicalArtifactHash } from "./canonical";
import { composeExperimentArtifact } from "./compose";
import { composeInput } from "./testdata/v2-builders";
import {
  ArtifactStoreError,
  publishArtifact,
  type ArtifactStoreFileSystem,
} from "./artifact-store";

const testModuleName: string = "vitest";
const { afterEach, describe, expect, it } = await import(testModuleName) as any;

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true }))));

const hash = (digit: string): string => digit.repeat(64);
const artifact = () => structuredClone(composeExperimentArtifact(composeInput()).artifact) as Record<string, any>;

const makeTarget = async (): Promise<{ directory: string; target: string }> => {
  const directory = await mkdtemp(join(tmpdir(), "codeguessr-artifact-"));
  temporaryDirectories.push(directory);
  const target = join(directory, "local-real-rounds.json");
  await writeFile(target, "previous-artifact", "utf8");
  return { directory, target };
};

const makeMissingTarget = async (): Promise<{ directory: string; target: string }> => {
  const directory = await mkdtemp(join(tmpdir(), "codeguessr-artifact-"));
  temporaryDirectories.push(directory);
  return { directory, target: join(directory, "local-real-rounds.json") };
};

type FailureStage = "none" | "write" | "fileSync" | "close" | "directoryOpen" | "directorySync" | "directoryClose" | "rename";
const injectedFileSystem = (stage: FailureStage, events: string[]): ArtifactStoreFileSystem => ({
  open: async (path, flags, mode) => {
    events.push(`open:${flags}:${path}`);
    if (stage === "directoryOpen" && flags === "r") throw new Error("injected directory open");
    const handle = await open(path, flags, mode);
    const directoryHandle = flags === "r";
    let closeFailed = false;
    let directorySyncs = 0;
    return {
      writeFile: async (data) => {
        events.push("write");
        if (stage === "write") throw new Error("injected write");
        await handle.writeFile(data);
      },
      sync: async () => {
        events.push(directoryHandle ? "directorySync" : "fileSync");
        if (directoryHandle) directorySyncs += 1;
        if (stage === "directorySync" && directoryHandle && directorySyncs === 2) {
          throw new Error("injected directory sync");
        }
        if (stage === "fileSync" && !directoryHandle) throw new Error("injected sync");
        await handle.sync();
      },
      close: async () => {
        events.push(directoryHandle ? "directoryClose" : "fileClose");
        if (stage === "directoryClose" && directoryHandle) {
          await handle.close();
          throw new Error("injected directory close");
        }
        if (stage === "close" && !directoryHandle && !closeFailed) {
          closeFailed = true;
          throw new Error("injected close");
        }
        await handle.close();
      },
    };
  },
  rename: async (from, to) => {
    events.push("rename");
    if (stage === "rename") throw new Error("injected rename");
    await rename(from, to);
  },
  link: async (from, to) => {
    events.push("link");
    await link(from, to);
  },
  unlink,
});

describe("atomic artifact publication", () => {
  it("exposes one hash-verifying publisher", async () => {
    const moduleName: string = "./artifact-store";
    const storeModule = await import(moduleName).catch(() => ({})) as Record<string, unknown>;

    expect(storeModule.publishArtifact).toBeTypeOf("function");
  });

  it("writes canonical bytes through an exclusive same-directory file and syncs the directory", async () => {
    const { directory, target } = await makeTarget();
    const candidate = artifact();
    const events: string[] = [];

    const published = await publishArtifact({
      artifact: candidate,
      expectedHash: canonicalArtifactHash(candidate),
      targetPath: target,
      fileSystem: injectedFileSystem("none", events),
      uniqueId: () => "11111111-1111-4111-8111-111111111111",
    });

    expect(published).toEqual({ path: target, hash: canonicalArtifactHash(candidate), bytes: canonicalArtifactBytes(candidate).byteLength });
    expect(await readFile(target)).toEqual(Buffer.from(canonicalArtifactBytes(candidate)));
    expect(events).toContain("directorySync");
    expect(events.findIndex((event) => event.startsWith("open:r:"))).toBeLessThan(events.indexOf("rename"));
    const tempOpen = events.find((event) => event.startsWith("open:wx:"));
    expect(tempOpen).toContain(`${dirname(target)}/`);
    expect(await readdir(directory)).toEqual(["local-real-rounds.json"]);
    expect(Object.isFrozen(published)).toBe(true);
  });

  it("preserves old bytes when the directory cannot be opened and treats post-sync close as best effort", async () => {
    const openFailure = await makeTarget();
    const candidate = artifact();
    await expect(publishArtifact({
      artifact: candidate,
      expectedHash: canonicalArtifactHash(candidate),
      targetPath: openFailure.target,
      fileSystem: injectedFileSystem("directoryOpen", []),
      uniqueId: () => "11111111-1111-4111-8111-111111111111",
    })).rejects.toBeInstanceOf(ArtifactStoreError);
    expect(await readFile(openFailure.target, "utf8")).toBe("previous-artifact");

    const closeFailure = await makeTarget();
    await expect(publishArtifact({
      artifact: candidate,
      expectedHash: canonicalArtifactHash(candidate),
      targetPath: closeFailure.target,
      fileSystem: injectedFileSystem("directoryClose", []),
      uniqueId: () => "11111111-1111-4111-8111-111111111111",
    })).resolves.toMatchObject({ hash: canonicalArtifactHash(candidate) });
    expect(await readFile(closeFailure.target)).toEqual(Buffer.from(canonicalArtifactBytes(candidate)));

    const syncFailure = await makeTarget();
    await expect(publishArtifact({
      artifact: candidate,
      expectedHash: canonicalArtifactHash(candidate),
      targetPath: syncFailure.target,
      fileSystem: injectedFileSystem("directorySync", []),
      uniqueId: () => "11111111-1111-4111-8111-111111111111",
    })).rejects.toBeInstanceOf(ArtifactStoreError);
    expect(await readFile(syncFailure.target, "utf8")).toBe("previous-artifact");
    expect(await readdir(syncFailure.directory)).toEqual(["local-real-rounds.json"]);

    const missing = await makeMissingTarget();
    await expect(publishArtifact({
      artifact: candidate,
      expectedHash: canonicalArtifactHash(candidate),
      targetPath: missing.target,
      fileSystem: injectedFileSystem("directorySync", []),
      uniqueId: () => "11111111-1111-4111-8111-111111111111",
    })).rejects.toBeInstanceOf(ArtifactStoreError);
    await expect(readFile(missing.target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(missing.directory)).toEqual([]);
  });

  it("rejects malformed or hash-mismatched input before touching the previous artifact", async () => {
    const { directory, target } = await makeTarget();

    await expect(publishArtifact({ artifact: {}, expectedHash: hash("1"), targetPath: target }))
      .rejects.toBeInstanceOf(ArtifactStoreError);
    await expect(publishArtifact({ artifact: artifact(), expectedHash: hash("9"), targetPath: target }))
      .rejects.toBeInstanceOf(ArtifactStoreError);

    expect(await readFile(target, "utf8")).toBe("previous-artifact");
    expect(await readdir(directory)).toEqual(["local-real-rounds.json"]);
  });

  it("cleans temporary and backup files while preserving previous bytes on pre-publication failure", async () => {
    for (const stage of ["write", "fileSync", "close", "rename"] as const) {
      const { directory, target } = await makeTarget();
      const candidate = artifact();
      const events: string[] = [];
      await expect(publishArtifact({
        artifact: candidate,
        expectedHash: canonicalArtifactHash(candidate),
        targetPath: target,
        fileSystem: injectedFileSystem(stage, events),
        uniqueId: () => "11111111-1111-4111-8111-111111111111",
      })).rejects.toBeInstanceOf(ArtifactStoreError);

      expect(await readFile(target, "utf8")).toBe("previous-artifact");
      expect(await readdir(directory)).toEqual(["local-real-rounds.json"]);
      if (stage === "rename") expect(events).toContain("link");
    }
  });

  it("invokes beforeCommit after the new bytes are in place and while the backup still exists", async () => {
    const { directory, target } = await makeTarget();
    const candidate = artifact();
    const observed: { bytes: Buffer; names: string[] }[] = [];

    await publishArtifact({
      artifact: candidate,
      expectedHash: canonicalArtifactHash(candidate),
      targetPath: target,
      uniqueId: () => "11111111-1111-4111-8111-111111111111",
      beforeCommit: async () => { observed.push({ bytes: await readFile(target), names: await readdir(directory) }); },
    });

    expect(observed).toHaveLength(1);
    expect(observed[0]!.bytes).toEqual(Buffer.from(canonicalArtifactBytes(candidate)));
    expect(observed[0]!.names).toEqual([".local-real-rounds.json.11111111-1111-4111-8111-111111111111.bak", "local-real-rounds.json"]);
    expect(await readdir(directory)).toEqual(["local-real-rounds.json"]);
  });

  it("restores the previous artifact and reports PUBLICATION_FAILED when beforeCommit rejects", async () => {
    const { directory, target } = await makeTarget();
    const candidate = artifact();

    await expect(publishArtifact({
      artifact: candidate,
      expectedHash: canonicalArtifactHash(candidate),
      targetPath: target,
      uniqueId: () => "11111111-1111-4111-8111-111111111111",
      beforeCommit: async () => { throw new Error("REPORT_COMMIT_FAILED"); },
    })).rejects.toMatchObject({ code: "PUBLICATION_FAILED" });

    expect(await readFile(target, "utf8")).toBe("previous-artifact");
    expect(await readdir(directory)).toEqual(["local-real-rounds.json"]);

    const missing = await makeMissingTarget();
    await expect(publishArtifact({
      artifact: candidate,
      expectedHash: canonicalArtifactHash(candidate),
      targetPath: missing.target,
      uniqueId: () => "11111111-1111-4111-8111-111111111111",
      beforeCommit: async () => { throw new Error("REPORT_COMMIT_FAILED"); },
    })).rejects.toMatchObject({ code: "PUBLICATION_FAILED" });
    expect(await readdir(missing.directory)).toEqual([]);
  });
});
