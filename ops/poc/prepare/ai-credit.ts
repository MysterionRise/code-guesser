import type { CrawlProfile } from "./profile";

export interface AiCredit {
  readonly recorded: boolean;
  readonly assistant: string | null;
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const TRAILER = /^([A-Za-z][A-Za-z-]*): (.+)$/u;
const VERSION_WORDS = "(?: [A-Za-z0-9.-]+){0,3}";

/**
 * FR-034: a commit message credits an AI assistant when one of its lines is a trailer whose
 * key matches the marker's key ignoring case and whose value is the tool name, at most three
 * version words, one space, and one angle-bracket address at the marker's service domain;
 * or when a line equals a configured literal. Only the assistant's name leaves this function.
 */
export const aiCreditFor = (message: string, credits: CrawlProfile["aiCredits"]): AiCredit => {
  for (const line of message.split(/\r?\n/u)) {
    const literal = credits.literals.find((entry) => entry.line === line);
    if (literal) return Object.freeze({ recorded: true, assistant: literal.assistant });
    const trailer = TRAILER.exec(line);
    if (!trailer) continue;
    const [, key, value] = trailer;
    for (const marker of credits.trailers) {
      if (key!.toLowerCase() !== marker.key.toLowerCase()) continue;
      const names = marker.names.map(escape).join("|");
      const pattern = new RegExp(`^(?:${names})${VERSION_WORDS} <[^\\s<>@]+@${escape(marker.domain)}>$`, "iu");
      const name = new RegExp(`^(?:${names})(?: |$)`, "u");
      if (name.test(value!) && pattern.test(value!)) {
        return Object.freeze({ recorded: true, assistant: marker.assistant });
      }
    }
  }
  return Object.freeze({ recorded: false, assistant: null });
};

export const commitSubject = (message: string): string => message.split(/\r?\n/u, 1)[0] ?? "";

export interface SubjectIdentity {
  readonly owner: string;
  readonly name: string;
  readonly authorName: string;
  readonly authorLogin: string | null;
}

const AI_TOOL_NAMES = /\b(?:copilot|claude|anthropic|openai|chatgpt|gpt|codex|cursor|gemini|aider|llm|ai)\b/iu;
const UNSAFE_SUBJECT = /(?:https?:\/\/|www\.|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+|(?:^|\s)@[A-Za-z0-9-]|co-authored-by|generated[- ]by|code generated|authored by|written by)/iu;

const mentions = (subject: string, value: string): boolean => {
  if (value.length === 0) return false;
  return new RegExp(`(^|[^A-Za-z0-9_])${escape(value)}([^A-Za-z0-9_]|$)`, "iu").test(subject);
};

/**
 * FR-024 clue 2: the subject is shown only when it is at most the profile's length, carries no
 * URL, email, handle, AI-credit marker, AI tool name, or candidate or author identity.
 */
export const safeSubject = (
  subject: string,
  profile: CrawlProfile,
  identity: SubjectIdentity,
): string | undefined => {
  if (subject.length === 0 || subject.trim() !== subject || subject.length > profile.screening.subjectMaxLength) return undefined;
  if (UNSAFE_SUBJECT.test(subject) || AI_TOOL_NAMES.test(subject)) return undefined;
  const identities = [identity.owner, identity.name, identity.authorName, ...(identity.authorLogin ? [identity.authorLogin] : []),
    ...identity.authorName.split(/\s+/u).filter((part) => part.length > 2)];
  if (identities.some((value) => mentions(subject, value))) return undefined;
  return subject;
};
