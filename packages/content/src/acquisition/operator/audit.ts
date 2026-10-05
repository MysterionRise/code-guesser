import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  isIssuedOperatorRun,
  READ_ONLY_PUBLIC_REPOSITORY_TOKEN,
  type AuthorizedOperatorRun,
} from "../policy/operator-authorization";

const TYPES = [
  "RUN_STARTED", "RUN_RESUMED", "RUN_REJECTED", "RUN_PAUSED", "RAW_OBJECT_CREATED",
  "RAW_OBJECT_DELETED", "DRAFT_COMPLETED", "REVIEW_TRANSITION", "PROMOTION_HANDOFF",
] as const;
const H64 = /^[0-9a-f]{64}$/u;
const H40 = /^[0-9a-f]{40}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u;
const REPOSITORY = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u;
const GITHUB_DATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/u;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
type Json = Record<string, unknown>;
type AuditRun = Pick<
  AuthorizedOperatorRun,
  "operatorName" | "osIdentity" | "repository" | "commit" | "subtree" | "purpose"
  | "tokenAllowance" | "callerObservationTime" | "authoritativeReceiptTime"
  | "githubDate" | "registerVersion" | "registerHash" | "entryId"
  | "authorizationValidFrom" | "authorizationValidThrough"
> & { readonly runId: string };
export class AuditError extends Error {
  public constructor(code: string) { super(code); this.name = "AuditError"; }
}
const fail = (code: string): never => { throw new AuditError(code); };
const exact = (value: unknown, keys: readonly string[]): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Json).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
};
const hash = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");
const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    Object.values(value as Json).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const INPUT = ["eventIdentity", "eventTime", "eventType", "reasonCode", "run", "subjectHash"];
const RUN = [
  "authorizationValidFrom", "authorizationValidThrough", "authoritativeReceiptTime",
  "callerObservationTime", "commit", "entryId", "githubDate", "operatorName", "osIdentity",
  "purpose", "registerHash", "registerVersion", "repository", "runId", "tokenAllowance",
  "subtree",
];
const RECORD = [...INPUT, "eventHash", "previousHash", "sequence"];
const wholeSecond = (value: unknown): value is string =>
  typeof value === "string" && UTC.test(value) && !Number.isNaN(Date.parse(value))
  && new Date(value).toISOString() === value.replace("Z", ".000Z");
const validateInput = (raw: unknown): Json => {
  const input = exact(raw, INPUT) ? raw : fail("EVENT_FIELDS_REJECTED");
  const run = exact(input.run, RUN) ? input.run : fail("RUN_BINDING_REJECTED");
  const receipt = run.authoritativeReceiptTime;
  const receiptMs = Date.parse(receipt as string);
  const validThrough = run.authorizationValidThrough === null
    ? null
    : wholeSecond(run.authorizationValidThrough)
      ? run.authorizationValidThrough
      : fail("EVENT_REJECTED");
  if (
    !TYPES.includes(input.eventType as typeof TYPES[number])
    || !wholeSecond(input.eventTime)
    || !H64.test(input.eventIdentity as string) || !H64.test(input.subjectHash as string)
    || !CODE.test(input.reasonCode as string) || (input.reasonCode as string).length > 128
    || !H64.test(run.runId as string) || !H64.test(run.registerHash as string)
    || !H40.test(run.commit as string)
    || typeof run.subtree !== "string"
    || !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test(run.subtree)
    || !REPOSITORY.test(run.repository as string)
    || !["LANGUAGE_CANDIDATE", "RECORDED_AGENT_PARTICIPATION_CANDIDATE"]
      .includes(run.purpose as string)
    || run.tokenAllowance !== READ_ONLY_PUBLIC_REPOSITORY_TOKEN
    || !wholeSecond(receipt) || !wholeSecond(run.callerObservationTime)
    || !wholeSecond(run.authorizationValidFrom)
    || Date.parse(run.callerObservationTime) - receiptMs > MAX_CLOCK_SKEW_MS
    || typeof run.githubDate !== "string" || !GITHUB_DATE.test(run.githubDate)
    || new Date(run.githubDate).toUTCString() !== run.githubDate
    || Math.abs(Date.parse(run.githubDate) - receiptMs) > MAX_CLOCK_SKEW_MS
    || (input.eventTime as string) < receipt
    || RUN.filter((key) =>
      !["authorizationValidThrough", "runId", "registerHash"].includes(key))
      .some((key) => typeof run[key] !== "string"
        || (run[key] as string).length === 0 || (run[key] as string).length > 256)
  ) fail("EVENT_REJECTED");
  if ((input.eventTime as string) < (run.authorizationValidFrom as string)
    || (validThrough !== null && (input.eventTime as string) > validThrough)) {
    fail("AUDIT_AUTHORIZATION_EXPIRED");
  }
  return input;
};
const validateChain = (chain: readonly unknown[]): readonly Json[] => {
  if (!Array.isArray(chain)) return fail("CHAIN_INVALID");
  let previous = "0".repeat(64);
  let previousTime = "";
  const identities = new Set<string>();
  return chain.map((raw, index) => {
    const record = exact(raw, RECORD) ? raw : fail("CHAIN_INVALID");
    const input = Object.fromEntries(INPUT.map((key) => [key, record[key]]));
    validateInput(input);
    const payload = { ...input, sequence: index + 1, previousHash: previous };
    if (record.sequence !== index + 1 || record.previousHash !== previous
      || record.eventHash !== hash(payload)
      || (record.eventTime as string) < previousTime
      || identities.has(record.eventIdentity as string)) fail("CHAIN_INVALID");
    identities.add(record.eventIdentity as string);
    previous = record.eventHash as string;
    previousTime = record.eventTime as string;
    return record;
  });
};

