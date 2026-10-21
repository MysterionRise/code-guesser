import { ImageResponse } from "next/og";

import { gameSources } from "../../../demo/game-sources.server";
import { activeLocalRealExperiment } from "../../../demo/local-real-experiment-loader.server";

/**
 * A link preview per deck (#171): the deck's title under the game's name, in the Terminal theme's colours, drawn once
 * at build time. It reads deck titles only, never a round, and fetches nothing: every title stays within the font
 * `next/og` bundles, so no glyph is fetched either.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

/** Terminal's tokens (`globals.css`): the page, its glow, the text, and the accent. */
const COLOURS = { bg: "#07120f", "bg-glow": "#123b2e", text: "#effff8", accent: "#baff65" } as const;

/** Each deck's title, by the id its address names. */
const titles = (): ReadonlyMap<string, string> => {
  const loaded = activeLocalRealExperiment();
  return new Map(loaded.ok ? gameSources(loaded.experiment).map(({ id, title }) => [id, title]) : []);
};

export const generateStaticParams = (): { deck: string }[] => [...titles().keys()].map((deck) => ({ deck }));

export async function GET(_request: Request, { params }: { params: Promise<{ deck: string }> }): Promise<Response> {
  const title = titles().get((await params).deck);
  if (title === undefined) return new Response(null, { status: 404 });
  // The page's glow (`body` in globals.css), set 1% down: the renderer centres a glow placed at 0%.
  return new ImageResponse((
    <div style={{
      width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 80px",
      backgroundColor: COLOURS.bg, backgroundImage: `radial-gradient(circle at 80% 1%, ${COLOURS["bg-glow"]} 0px, transparent 544px)`,
    }}>
      <div style={{ display: "flex", color: COLOURS.accent, fontSize: 40, letterSpacing: "0.12em", textTransform: "uppercase" }}>CodeGuessr</div>
      <div style={{ display: "flex", color: COLOURS.text, fontSize: 112, lineHeight: 1.05 }}>{title}</div>
    </div>
  ), { width: 1200, height: 630 });
}
