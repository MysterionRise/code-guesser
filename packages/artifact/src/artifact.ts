import {
  ALGORITHM_SOURCE_KEYS,
  OUTPUT_SOURCE_KEYS,
  ARTIFACT_SCHEMA_VERSION,
  BEFORE_AFTER_CANDIDATE_IDS,
  CANDIDATE_COUNTS,
  CONTENT_CLASS,
  CROSS_DECK_KEYS_BY_KIND,
  DECK_IDS,
  DECK_KINDS,
  DEDUPLICATION_KEYS_BY_KIND,
  DETAIL_KINDS,
  LANGUAGE_PAIRS,
  LANGUAGE_SLUGS,
  MASKED_NAME,
  MAXIMUM_POOL_SIZE,
  PANE_LAYOUTS,
  PROFILE_VERSION,
  PROTECTED_SOURCE_KEYS,
  ROUNDS_PER_SESSION,
  STACK_LANGUAGES,
  type CandidateRecord,
  type DeckId,
  type ExperimentArtifact,
  type ExperimentFixture,
  type FixtureKind,
  type Pane,
  type ParsedDeck,
  type ParsedFixture,
  type ParsedSource,
  type StackLanguage,
} from "./domain";
import { fail } from "./errors";
import { pinKey, validateCuratedSource, validateFixSource, validateLineageSource, validateStackSource, type StackIdentity } from "./source";
import {
  canonicalHash,
  codeText,
  containsProtected,
  deepFreeze,
  gitId,
  positiveInteger,
  rawHash,
  record,
  serializeCanonical,
  sha256,
  text,
  texts,
  type JsonRecord,
} from "./validation";

const FIXTURE_KEYS = [
  "kind", "roundId", "roundVersion", "panes", "prompt", "candidates", "clues",
  "correctCandidateId", "evidence", "explanation", "attribution", "helpfulSignals",
  "misleadingSignals", "source",
] as const;
const DECK_KEYS = ["id", "title", "description", "roundsPerSession", "fixtures"] as const;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
/**
 * Public text may not claim to tell who or what wrote code. A repository description about object detection
 * says nothing about authorship, so only detection of AI or authorship counts.
 */
