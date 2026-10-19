/**
 * The experiment report's statistics (#108): Beta posteriors over rates, drawn from a seeded generator so a report
 * reads the same every time it runs on the same events, and the pre-registered sample size.
 */

/** A small seeded generator (mulberry32), uniform on [0, 1). */
export const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const standardNormal = (random: () => number): number => {
  // Box–Muller; 1 - u keeps the logarithm finite.
  const u = 1 - random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
};

/** A Gamma(shape, 1) draw for shape ≥ 1 (Marsaglia and Tsang), which every Beta(1 + s, 1 + f) posterior needs. */
const gamma = (shape: number, random: () => number): number => {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = standardNormal(random);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = 1 - random();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
};

/** Draws from the Beta(1 + successes, 1 + failures) posterior, a uniform prior updated by the counts. */
export const posteriorDraws = (successes: number, trials: number, draws: number, random: () => number): Float64Array => {
  const out = new Float64Array(draws);
  for (let index = 0; index < draws; index += 1) {
    const a = gamma(1 + successes, random);
    out[index] = a / (a + gamma(1 + trials - successes, random));
  }
  return out;
};

/** The value at quantile `q` of sorted values, interpolated linearly. */
export const quantile = (sorted: ArrayLike<number>, q: number): number => {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const above = Math.min(below + 1, sorted.length - 1);
  return sorted[below]! + (sorted[above]! - sorted[below]!) * (position - below);
};

const sortedCopy = (values: ArrayLike<number>): Float64Array => Float64Array.from(values).sort();

/** A rate's posterior summary: its mean and a 95% interval. */
export interface Interval { readonly mean: number; readonly low: number; readonly high: number }
const summarize = (draws: ArrayLike<number>): Interval => {
  const sorted = sortedCopy(draws);
  let total = 0;
  for (let index = 0; index < sorted.length; index += 1) total += sorted[index]!;
  return Object.freeze({ mean: total / sorted.length, low: quantile(sorted, 0.025), high: quantile(sorted, 0.975) });
};

export interface ArmCounts { readonly level: string; readonly successes: number; readonly trials: number }
export interface ArmComparison extends ArmCounts {
  readonly rate: Interval;
  /** The share of draws in which this level's rate is the highest of the levels with data; 0 without data. */
  readonly pBest: number;
  /** This level's rate minus control's, and the share of draws in which it is above control; null for control. */
  readonly difference: Interval | null;
  readonly pAboveControl: number | null;
}

export const DRAWS = 20_000;

/**
 * Compares levels of one factor on one rate: each level's posterior, the chance it is best, and its difference from
 * control, all from the same joint draws.
 */
export const compareArms = (arms: readonly ArmCounts[], control: string, seed: number, draws = DRAWS): readonly ArmComparison[] => {
  const random = seededRandom(seed);
  const samples = arms.map(({ successes, trials }) => posteriorDraws(successes, trials, draws, random));
  const wins = arms.map(() => 0);
  // Only levels with data compete for best: an empty level's prior alone would win draws it has no claim to.
  const competing = arms.flatMap(({ trials }, index) => trials > 0 ? [index] : []);
  if (competing.length > 0) {
    for (let index = 0; index < draws; index += 1) {
      let best = competing[0]!;
      for (const arm of competing) if (samples[arm]![index]! > samples[best]![index]!) best = arm;
      wins[best]! += 1;
    }
  }
  const controlIndex = arms.findIndex(({ level }) => level === control);
  return Object.freeze(arms.map((arm, index) => {
    const own = samples[index]!;
    const base = controlIndex < 0 || index === controlIndex ? null : samples[controlIndex]!;
    const difference = base === null ? null : own.map((value, draw) => value - base[draw]!);
    let above = 0;
    if (difference !== null) for (let draw = 0; draw < draws; draw += 1) above += difference[draw]! > 0 ? 1 : 0;
    return Object.freeze({
      ...arm,
      rate: summarize(own),
      pBest: wins[index]! / draws,
      difference: difference === null ? null : summarize(difference),
      pAboveControl: difference === null ? null : above / draws,
    });
  }));
};

/** The standard normal quantile (Acklam's rational approximation, relative error under 1.2e-9). */
export const normalQuantile = (p: number): number => {
  if (!(p > 0 && p < 1)) throw new RangeError("normalQuantile needs 0 < p < 1");
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (q: number) => (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q
    / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
};

/**
 * Completed games per level to detect a rise of `lift` over a `base` rate with a two-sided test of two proportions,
 * at α split evenly over `comparisons` comparisons with control (Bonferroni), with the given power.
 */
export const sampleSize = ({ base, lift, comparisons, alpha = 0.05, power = 0.8 }: Readonly<{
  base: number; lift: number; comparisons: number; alpha?: number; power?: number;
}>): number => {
  const other = base + lift;
  const pooled = (base + other) / 2;
  const zAlpha = normalQuantile(1 - alpha / comparisons / 2);
  const zPower = normalQuantile(power);
  const numerator = zAlpha * Math.sqrt(2 * pooled * (1 - pooled)) + zPower * Math.sqrt(base * (1 - base) + other * (1 - other));
  return Math.ceil((numerator * numerator) / (lift * lift));
};

/** The median of some values, or null when there are none. */
export const median = (values: readonly number[]): number | null =>
  values.length === 0 ? null : quantile(sortedCopy(values), 0.5);
/** The 95th percentile of some values, or null when there are none. */
export const percentile95 = (values: readonly number[]): number | null =>
  values.length === 0 ? null : quantile(sortedCopy(values), 0.95);
