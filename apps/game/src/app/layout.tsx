import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "./globals.css";

import { configuredOrigin } from "../server/public-origin.server";

const TITLE = "CodeGuessr — Read the code. Make your call.";
const DESCRIPTION = "A five-round code-reading arcade.";
const origin = configuredOrigin();

/**
 * Every page's metadata defaults (#168): the chooser's title and description, which another page's title joins
 * ("About · CodeGuessr"), and a link preview that takes each page's own title and description. A deck's page names its
 * deck and image instead (#171), and `metadataBase` is the public origin when a host sets one.
 */
export const metadata: Metadata = {
  ...(origin === null ? {} : { metadataBase: new URL(origin) }),
  title: { default: TITLE, template: "%s · CodeGuessr" },
  description: DESCRIPTION,
  applicationName: "CodeGuessr",
  openGraph: { type: "website", siteName: "CodeGuessr", locale: "en" },
  twitter: { card: "summary" },
};

/** Every page's footer: how to play (#168), where the code comes from, and what is recorded (#99). */
function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="About CodeGuessr">
        <a href="/about">About</a>
        <a href="/credits">Credits</a>
        <a href="/privacy">Privacy</a>
      </nav>
    </footer>
  );
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Every page renders per request, so Next.js tags its scripts with that request's CSP nonce (#97); a page built
  // ahead of time, such as the 404, would carry none, and its scripts would be refused.
  await connection();
  return <html lang="en"><body>{children}<SiteFooter /></body></html>;
}