export const AUTHORSHIP_CLAIM = /\b(?:human[- ]written|written by (?:a |an )?human|a human wrote|human-only|ai[- ]generated|code style (?:shows|proves|indicates)|(?:ai|authorship|gpt|llm|chatgpt)[- ](?:code |content |text |writing )?detect(?:or|ors|ion))\b/iu;

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
/** Case-insensitive whole-word owner, name, or `owner/name`. */
export const mentionsRepository = (haystack: string, repository: string): boolean => {
  const [owner, name] = repository.split("/") as [string, string];
  return [repository, owner, name].some((value) =>
    new RegExp(`(^|[^A-Za-z0-9_])${escape(value)}([^A-Za-z0-9_]|$)`, "iu").test(haystack));
};
/** Case-sensitive whole-word language label; `+` and `#` count as word characters for C++ and C#. */
export const mentionsLabel = (haystack: string, label: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_+#])${escape(label)}([^A-Za-z0-9_+#]|$)`, "u").test(haystack);
export const projectCandidateId = (repository: string): string =>
  `local-experiment.project.${rawHash(repository).slice(0, 16)}.v3`;
export const languageCandidateId = (label: string): string =>
  `local-experiment.language.${LANGUAGE_SLUGS[label as StackLanguage] ?? fail()}.v3`;
export const outputCandidateId = (label: string): string => `local-experiment.output.${rawHash(label).slice(0, 16)}.v3`;
/** The kind of value a doctest output shows, so a round's options all look alike. */
export const outputShape = (output: string): string => {
  if (/^-?\d+$/u.test(output)) return "int";
  if (/^-?(?:\d+\.\d*|\.\d+|\d+(?:\.\d*)?e[+-]?\d+|inf|nan)$/u.test(output)) return "float";
  if (/^(?:True|False)$/u.test(output)) return "bool";
  if (output === "None") return "none";
  if (/^(?:'[^']*'|"[^"]*")$/u.test(output)) return "str";
  return { "[": "list", "(": "tuple", "{": "mapping" }[output[0] ?? ""] ?? "other";
};
/**
 * Output options in the order a code-blind solver would rank them: by value when every option is a number,
 * otherwise by length and then text. An output deck spreads its answers evenly over these ranks.
 */
export const outputOrder = (labels: readonly string[]): readonly string[] => {
  const numeric = labels.every((label) => Number.isFinite(Number(label)) && label.trim().length > 0);
  return [...labels].sort((left, right) => numeric
    ? Number(left) - Number(right) || (left < right ? -1 : 1)
    : left.length - right.length || (left < right ? -1 : left > right ? 1 : 0));
};
/** Output options in plain text order, the other fixed preference a code-blind solver might have. */
export const textOrder = (labels: readonly string[]): readonly string[] => [...labels].sort();
/** The orders an output deck balances its answers over. */
export const OUTPUT_ORDERS: readonly ((labels: readonly string[]) => readonly string[])[] = Object.freeze([outputOrder, textOrder]);
/**
 * Whether a call's result repeats one of its own arguments (`digital_root(9)` gives `9`): guessing the echo would
 * answer such a round without reading the function, so no round asks about one.
 */
export const echoesArgument = (call: string, output: string): boolean => {
  const argumentsText = call.slice(call.indexOf("("));
  const text = /^'(.*)'$/u.exec(output)?.[1];
  if (text !== undefined) return argumentsText.includes(`'${text}'`) || argumentsText.includes(`"${text}"`);
  return new RegExp(`(?<![\\w.-])${escape(output)}(?![\\w.])`, "u").test(argumentsText);
};
/** A hint that works one decoy: `call → output`. */
export const OUTPUT_HINT = " → ";
/** A fix round's options name lines of its pane, counted from one. */
export const fixCandidateId = (line: number): string => `local-experiment.fix.line-${line}.v3`;
export const fixLineLabel = (line: number): string => `Line ${line}`;
/** The first hint of a fix round: what kind of change the fix made, never where. */
export const FIX_CHANGE_HINTS = Object.freeze({
  OPERATOR: "The fix changes an operator or a comparison.",
  LITERAL: "The fix changes a number, a string, or another literal value.",
  NAME: "The fix changes a name: a method, a variable, a type, or a keyword.",
  STRUCTURE: "The fix adds, removes, or rearranges part of an expression.",
} as const);
/**
 * The orders a fix deck balances its answers over, each ranking a round's option lines: by position; by distance
 * from the pane's middle line, nearest first; and by length, shortest first. Ties go to the earlier line.
 */
export const FIX_ORDERS: readonly ((lines: readonly number[], pane: readonly string[]) => readonly number[])[] = Object.freeze([
  (lines: readonly number[]) => [...lines].sort((left, right) => left - right),
  (lines: readonly number[], pane: readonly string[]) => [...lines].sort((left, right) =>
    Math.abs(2 * left - pane.length - 1) - Math.abs(2 * right - pane.length - 1) || left - right),
  (lines: readonly number[], pane: readonly string[]) => [...lines].sort((left, right) =>
    pane[left - 1]!.trim().length - pane[right - 1]!.trim().length || left - right),
]);
/**
 * How many more answers than an equal share one rank may hold, per fix order. Position and centrality are exact;
 * a bug's line is often the longest near it, so length allows a tenth of the deck more, which keeps a solver that
 * always picks the longest (or shortest) line within ten points of chance.
 */
export const fixSlack = (rounds: number): readonly number[] => Object.freeze([0, 0, Math.floor(rounds / 10)]);
/** The answer's rank in each fix order. */
export const fixRanks = (answer: number, lines: readonly number[], pane: readonly string[]): readonly number[] =>
  FIX_ORDERS.map((order) => order(lines, pane).indexOf(answer));
/** The second hint of a fix round: the answer and one other option, in line order. */
export const fixPairHint = (first: number, second: number): string =>
  `It is line ${Math.min(first, second)} or line ${Math.max(first, second)}.`;
export const algorithmCandidateId = (id: string): string =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id) ? `local-experiment.algorithm.${id}.v3` : fail();
/** A name as code would spell it once case and separators are dropped: `Merge sort`, `merge_sort`, `MergeSort` all fold to `mergesort`. */
export const foldName = (value: string): string => value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, "");
/** Whether text names an algorithm, inside an identifier or not: its label or any of its known spellings. */
export const namesAlgorithm = (haystack: string, algorithm: Readonly<{ label: string; names: readonly string[] }>): boolean => {
  const folded = foldName(haystack);
  return [algorithm.label, ...algorithm.names].map(foldName).some((name) => name.length > 0 && folded.includes(name));
};

