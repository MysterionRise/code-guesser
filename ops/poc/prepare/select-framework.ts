import { screenBlob } from "@codeguessr/content/local-poc-support";

import { CROSS_DECK_KEYS_BY_KIND, deduplicationKeys } from "../../../packages/artifact/src/index";
import { DECK_SHORT, noteRejection, rejectCandidate, type DeckAttempts, type DeckOutcome, type RunState } from "./diagnostics";
import { looksGenerated } from "./excerpt-window";
import type { FrameworkCandidate } from "./framework-rounds";
import { frameworkWindow } from "./framework-window";
import type { FrameworkEntry, FrameworkFamily } from "./profile";
import { sha256 } from "./round-helpers";
import { addHashes, collidesWithSelected, revealsProtected, unreportable } from "./selection";
import type { Context, PreparationDependencies } from "./types";

/** A framework round in waiting: everything but the final snapshot it is bound to. */
export type FrameworkSelection = Omit<FrameworkCandidate, "crawlSnapshotId">;

const fail = (code: string): never => { throw new Error(code); };

/** A file that would state a licence of its own for the directory it is in. */
const LICENSE_FILE = /^(?:licen[cs]e|copying|unlicense|notice|patents)(?:[.-][\w.-]*)?$/iu;

/**
 * Selects the framework deck, one whole family at a time: each of a family's four frameworks needs
 * `roundsPerFramework` of its files, tried in the profile's order, that yield a window telling it apart from the rest
 * of the family. A family that cannot fill is dropped whole, so every published family answers each of its frameworks
 * equally often.
 *
 * The repository's licence covers its examples "unless otherwise specified", so a file is read only when no directory
 * from its example down to the file holds a licence file, and the example's package manifest declares no licence or the
 * repository's own.
 */
