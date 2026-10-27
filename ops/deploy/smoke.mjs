/**
 * The deploy smoke test (#170, L13), run against a running game in public mode:
 *
 *   node ops/deploy/smoke.mjs <base-url> [--deck=<id>] [--record] [--rate-limits] [--events=<dir>] [--no-browser]
 *
 * It is safe against the live server: it reads pages, deals one game, and plays it through in Chromium. The game sends
 * `Sec-GPC: 1`, so it records no events, unless `--record` asks for them (the pre-launch run, with
 * `EXPERIMENT_SOURCE=synthetic`). `--rate-limits` spends this client's beacon allowance for a minute to see a 429;
 * `--events=<dir>` also reads event files pulled with `ops/deploy/pull-events.sh`. Every request carries a forged
 * `X-Forwarded-For` from a documentation range, which no response may echo, and no page outside a round may hold an
 * address. It prints one line per check and exits 1 if any fails. Chromium comes from
 * `pnpm exec playwright install chromium`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const USAGE = "usage: node ops/deploy/smoke.mjs <base-url> [--deck=<id>] [--record] [--rate-limits] [--events=<dir>] [--no-browser]";
/** An address from TEST-NET-2 (RFC 5737), sent as the client's own: a response that holds it echoes a client header. */
const FORGED = "198.51.100.77";
/** An IPv4 address, or an IPv6 one written in full or with `::` between hex groups. */
const IPV4 = /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\w.])/u;
const IPV6 = /(?<![\w:])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4})?)(?![\w:])/iu;

const options = new Map();
const flags = new Set();
let base;
for (const argument of process.argv.slice(2)) {
  const option = /^--(deck|events)=(.+)$/u.exec(argument);
  if (option) options.set(option[1], option[2]);
  else if (/^--(record|rate-limits|no-browser)$/u.test(argument)) flags.add(argument.slice(2));
  else if (base === undefined && /^https?:\/\/[^/\s]+$/u.test(argument.replace(/\/$/u, ""))) base = argument.replace(/\/$/u, "");
  else {
    console.error(USAGE);
    process.exit(2);
  }
}
if (base === undefined) {
  console.error(USAGE);
  process.exit(2);
}
const deck = options.get("deck") ?? "project";
const headers = { "x-forwarded-for": FORGED, ...(flags.has("record") ? {} : { "sec-gpc": "1" }) };

let failures = 0;
const check = async (name, run) => {
  try {
    await run();
    console.log(`SMOKE_OK ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`SMOKE_FAILED ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
};
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

/** One request with this run's headers; every response is held to never echo the forged address. */
const get = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, { redirect: "manual", ...init, headers: { ...headers, ...init.headers } });
  const body = await response.text();
  const head = [...response.headers].map(([name, value]) => `${name}: ${value}`).join("\n");
  expect(!`${head}\n${body}`.includes(FORGED), `${path} echoed the client's forwarded address`);
  return { response, body, head };
};

/** The page's nonce from its policy; every script tag must carry it. */
const nonceOf = ({ response, body }, path) => {
  const policy = response.headers.get("content-security-policy") ?? "";
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/u.exec(policy)?.[1];
  expect(nonce !== undefined, `${path} has no nonce in its policy`);
  const scripts = body.match(/<script\b[^>]*>/gu) ?? [];
  expect(scripts.length > 0, `${path} has no scripts`);
  const untagged = scripts.filter((tag) => !tag.includes(` nonce="${nonce}"`));
  expect(untagged.length === 0, `${path} has ${untagged.length} script(s) without the policy's nonce`);
  return nonce;
};

/** No address outside a round's code: the pages the server writes itself, with their headers. */
const holdsNoAddress = ({ body, head }, path) => {
  for (const pattern of [IPV4, IPV6]) {
    const found = pattern.exec(`${head}\n${body}`);
    expect(found === null, `${path} holds an address-shaped string at "${found?.[0]}"`);
  }
};

await check("health", async () => {
  const { response, body } = await get("/api/health");
  expect(response.status === 200 && body === "ok", `GET /api/health answered ${response.status} ${JSON.stringify(body.slice(0, 40))}`);
  expect(response.headers.get("cache-control") === "no-store", "the health check may be cached");
});