/** An algorithm a curated repository files code under, and the files that show it. */
export interface CuratedAlgorithm {
  readonly id: string;
  readonly label: string;
  readonly family: string;
  readonly names: readonly string[];
  /** `owner/name:path` for each file. */
  readonly files: readonly string[];
}

const parseCandidates = (value: unknown, kind: FixtureKind): readonly CandidateRecord[] => {
  const expected = CANDIDATE_COUNTS[kind];
  if (!Array.isArray(value) || value.length !== expected) return fail();
  const candidates = value.map((entry) => {
    const candidate = record(entry, ["id", "label", "detail"]);
    const detail = candidate.detail === null ? null : text(candidate.detail);
    if (detail !== null && !DETAIL_KINDS.has(kind)) fail();
    return Object.freeze({ id: text(candidate.id), label: text(candidate.label), detail });
  });
  if (new Set(candidates.map(({ id }) => id)).size !== expected
    || new Set(candidates.map(({ label }) => label)).size !== expected) fail();
  return Object.freeze(candidates);
};

const parsePanes = (value: unknown, kind: FixtureKind): readonly Pane[] => {
  const expected = PANE_LAYOUTS[kind];
  if (!Array.isArray(value) || value.length !== expected.length) return fail();
  return Object.freeze(value.map((entry, index) => {
    const pane = record(entry, ["label", "text"]);
    if (pane.label !== expected[index]) fail();
    return Object.freeze({ label: expected[index]!, text: codeText(pane.text) });
  }));
};

interface Snapshot {
  readonly id: string;
  readonly queryIds: ReadonlySet<string>;
  readonly stack: StackIdentity;
  /** The curated repositories' pinned commits, as `owner/name@commit`; empty when the run read none. */
  readonly pins: ReadonlySet<string>;
  /** The algorithms an algorithm round may offer, by id. */
  readonly algorithms: ReadonlyMap<string, CuratedAlgorithm>;
  /** The bug datasets fix rounds come from, by id. */
  readonly datasets: ReadonlySet<string>;
}

type Semantics = Readonly<{
  snapshot: Snapshot;
  panes: readonly Pane[];
  prompt: string;
  candidates: readonly CandidateRecord[];
  clues: readonly string[];
  correctCandidateId: string;
  source: ParsedSource;
}>;

/** The answer is the recorded repository, and no pre-answer text other than the labels names a candidate. */
const validateProject = ({ panes, prompt, candidates, clues, correctCandidateId, source }: Semantics): void => {
  if (candidates.some(({ id, label }) => !REPOSITORY.test(label) || id !== projectCandidateId(label))) fail();
  const correct = candidates.find(({ id }) => id === correctCandidateId) ?? fail();
  if (correct.label !== source.repository || panes[0]!.label !== null || source.excerptHash !== rawHash(panes[0]!.text)) fail();
  for (const part of [panes[0]!.text, prompt, ...clues]) {
    if (candidates.some(({ label }) => mentionsRepository(part, label))) fail();
  }
};

/**
 * The answer is the recorded language; the options are two whole look-alike pairs, the answer's among them,
 * so no option stands out by missing its look-alike; and no pre-answer text names one.
 */
const validateLanguage = ({ panes, prompt, candidates, clues, correctCandidateId, source }: Semantics): void => {
  if (candidates.some(({ id, label }) => !(STACK_LANGUAGES as readonly string[]).includes(label) || id !== languageCandidateId(label))) fail();
  const labels: readonly string[] = candidates.map(({ label }) => label);
  const pairs = LANGUAGE_PAIRS.filter((pair) => pair.some((member) => labels.includes(member)));
  if (pairs.length !== 2 || pairs.some((pair) => pair.some((member) => !labels.includes(member)))) fail();
  const correct = candidates.find(({ id }) => id === correctCandidateId) ?? fail();
  if (correct.label !== source.configuration || source.excerptHash !== rawHash(panes[0]!.text)) fail();
  for (const part of [panes[0]!.text, prompt, ...clues]) {
    if (candidates.some(({ label }) => mentionsLabel(part, label))) fail();
  }
};

