import { DEFAULT_GIF_OPTIONS, DEFAULT_MP4_OPTIONS, gifArguments, gifFilterGraph, mp4Arguments } from "./encode";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

describe("demo recorder ffmpeg argument builders", () => {
  it("builds a single-pass palette GIF graph at the default vertical size", () => {
    const graph = gifFilterGraph(DEFAULT_GIF_OPTIONS);

    expect(graph).toBe(
      "[0:v]fps=15,scale=406:-2:flags=lanczos,split[prepared][sample];"
      + "[sample]palettegen=max_colors=128:stats_mode=diff[palette];"
      + "[prepared][palette]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    );
  });

  it("speeds a clip up with setpts before sampling frames", () => {
    expect(gifFilterGraph({ ...DEFAULT_GIF_OPTIONS, speed: 1.5 })).toMatch(/^\[0:v\]setpts=PTS\/1\.5,fps=15,/u);
    expect(gifFilterGraph({ ...DEFAULT_GIF_OPTIONS, speed: 1 })).not.toContain("setpts");
  });

  it("rejects impossible encoding parameters", () => {
    expect(() => gifFilterGraph({ ...DEFAULT_GIF_OPTIONS, width: 0 })).toThrow(RangeError);
    expect(() => gifFilterGraph({ ...DEFAULT_GIF_OPTIONS, framesPerSecond: -1 })).toThrow(RangeError);
    expect(() => gifFilterGraph({ ...DEFAULT_GIF_OPTIONS, maximumColors: 300 })).toThrow(RangeError);
    expect(() => gifFilterGraph({ ...DEFAULT_GIF_OPTIONS, speed: Number.NaN })).toThrow(RangeError);
  });

  it("emits quiet, overwriting, looping GIF arguments around the graph", () => {
    const args = gifArguments("in.webm", "out.gif");

    expect(args.slice(0, 6)).toEqual(["-hide_banner", "-loglevel", "error", "-y", "-i", "in.webm"]);
    expect(args).toContain("-filter_complex");
    expect(args.slice(-3)).toEqual(["-loop", "0", "out.gif"]);
    expect(Object.isFrozen(args)).toBe(true);
  });

  it("emits a browser-safe H.264 MP4 with even dimensions and no audio track", () => {
    const args = mp4Arguments("in.webm", "out.mp4", { ...DEFAULT_MP4_OPTIONS, width: 405 });

    expect(args).toContain("scale=406:-2:flags=lanczos");
    expect(args).toContain("libx264");
    expect(args).toContain("yuv420p");
    expect(args).toContain("+faststart");
    expect(args).toContain("-an");
    expect(args.at(-1)).toBe("out.mp4");
    expect(args[args.indexOf("-crf") + 1]).toBe("23");
  });
});