await check("headers and nonce", async () => {
  const first = await get("/");
  expect(first.response.status === 200, `GET / answered ${first.response.status}`);
  const policy = first.response.headers.get("content-security-policy") ?? "";
  for (const directive of ["default-src 'self'", "'strict-dynamic'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "upgrade-insecure-requests"]) {
    expect(policy.includes(directive), `the policy lacks ${directive}`);
  }
  expect(!policy.includes("unsafe-eval"), "the policy allows eval");
  const want = {
    "strict-transport-security": /^max-age=\d+/u,
    "referrer-policy": /^no-referrer$/u,
    "x-content-type-options": /^nosniff$/u,
    "x-frame-options": /^DENY$/u,
    "cross-origin-opener-policy": /^same-origin$/u,
    "permissions-policy": /camera=\(\)/u,
  };
  for (const [name, pattern] of Object.entries(want)) {
    expect(pattern.test(first.response.headers.get(name) ?? ""), `${name} is ${JSON.stringify(first.response.headers.get(name))}`);
  }
  expect(!first.response.headers.has("x-powered-by"), "the server names itself in X-Powered-By");
  const nonce = nonceOf(first, "/");
  expect(nonce !== nonceOf(await get("/"), "/"), "two pages share one nonce");
  holdsNoAddress(first, "/");
});

await check("pages", async () => {
  for (const [path, status, heading] of [
    ["/about", 200, "About CodeGuessr"],
    ["/credits", 200, "Credits"],
    ["/privacy", 200, "Privacy"],
    ["/no-such-page", 404, "There’s nothing here"],
  ]) {
    const page = await get(path);
    expect(page.response.status === status, `GET ${path} answered ${page.response.status}`);
    expect(page.body.includes(heading), `${path} lacks its heading`);
    nonceOf(page, path);
    holdsNoAddress(page, path);
  }
  const robots = await get("/robots.txt");
  expect(robots.response.status === 200, `GET /robots.txt answered ${robots.response.status}`);
  const optimizer = await get("/_next/image?url=%2Ficon.svg&w=64&q=75");
  expect(optimizer.response.status === 404, `the image optimizer answered ${optimizer.response.status}`);
});

await check("deal", async () => {
  const redirect = await get(`/?deck=${encodeURIComponent(deck)}`);
  const location = redirect.response.headers.get("location") ?? "";
  expect(redirect.response.status === 307 && /[?&]deal=[0-9a-f]{8}&game=0$/u.test(location),
    `a deck's address answered ${redirect.response.status} ${location}`);
  const { pathname, search } = new URL(location, base);
  const dealt = await get(`${pathname}${search}`);
  expect(dealt.response.status === 200, `the dealt game answered ${dealt.response.status}`);
  expect(!dealt.body.includes("Too many new games"), "the deal was rate limited");
  // The page carries the game's sealed token for the browser, which renders the round.
  expect(dealt.body.includes("sessionToken"), "the dealt page holds no game");
  nonceOf(dealt, "the dealt game");
});

if (!flags.has("no-browser")) {
  await check("one game in a browser", async () => {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ extraHTTPHeaders: headers });
      const page = await context.newPage();
      const problems = [];
      page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
      await page.exposeFunction("reportCspViolation", (violation) => problems.push(`policy violation: ${violation}`));
      await page.addInitScript(() => {
        if (window !== window.top) return;
        document.addEventListener("securitypolicyviolation", (event) => { void window.reportCspViolation(`${event.violatedDirective} ${event.blockedURI}`); });
      });
      page.setDefaultTimeout(30_000);
      await page.goto(`${base}/?deck=${encodeURIComponent(deck)}`);
      await page.getByText("Round 1 of 5").waitFor();
      // A hint and an answer each go through a server action; the game draws its own theme, layer, and design.
      await page.locator(".hint-button").first().click();
      await page.locator(".hints .hint").first().waitFor();
      for (let round = 1; round <= 5; round += 1) {
        await page.getByText(`Round ${round} of 5`).waitFor();
        await page.locator("input[type=radio]").first().check();
        await page.getByRole("button", { name: "Lock in answer" }).click();
        await page.locator(".reveal .round-points").waitFor();
        if (round < 5) await page.getByRole("button", { name: "Next round" }).click();
      }
      await page.getByText(/^Run complete — /u).waitFor();
      expect(problems.length === 0, problems.join("; "));
    } finally {
      await browser.close();
    }
  });
}

if (flags.has("rate-limits")) {
  // A beacon past its limit is refused before its body is read, so this spends only this client's beacon allowance.
  await check("rate limit", async () => {
    for (let sent = 1; sent <= 400; sent += 1) {
      const { response } = await get("/api/events", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
      if (response.status !== 429) continue;
      // A first beacon refused means this client shares its key with others: the proxy's header isn't reaching the game.
      expect(sent > 1, "the first beacon was refused: is CODEGUESSR_CLIENT_IP_HEADER the header the proxy sets?");
      expect(/^\d+$/u.test(response.headers.get("retry-after") ?? ""), "a 429 without Retry-After");
      return;
    }
    throw new Error("no 429 after 400 beacons: are rate limits on?");
  });
}

const eventsDirectory = options.get("events");
if (eventsDirectory !== undefined) {
  await check("events hold no address", async () => {
    const files = readdirSync(eventsDirectory).filter((name) => name.endsWith(".jsonl"));
    expect(files.length > 0, `no event files in ${eventsDirectory}`);
    for (const name of files) {
      const lines = readFileSync(join(eventsDirectory, name), "utf8").split("\n").filter((line) => line !== "");
      for (const line of lines) JSON.parse(line);
      for (const pattern of [IPV4, IPV6]) expect(!pattern.test(lines.join("\n")), `${name} holds an address-shaped string`);
    }
  });
}

console.log(failures === 0 ? "SMOKE_PASSED" : `SMOKE_FAILED ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