/** The answer names the pane that holds the commit's version; the other pane holds its parent's. */
const validateBeforeAfter = ({ panes, candidates, correctCandidateId, source }: Semantics): void => {
  if (candidates.map(({ id }) => id).join("|") !== BEFORE_AFTER_CANDIDATE_IDS.join("|")) fail();
  const later = BEFORE_AFTER_CANDIDATE_IDS.indexOf(correctCandidateId as typeof BEFORE_AFTER_CANDIDATE_IDS[number]);
  if (later < 0) fail();
  const [laterPane, earlierPane] = later === 0 ? [panes[0]!, panes[1]!] : [panes[1]!, panes[0]!];
  if (rawHash(laterPane.text) !== source.excerptHash || rawHash(earlierPane.text) !== source.parentExcerptHash) fail();
};

/**
 * The options are one whole family of algorithms; the answer is the algorithm whose files include this one; the code
 * shows the masked name, and no option's name survives in it or in any text shown before the answer.
 */
const validateAlgorithm = ({ snapshot, panes, prompt, candidates, clues, correctCandidateId, source }: Semantics): void => {
  const options = candidates.map(({ id, label }) => {
    const algorithm = [...snapshot.algorithms.values()].find((known) => algorithmCandidateId(known.id) === id) ?? fail();
    if (algorithm.label !== label) fail();
    return algorithm;
  });
  const family = options[0]!.family;
  const members = [...snapshot.algorithms.values()].filter((algorithm) => algorithm.family === family);
  if (options.some((algorithm) => algorithm.family !== family) || members.length !== options.length) fail();
  const answer = options.find(({ id }) => algorithmCandidateId(id) === correctCandidateId) ?? fail();
  if (answer.id !== source.algorithmId || !answer.files.includes(`${source.repository}:${source.path}`)
    || !(STACK_LANGUAGES as readonly unknown[]).includes(source.language)) fail();
  const code = panes[0]!.text;
  if (source.excerptHash !== rawHash(code) || !foldName(code).includes(MASKED_NAME)
    || new RegExp(`(^|[^A-Za-z0-9_])${escape(String(source.functionName))}([^A-Za-z0-9_]|$)`, "u").test(code)) fail();
  for (const part of [code, prompt, ...clues]) {
    if (options.some((algorithm) => namesAlgorithm(part, algorithm))) fail();
  }
};

/**
 * The pane is a function and one call of it, the last and only `>>>` line; the options are four outputs of one
 * shape; and each hint works a decoy (`call → output`), never the answer.
 */
const validateOutput = ({ panes, candidates, clues, correctCandidateId, source }: Semantics): void => {
  if (candidates.some(({ id, label }) => id !== outputCandidateId(label))) fail();
  const correct = candidates.find(({ id }) => id === correctCandidateId) ?? fail();
  if (new Set(candidates.map(({ label }) => outputShape(label))).size !== 1) fail();
  const code = panes[0]!.text;
  const lines = code.split("\n");
  const call = text(source.call);
  const name = text(source.functionName);
  if (source.excerptHash !== rawHash(code) || lines.at(-1) !== `>>> ${call}` || lines.at(-2) !== ""
    || lines.filter((line) => line.trimStart().startsWith(">>>")).length !== 1
    || !call.startsWith(`${name}(`) || !new RegExp(`^def ${escape(name)}\\b`, "mu").test(code) || echoesArgument(call, correct.label)) fail();
  const worked = clues.map((clue) => {
    const [hintCall, output, extra] = clue.split(OUTPUT_HINT);
    if (extra !== undefined || hintCall === undefined || output === undefined || !hintCall.startsWith(`${name}(`) || hintCall === call) fail();
    return output!;
  });
  if (new Set(worked).size !== worked.length
    || worked.some((output) => output === correct.label || !candidates.some(({ label }) => label === output))) fail();
};

/**
 * Options name four non-blank lines of the pane in line order; the answer is the line the fix changed, counted
 * from the pane's first line; the first hint names the change's kind and the second the answer and one option.
 */
