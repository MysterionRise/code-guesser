import { NextResponse, type NextRequest } from "next/server";

/**
 * The page's Content Security Policy (#97), with a nonce made fresh for each request. The policy goes on the request
 * too, where Next.js reads the nonce to tag the scripts it renders, so only this response's own scripts run and
 * whatever they load is trusted through `'strict-dynamic'`. Styles keep `'unsafe-inline'`: code panes and the
 * visualizer frame set their sizes with `style=`. Only public mode upgrades insecure requests and pins HTTPS (HSTS),
 * read here when the server starts rather than when it is built; development adds `'unsafe-eval'` for React's
 * refresh. Routes that are not pages set their own headers: the API, link previews, and the visualizer's frame
 * (`app/genui/frame/route.ts`), whose policy is the visualizer's.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const publicServer = process.env.CODEGUESSR_PUBLIC === "1";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(publicServer ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  // A short max-age to start (#97); it grows once the public origin has served HTTPS for a while.
  if (publicServer) response.headers.set("strict-transport-security", "max-age=300");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|og/|api/|genui/frame|favicon\\.ico|icon|apple-icon).*)"],
};
