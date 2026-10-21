"use client";

import "./globals.css";
import { ErrorNotice } from "./error-notice";

/** When the root layout itself fails, this replaces it, so it brings its own document and the theme tokens. */
export default function GlobalError() {
  return (
    <html lang="en">
      <body>
        <title>CodeGuessr — Something went wrong</title>
        <ErrorNotice />
      </body>
    </html>
  );
}