const validateFix = ({ panes, candidates, clues, correctCandidateId, source }: Semantics): void => {
  const lines = panes[0]!.text.split("\n");
  const numbers = candidates.map(({ id, label }) => {
    const line = Number(/^Line ([1-9][0-9]*)$/u.exec(label)?.[1] ?? fail());
    if (id !== fixCandidateId(line) || line > lines.length || lines[line - 1]!.trim().length === 0) fail();
    return line;
  });
  if (numbers.some((line, index) => index > 0 && line <= numbers[index - 1]!)) fail();
  const answer = Number(source.changedLine) - Number(source.windowStart) + 1;
  if (correctCandidateId !== fixCandidateId(answer) || source.excerptHash !== rawHash(panes[0]!.text)) fail();
  if (!(Object.values(FIX_CHANGE_HINTS) as readonly string[]).includes(clues[0]!)) fail();
  const pair = /^It is line ([1-9][0-9]*) or line ([1-9][0-9]*)\.$/u.exec(clues[1]!) ?? fail();
  const named = [Number(pair[1]), Number(pair[2])];
  if (named[0]! >= named[1]! || !named.includes(answer) || named.some((line) => !numbers.includes(line))) fail();
};

const VALIDATORS: Readonly<Record<FixtureKind, (semantics: Semantics) => void>> = Object.freeze({
  PROJECT: validateProject, LANGUAGE: validateLanguage, BEFORE_AFTER: validateBeforeAfter, ALGORITHM: validateAlgorithm,
  OUTPUT: validateOutput, FIX: validateFix,
});

/** Where each kind's source comes from, and the check that binds it to this snapshot. */
const SOURCE_VALIDATORS: Readonly<Record<FixtureKind, (value: unknown, snapshot: Snapshot) => ParsedSource>> = Object.freeze({
  PROJECT: (value: unknown, snapshot: Snapshot) => validateStackSource(value, snapshot.id, snapshot.stack),
  LANGUAGE: (value: unknown, snapshot: Snapshot) => validateStackSource(value, snapshot.id, snapshot.stack),
  BEFORE_AFTER: (value: unknown, snapshot: Snapshot) => validateLineageSource(value, snapshot.id, snapshot.queryIds),
  ALGORITHM: (value: unknown, snapshot: Snapshot) => validateCuratedSource(value, ALGORITHM_SOURCE_KEYS, snapshot.id, snapshot.pins),
  OUTPUT: (value: unknown, snapshot: Snapshot) => validateCuratedSource(value, OUTPUT_SOURCE_KEYS, snapshot.id, snapshot.pins),
  FIX: (value: unknown, snapshot: Snapshot) => validateFixSource(value, snapshot.id, snapshot.datasets),
});

/** Rules a whole deck must keep beyond its rounds' own. */
const DECK_RULES: Readonly<Partial<Record<DeckId, (fixtures: readonly ParsedFixture[]) => void>>> = Object.freeze({
  // Pane order carries no signal: the later version is pane A in half the pool, give or take one.
  "before-after": (fixtures: readonly ParsedFixture[]) => {
    const aLater = fixtures.filter(({ correctCandidateId }) => correctCandidateId === BEFORE_AFTER_CANDIDATE_IDS[0]).length;
    if (Math.abs(2 * aLater - fixtures.length) > 1) fail();
  },
  // In the shown order (numeric, else by length) and in text order, every rank holds the answer equally often, so no
  // extreme and no fixed position finds it more often than chance.
  output: (fixtures: readonly ParsedFixture[]) => {
    for (const order of OUTPUT_ORDERS) {
      const ranks = [0, 0, 0, 0];
      for (const fixture of fixtures) {
        const answer = fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label;
        ranks[order(fixture.candidates.map(({ label }) => label)).indexOf(answer)]! += 1;
      }
      if (Math.max(...ranks) - Math.min(...ranks) > 1) fail();
    }
  },
  // By position and by distance from the pane's middle, every rank holds the answer equally often; by length, nearly.
  fix: (fixtures: readonly ParsedFixture[]) => {
    const counts = FIX_ORDERS.map(() => [0, 0, 0, 0]);
    for (const fixture of fixtures) {
      const lines = fixture.candidates.map(({ label }) => Number(label.slice("Line ".length)));
      const answer = lines[fixture.candidates.findIndex(({ id }) => id === fixture.correctCandidateId)]!;
      fixRanks(answer, lines, fixture.panes[0]!.text.split("\n")).forEach((rank, order) => { counts[order]![rank]! += 1; });
    }
    const slack = fixSlack(fixtures.length);
    if (counts.some((ranks, order) => Math.max(...ranks) > Math.ceil(fixtures.length / 4) + slack[order]!)) fail();
  },
});

