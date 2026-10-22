import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "./globals.css";

const TITLE = "CodeGuessr — Read the code. Make your call.";
const DESCRIPTION = "A five-round code-reading arcade.";

/** The chooser's title and link preview; a deck's page names its deck instead (#171). */
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { type: "website", siteName: "CodeGuessr", title: TITLE, description: DESCRIPTION },
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Every page renders per request, so Next.js tags its scripts with that request's CSP nonce (#97); a page built
  // ahead of time, such as the 404, would carry none, and its scripts would be refused.
  await connection();
  return <html lang="en"><body>{children}</body></html>;
}
