import type { Metadata } from "next";
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

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