const parseAttribution = (value: unknown, source: ParsedSource): string => {
  const attribution = text(value);
  for (const required of [source.authorName, source.repository, source.licenseName, source.licenseSpdx, source.blobUrl]) {
    if (!attribution.includes(required)) fail();
  }
  return attribution;
};

const parseFixture = (value: unknown, kind: FixtureKind, snapshot: Snapshot): ParsedFixture => {
  const fixture = record(value, FIXTURE_KEYS);
  if (fixture.kind !== kind) fail();
  const panes = parsePanes(fixture.panes, kind);
  const prompt = text(fixture.prompt);
  const candidates = parseCandidates(fixture.candidates, kind);
  const clues = texts(fixture.clues, 2);
  const correctCandidateId = text(fixture.correctCandidateId);
  const evidence = text(fixture.evidence);
  const explanation = text(fixture.explanation);
  const source = SOURCE_VALIDATORS[kind](fixture.source, snapshot);
  VALIDATORS[kind]({ snapshot, panes, prompt, candidates, clues, correctCandidateId, source });
  const helpfulSignals = texts(fixture.helpfulSignals);
  const misleadingSignals = texts(fixture.misleadingSignals);
  const claimText = [prompt, ...candidates.flatMap(({ label, detail }) => [label, detail ?? ""]), ...clues, evidence, explanation,
    ...helpfulSignals, ...misleadingSignals].join("\n");
  if (AUTHORSHIP_CLAIM.test(claimText)) fail();
  return deepFreeze({
    kind,
    roundId: text(fixture.roundId),
    roundVersion: sha256(fixture.roundVersion),
    panes,
    prompt,
    candidates,
    clues,
    correctCandidateId,
    evidence,
    explanation,
    attribution: parseAttribution(fixture.attribution, source),
    helpfulSignals,
    misleadingSignals,
    source,
  });
};

const requireDistinct = (fixtures: readonly ParsedFixture[], keys: readonly string[]): void => {
  for (const key of keys) {
    const values = fixtures.map(({ source }) => source[key]);
    if (new Set(values).size !== fixtures.length) fail();
  }
};

/** Across decks, each identity may appear once among the rounds whose kind lists it. */
const requireDistinctAcrossDecks = (fixtures: readonly ParsedFixture[]): void => {
  const keys = new Set(fixtures.flatMap(({ kind }) => CROSS_DECK_KEYS_BY_KIND[kind]));
  for (const key of keys) requireDistinct(fixtures.filter(({ kind }) => CROSS_DECK_KEYS_BY_KIND[kind].includes(key)), [key]);
};

const parseDeck = (value: unknown, snapshot: Snapshot): ParsedDeck => {
  const deck = record(value, DECK_KEYS);
  const id = DECK_IDS.find((known) => known === deck.id) ?? fail();
  const title = text(deck.title);
  const description = text(deck.description);
  if (deck.roundsPerSession !== ROUNDS_PER_SESSION) fail();
  const values = Array.isArray(deck.fixtures) ? deck.fixtures : fail();
  if (values.length < ROUNDS_PER_SESSION || values.length > MAXIMUM_POOL_SIZE) fail();
  const fixtures = values.map((fixture: unknown) => parseFixture(fixture, DECK_KINDS[id], snapshot));
  requireDistinct(fixtures, DEDUPLICATION_KEYS_BY_KIND[DECK_KINDS[id]]);
  DECK_RULES[id]?.(fixtures);
  return deepFreeze({ id, title, description, roundsPerSession: ROUNDS_PER_SESSION, fixtures: Object.freeze(fixtures) });
};

