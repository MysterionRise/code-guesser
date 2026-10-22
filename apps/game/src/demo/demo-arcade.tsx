"use client";

import dynamic from "next/dynamic";

import type { HintRequest, HintResponse, RevealRequest, RevealResponse } from "../components/arcade";
import type { PublicModeContract } from "../components/arcade/mode-contract";
import type { GameDuel } from "../components/duel/duel-contract";
import type { Design } from "../genui/designs";

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
  readonly replayHref?: string;
  readonly shareHref?: string;
  readonly deckTitle?: string;
  readonly roundDecks?: Readonly<Record<string, string>>;
  readonly genuiDesign?: Design;
  readonly duel?: GameDuel;
}

export function DemoArcade(props: DemoArcadeProps) {
  return <ArcadeShell {...props} />;
}
