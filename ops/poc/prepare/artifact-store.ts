import { link, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join } from "node:path";
import { canonicalArtifactBytes, canonicalArtifactHash } from "./canonical";
import { parseExperimentArtifact } from "./model";

export class ArtifactStoreError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "ArtifactStoreError";
  }
}

export interface ArtifactStoreHandle {
  writeFile(data: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface ArtifactStoreFileSystem {
  open(path: string, flags: "wx" | "r", mode?: number): Promise<ArtifactStoreHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface PublishArtifactOptions {
  readonly artifact: unknown;
  readonly expectedHash: string;
  readonly targetPath: string;
  readonly fileSystem?: ArtifactStoreFileSystem;
  readonly uniqueId?: () => string;
  /** Runs after the new artifact is in place and before its backup is discarded; a rejection restores the previous artifact. */
  readonly beforeCommit?: () => Promise<void>;
}

export interface PublishedArtifact {
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
}

const NODE_FILE_SYSTEM: ArtifactStoreFileSystem = Object.freeze({ link, open, rename, unlink });
const ARTIFACT_MODE = 0o600;

const validateArtifact = (artifact: unknown, expectedHash: string): {
  readonly bytes: Uint8Array;
  readonly hash: string;
} => {
  if (!/^[0-9a-f]{64}$/u.test(expectedHash)) throw new ArtifactStoreError("INVALID_HASH");
  try {
    const parsed = parseExperimentArtifact(artifact);
    const hash = canonicalArtifactHash(parsed);
    if (hash !== expectedHash) throw new ArtifactStoreError("HASH_MISMATCH");
    return { bytes: canonicalArtifactBytes(parsed), hash };
  } catch (error) {
    if (error instanceof ArtifactStoreError) throw error;
    throw new ArtifactStoreError("INVALID_ARTIFACT");
  }
};

const validateTarget = (targetPath: string): void => {
  if (!isAbsolute(targetPath) || basename(targetPath) === "." || basename(targetPath) === "..") {
    throw new ArtifactStoreError("INVALID_TARGET");
  }
};

const closeQuietly = async (handle: ArtifactStoreHandle | undefined): Promise<void> => {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    // Preserve the first publication failure.
  }
};

const unlinkQuietly = async (fileSystem: ArtifactStoreFileSystem, path: string): Promise<void> => {
  try {
    await fileSystem.unlink(path);
  } catch {
    // A failed cleanup must not replace the primary failure code.
  }
};

const createBackup = async (
  fileSystem: ArtifactStoreFileSystem,
  targetPath: string,
  backupPath: string,
): Promise<boolean> => {
  try {
    await fileSystem.link(targetPath, backupPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

interface PublicationState {
  temporary: boolean;
  backup: boolean;
  published: boolean;
}

const cleanupFailure = async (
  fileSystem: ArtifactStoreFileSystem,
  paths: Readonly<{ target: string; temporary: string; backup: string }>,
  state: PublicationState,
  directoryHandle: ArtifactStoreHandle | undefined,
): Promise<boolean> => {
  if (state.published) {
    try {
      if (state.backup) await fileSystem.rename(paths.backup, paths.target);
      else await fileSystem.unlink(paths.target);
      state.published = false;
      state.backup = false;
      await directoryHandle?.sync();
    } catch {
      await closeQuietly(directoryHandle);
      return true;
    }
  } else {
    if (state.temporary) await unlinkQuietly(fileSystem, paths.temporary);
    if (state.backup) await unlinkQuietly(fileSystem, paths.backup);
    try {
      await directoryHandle?.sync();
    } catch {
      // The active target was never replaced.
    }
  }
  await closeQuietly(directoryHandle);
  return false;
};

export const publishArtifact = async (options: PublishArtifactOptions): Promise<PublishedArtifact> => {
  validateTarget(options.targetPath);
  const verified = validateArtifact(options.artifact, options.expectedHash);
  const fileSystem = options.fileSystem ?? NODE_FILE_SYSTEM;
  const uniqueId = (options.uniqueId ?? randomUUID)();
  if (!/^[A-Za-z0-9-]+$/u.test(uniqueId)) throw new ArtifactStoreError("INVALID_TEMP_ID");
  const directory = dirname(options.targetPath);
  const temporaryPath = join(directory, `.${basename(options.targetPath)}.${uniqueId}.tmp`);
  const backupPath = join(directory, `.${basename(options.targetPath)}.${uniqueId}.bak`);
  const paths = { target: options.targetPath, temporary: temporaryPath, backup: backupPath };
  let fileHandle: ArtifactStoreHandle | undefined;
  let directoryHandle: ArtifactStoreHandle | undefined;
  const state: PublicationState = { temporary: false, backup: false, published: false };
  try {
    fileHandle = await fileSystem.open(temporaryPath, "wx", ARTIFACT_MODE);
    state.temporary = true;
    await fileHandle.writeFile(verified.bytes);
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;
    directoryHandle = await fileSystem.open(directory, "r");
    state.backup = await createBackup(fileSystem, options.targetPath, backupPath);
    await directoryHandle.sync();
    await fileSystem.rename(temporaryPath, options.targetPath);
    state.temporary = false;
    state.published = true;
    await directoryHandle.sync();
    if (options.beforeCommit) await options.beforeCommit();
    if (state.backup) {
      await fileSystem.unlink(backupPath);
      state.backup = false;
    }
    await closeQuietly(directoryHandle);
    directoryHandle = undefined;
    return Object.freeze({
      path: options.targetPath,
      hash: verified.hash,
      bytes: verified.bytes.byteLength,
    });
  } catch {
    await closeQuietly(fileHandle);
    const rollbackFailed = await cleanupFailure(fileSystem, paths, state, directoryHandle);
    throw new ArtifactStoreError(rollbackFailed ? "ROLLBACK_FAILED" : "PUBLICATION_FAILED");
  }
};