export const appendAuditEvent = (
  existing: readonly unknown[],
  raw: unknown,
): readonly Readonly<Json>[] => {
  const chain = validateChain(existing);
  const input = validateInput(raw);
  if (chain.some(({ eventIdentity }) => eventIdentity === input.eventIdentity)) {
    fail("DUPLICATE_EVENT");
  }
  if (chain.length > 0
    && (input.eventTime as string) < (chain.at(-1)?.eventTime as string)) {
    fail("EVENT_TIME_NONMONOTONIC");
  }
  const sequence = chain.length + 1;
  const previousHash = chain.at(-1)?.eventHash ?? "0".repeat(64);
  const payload = { ...input, sequence, previousHash };
  const record = { ...payload, eventHash: hash(payload) };
  return freeze(JSON.parse(canonical([...chain, record])) as Json[]);
};

interface AuditSinkConfig {
  readonly root: string;
  readonly ownershipAttestation: "ACQUISITION_OWNED";
  readonly authorizedRun: AuthorizedOperatorRun;
  readonly projectOperatorRegisterHash: string;
}
const categorical = async <T>(operation: () => Promise<T>, code: string): Promise<T> => {
  try { return await operation(); } catch (error) {
    if (error instanceof AuditError) throw error;
    return fail(code);
  }
};
const secureDirectory = async (path: string): Promise<void> => {
  const existing = await lstat(path).catch(() => undefined);
  if (existing === undefined) await mkdir(path, { mode: 0o700 });
  const entry = await lstat(path).catch(() => fail("AUDIT_PATH_REJECTED"));
  if (entry.isSymbolicLink()) fail("AUDIT_SYMLINK_REJECTED");
  if (!entry.isDirectory() || (entry.mode & 0o777) !== 0o700
    || (process.getuid !== undefined && entry.uid !== process.getuid())) {
    fail("AUDIT_PERMISSION_REJECTED");
  }
};
const noSymlinkComponents = async (path: string): Promise<void> => {
  let cursor = resolve(path);
  while (cursor !== dirname(cursor)) {
    const entry = await lstat(cursor).catch(() => undefined);
    if (entry?.isSymbolicLink()) fail("AUDIT_SYMLINK_REJECTED");
    cursor = dirname(cursor);
  }
};
const readAuditFile = async (path: string): Promise<Json> => {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    .catch(() => fail("AUDIT_CHAIN_INVALID"));
  try {
    const entry = await handle.stat();
    if (!entry.isFile() || (entry.mode & 0o777) !== 0o600
      || (process.getuid !== undefined && entry.uid !== process.getuid())) {
      fail("AUDIT_CHAIN_INVALID");
    }
    const text = await handle.readFile("utf8");
    const record = JSON.parse(text) as Json;
    if (text !== canonical(record)) fail("AUDIT_CHAIN_INVALID");
    return record;
  } finally { await handle.close(); }
};
const loadAuditChain = async (events: string): Promise<readonly Json[]> => {
  await noSymlinkComponents(events);
  await secureDirectory(events);
  const names = (await readdir(events)).sort();
  const chain: Json[] = [];
  for (const [index, name] of names.entries()) {
    if (name !== `${String(index + 1).padStart(12, "0")}.json`) {
      fail("AUDIT_CHAIN_INVALID");
    }
    chain.push(await readAuditFile(join(events, name)));
  }
  validateChain(chain);
  return freeze(JSON.parse(canonical(chain)) as Json[]);
};
/**
 * Appends against the chain length the caller observed when it issued the append. Any append
 * that lands in between, from this handle or another, shows up as a longer directory or chain
 * and fails as AUDIT_CONFLICT before the exclusive create is attempted.
 */
