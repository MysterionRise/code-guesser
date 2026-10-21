import * as React from "react";

import { SESSION_ENDED_MESSAGE } from "../arcade/arcade-text";
import { hasShareSheet, shareOrCopy } from "../arcade/share-sheet";
import { DuelComparisonTable } from "./duel-comparison";
import type { ChallengedDuel, ChallengerDuel, CreateChallengeResponse, DuelComparison, DuelRound, IssueResultResponse } from "./duel-contract";
import {
  DEFAULT_NAME,
  NAME_LIMIT,
  RESULT_NAMES,
  challengeShare,
  firstPlayNote,
  nameFragment,
  resultShare,
  roundWords,
  sanitizeName,
  sideLine,
} from "./duel-text";

/**
 * A duel inside a game (#173): the challenger's rounds beside the friend's game, the challenge a finished game offers,
 * and the friend's comparison, result link, and rematch.
 */

/**
 * The challenger's rounds beside the friend's game, each shown once the friend has locked that round. The page holds
 * them all from the deal; they say nothing of any round's answer, so holding each back until the lock keeps the duel
 * fair to play and is presentation, not secrecy. It is no live region: the reveal says how the challenger did.
 */
export function OpponentStrip({ name, rounds, answered }: {
  readonly name: string;
  readonly rounds: readonly DuelRound[];
  /** How many rounds the friend has locked. */
  readonly answered: number;
}) {
  return (
    <div className="duel-strip">
      <span className="duel-strip-name" aria-hidden="true"><bdi>{name}</bdi></span>
      <ol className="round-track" aria-label={`${name}’s rounds`}>
        {rounds.map((round, index) => {
          const shown = index < answered;
          return (
            <li className={shown ? `round-dot done ${round[0] ? "correct" : "missed"}` : "round-dot"} data-duel-round={index + 1} key={index}>
              <span aria-hidden="true">{shown ? `${index + 1}${round[0] ? " ✓" : " ✗"}` : "?"}</span>
              <span className="visually-hidden">{shown ? `Round ${index + 1}: ${roundWords(round)}` : `Round ${index + 1}, shown after you answer`}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A name field whose value goes only into a link's fragment; it says so when what was typed can't go in. */
function NameField({ id, value, onChange, inputRef }: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly inputRef?: React.Ref<HTMLInputElement>;
}) {
  const unfit = value.trim() !== "" && sanitizeName(value, "") === "";
  return (
    <>
      <label htmlFor={id}>Your name (stays in the link)</label>
      <input id={id} ref={inputRef} value={value} maxLength={NAME_LIMIT} autoComplete="nickname" spellCheck={false}
        aria-describedby={unfit ? `${id}-note` : undefined} onChange={(event) => onChange(event.target.value)} />
      {unfit && <p className="duel-note" id={`${id}-note`}>Only letters, digits, spaces, hyphens, apostrophes, and underscores fit, so the link names no one yet.</p>}
    </>
  );
}

/** A name that fits a link, or null. */
const linkName = (value: string): string | null => sanitizeName(value, "") || null;

const CHALLENGE_FAILED = "Couldn’t make a challenge link. Try again.";

/**
 * "Challenge a friend", under a finished game of a seeded deal or of today's five: the server seals the game as a
 * challenge, then the player's name, if they give one, goes into the link's fragment, and the link onto the share
 * sheet or the clipboard. Its share line has no grid, so the friend learns only the total to beat.
 */
export function ChallengeFriend({ duel, sessionToken }: { readonly duel: ChallengerDuel; readonly sessionToken: () => string }) {
  const sheet = hasShareSheet();
  const [issued, setIssued] = React.useState<Extract<CreateChallengeResponse, { ok: true }> | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [status, setStatus] = React.useState("");
  const nameField = React.useRef<HTMLInputElement>(null);
  // The button gives way to the name field, so keyboard focus moves into it rather than falling to the page.
  React.useEffect(() => {
    if (issued !== null) nameField.current?.focus();
  }, [issued]);

  const create = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await duel.createChallenge(sessionToken());
      if (response.ok) setIssued(response);
      else setError(response.reason === "SESSION_ENDED" ? SESSION_ENDED_MESSAGE : CHALLENGE_FAILED);
    } catch {
      setError(CHALLENGE_FAILED);
    } finally {
      setPending(false);
    }
  };

  if (issued === null) {
    return (
      <div className="duel-challenge">
        <button className="secondary-action" type="button" onClick={create}>{pending ? "Making your link…" : "Challenge a friend"}</button>
        {error && <p className="demo-error" role="alert">{error}</p>}
      </div>
    );
  }
  const { challenge, challengeToken } = issued;
  const send = async () => {
    const from = linkName(name);
    const share = challengeShare(challenge, from, `${duel.origin}/?duel=${challengeToken}${nameFragment({ from })}`);
    const outcome = await shareOrCopy({ text: share.message, url: share.url }, share.text);
    if (outcome !== "dismissed") {
      setStatus(outcome === "shared" ? "Challenge shared" : outcome === "copied" ? "Challenge link copied" : "Couldn’t copy the link. Try again.");
    }
  };
  const note = firstPlayNote(challenge.challenger.firstPlay, "You");
  return (
    <form className="duel-share" aria-labelledby="challenge-title" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <h3 id="challenge-title">Challenge a friend</h3>
      <p className="duel-note">
        Your friend sees your total ({sideLine(challenge.challenger, challenge.max)}{note && ` · ${note}`}) and plays the same five; each of your
        rounds shows once they’ve answered it.
      </p>
      <NameField id="challenge-name" value={name} onChange={setName} inputRef={nameField} />
      <button className="secondary-action" type="submit">{sheet ? "Share challenge…" : "Copy challenge link"}</button>
      <p className="share-status" role="status">{status}</p>
    </form>
  );
}

/** "Send your result": the friend's name, if they give one, joins the challenger's in the result link's fragment. */
function SendResult({ comparison, resultToken, origin, challenger }: {
  readonly comparison: DuelComparison;
  readonly resultToken: string;
  readonly origin: string;
  /** The challenger's name, from the challenge link. */
  readonly challenger: string | null;
}) {
  const sheet = hasShareSheet();
  const [name, setName] = React.useState("");
  const [status, setStatus] = React.useState("");
  const send = async () => {
    const vs = linkName(name);
    const share = resultShare(comparison, { challenger: challenger ?? RESULT_NAMES.challenger, challenged: vs ?? RESULT_NAMES.challenged },
      `${origin}/?duel-result=${resultToken}${nameFragment({ from: challenger, vs })}`);
    const outcome = await shareOrCopy({ text: share.message, url: share.url }, share.text);
    if (outcome !== "dismissed") {
      setStatus(outcome === "shared" ? "Result shared" : outcome === "copied" ? "Result link copied" : "Couldn’t copy the link. Try again.");
    }
  };
  return (
    <form className="duel-share" aria-labelledby="send-result-title" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <h3 id="send-result-title">Send your result</h3>
      <NameField id="result-name" value={name} onChange={setName} />
      <button className="secondary-action" type="submit">{sheet ? "Share result…" : "Copy result link"}</button>
      <p className="share-status" role="status">{status}</p>
    </form>
  );
}

const COMPARE_FAILED = "Couldn’t compare your games. Try again.";

/**
 * The friend's finished game: the server seals it as the challenge's result, and the comparison it sends back shows
 * under the game's summary, then the result link to send, a rematch on a fresh deal of the deck, and the chooser.
 */
export function DuelCompletion({ duel, name, sessionToken, chooseAnotherDeckHref }: {
  readonly duel: ChallengedDuel;
  /** The challenger's name, from the challenge link. */
  readonly name: string | null;
  readonly sessionToken: () => string;
  readonly chooseAnotherDeckHref: string | undefined;
}) {
  const [issued, setIssued] = React.useState<Extract<IssueResultResponse, { ok: true }> | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const issue = React.useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const response = await duel.issueResult({ sessionToken: sessionToken(), challengeToken: duel.challengeToken });
      if (response.ok) setIssued(response);
      else setError(response.reason === "SESSION_ENDED" ? SESSION_ENDED_MESSAGE : COMPARE_FAILED);
    } catch {
      setError(COMPARE_FAILED);
    } finally {
      setPending(false);
    }
  }, [duel, sessionToken]);
  // Once, as the game completes, though React's strict mode runs effects twice in development.
  const asked = React.useRef(false);
  React.useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void issue();
  }, [issue]);

  return (
    <>
      {issued
        ? <DuelComparisonTable comparison={issued.comparison} names={{ challenger: name ?? DEFAULT_NAME, challenged: null }} level={3} />
        : pending && <p className="duel-note">Comparing your game with {name ?? DEFAULT_NAME}’s…</p>}
      {error && (
        <>
          <p className="demo-error" role="alert">{error}</p>
          <button className="secondary-action duel-retry" type="button" onClick={issue} disabled={pending}>Try again</button>
        </>
      )}
      {issued && duel.origin !== null && (
        <SendResult comparison={issued.comparison} resultToken={issued.resultToken} origin={duel.origin} challenger={name} />
      )}
      <div className="completion-actions">
        <a className="primary-action" href={duel.rematchHref}>Rematch</a>
        {chooseAnotherDeckHref && <a className="deck-link" href={chooseAnotherDeckHref}>Choose another deck</a>}
      </div>
    </>
  );
}
