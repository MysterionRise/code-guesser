/**
 * Pure builders for the ffmpeg invocations that turn a Playwright screencast
 * into README media. Nothing here touches the file system; `index.ts` spawns
 * the arguments these functions return.
 */

export interface GifOptions {
  /** Output width in pixels; height follows the source aspect ratio. */
  readonly width: number;
  readonly framesPerSecond: number;
  readonly maximumColors: number;
  /** Playback speed multiplier; 1.5 plays the clip 1.5x faster. */
  readonly speed: number;
}

export interface Mp4Options {
  readonly width: number;
  readonly constantRateFactor: number;
}

export const DEFAULT_GIF_OPTIONS: GifOptions = Object.freeze({
  width: 405,
  framesPerSecond: 15,
  maximumColors: 128,
  speed: 1,
});

export const DEFAULT_MP4_OPTIONS: Mp4Options = Object.freeze({
  width: 720,
  constantRateFactor: 23,
});

const positive = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive number`);
  return value;
};

const evenWidth = (width: number): number => {
  const rounded = Math.round(positive(width, "width"));
  return rounded % 2 === 0 ? rounded : rounded + 1;
};

const speedFilter = (speed: number): string[] =>
  positive(speed, "speed") === 1 ? [] : [`setpts=PTS/${speed}`];

/** Two-pass palette GIF encode expressed as one filter graph. */
export const gifFilterGraph = (options: GifOptions): string => {
  const colors = Math.round(positive(options.maximumColors, "maximumColors"));
  if (colors < 2 || colors > 256) throw new RangeError("maximumColors must be between 2 and 256");
  const prepare = [
    ...speedFilter(options.speed),
    `fps=${Math.round(positive(options.framesPerSecond, "framesPerSecond"))}`,
    `scale=${evenWidth(options.width)}:-2:flags=lanczos`,
  ].join(",");
  return [
    `[0:v]${prepare},split[prepared][sample]`,
    `[sample]palettegen=max_colors=${colors}:stats_mode=diff[palette]`,
    "[prepared][palette]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
  ].join(";");
};

export const gifArguments = (input: string, output: string, options: GifOptions = DEFAULT_GIF_OPTIONS): readonly string[] =>
  Object.freeze([
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-filter_complex", gifFilterGraph(options),
    "-loop", "0",
    output,
  ]);

export const mp4Arguments = (input: string, output: string, options: Mp4Options = DEFAULT_MP4_OPTIONS): readonly string[] =>
  Object.freeze([
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-vf", `scale=${evenWidth(options.width)}:-2:flags=lanczos`,
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", String(Math.round(positive(options.constantRateFactor, "constantRateFactor"))),
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    output,
  ]);