const appendToSink = async (events: string, raw: unknown, expectedLength: number): Promise<readonly Json[]> => {
  if ((await readdir(events)).length !== expectedLength) fail("AUDIT_CONFLICT");
  const chain = await loadAuditChain(events);
  if (chain.length !== expectedLength) fail("AUDIT_CONFLICT");
  const next = appendAuditEvent(chain, raw);
  const record = next.at(-1) ?? fail("AUDIT_CHAIN_INVALID");
  const name = `${String(next.length).padStart(12, "0")}.json`;
  const path = join(events, name);
  const handle = await open(
    path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600,
  ).catch(() => fail("AUDIT_CONFLICT"));
  let complete = false;
  try {
    await handle.writeFile(canonical(record));
    await handle.sync();
    complete = true;
  } finally {
    await handle.close();
    if (!complete) await unlink(path).catch(() => undefined);
  }
  try {
    const directory = await open(events, constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch { return fail("AUDIT_WRITE_REJECTED"); }
  return loadAuditChain(events);
};
const bindAuthorizedRun = (
  raw: unknown,
  authorizedRun: AuthorizedOperatorRun,
): unknown => {
  const input = raw as Json;
  const submitted = input?.run as Json;
  const fields = RUN.filter((key) => key !== "runId");
  if (!exact(submitted, RUN)
    || fields.some((key) => submitted[key] !== authorizedRun[key as keyof AuthorizedOperatorRun])) {
    fail("AUDIT_AUTHORIZATION_REJECTED");
  }
  return raw;
};

export const openAuditSink = (config: AuditSinkConfig) =>
  categorical(async () => {
    if (!isAbsolute(config.root) || config.ownershipAttestation !== "ACQUISITION_OWNED") {
      fail("AUDIT_ROOT_REJECTED");
    }
    if (!isIssuedOperatorRun(config.authorizedRun)) fail("AUDIT_AUTHORIZATION_REJECTED");
    if (!H64.test(config.projectOperatorRegisterHash)
      || config.projectOperatorRegisterHash !== config.authorizedRun.registerHash) {
      fail("AUDIT_AUTHORIZATION_REJECTED");
    }
    const root = resolve(config.root);
    const workspace = resolve(process.cwd());
    const child = relative(workspace, root);
    if (root === workspace || (child !== ".." && !child.startsWith(`..${sep}`))) {
      fail("AUDIT_ROOT_REJECTED");
    }
    await noSymlinkComponents(root);
    await secureDirectory(root);
    if (await realpath(root) !== root) fail("AUDIT_SYMLINK_REJECTED");
    await chmod(root, 0o700);
    const events = join(root, "events");
    await secureDirectory(events);
    let knownLength = (await loadAuditChain(events)).length;
    return Object.freeze({
      append: (raw: unknown) => {
        const expectedLength = knownLength;
        return categorical(async () => {
          const chain = await appendToSink(events, bindAuthorizedRun(raw, config.authorizedRun), expectedLength);
          knownLength = chain.length;
          return chain;
        }, "AUDIT_WRITE_REJECTED");
      },
      read: () => categorical(async () => {
        const chain = await loadAuditChain(events);
        knownLength = chain.length;
        return chain;
      }, "AUDIT_READ_REJECTED"),
    });
  }, "AUDIT_OPEN_REJECTED");
