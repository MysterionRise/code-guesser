"use client";

import dynamic from "next/dynamic";

import type { HintRequest, HintResponse, RevealRequest, RevealResponse } from "../components/arcade";
import type { PublicModeContract } from "../components/arcade/mode-contract";

const ArcadeShell = dynamic(
  () => import("../components/arcade/arcade-shell").then((module) => module.ArcadeShell),
  { ssr: false },
);

interface DemoArcadeProps {
  readonly mode: PublicModeContract;
  readonly sessionToken: string;
  readonly authorizeRevealAction: (request: RevealRequest) => Promise<RevealResponse>;
  readonly revealHintAction: (request: HintRequest) => Promise<HintResponse>;
  readonly chooseAnotherDeckHref?: string;
  readonly newGameHref?: string;
  readonly deckTitle?: string;
  readonly genuiEnabled?: boolean;
}

export function DemoArcade(props: DemoArcadeProps) {
  return <ArcadeShell {...props} />;
}