/** Repository names may appear before the answer only as project-round candidate labels. */
const requirePublicContainment = (fixtures: readonly ParsedFixture[]): void => {
  const publicText = serializeCanonical(fixtures.map((fixture) => ({
    panes: fixture.panes,
    prompt: fixture.prompt,
    candidates: fixture.kind === "PROJECT" ? fixture.candidates.map(({ id, detail }) => ({ id, detail })) : fixture.candidates,
    clues: fixture.clues,
  })));
  for (const fixture of fixtures) {
    const protectedValues = [
      fixture.evidence,
      fixture.explanation,
      fixture.attribution,
      ...PROTECTED_SOURCE_KEYS.map((key) => fixture.source[key])
        // A whole-file excerpt makes the raw-content hash equal the public excerpt hash.
        .filter((value) => value !== fixture.source.excerptHash && value !== fixture.source.parentExcerptHash),
    ];
    if (protectedValues.some((value) => typeof value === "string" && containsProtected(publicText, value))) fail();
  }
};

const parseQueryIds = (value: unknown): ReadonlySet<string> => {
  const queries = Array.isArray(value) ? value : fail();
  const ids = new Set<string>();
  for (const entry of queries) {
    const query = record(entry, ["id", "query", "sort", "order", "pages", "resultCeiling"]);
    if (query.sort !== "committer-date" || query.order !== "desc") fail();
    text(query.query);
    positiveInteger(query.pages);
    positiveInteger(query.resultCeiling);
    const id = text(query.id);
    if (ids.has(id)) fail();
    ids.add(id);
  }
  return ids;
};

const validateResponseHashes = (value: unknown, snapshotId: string, profileHash: string): void => {
  const acceptedResponseHashes = Array.isArray(value) ? value : fail();
  if (acceptedResponseHashes.length === 0) fail();
  const responseHashes = acceptedResponseHashes.map(sha256);
  if (new Set(responseHashes).size !== responseHashes.length
    || snapshotId !== canonicalHash({ profileHash, acceptedResponseHashes: responseHashes })) fail();
};

/** The curated section lists each pinned repository commit once, in order. */
const parsePins = (value: unknown): ReadonlySet<string> => {
  const pins = (Array.isArray(value) ? value : fail()).map((entry: unknown) => {
    const pin = record(entry, ["repository", "commit"]);
    const repository = text(pin.repository);
    if (!REPOSITORY.test(repository)) fail();
    return pinKey(repository, gitId(pin.commit));
  });
  if (pins.length === 0 || pins.some((pin, index) => index > 0 && pin <= pins[index - 1]!)) fail();
  return new Set(pins);
};

/** The algorithms the run's algorithm rounds may offer, in id order, each file in a pinned repository. */
const parseAlgorithms = (value: unknown, pins: ReadonlySet<string>): ReadonlyMap<string, CuratedAlgorithm> => {
  const pinned = new Set([...pins].map((pin) => pin.split("@")[0]!));
  const algorithms = (Array.isArray(value) ? value : fail()).map((entry: unknown): CuratedAlgorithm => {
    const algorithm = record(entry, ["id", "label", "family", "names", "files"]);
    const files = texts(algorithm.files);
    if (files.some((file) => !pinned.has(file.split(":")[0]!) || file.split(":").length !== 2)) fail();
    algorithmCandidateId(text(algorithm.id));
    return Object.freeze({ id: text(algorithm.id), label: text(algorithm.label), family: text(algorithm.family),
      names: texts(algorithm.names), files });
  });
  if (algorithms.length === 0 || algorithms.some(({ id }, index) => index > 0 && id <= algorithms[index - 1]!.id)
    || new Set(algorithms.map(({ label }) => label)).size !== algorithms.length) fail();
  return new Map(algorithms.map((algorithm) => [algorithm.id, algorithm]));
};

