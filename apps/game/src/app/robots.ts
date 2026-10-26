import type { MetadataRoute } from "next";

/**
 * What crawlers may read (#168): the chooser and the About page. A deck's address deals a game and a duel's link is a
 * friend's, so neither is crawled; every such link the game makes starts its query with `?deck=` or `?duel`. A link
 * previewer that honours this file, as X's and LinkedIn's do, shows no card for them either.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: ["/", "/about"], disallow: ["/*?deck=", "/*?duel"] } };
}
