import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

/**
 * A client's key for rate limits (#98), and the one place the game reads a client's address. The reverse proxy in
 * front of a public server sets the header `CODEGUESSR_CLIENT_IP_HEADER` names; this reads the address from it,
 * reduces an IPv6 address to its /64 (one subscriber's network, which a client can rotate within), and returns a
 * truncated HMAC-SHA256 of that under a salt made fresh for each process. The address is never logged, stored, or
 * returned: the key can't be turned back into it, and no key outlives the process that made it.
 */

/** The key every request shares when no header is configured, or the header holds no address it can read. */
export const SHARED_KEY = "shared";

/** The salt lives on the process, like the session ledger, so the page, its actions, and each route agree on keys. */
const salt = (): Buffer => {
  const key = Symbol.for("codeguessr.client-key-salt");
  const holder = globalThis as unknown as Record<symbol, Buffer | undefined>;
  return holder[key] ??= randomBytes(32);
};

/**
 * The address the proxy in front of the game saw: the last entry of a list such as `X-Forwarded-For`, because each
 * proxy appends the address its request came from, and every entry before that is whatever the client sent. A
 * header with one address (`X-Real-IP`, `Fly-Client-IP`) is its own last entry. A port, brackets, and an IPv6 zone
 * are dropped.
 */
const lastEntry = (value: string): string => {
  const entry = value.slice(value.lastIndexOf(",") + 1).trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/u.exec(entry)?.[1] ?? entry;
  const unported = /^[\d.]+:\d+$/u.test(bracketed) ? bracketed.slice(0, bracketed.lastIndexOf(":")) : bracketed;
  return unported.replace(/%.*$/u, "");
};

/** An IPv6 address's eight groups, its `::` filled in and a dotted IPv4 tail read as the last two. */
const groupsOf = (address: string): number[] => {
  const parts = (text: string): number[] => text === "" ? [] : text.split(":").flatMap((part) => {
    if (!part.includes(".")) return [Number.parseInt(part, 16)];
    const [a, b, c, d] = part.split(".").map(Number) as [number, number, number, number];
    return [a * 256 + b, c * 256 + d];
  });
  const [head = "", tail] = address.split("::");
  const left = parts(head);
  const right = tail === undefined ? [] : parts(tail);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
};

/** What a limit counts as one client: an IPv4 address, or an IPv6 address's /64; null for anything else. */
export const clientNetwork = (address: string): string | null => {
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) return null;
  const groups = groupsOf(address);
  // An IPv4 address mapped into IPv6 (`::ffff:192.0.2.1`) is that IPv4 client.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255].join(".");
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
};

/**
 * The rate-limit key of the client a request came from. With no header configured, as on a local server, every
 * request shares one key; so does a request whose header is missing or holds no address, so a client can't win a fresh
 * bucket by sending nonsense.
 */
export const clientKey = (headers: Pick<Headers, "get">, env: Readonly<Record<string, string | undefined>> = process.env): string => {
  const name = env.CODEGUESSR_CLIENT_IP_HEADER;
  if (name === undefined || name === "") return SHARED_KEY;
  let value: string | null;
  try {
    value = headers.get(name);
  } catch {
    // A header name `Headers` refuses; the boot check holds a public server to a valid one.
    return SHARED_KEY;
  }
  const network = value === null ? null : clientNetwork(lastEntry(value));
  return network === null ? SHARED_KEY : createHmac("sha256", salt()).update(network).digest("base64url").slice(0, 22);
};