export const selectFramework = async (
  context: Context,
  deps: PreparationDependencies,
  hashes: string[],
  state: RunState,
  attempt: DeckAttempts,
  otherDecks: () => readonly unknown[],
): Promise<DeckOutcome<FrameworkSelection>> => attempt<FrameworkSelection>(async () => {
  const { profile } = context;
  const deck = profile.curated!.framework!;
  const pin = profile.curated!.repositories.find(({ repository }) => repository === deck.repository)!;
  const target = { repository: pin.repository, commit: pin.commit };
  const every = deck.families.flatMap(({ frameworks }) => frameworks);
  // Every framework's names are masked in every round, so no window names one, whichever family it is offered with.
  const terms = { names: every.flatMap(({ label, names }) => [label, ...names]), symbols: every.flatMap(({ symbols }) => symbols) };
  const limits = { maxLines: deck.windowLines, maxBytes: profile.screening.excerptBytes, minBytes: profile.screening.minimumExcerptBytes };
  const keys = { deck: deduplicationKeys("FRAMEWORK", profile.profileVersion), cross: CROSS_DECK_KEYS_BY_KIND.FRAMEWORK };
  const seen = new Set<string>();
  const rounds: FrameworkSelection[] = [];
  /** Each directory's listing, read once. */
  const listings = new Map<string, readonly string[]>();
  const listing = async (path: string): Promise<readonly string[]> => {
    if (!listings.has(path)) {
      const listed = await deps.listCuratedDirectory({ ...context, ...target, path });
      addHashes(hashes, listed.acceptedResponseHashes);
      listings.set(path, listed.value);
    }
    return listings.get(path)!;
  };
  /** Each example's manifest licence, read once: the code that refuses it, or undefined when it states none of its own. */
  const manifests = new Map<string, string | undefined>();

  /** Throws when a licence other than the repository's applies to `path` in `example`. */
  const clearLicense = async (example: string, path: string): Promise<void> => {
    const directories = path.slice(0, path.lastIndexOf("/")).slice(example.length).split("/").filter((part) => part.length > 0)
      .reduce<string[]>((paths, part) => [...paths, `${paths.at(-1)!}/${part}`], [example]);
    for (const directory of directories) {
      const files = await listing(directory);
      if (files.some((file) => LICENSE_FILE.test(file.slice(file.lastIndexOf("/") + 1)))) fail("FRAMEWORK_LICENSE_OWN");
    }
    if (!manifests.has(example)) {
      let refused: string | undefined;
      if ((await listing(example)).includes(`${example}/package.json`)) {
        const read = await deps.readCuratedFile({ ...context, ...target, path: `${example}/package.json` });
        addHashes(hashes, read.acceptedResponseHashes);
        let manifest: unknown;
        try {
          manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.value.bytes));
        } catch {
          manifest = undefined;
        }
        const declared = typeof manifest === "object" && manifest !== null ? (manifest as Record<string, unknown>).license : null;
        if (declared === null) refused = "FRAMEWORK_LICENSE_UNREADABLE";
        else if (declared !== undefined && declared !== pin.license?.spdx) refused = "FRAMEWORK_LICENSE_OWN";
      }
      manifests.set(example, refused);
    }
    const refused = manifests.get(example);
    if (refused !== undefined) fail(refused);
  };

  const tryFile = async (family: FrameworkFamily, entry: FrameworkEntry, path: string, picked: readonly FrameworkSelection[]) => {
    const example = entry.examples.find((root) => path.startsWith(`${root}/`))!;
    let read;
    try {
      await clearLicense(example, path);
      const result = await deps.readCuratedFile({ ...context, ...target, path });
      addHashes(hashes, result.acceptedResponseHashes);
      read = result.value;
    } catch (error) {
      rejectCandidate(state, "ADMISSION", error);
      return undefined;
    }
    let window;
    try {
      const screened = screenBlob({ path, bytes: read.bytes }, seen);
      if (looksGenerated(screened.text, profile.screening.generatedScanLines)) fail("GENERATED_CONTENT");
      window = frameworkWindow(screened.text, entry.id, family.frameworks.map(({ id }) => id), terms, limits) ?? fail("FRAMEWORK_WINDOW");
    } catch (error) {
      rejectCandidate(state, "SCREENING", error);
      return undefined;
    }
    let bound;
    try {
      const result = await deps.bindCuratedFile({ ...context, ...target, path });
      addHashes(hashes, result.acceptedResponseHashes);
      bound = result.value;
    } catch (error) {
      rejectCandidate(state, "ADMISSION", error);
      return undefined;
    }
    try {
      if (bound.blob !== read.blob) fail("FRAMEWORK_FILE_CHANGED");
      const selection: FrameworkSelection = Object.freeze({
        familyId: family.id, framework: entry.id, repository: pin.repository, commit: pin.commit, path, blob: bound.blob,
        rawContentHash: bound.rawContentHash, licenseName: bound.licenseName, licenseSpdx: bound.licenseSpdx,
        licenseFileUrl: bound.licenseFileUrl, authorName: bound.author.name, authorLogin: bound.author.login,
        authorCommit: bound.author.commit, windowStart: window.windowStart, excerpt: window.excerpt,
        excerptHash: sha256(window.excerpt), marker: window.markers[0]!,
      });
      if (collidesWithSelected(profile, selection, [...rounds, ...picked], otherDecks(), keys)) {
        state.duplicatesRejected += 1;
        fail("SOURCE_DUPLICATE");
      }
      if (revealsProtected(profile, selection, [...otherDecks(), ...rounds, ...picked])) fail("PUBLIC_CONTAINMENT_REJECTED");
      if (unreportable(selection)) fail("SOURCE_IDENTITY_UNREPORTABLE");
      state.screened += 1;
      return selection;
    } catch (error) {
      rejectCandidate(state, "SCREENING", error);
      return undefined;
    }
  };

  for (const family of deck.families) {
    if (rounds.length >= deck.rounds) break;
    const picked: FrameworkSelection[] = [];
    for (const entry of family.frameworks) {
      const own: FrameworkSelection[] = [];
      for (const path of entry.files) {
        if (own.length >= deck.roundsPerFramework) break;
        const selection = await tryFile(family, entry, path, [...picked, ...own]);
        if (selection) own.push(selection);
      }
      if (own.length < deck.roundsPerFramework) break;
      picked.push(...own);
    }
    if (picked.length === family.frameworks.length * deck.roundsPerFramework) rounds.push(...picked);
    else noteRejection(state, "SELECTION", new Error("FRAMEWORK_FAMILY_SHORT"));
  }
  if (rounds.length < deck.rounds) return { skipped: DECK_SHORT };
  return { candidates: Object.freeze(rounds) };
});
