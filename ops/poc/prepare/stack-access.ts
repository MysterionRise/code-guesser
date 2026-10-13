import { STACK_DATASET, STACK_RELEASE, STACK_REVISION } from "../limits";
import type { CrawlProfile } from "./profile";
import type { BoundedTransport } from "./transport";

const DATASET = STACK_DATASET;
const RELEASE = STACK_RELEASE;
const REVISION = STACK_REVISION;
const METADATA_URL = `https://huggingface.co/api/datasets/${DATASET}/revision/${REVISION}`;
const CARD_URL = `https://huggingface.co/datasets/${DATASET}/raw/main/README.md`;
const REVISION_PATTERN = /^[0-9a-f]{40}$/u;
const TERMS_MARKERS = [
  "The Stack v2 is regularly updated to enact validated data removal requests.",
  "most recent usable version",
  "I have read the License and agree with its terms: checkbox",
] as const;

export class StackAccessError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "StackAccessError";
  }
}

export interface StackAccessGrant {
  readonly release: string;
  readonly revision: string;
}

export interface StackAccessOptions {
  readonly profile: CrawlProfile;
  readonly acknowledgedUsableRevision?: string;
  readonly transport: BoundedTransport;
}

type UnknownRecord = Record<string, unknown>;
const fail = (code: string): never => { throw new StackAccessError(code); };
const record = (value: unknown, code: string): UnknownRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(code);
  return value as UnknownRecord;
};

const validateInputs = (options: StackAccessOptions): void => {
  if (options.profile.stack.release !== RELEASE || options.profile.stack.revision !== REVISION) {
    fail("PROFILE_MISMATCH");
  }
  const acknowledgement = options.acknowledgedUsableRevision
    ?? fail("ACKNOWLEDGEMENT_MISSING");
  if (!REVISION_PATTERN.test(acknowledgement)
    || acknowledgement !== options.profile.stack.revision) {
    fail("ACKNOWLEDGEMENT_MISMATCH");
  }
};

const validateGating = (metadata: UnknownRecord): void => {
  if (metadata.private !== false || metadata.disabled !== false) fail("ACCESS_DENIED");
  if (metadata.gated !== "auto") fail("ACCESS_GATE_CHANGED");
  const cardData = record(metadata.cardData, "ACCESS_RESPONSE_MALFORMED");
  const prompt = cardData.extra_gated_prompt;
  const fields = record(cardData.extra_gated_fields, "TERMS_CHANGED");
  if (typeof prompt !== "string"
    || !TERMS_MARKERS.slice(0, 2).every((marker) => prompt.includes(marker))) {
    fail("TERMS_CHANGED");
  }
  if (fields.Email !== "text"
    || fields["I have read the License and agree with its terms"] !== "checkbox") {
    fail("TERMS_CHANGED");
  }
};

const validateMetadata = (value: unknown, profile: CrawlProfile): void => {
  const metadata = record(value, "ACCESS_RESPONSE_MALFORMED");
  if (metadata.id !== DATASET || typeof metadata.sha !== "string"
    || !REVISION_PATTERN.test(metadata.sha)) fail("ACCESS_RESPONSE_MALFORMED");
  validateGating(metadata);
  if (metadata.sha !== profile.stack.revision) fail("REVISION_MISMATCH");
  if (!Array.isArray(metadata.siblings)
    || !metadata.siblings.some((entry) => record(entry, "ACCESS_RESPONSE_MALFORMED").rfilename === "README.md")) {
    fail("ACCESS_RESPONSE_MALFORMED");
  }
};

const latestRelease = (card: string): string => {
  if (!TERMS_MARKERS.every((marker) => card.includes(marker))) fail("TERMS_CHANGED");
  const section = card.split(/^### Changelog\s*$/mu);
  const body = section.length === 2
    ? section[1] ?? fail("CARD_RESPONSE_MALFORMED")
    : fail("CARD_RESPONSE_MALFORMED");
  const rows = body.split("\n").map((line) => line.trim()).filter(Boolean);
  const legacy = rows[0] === "Release  | Description" && rows[1] === "--- | ---";
  const pipe = rows[0] === "|Release|Description|" && rows[1] === "|-|-|";
  if (!legacy && !pipe) fail("CARD_RESPONSE_MALFORMED");
  const pattern = legacy
    ? /^(v\d+\.\d+(?:\.\d+)?)\s+\|\s+.+$/u
    : /^\|\s*(v\d+\.\d+(?:\.\d+)?)\s*\|\s*.+\|$/u;
  const match = pattern.exec(rows[2] ?? "");
  return match?.[1] ?? fail("CARD_RESPONSE_MALFORMED");
};

const requestMetadata = async (transport: BoundedTransport): Promise<unknown> => {
  try {
    return await transport.requestJson({
      provider: "huggingFace",
      method: "GET",
      url: METADATA_URL,
      headers: { accept: "application/json" },
    });
  } catch {
    return fail("ACCESS_UNAVAILABLE");
  }
};

const requestCard = async (transport: BoundedTransport): Promise<string> => {
  try {
    const bytes = await transport.requestBytes({
      provider: "huggingFace",
      method: "GET",
      url: CARD_URL,
      headers: { accept: "text/plain; charset=utf-8" },
    });
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("CARD_UNAVAILABLE");
  }
};

export const preflightStackAccess = async (
  options: StackAccessOptions,
): Promise<StackAccessGrant> => {
  validateInputs(options);
  validateMetadata(await requestMetadata(options.transport), options.profile);
  if (latestRelease(await requestCard(options.transport)) !== options.profile.stack.release) {
    fail("RELEASE_MISMATCH");
  }
  return Object.freeze({ release: RELEASE, revision: REVISION });
};
