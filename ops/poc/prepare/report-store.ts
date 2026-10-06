import { link, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { ArtifactStoreFileSystem, ArtifactStoreHandle } from "./artifact-store";

export class ReportStoreError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "ReportStoreError";
  }
}

export interface StageRunReportOptions {
  readonly bytes: Uint8Array;
  readonly targetPath: string;
  readonly fileSystem?: ArtifactStoreFileSystem;
  readonly uniqueId?: () => string;
}

export interface StagedRunReport {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  finalize(): Promise<void>;
}

const NODE_FILE_SYSTEM: ArtifactStoreFileSystem = Object.freeze({ link, open, rename, unlink });
const REPORT_MODE = 0o600;

interface ReportState {
  staged: boolean;
  backup: boolean;
  committed: boolean;
}

const closeQuietly = async (handle: ArtifactStoreHandle | undefined): Promise<void> => {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    // Preserve the first failure code.
  }
};

const unlinkQuietly = async (fileSystem: ArtifactStoreFileSystem, path: string): Promise<void> => {
  try {
    await fileSystem.unlink(path);
  } catch {
    // A failed cleanup must not replace the primary failure code.
  }
};

const syncDirectory = async (fileSystem: ArtifactStoreFileSystem, directory: string): Promise<void> => {
  const handle = await fileSystem.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await closeQuietly(handle);
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

export const stageRunReport = async (options: StageRunReportOptions): Promise<StagedRunReport> => {
  const { targetPath } = options;
  if (!isAbsolute(targetPath) || basename(targetPath) === "." || basename(targetPath) === "..") {
    throw new ReportStoreError("INVALID_TARGET");
  }
  const fileSystem = options.fileSystem ?? NODE_FILE_SYSTEM;
  const uniqueId = (options.uniqueId ?? randomUUID)();
  if (!/^[A-Za-z0-9-]+$/u.test(uniqueId)) throw new ReportStoreError("INVALID_TEMP_ID");
  const directory = dirname(targetPath);
  const temporaryPath = join(directory, `.${basename(targetPath)}.${uniqueId}.tmp`);
  const backupPath = join(directory, `.${basename(targetPath)}.${uniqueId}.bak`);
  const state: ReportState = { staged: false, backup: false, committed: false };

  let handle: ArtifactStoreHandle | undefined;
  try {
    handle = await fileSystem.open(temporaryPath, "wx", REPORT_MODE);
    state.staged = true;
    await handle.writeFile(options.bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch {
    await closeQuietly(handle);
    if (state.staged) await unlinkQuietly(fileSystem, temporaryPath);
    throw new ReportStoreError("REPORT_STAGE_FAILED");
  }

  const commit = async (): Promise<void> => {
    if (!state.staged || state.committed) throw new ReportStoreError("REPORT_COMMIT_FAILED");
    try {
      state.backup = await createBackup(fileSystem, targetPath, backupPath);
      await syncDirectory(fileSystem, directory);
      await fileSystem.rename(temporaryPath, targetPath);
      state.staged = false;
      state.committed = true;
      await syncDirectory(fileSystem, directory);
    } catch {
      throw new ReportStoreError("REPORT_COMMIT_FAILED");
    }
  };

  const rollback = async (): Promise<void> => {
    try {
      if (state.committed) {
        if (state.backup) await fileSystem.rename(backupPath, targetPath);
        else await fileSystem.unlink(targetPath);
        state.committed = false;
        state.backup = false;
        await syncDirectory(fileSystem, directory);
        return;
      }
      if (state.staged) {
        await unlinkQuietly(fileSystem, temporaryPath);
        state.staged = false;
      }
      if (state.backup) {
        await unlinkQuietly(fileSystem, backupPath);
        state.backup = false;
      }
    } catch {
      throw new ReportStoreError("REPORT_ROLLBACK_FAILED");
    }
  };

  const finalize = async (): Promise<void> => {
    if (!state.committed) throw new ReportStoreError("REPORT_FINALIZE_FAILED");
    if (state.backup) {
      await unlinkQuietly(fileSystem, backupPath);
      state.backup = false;
    }
  };

  return Object.freeze({ commit, rollback, finalize });
};
