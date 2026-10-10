"use client";

import dynamic from "next/dynamic";

import type { AuthorizedReveal, RevealRequest } from "../components/arcade";
import type { PublicModeContract } from "../components/arcade/mode-contract";

const ArcadeShell = dynamic(
  () => import("../components/arcade/arcade-shell").then((module) => module.ArcadeShell),
  { ssr: false },
);

interface DemoArcadeProps {
  readonly mode: PublicModeContract;
  readonly authorizeRevealAction: (request: RevealRequest) => Promise<AuthorizedReveal>;
  readonly chooseAnotherDeckHref?: string;
}

export function DemoArcade(props: DemoArcadeProps) {
  return <ArcadeShell {...props} />;
}
