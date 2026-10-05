import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalSha256,
  appendAuditEvent,
  READ_ONLY_PUBLIC_REPOSITORY_TOKEN,
} from "@codeguessr/content/operator/acquisition";
import {
  OperatorCommandError,
  runInternalSourceReceiptStep,
  runOperatorCommand,
} from "./index";
import { PauseResumeError } from "./pause-resume";
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;
const root = process.cwd();
const receipt = "2026-01-01T00:00:00Z";
const receiptMs = Date.parse(receipt);
const githubDate = "Thu, 01 Jan 2026 00:00:00 GMT";
const purpose = "LANGUAGE_CANDIDATE";
const childTreeSha = "c".repeat(40);
const parentTreeSha = "d".repeat(40);
const commitMessage = "Implement answer\n\nCo-authored-by: Claude <noreply@anthropic.com>";
const repositoryMetadata = {
  repositoryId: "R_1",
  repository: "owner/repo",
  visibility: "public",
  archived: false,
  disabled: false,
  licenseIdentifier: "MIT",
};
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const sha256 = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
const gitBlobSha = (value: Uint8Array): string =>
  createHash("sha1").update(`blob ${value.byteLength}\0`).update(value).digest("hex");
interface TreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly type: string;
  readonly sha: string;
}
const gitTree = (entries: readonly TreeEntry[]) => {
  const body = Buffer.concat(entries
    .map((entry) => ({
      entry,
      sortName: entry.type === "tree" ? `${entry.path}/` : entry.path,
    }))
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left.sortName), Buffer.from(right.sortName)))
    .map(({ entry }) => Buffer.concat([
      Buffer.from(`${entry.mode === "040000" ? "40000" : entry.mode} ${entry.path}\0`),
      Buffer.from(entry.sha, "hex"),
    ])));
  return {
    sha: createHash("sha1").update(`tree ${body.byteLength}\0`).update(body).digest("hex"),
    truncated: false,
    tree: entries,
  };
};
const effectiveFixture = (validThrough?: string) => {
  const policy = (
    policyClass: "REPOSITORY_ADMISSION" | "ATTRIBUTION_MARKER",
  ) => ({
    policyClass,
    policyVersion: `${policyClass.toLowerCase()}-v1`,
    permittedPurposes: [purpose],
    ...(policyClass === "REPOSITORY_ADMISSION"
      ? { repositories: [{ repository: "owner/repo", approvedSubtrees: ["src"] }] }
      : {}),
  });
  const repositoryPolicy = policy("REPOSITORY_ADMISSION");
  const attributionPolicy = policy("ATTRIBUTION_MARKER");
  const policyEntry = (
    controlledPolicy: typeof repositoryPolicy | typeof attributionPolicy,
  ) => ({
    entryId: `${controlledPolicy.policyClass.toLowerCase()}-entry`,
    policyClass: controlledPolicy.policyClass,
    policyVersion: controlledPolicy.policyVersion,
    policyHash: canonicalSha256(controlledPolicy),
    permittedPurposes: [purpose],
    validFrom: receipt,
    ...(validThrough === undefined ? {} : { validThrough }),
    approvals: [
      { role: "Don", approverId: "approver-one", approvedAt: receipt },
      { role: "Rights/Safety Reviewer", approverId: "approver-two", approvedAt: receipt },
    ],
  });
  const approvedPolicyRegister = {
    registerVersion: "approved-policies-v1",
    entries: [policyEntry(repositoryPolicy), policyEntry(attributionPolicy)],
  };
  const operatorEntry = {
    entryId: "operator-entry",
    operatorName: "Operator",
    osIdentity: "uid:1",
    repositories: ["owner/repo"],
    purposes: [purpose],
    tokenAllowance: READ_ONLY_PUBLIC_REPOSITORY_TOKEN,
    validFrom: receipt,
    ...(validThrough === undefined ? {} : { validThrough }),
    approvals: [
      { role: "Release Operator", approverId: "release", approvedAt: receipt },
      { role: "Security Reviewer", approverId: "security", approvedAt: receipt },
    ],
  };
  const operatorAuthorizationRegister = {
    registerVersion: "operators-v1",
    entries: [operatorEntry],
  };
  const policyInput = (
    controlledPolicy: typeof repositoryPolicy | typeof attributionPolicy,
  ) => {
    const entry = approvedPolicyRegister.entries.find(
      (candidate) => candidate.policyClass === controlledPolicy.policyClass,
    )!;
    return {
      policy: controlledPolicy,
      register: approvedPolicyRegister,
      binding: {
        registerVersion: approvedPolicyRegister.registerVersion,
        registerHash: canonicalSha256(approvedPolicyRegister),
        entryId: entry.entryId,
      },
      purpose,
      authoritativeReceiptTime: receipt,
    };
  };
  return {
    descriptor: {
      request: {
        repository: "owner/repo",
        commit: "a".repeat(40),
        subtree: "src",
        purpose,
        observationTime: receipt,
      },
      repositoryPolicy: policyInput(repositoryPolicy),
      attributionPolicy: policyInput(attributionPolicy),
      operatorAuthorization: {
        register: operatorAuthorizationRegister,
        binding: {
          registerVersion: operatorAuthorizationRegister.registerVersion,
          registerHash: canonicalSha256(operatorAuthorizationRegister),
          entryId: operatorEntry.entryId,
        },
        operatorName: operatorEntry.operatorName,
        osIdentity: operatorEntry.osIdentity,
        repository: "owner/repo",
        purpose,
        tokenAllowance: READ_ONLY_PUBLIC_REPOSITORY_TOKEN,
        callerObservationTime: receipt,
        authoritativeReceiptTime: receipt,
        githubDate,
      },
    },
    controls: {
      repositoryPolicy,
      attributionPolicy,
      approvedPolicyRegister,
      operatorAuthorizationRegister,
    },
  };
};
const dependencies = (
  fixture: ReturnType<typeof effectiveFixture>,
  fetch: (request: Request) => Promise<Response>,
  now = receiptMs,
) => ({
  loadRunDescriptor: async () => fixture.descriptor,
  loadProjectControls: async () => fixture.controls,
  fetch,
  now: () => now,
  osIdentity: () => "uid:1",
});
const successfulResponse = () => new Response(JSON.stringify({
  sha: "a".repeat(40),
  parents: [{ sha: "b".repeat(40) }],
  commit: {
    message: commitMessage,
    tree: { sha: childTreeSha },
    verification: { verified: true, reason: "valid" },
    author: { name: "Developer" },
    committer: { name: "Developer" },
  },
  author: { login: "developer", type: "User" },
  committer: { login: "developer", type: "User" },
}), {
  status: 200,
  headers: { "content-type": "application/json", date: githubDate },
});
const parentResponse = () => new Response(JSON.stringify({
  sha: "b".repeat(40),
  commit: { tree: { sha: parentTreeSha } },
}), { status: 200, headers: { "content-type": "application/json" } });
const repositoryResponse = () => new Response(JSON.stringify({
  node_id: repositoryMetadata.repositoryId,
  full_name: repositoryMetadata.repository,
  visibility: repositoryMetadata.visibility,
  private: false,
  archived: repositoryMetadata.archived,
  disabled: repositoryMetadata.disabled,
  license: { spdx_id: repositoryMetadata.licenseIdentifier },
}), { status: 200, headers: { "content-type": "application/json" } });
const rateLimitedResponse = () => new Response(null, {
  status: 429,
  headers: { "retry-after": "60" },
});
const memoryOperatorState = (options: {
  readonly failPausePersistence?: boolean;
  readonly failAuditEvent?: string;
} = {}) => {
  const objects = new Map<string, Uint8Array>();
  let audit: readonly any[] = [];
  const store = {
    put: async ({ identity, plaintext }: any) => {
      if (options.failPausePersistence
        && Buffer.from(plaintext).includes(Buffer.from("github-rate-limit-pause-v1"))) {
        throw new Error("pause persistence canary");
      }
      const created = !objects.has(identity.objectId);
      if (created) objects.set(identity.objectId, new Uint8Array(plaintext));
      return { identity, created };
    },
    read: async (identity: any) => {
      const value = objects.get(identity.objectId);
      if (value === undefined) throw new Error("missing object");
      return new Uint8Array(value);
    },
    remove: async ({ objectId }: any) => objects.delete(objectId),
  };
  const auditSink = {
    append: async (event: any) => {
      if (event.eventType === options.failAuditEvent) {
        throw new Error("audit canary");
      }
      audit = appendAuditEvent(audit, event);
      return audit;
    },
  };
  return {
    objects,
    audit: () => audit,
    prepare: async () => ({
      open: async () => ({ store, audit: auditSink }),
      openStore: async () => store,
      openAudit: async () => auditSink,
      dispose: () => undefined,
    }),
  };
};
const resumableLanguageScenario = (rejectResumedSource = false) => {
  const parentBytes = bytes("export const answer = 41;\n");
  const childBytes = bytes("export const answer = 42;\n");
  const licenseBytes = bytes("MIT License\n");
  const parentBlob = gitBlobSha(parentBytes);
  const childBlob = gitBlobSha(childBytes);
  const licenseBlob = gitBlobSha(licenseBytes);
  const parentSubtree = gitTree([
    { path: "answer.ts", mode: "100644", type: "blob", sha: parentBlob },
  ]);
  const childSubtree = gitTree([
    { path: "answer.ts", mode: "100644", type: "blob", sha: childBlob },
  ]);
  const parentRoot = gitTree([
    { path: "src", mode: "040000", type: "tree", sha: parentSubtree.sha },
  ]);
  const childRoot = gitTree([
    { path: "LICENSE", mode: "100644", type: "blob", sha: licenseBlob },
    { path: "src", mode: "040000", type: "tree", sha: childSubtree.sha },
  ]);
  const trees = new Map([
    [parentRoot.sha, parentRoot],
    [childRoot.sha, childRoot],
    [parentSubtree.sha, parentSubtree],
    [childSubtree.sha, childSubtree],
  ]);
  const blobs = new Map([
    [parentBlob, parentBytes],
    [childBlob, childBytes],
    [licenseBlob, licenseBytes],
  ]);
  let paused = false;
  let childReceiptCalls = 0;
  const fetch = async (request: Request): Promise<Response> => {
    if (request.url.endsWith(`/commits/${"a".repeat(40)}`)) {
      childReceiptCalls += 1;
      if (rejectResumedSource && childReceiptCalls > 1) {
        return new Response(JSON.stringify({ sha: "malformed" }), {
          headers: { date: githubDate },
        });
      }
      return new Response(JSON.stringify({
        sha: "a".repeat(40),
        parents: [{ sha: "b".repeat(40) }],
        commit: {
          message: "Implement answer",
          tree: { sha: childRoot.sha },
          verification: { verified: true, reason: "valid" },
          author: { name: "Developer" },
          committer: { name: "Developer" },
        },
        author: { login: "developer", type: "User" },
        committer: { login: "developer", type: "User" },
      }), { headers: { date: githubDate } });
    }
    if (request.url.endsWith(`/commits/${"b".repeat(40)}`)) {
      return new Response(JSON.stringify({
        sha: "b".repeat(40), commit: { tree: { sha: parentRoot.sha } },
      }));
    }
    if (request.url === "https://api.github.com/repos/owner/repo") {
      return repositoryResponse();
    }
    const treeIdentity = request.url.match(/\/git\/trees\/([0-9a-f]{40})$/u)?.[1];
    if (treeIdentity === parentRoot.sha && !paused) {
      paused = true;
      return rateLimitedResponse();
    }
    if (treeIdentity !== undefined) {
      return new Response(JSON.stringify(trees.get(treeIdentity)));
    }
    const blobIdentity = request.url.match(/\/git\/blobs\/([0-9a-f]{40})$/u)?.[1];
    const content = blobIdentity === undefined ? undefined : blobs.get(blobIdentity);
    if (blobIdentity === undefined || content === undefined) {
      throw new Error("unexpected object endpoint");
    }
    return new Response(JSON.stringify({
      sha: blobIdentity,
      encoding: "base64",
      size: content.byteLength,
      content: Buffer.from(content).toString("base64"),
    }));
  };
  return {
    fetch,
    prePauseObjectIds: [
      sha256(bytes(JSON.stringify(childRoot))),
      sha256(bytes(JSON.stringify(childSubtree))),
      sha256(childBytes),
    ],
  };
};
describe("operator-only acquisition command", () => {
  it("exposes acquisition only through a node operator subpath and locked root runner", async () => {
    const workspace = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const content = JSON.parse(await readFile(join(root, "packages/content/package.json"), "utf8"));
    expect(workspace.scripts["acquire:content"]).toContain("tsx");
    expect(workspace.devDependencies.tsx).toBe("4.23.1");
    expect(content.devDependencies?.tsx).toBe(undefined);
    expect(content.exports["."]).toBe("./src/index.ts");
    expect(content.exports["./operator/acquisition"].node).toBe("./src/acquisition/index.ts");
    expect(content.exports["./operator/acquisition"].browser).toBe(null);
    expect(content.exports["./operator/acquisition"].default).toBe(null);
    const resolution = spawnSync("node", [
      "--import", "tsx", "--input-type=module", "-e",
      'const r=await import("@codeguessr/content");const a=await import("@codeguessr/content/operator/acquisition");console.log(`${"openEncryptedStore" in r}:${"openEncryptedStore" in a}`)',
    ], { cwd: join(root, "packages/content"), encoding: "utf8" });
    expect(resolution.status).toBe(0);
    expect(resolution.stdout.trim()).toBe("false:true");
    // git grep ships with every checkout; a stock CI runner has no ripgrep.
    const scan = spawnSync("git", [
      "grep", "-n", "-e", "@codeguessr/content/operator/acquisition", "--", "apps/game", "packages/domain",
      "packages/measurement", "packages/content/src/index.ts",
    ], { cwd: root, encoding: "utf8" });
    expect(scan.error).toBe(undefined);
    expect(scan.status).toBe(1);
    expect(scan.stdout).toBe("");
    const temporary = await mkdtemp(join(tmpdir(), "operator-run-"));
    try {
      const descriptorPath = join(temporary, "run.json");
      await writeFile(descriptorPath, JSON.stringify({
        request: effectiveFixture().descriptor.request,
        operatorEntryId: "not-authorized",
      }));
      const startup = spawnSync("pnpm", ["acquire:content", "--", "--run", descriptorPath], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, CODEGUESSR_GITHUB_TOKEN: "startup-raw-canary" },
      });
      expect(startup.status).not.toBe(0);
      expect(startup.stderr).toContain("AUTHORIZATION_REJECTED");
      expect(`${startup.stdout}${startup.stderr}`).not.toContain("startup-raw-canary");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
  it("rejects unsafe arguments and a self-signed descriptor before network", async () => {
    let networkCalls = 0;
    const fixture = effectiveFixture();
    const deps = dependencies(fixture, async () => {
      networkCalls += 1;
      return successfulResponse();
    });
    for (const argv of [
      ["--token", "raw-canary"],
      ["--run", "https://example.test/run"],
      ["--run", "run.json", "--x"],
    ]) {
      const error = await runOperatorCommand(
        argv,
        deps as never,
      ).catch((failure) => failure);
      expect(error).toBeInstanceOf(OperatorCommandError);
      expect(error.message.includes("raw-canary")).toBe(false);
    }
    const untrustedControls = {
      ...fixture.controls,
      approvedPolicyRegister: {
        ...fixture.controls.approvedPolicyRegister,
        entries: [],
      },
    };
    const error = await runOperatorCommand(["--run", "run.json"], {
      ...deps,
      loadProjectControls: async () => untrustedControls,
    } as never).catch((failure) => failure);
    expect(error).toBeInstanceOf(OperatorCommandError);
    expect(error.message).toBe("AUTHORIZATION_REJECTED");
    expect(networkCalls).toBe(0);
  });
  it("rejects expired project controls using trusted host time before network", async () => {
    let networkCalls = 0;
    const fixture = effectiveFixture("2026-01-01T00:00:00Z");
    const error = await runOperatorCommand(["--run", "run.json"], dependencies(
      fixture,
      async () => {
        networkCalls += 1;
        return successfulResponse();
      },
      Date.parse("2026-01-02T00:00:00Z"),
    ) as never).catch((failure) => failure);
    expect(error).toBeInstanceOf(OperatorCommandError);
    expect(error.message).toBe("AUTHORIZATION_REJECTED");
    expect(networkCalls).toBe(0);
  });
  it("rejects a mismatched host operating-system identity before network", async () => {
    let networkCalls = 0;
    const fixture = effectiveFixture();
    const deps = {
      ...dependencies(fixture, async () => {
        networkCalls += 1;
        return successfulResponse();
      }),
      osIdentity: () => "uid:999",
    };
    const error = await runOperatorCommand(
      ["--run", "run.json"],
      deps as never,
    ).catch((failure) => failure);
    expect(error).toBeInstanceOf(OperatorCommandError);
    expect(error.message).toBe("AUTHORIZATION_REJECTED");
    expect(networkCalls).toBe(0);
  });

  it("requires prepared external state before any source network request", async () => {
    const fixture = effectiveFixture();
    let networkCalls = 0;
    const error = await runOperatorCommand(
      ["--run", "run.json"],
      dependencies(fixture, async () => {
        networkCalls += 1;
        return successfulResponse();
      }) as never,
    ).catch((failure) => failure);
    expect(error).toBeInstanceOf(OperatorCommandError);
    expect(error.message).toBe("OPERATOR_STATE_REJECTED");
    expect(networkCalls).toBe(0);
  });

  it("authorizes project-controlled scope and performs one unauthenticated public request", async () => {
    const fixture = effectiveFixture();
    const captured: Request[] = [];
    const result = await runInternalSourceReceiptStep(["--run", "run.json"], dependencies(
      fixture,
      async (request) => {
        captured.push(request);
        if (request.url.endsWith(`/commits/${"a".repeat(40)}`)) return successfulResponse();
        if (request.url.endsWith(`/commits/${"b".repeat(40)}`)) return parentResponse();
        if (request.url === "https://api.github.com/repos/owner/repo") {
          return repositoryResponse();
        }
        throw new Error("unexpected endpoint");
      },
    ) as never);
    expect(captured.map(({ url }) => url)).toEqual([
      `https://api.github.com/repos/owner/repo/commits/${"a".repeat(40)}`,
      `https://api.github.com/repos/owner/repo/commits/${"b".repeat(40)}`,
      "https://api.github.com/repos/owner/repo",
    ]);
    expect(captured.every(({ headers }) => headers.get("authorization") === null)).toBe(true);
    expect(result).toEqual({
      status: "AUTHORIZED_COMMIT_RECEIPT",
      repository: "owner/repo",
      subtree: "src",
      childSha: "a".repeat(40),
      parentSha: "b".repeat(40),
      childTreeSha,
      parentTreeSha,
      repositoryId: repositoryMetadata.repositoryId,
      repositoryMetadataHash: canonicalSha256(repositoryMetadata),
      licenseIdentifier: "MIT",
      commit: {
        author: { name: "Developer", login: "developer", type: "User" },
        committer: { name: "Developer", login: "developer", type: "User" },
        verification: { verified: true, reason: "valid" },
        message: commitMessage,
      },
      responseDate: githubDate,
      purpose,
      repositoryPolicyHash: canonicalSha256(fixture.controls.repositoryPolicy),
      attributionPolicyHash: canonicalSha256(fixture.controls.attributionPolicy),
      operatorEntryId: "operator-entry",
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("accepts GitHub repository casing only when it is canonically equivalent", async () => {
    const fixture = effectiveFixture();
    const acquire = (fullName: string) => runInternalSourceReceiptStep(
      ["--run", "run.json"],
      dependencies(fixture, async (request) => {
        if (request.url.endsWith(`/commits/${"a".repeat(40)}`)) return successfulResponse();
        if (request.url.endsWith(`/commits/${"b".repeat(40)}`)) return parentResponse();
        return new Response(JSON.stringify({
          ...repositoryMetadata,
          node_id: repositoryMetadata.repositoryId,
          full_name: fullName,
          private: false,
          license: { spdx_id: repositoryMetadata.licenseIdentifier },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    ) as Promise<any>;
    const accepted = await acquire("Owner/Repo");
    expect(accepted.repository).toBe("owner/repo");
    await expect(acquire("owner/different")).rejects.toThrow("SOURCE_RECEIPT_REJECTED");
  });

  it("rejects malformed commits and response-clock skew", async () => {
    const fixture = effectiveFixture();
    for (const data of [
      { sha: "malformed", parents: [] },
      { sha: "a".repeat(40), parents: [] },
      { sha: "a".repeat(40), parents: [{ sha: "b".repeat(40) }, { sha: "c".repeat(40) }] },
      { sha: "a".repeat(40), parents: [{ sha: "bad" }] },
    ]) {
      const error = await runInternalSourceReceiptStep(["--run", "run.json"], dependencies(
        fixture,
        async () => new Response(JSON.stringify(data), { headers: { date: githubDate } }),
      ) as never).catch((failure) => failure);
      expect(error.message).toBe("COMMIT_RECEIPT_REJECTED");
    }
    const skew = await runInternalSourceReceiptStep(["--run", "run.json"], dependencies(
      fixture,
      async () => new Response(JSON.stringify({
        sha: "a".repeat(40),
        parents: [{ sha: "b".repeat(40) }],
        commit: {
          message: commitMessage,
          tree: { sha: childTreeSha },
          verification: { verified: true, reason: "valid" },
          author: { name: "Developer" },
          committer: { name: "Developer" },
        },
        author: { login: "developer", type: "User" },
        committer: { login: "developer", type: "User" },
      }), { headers: { date: "Thu, 01 Jan 2026 00:06:00 GMT" } }),
    ) as never).catch((failure) => failure);
    expect(skew.message).toBe("RECEIPT_AUTHORIZATION_REJECTED");
  });

  it("composes certified Git objects into a quarantined draft when state is prepared", async () => {
    const fixture = effectiveFixture();
    const parentBytes = bytes("export const answer = 41;\n");
    const childBytes = bytes("export const answer = 42;\n");
    const licenseBytes = bytes("MIT License\n");
    const parentBlob = gitBlobSha(parentBytes);
    const childBlob = gitBlobSha(childBytes);
    const licenseBlob = gitBlobSha(licenseBytes);
    const parentSubtree = gitTree([
      { path: "answer.ts", mode: "100644", type: "blob", sha: parentBlob },
    ]);
    const childSubtree = gitTree([
      { path: "answer.ts", mode: "100644", type: "blob", sha: childBlob },
    ]);
    const parentRoot = gitTree([
      { path: "src", mode: "040000", type: "tree", sha: parentSubtree.sha },
    ]);
    const childRoot = gitTree([
      { path: "LICENSE", mode: "100644", type: "blob", sha: licenseBlob },
      { path: "src", mode: "040000", type: "tree", sha: childSubtree.sha },
    ]);
    const trees = new Map([
      [parentRoot.sha, parentRoot],
      [childRoot.sha, childRoot],
      [parentSubtree.sha, parentSubtree],
      [childSubtree.sha, childSubtree],
    ]);
    const blobs = new Map([
      [parentBlob, parentBytes],
      [childBlob, childBytes],
      [licenseBlob, licenseBytes],
    ]);
    const stored: string[] = [];
    let audit: readonly any[] = [];
    const order: string[] = [];
    const result = await runOperatorCommand(["--run", "run.json"], {
      ...dependencies(fixture, async (request) => {
        order.push("network");
        if (request.url.endsWith(`/commits/${"a".repeat(40)}`)) {
          return new Response(JSON.stringify({
            sha: "a".repeat(40),
            parents: [{ sha: "b".repeat(40) }],
            commit: {
              message: "Implement answer",
              tree: { sha: childRoot.sha },
              verification: { verified: true, reason: "valid" },
              author: { name: "Developer" },
              committer: { name: "Developer" },
            },
            author: { login: "developer", type: "User" },
            committer: { login: "developer", type: "User" },
          }), { headers: { date: githubDate } });
        }
        if (request.url.endsWith(`/commits/${"b".repeat(40)}`)) {
          return new Response(JSON.stringify({
            sha: "b".repeat(40), commit: { tree: { sha: parentRoot.sha } },
          }));
        }
        if (request.url === "https://api.github.com/repos/owner/repo") {
          return repositoryResponse();
        }
        const treeIdentity = request.url.match(/\/git\/trees\/([0-9a-f]{40})$/u)?.[1];
        if (treeIdentity !== undefined) {
          return new Response(JSON.stringify(trees.get(treeIdentity)));
        }
        const blobIdentity = request.url.match(/\/git\/blobs\/([0-9a-f]{40})$/u)?.[1];
        const content = blobIdentity === undefined ? undefined : blobs.get(blobIdentity);
        if (blobIdentity === undefined || content === undefined) {
          throw new Error("unexpected object endpoint");
        }
        return new Response(JSON.stringify({
          sha: blobIdentity,
          encoding: "base64",
          size: content.byteLength,
          content: Buffer.from(content).toString("base64"),
        }));
      }),
      prepareOperatorState: async () => {
        order.push("state");
        return {
          open: async () => ({
            store: {
              put: async ({ identity }: any) => {
                stored.push(identity.objectId);
                return { identity, created: true };
              },
              remove: async ({ objectId }: any) => {
                const index = stored.indexOf(objectId);
                if (index < 0) return false;
                stored.splice(index, 1);
                return true;
              },
            },
            audit: {
              append: async (event: unknown) => {
                audit = appendAuditEvent(audit, event);
                return audit;
              },
            },
          }),
          dispose: () => undefined,
        };
      },
    } as never);
    expect(result).toMatchObject({
      status: "DRAFT_REVIEW_REQUIRED",
      draftId: expect.stringMatching(/^draft:[0-9a-f]{64}$/u),
      draftHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      checkpointHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      artifactObjects: {
        draft: {
          objectId: expect.stringMatching(/^[0-9a-f]{64}$/u),
          plaintextSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
        checkpoint: {
          objectId: expect.stringMatching(/^[0-9a-f]{64}$/u),
          plaintextSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
        index: {
          objectId: expect.stringMatching(/^[0-9a-f]{64}$/u),
          plaintextSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("src/answer.ts");
    expect(JSON.stringify(result)).not.toContain("export const answer");
    expect(stored).toHaveLength(10);
    expect(audit.at(-1)?.eventType).toBe("DRAFT_COMPLETED");
    expect(audit.at(-1)?.subjectHash)
      .toBe((result as any).artifactObjects.index.objectId);
    expect(order[0]).toBe("state");
  });

  it("resumes mid-traversal from encrypted verified objects without refetching them", async () => {
    const fixture = effectiveFixture();
    const parentBytes = bytes("export const answer = 41;\n");
    const childBytes = bytes("export const answer = 42;\n");
    const licenseBytes = bytes("MIT License\n");
    const parentBlob = gitBlobSha(parentBytes);
    const childBlob = gitBlobSha(childBytes);
    const licenseBlob = gitBlobSha(licenseBytes);
    const parentSubtree = gitTree([
      { path: "answer.ts", mode: "100644", type: "blob", sha: parentBlob },
    ]);
    const childSubtree = gitTree([
      { path: "answer.ts", mode: "100644", type: "blob", sha: childBlob },
    ]);
    const parentRoot = gitTree([
      { path: "src", mode: "040000", type: "tree", sha: parentSubtree.sha },
    ]);
    const childRoot = gitTree([
      { path: "LICENSE", mode: "100644", type: "blob", sha: licenseBlob },
      { path: "src", mode: "040000", type: "tree", sha: childSubtree.sha },
    ]);
    const trees = new Map([
      [parentRoot.sha, parentRoot],
      [childRoot.sha, childRoot],
      [parentSubtree.sha, parentSubtree],
      [childSubtree.sha, childSubtree],
    ]);
    const blobs = new Map([
      [parentBlob, parentBytes],
      [childBlob, childBytes],
      [licenseBlob, licenseBytes],
    ]);
    const state = memoryOperatorState();
    const calls = new Map<string, number>();
    let now = receiptMs;
    let paused = false;
    const fetch = async (request: Request): Promise<Response> => {
      calls.set(request.url, (calls.get(request.url) ?? 0) + 1);
      if (request.url.endsWith(`/commits/${"a".repeat(40)}`)) {
        return new Response(JSON.stringify({
          sha: "a".repeat(40),
          parents: [{ sha: "b".repeat(40) }],
          commit: {
            message: "Implement answer",
            tree: { sha: childRoot.sha },
            verification: { verified: true, reason: "valid" },
            author: { name: "Developer" },
            committer: { name: "Developer" },
          },
          author: { login: "developer", type: "User" },
          committer: { login: "developer", type: "User" },
        }), { headers: { date: githubDate } });
      }
      if (request.url.endsWith(`/commits/${"b".repeat(40)}`)) {
        return new Response(JSON.stringify({
          sha: "b".repeat(40), commit: { tree: { sha: parentRoot.sha } },
        }));
      }
      if (request.url === "https://api.github.com/repos/owner/repo") {
        return repositoryResponse();
      }
      const treeIdentity = request.url.match(/\/git\/trees\/([0-9a-f]{40})$/u)?.[1];
      if (treeIdentity === parentRoot.sha && !paused) {
        paused = true;
        return rateLimitedResponse();
      }
      if (treeIdentity !== undefined) {
        return new Response(JSON.stringify(trees.get(treeIdentity)));
      }
      const blobIdentity = request.url.match(/\/git\/blobs\/([0-9a-f]{40})$/u)?.[1];
      const content = blobIdentity === undefined ? undefined : blobs.get(blobIdentity);
      if (blobIdentity === undefined || content === undefined) {
        throw new Error("unexpected object endpoint");
      }
      return new Response(JSON.stringify({
        sha: blobIdentity,
        encoding: "base64",
        size: content.byteLength,
        content: Buffer.from(content).toString("base64"),
      }));
    };
    const deps = {
      ...dependencies(fixture, fetch),
      now: () => now,
      prepareOperatorState: state.prepare,
    };
    const first = await runOperatorCommand(["--run", "run.json"], deps as never) as any;
    expect(first.status).toBe("PAUSED");
    expect(first.storedObjectCount).toBe(3);

    now = first.resumeAfterEpochMs;
    const result = await runOperatorCommand([
      "--resume", "run.json", first.checkpointObject.objectId,
      String(first.checkpointObject.byteLength),
    ], deps as never) as any;
    expect(result.status).toBe("DRAFT_REVIEW_REQUIRED");
    for (const sha of [childRoot.sha, childSubtree.sha]) {
      expect(calls.get(`https://api.github.com/repos/owner/repo/git/trees/${sha}`))
        .toBe(1);
    }
    expect(calls.get(`https://api.github.com/repos/owner/repo/git/blobs/${childBlob}`))
      .toBe(1);
    expect(new Set(state.audit().map(({ run }) => run.runId))).toHaveLength(1);
  });

  it("removes run-owned pre-pause objects after resumed terminal rejection", async () => {
    const fixture = effectiveFixture();
    const childBytes = bytes("export const answer = 42;\n");
    const unrelatedBytes = bytes("export const unrelated = 41;\n");
    const licenseBytes = bytes("MIT License\n");
    const childBlob = gitBlobSha(childBytes);
    const unrelatedBlob = gitBlobSha(unrelatedBytes);
    const licenseBlob = gitBlobSha(licenseBytes);
    const childSubtree = gitTree([
      { path: "answer.ts", mode: "100644", type: "blob", sha: childBlob },
    ]);
    const parentSubtree = gitTree([
      { path: "unrelated.ts", mode: "100644", type: "blob", sha: unrelatedBlob },
    ]);
    const childRoot = gitTree([
      { path: "LICENSE", mode: "100644", type: "blob", sha: licenseBlob },
      { path: "src", mode: "040000", type: "tree", sha: childSubtree.sha },
    ]);
    const parentRoot = gitTree([
      { path: "src", mode: "040000", type: "tree", sha: parentSubtree.sha },
    ]);
    const trees = new Map([
      [childRoot.sha, childRoot],
      [childSubtree.sha, childSubtree],
      [parentRoot.sha, parentRoot],
      [parentSubtree.sha, parentSubtree],
    ]);
    const blobs = new Map([
      [childBlob, childBytes],
      [unrelatedBlob, unrelatedBytes],
      [licenseBlob, licenseBytes],
    ]);
    const state = memoryOperatorState();
    let now = receiptMs;
    let paused = false;
    const fetch = async (request: Request): Promise<Response> => {
      if (request.url.endsWith(`/commits/${"a".repeat(40)}`)) {
        return new Response(JSON.stringify({
          sha: "a".repeat(40),
          parents: [{ sha: "b".repeat(40) }],
          commit: {
            message: "Implement answer",
            tree: { sha: childRoot.sha },
            verification: { verified: true, reason: "valid" },
            author: { name: "Developer" },
            committer: { name: "Developer" },
          },
          author: { login: "developer", type: "User" },
          committer: { login: "developer", type: "User" },
        }), { headers: { date: githubDate } });
      }
      if (request.url.endsWith(`/commits/${"b".repeat(40)}`)) {
        return new Response(JSON.stringify({
          sha: "b".repeat(40), commit: { tree: { sha: parentRoot.sha } },
        }));
      }
      if (request.url === "https://api.github.com/repos/owner/repo") {
        return repositoryResponse();
      }
      const treeIdentity = request.url.match(/\/git\/trees\/([0-9a-f]{40})$/u)?.[1];
      if (treeIdentity === parentRoot.sha && !paused) {
        paused = true;
        return rateLimitedResponse();
      }
      if (treeIdentity !== undefined) {
        return new Response(JSON.stringify(trees.get(treeIdentity)));
      }
      const blobIdentity = request.url.match(/\/git\/blobs\/([0-9a-f]{40})$/u)?.[1];
      const content = blobIdentity === undefined ? undefined : blobs.get(blobIdentity);
      if (blobIdentity === undefined || content === undefined) {
        throw new Error("unexpected object endpoint");
      }
      return new Response(JSON.stringify({
        sha: blobIdentity,
        encoding: "base64",
        size: content.byteLength,
        content: Buffer.from(content).toString("base64"),
      }));
    };
    const deps = {
      ...dependencies(fixture, fetch),
      now: () => now,
      prepareOperatorState: state.prepare,
    };
    const first = await runOperatorCommand(["--run", "run.json"], deps as never) as any;
    expect(first.status).toBe("PAUSED");
    const checkpoint = JSON.parse(Buffer.from(
      state.objects.get(first.checkpointObject.objectId)!,
    ).toString("utf8"));
    expect(checkpoint.storedObjects).toHaveLength(3);
    expect(checkpoint.storedObjects.every(
      ({ createdByRun }: any) => createdByRun === true,
    )).toBe(true);

    now = first.resumeAfterEpochMs;
    const error = await runOperatorCommand([
      "--resume", "run.json", first.checkpointObject.objectId,
      String(first.checkpointObject.byteLength),
    ], deps as never).catch((failure) => failure);
    expect(error).toBeInstanceOf(OperatorCommandError);
    expect(error.message).toBe("NO_ELIGIBLE_CANDIDATE");
    for (const { snapshot } of checkpoint.storedObjects) {
      expect(state.objects.has(snapshot.objectId)).toBe(false);
    }
    expect(state.audit().filter(({ eventType }) => eventType === "RAW_OBJECT_DELETED"))
      .toHaveLength(6);
  });

  it("cleans run-owned objects when pause persistence, pause audit, or resumed source fails", async () => {
    const fixture = effectiveFixture();
    for (const failure of ["persistence", "audit", "resumed-source"] as const) {
      const scenario = resumableLanguageScenario(failure === "resumed-source");
      const state = memoryOperatorState({
        failPausePersistence: failure === "persistence",
        ...(failure === "audit" ? { failAuditEvent: "RUN_PAUSED" } : {}),
      });
      let now = receiptMs;
      const deps = {
        ...dependencies(fixture, scenario.fetch),
        now: () => now,
        prepareOperatorState: state.prepare,
      };
      const first = await runOperatorCommand(["--run", "run.json"], deps as never)
        .catch((error) => error) as any;
      if (failure === "persistence" || failure === "audit") {
        expect(first).toBeInstanceOf(PauseResumeError);
        expect(first.message).toBe(
          failure === "persistence"
            ? "PAUSE_PERSISTENCE_REJECTED"
            : "PAUSE_AUDIT_REJECTED",
        );
      } else {
        expect(first.status).toBe("PAUSED");
        now = first.resumeAfterEpochMs;
        const resumed = await runOperatorCommand([
          "--resume", "run.json", first.checkpointObject.objectId,
          String(first.checkpointObject.byteLength),
        ], deps as never).catch((error) => error);
        expect(resumed).toBeInstanceOf(OperatorCommandError);
        expect(resumed.message).toBe("COMMIT_RECEIPT_REJECTED");
      }
      for (const objectId of scenario.prePauseObjectIds) {
        expect(state.objects.has(objectId)).toBe(false);
      }
    }
  });

  it("preserves a categorical state-opening failure after source certification", async () => {
    const fixture = effectiveFixture();
    let disposed = false;
    const error = await runOperatorCommand(["--run", "run.json"], {
      ...dependencies(fixture, async (request) => {
        if (request.url.endsWith(`/commits/${"a".repeat(40)}`)) return successfulResponse();
        if (request.url.endsWith(`/commits/${"b".repeat(40)}`)) return parentResponse();
        return repositoryResponse();
      }),
      prepareOperatorState: async () => ({
        open: async () => { throw new Error("state canary"); },
        dispose: () => { disposed = true; },
      }),
    } as never).catch((failure) => failure);
    expect(error).toBeInstanceOf(OperatorCommandError);
    expect(error.message).toBe("OPERATOR_STATE_REJECTED");
    expect(disposed).toBe(true);
  });

  it("persists a validated rate-limit pause without exposing source or operator details", async () => {
    const fixture = effectiveFixture();
    const state = memoryOperatorState();
    let networkCalls = 0;
    const result = await runOperatorCommand(["--run", "run.json"], {
      ...dependencies(fixture, async () => {
        networkCalls += 1;
        return rateLimitedResponse();
      }),
      prepareOperatorState: state.prepare,
    } as never);

    expect(result).toMatchObject({
      status: "PAUSED",
      resumeAfterEpochMs: receiptMs + 60_000,
      checkpointHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      checkpointObject: {
        objectId: expect.stringMatching(/^[0-9a-f]{64}$/u),
        plaintextSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        byteLength: expect.any(Number),
      },
      storedObjectCount: 0,
    });
    expect(networkCalls).toBe(1);
    expect(state.objects.size).toBe(1);
    expect(state.audit().map(({ eventType }) => eventType)).toEqual(["RUN_PAUSED"]);
    expect(JSON.stringify(result)).not.toMatch(
      /owner\/repo|src|Operator|uid:1|Implement answer|noreply/iu,
    );
  });

  it("preserves a validated pause from every source-receipt request", async () => {
    const fixture = effectiveFixture();
    for (const pauseAt of [2, 3]) {
      const state = memoryOperatorState();
      let calls = 0;
      const result = await runOperatorCommand(["--run", "run.json"], {
        ...dependencies(fixture, async () => {
          calls += 1;
          if (calls === pauseAt) return rateLimitedResponse();
          return calls === 1 ? successfulResponse() : parentResponse();
        }),
        prepareOperatorState: state.prepare,
      } as never) as any;
      expect(result.status).toBe("PAUSED");
      expect(calls).toBe(pauseAt);
      expect(state.audit().at(-1)?.eventType).toBe("RUN_PAUSED");
    }
  });

  it("requires an explicit eligible resume and revalidates its checkpoint before network", async () => {
    const fixture = effectiveFixture();
    const state = memoryOperatorState();
    let now = receiptMs;
    let networkCalls = 0;
    const deps = {
      ...dependencies(fixture, async () => {
        networkCalls += 1;
        return rateLimitedResponse();
      }),
      now: () => now,
      prepareOperatorState: state.prepare,
    };
    const paused = await runOperatorCommand(["--run", "run.json"], deps as never) as any;
    const resumeArgs = [
      "--resume", "run.json", paused.checkpointObject.objectId,
      String(paused.checkpointObject.byteLength),
    ];

    const early = await runOperatorCommand(resumeArgs, deps as never)
      .catch((failure) => failure);
    expect(early).toBeInstanceOf(OperatorCommandError);
    expect(early.message).toBe("RESUME_NOT_READY");
    expect(networkCalls).toBe(1);

    now = paused.resumeAfterEpochMs;
    const resumed = await runOperatorCommand(resumeArgs, deps as never) as any;
    expect(resumed.status).toBe("PAUSED");
    expect(networkCalls).toBe(2);
    expect(state.audit().map(({ eventType }) => eventType)).toEqual([
      "RUN_PAUSED", "RUN_RESUMED", "RUN_PAUSED",
    ]);
    expect(new Set(state.audit().map(({ run }) => run.runId))).toHaveLength(1);

    const tampered = await runOperatorCommand(
      ["--resume", "run.json", "f".repeat(64), String(paused.checkpointObject.byteLength)],
      deps as never,
    ).catch((failure) => failure);
    expect(tampered).toBeInstanceOf(OperatorCommandError);
    expect(tampered.message).toBe("RESUME_CHECKPOINT_REJECTED");
    expect(networkCalls).toBe(2);
  });

  it("rejects every altered resume binding and listed stored object before network", async () => {
    const fixture = effectiveFixture();
    const state = memoryOperatorState();
    let now = receiptMs;
    let networkCalls = 0;
    const deps = {
      ...dependencies(fixture, async () => {
        networkCalls += 1;
        return rateLimitedResponse();
      }),
      now: () => now,
      prepareOperatorState: state.prepare,
    };
    const paused = await runOperatorCommand(["--run", "run.json"], deps as never) as any;
    const originalBytes = state.objects.get(paused.checkpointObject.objectId)!;
    const original = JSON.parse(Buffer.from(originalBytes).toString("utf8"));
    now = paused.resumeAfterEpochMs;
    const publish = (checkpoint: any, recompute = true) => {
      const { checkpointHash: _old, ...payload } = checkpoint;
      const value = recompute
        ? { ...payload, checkpointHash: canonicalSha256(payload) }
        : checkpoint;
      const plaintext = bytes(JSON.stringify(value));
      const objectId = createHash("sha256").update(plaintext).digest("hex");
      state.objects.set(objectId, plaintext);
      return ["--resume", "run.json", objectId, String(plaintext.byteLength)];
    };
    const cases = [
      publish({ ...original, requestHash: "0".repeat(64) }),
      publish({ ...original, repositoryPolicyHash: "1".repeat(64) }),
      publish({ ...original, repositoryPolicyEntryId: "different-repository-entry" }),
      publish({ ...original, attributionPolicyEntryId: "different-attribution-entry" }),
      publish({ ...original, operatorBindingHash: "2".repeat(64) }),
      publish({ ...original, toolHash: "3".repeat(64) }),
      publish({ ...original, requestHash: "4".repeat(64) }, false),
      publish({
        ...original,
        storedObjects: [{
          kind: "blob",
          gitSha: "e".repeat(40),
          createdByRun: true,
          snapshot: {
            objectId: "5".repeat(64),
            plaintextSha256: "5".repeat(64),
            byteLength: 1,
          },
        }],
      }),
    ];
    for (const args of cases) {
      const error = await runOperatorCommand(args, deps as never)
        .catch((failure) => failure);
      expect(error).toBeInstanceOf(OperatorCommandError);
      expect(error.message).toBe("RESUME_CHECKPOINT_REJECTED");
    }
    expect(networkCalls).toBe(1);
  });
});