/** Bug datasets at pinned commits, in id order: `{id, repository, commit}`. */
const parseDatasets = (value: unknown): ReadonlySet<string> => {
  const ids = (Array.isArray(value) ? value : fail()).map((entry: unknown) => {
    const dataset = record(entry, ["id", "repository", "commit"]);
    if (!REPOSITORY.test(text(dataset.repository))) fail();
    gitId(dataset.commit);
    return text(dataset.id);
  });
  if (ids.length === 0 || ids.some((id, index) => index > 0 && id <= ids[index - 1]!)) fail();
  return new Set(ids);
};
const parseCurated = (value: unknown): Pick<Snapshot, "pins" | "algorithms" | "datasets"> => {
  const optional = ["algorithms", "datasets"].filter((key) => typeof value === "object" && value !== null && Object.hasOwn(value, key));
  const curated = record(value, ["pins", ...optional]);
  const pins = parsePins(curated.pins);
  return Object.freeze({
    pins,
    algorithms: optional.includes("algorithms") ? parseAlgorithms(curated.algorithms, pins) : new Map(),
    datasets: optional.includes("datasets") ? parseDatasets(curated.datasets) : new Set<string>(),
  });
};

const SNAPSHOT_KEYS = ["id", "profileVersion", "profileHash", "github", "stack", "acceptedResponseHashes"] as const;

const parseSnapshot = (value: unknown, profileHash: string): Snapshot => {
  // A run that read curated repositories lists their pins; one that read none has no curated section.
  const curated = typeof value === "object" && value !== null && Object.hasOwn(value, "curated");
  const snapshot = record(value, curated ? [...SNAPSHOT_KEYS, "curated"] : SNAPSHOT_KEYS);
  const id = sha256(snapshot.id);
  if (snapshot.profileVersion !== PROFILE_VERSION || sha256(snapshot.profileHash) !== profileHash) fail();
  const github = record(snapshot.github, ["apiVersion", "queries"]);
  text(github.apiVersion);
  const queryIds = parseQueryIds(github.queries);
  const stack = record(snapshot.stack, ["release", "revision", "configurations"]);
  const identity = Object.freeze({ release: text(stack.release), revision: gitId(stack.revision) });
  if (!Array.isArray(stack.configurations)
    || stack.configurations.join("|") !== STACK_LANGUAGES.join("|")) fail();
  validateResponseHashes(snapshot.acceptedResponseHashes, id, profileHash);
  return Object.freeze({ id, queryIds, stack: identity,
    ...(curated ? parseCurated(snapshot.curated)
      : { pins: new Set<string>(), algorithms: new Map<string, CuratedAlgorithm>(), datasets: new Set<string>() }) });
};

export const ARTIFACT_KEYS = ["schemaVersion", "contentClass", "profileHash", "crawlSnapshot", "decks"] as const;

/**
 * Parses the artifact into its decks. A run publishes every deck it could fill, so an artifact holds one
 * to three decks in deck order, each a pool of rounds validated in full and against the others.
 */
export const parseArtifactDecks = (value: unknown): readonly ParsedDeck[] => {
  const artifact: JsonRecord = record(value, ARTIFACT_KEYS);
  if (artifact.schemaVersion !== ARTIFACT_SCHEMA_VERSION || artifact.contentClass !== CONTENT_CLASS) fail();
  const profileHash = sha256(artifact.profileHash);
  const snapshot = parseSnapshot(artifact.crawlSnapshot, profileHash);
  const values = Array.isArray(artifact.decks) ? artifact.decks : fail();
  if (values.length === 0 || values.length > DECK_IDS.length) fail();
  const decks = values.map((deck: unknown) => parseDeck(deck, snapshot));
  const order = decks.map(({ id }) => DECK_IDS.indexOf(id));
  if (order.some((position, index) => index > 0 && position <= order[index - 1]!)) fail();
  const fixtures = decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures);
  const roundIds = fixtures.map(({ roundId }) => roundId.toLocaleLowerCase("en-US"));
  if (new Set(roundIds).size !== fixtures.length) fail();
  requireDistinctAcrossDecks(fixtures);
  requirePublicContainment(fixtures);
  return Object.freeze(decks);
};

/** Validates the artifact in full and returns a frozen copy of it. */
export const parseExperimentArtifact = (value: unknown): ExperimentArtifact => {
  parseArtifactDecks(value);
  return deepFreeze(structuredClone(value)) as ExperimentArtifact;
};

/** Every fixture in deck order. */
export const artifactFixtures = (artifact: ExperimentArtifact): readonly ExperimentFixture[] =>
  artifact.decks.flatMap(({ fixtures }) => fixtures);

/** The SHA-256 of the artifact's canonical serialization, which the game pins. */
export const artifactHash = (value: unknown): string => canonicalHash(value);
