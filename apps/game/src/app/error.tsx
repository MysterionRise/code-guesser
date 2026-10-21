"use client";

import { ErrorNotice } from "./error-notice";

/** A page or server action that throws renders this inside the root layout. */
export default function ErrorPage() {
  return <ErrorNotice />;
}
