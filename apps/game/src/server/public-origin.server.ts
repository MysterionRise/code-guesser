import "server-only";

/** A request's host: a name or bracketed IPv6 address, and an optional port; nothing else may enter a shared link. */
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/iu;

/**
 * The origin a shared link and a link preview name (#171): `CODEGUESSR_PUBLIC_ORIGIN` when a host sets it, otherwise
 * the address the request came to. Only a well-formed http or https origin is used; anything else gives null, and a
 * share then carries no link.
 */
export const publicOrigin = (requestHeaders: Pick<Headers, "get">, env: Readonly<Record<string, string | undefined>> = process.env): string | null => {
  const configured = env.CODEGUESSR_PUBLIC_ORIGIN;
  if (configured !== undefined && configured !== "") {
    try {
      const url = new URL(configured);
      return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
    } catch {
      return null;
    }
  }
  const host = requestHeaders.get("host") ?? "";
  if (!HOST.test(host)) return null;
  const scheme = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ? "https" : "http";
  return new URL(`${scheme}://${host}`).origin;
};
