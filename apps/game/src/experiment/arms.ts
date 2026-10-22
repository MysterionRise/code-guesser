/**
 * Experiment arms (#106): each game draws one level of every factor at deal time, independently of the others, and
 * the server seals the draw into the game's token (#96). Factors are independent, so every game counts toward every
 * factor's comparison. Nothing identifies a player: a returning player draws afresh, and every metric is per game.
 */

export const FACTORS = Object.freeze({
  /** The generative design after the lock (#114); `off` is the static game. */
  design: Object.freeze(["off", "catalog", "composer", "visualizer", "host"] as const),
  /** The visual theme (#125); `terminal` is the original look. */
  theme: Object.freeze(["terminal", "paper", "arcade", "contrast"] as const),
  /** The preparation-time question layer (#127, #128). */
  layer: Object.freeze(["off", "on"] as const),
});

export type Factor = keyof typeof FACTORS;
export type Level<F extends Factor> = (typeof FACTORS)[F][number];
export type Arms = Readonly<{ [F in Factor]: Level<F> }>;

/** Each factor's control level, which takes the weight of any level switched off. */
export const CONTROL: Arms = Object.freeze({ design: "off", theme: "terminal", layer: "off" });

/**
 * The committed weights; a level weighs 0 until it is built. Question layers exist for the algorithm and language
 * decks so far (#128); on another deck a game drawn `on` plays as `off`, and the report reads the layer per deck.
 */
export const WEIGHTS: Readonly<{ [F in Factor]: Readonly<Record<Level<F>, number>> }> = Object.freeze({
  design: Object.freeze({ off: 1, catalog: 1, composer: 1, visualizer: 1, host: 1 }),
  theme: Object.freeze({ terminal: 1, paper: 1, arcade: 1, contrast: 1 }),
  layer: Object.freeze({ off: 1, on: 1 }),
});

const FACTOR_NAMES = Object.keys(FACTORS) as Factor[];

export const isLevel = <F extends Factor>(factor: F, value: unknown): value is Level<F> =>
  typeof value === "string" && (FACTORS[factor] as readonly string[]).includes(value);

/** Arms with exactly these three keys and known levels, or null. */
export const parseArms = (value: unknown): Arms | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("|") !== [...FACTOR_NAMES].sort().join("|")) return null;
  return FACTOR_NAMES.every((factor) => isLevel(factor, record[factor])) ? Object.freeze({ ...record }) as Arms : null;
};

/** `EXPERIMENT_DISABLED`: comma-separated `factor:level` pairs, such as `design:host,theme:arcade`. */
export const parseDisabled = (value: string | undefined): ReadonlySet<string> => new Set((value ?? "").split(",")
  .map((pair) => pair.trim()).filter((pair) => {
    const [factor, level, ...rest] = pair.split(":");
    return rest.length === 0 && factor !== undefined && factor in FACTORS && isLevel(factor as Factor, level);
  }));

/** A factor's weights after the kill switch: a switched-off level weighs 0 and its weight goes to the control level. */
export const effectiveWeights = <F extends Factor>(factor: F, disabled: ReadonlySet<string>): readonly number[] => {
  const levels = FACTORS[factor] as readonly string[];
  const base = WEIGHTS[factor] as Readonly<Record<string, number>>;
  const off = (level: string): boolean => level !== CONTROL[factor] && disabled.has(`${factor}:${level}`);
  const moved = levels.reduce((sum, level) => sum + (off(level) ? base[level]! : 0), 0);
  return levels.map((level) => off(level) ? 0 : base[level]! + (level === CONTROL[factor] ? moved : 0));
};

/** One factor's level, drawn by weight. */
const drawLevel = <F extends Factor>(factor: F, disabled: ReadonlySet<string>, random: () => number): Level<F> => {
  const levels = FACTORS[factor] as readonly Level<F>[];
  const weights = effectiveWeights(factor, disabled);
  let threshold = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (const [index, weight] of weights.entries()) {
    if (weight > 0 && threshold < weight) return levels[index]!;
    threshold -= weight;
  }
  return CONTROL[factor] as Level<F>;
};

export interface AssignOptions {
  /** Without generative UI (`GENUI_ENABLED=1`) every game's design is `off`. */
  readonly genuiEnabled: boolean;
  readonly disabled: ReadonlySet<string>;
  /** Levels a local tester picked (`?design=` and friends), honoured only in lab mode; see `labOverrides`. */
  readonly overrides?: Partial<Arms>;
  readonly random?: () => number;
}

/** Draws a game's arms. An override wins over the draw, but never turns on a design without generative UI. */
export const assignArms = ({ genuiEnabled, disabled, overrides = {}, random = Math.random }: AssignOptions): Arms => {
  const drawn = Object.fromEntries(FACTOR_NAMES.map((factor) => [factor, overrides[factor] ?? drawLevel(factor, disabled, random)]));
  if (!genuiEnabled) drawn.design = "off";
  return Object.freeze(drawn) as Arms;
};

/**
 * A challenger's arms as their friend plays them (#173): the same theme and question layer, so both see the same
 * scaffolds and are sold the same hints, and the same design while generative UI is on and the design isn't switched
 * off; otherwise the static game.
 */
export const challengedArms = (arms: Arms, { genuiEnabled, disabled }: Pick<AssignOptions, "genuiEnabled" | "disabled">): Arms =>
  Object.freeze({ ...arms, design: genuiEnabled && !disabled.has(`design:${arms.design}`) ? arms.design : CONTROL.design });

/**
 * Lab mode lets a local tester pick levels by query and shows the Lab bar: on with `EXPERIMENT_LAB=1`, or under
 * `next dev`. A public server (`CODEGUESSR_PUBLIC=1`, #97) leaves it off, so the draw stands, except for a smoke run
 * whose events are tagged `agent` or `synthetic` (`EXPERIMENT_SOURCE`) and so never mix with real games.
 */
export const labMode = (env: Readonly<Record<string, string | undefined>> = process.env): boolean =>
  (env.EXPERIMENT_LAB === "1" || env.NODE_ENV === "development")
  && (env.CODEGUESSR_PUBLIC !== "1" || env.EXPERIMENT_SOURCE === "agent" || env.EXPERIMENT_SOURCE === "synthetic");

/** The levels a lab query names: `?design=`, `?theme=`, `?layer=`; anything unknown is ignored. */
export const labOverrides = (query: Readonly<Record<string, string | string[] | undefined>>): Partial<Arms> =>
  Object.freeze(Object.fromEntries(FACTOR_NAMES.flatMap((factor) => isLevel(factor, query[factor]) ? [[factor, query[factor]]] : [])));
