/** How a share went: through the browser's share sheet, onto the clipboard, closed by the player, or not at all. */
export type ShareOutcome = "shared" | "copied" | "dismissed" | "failed";

/** Whether this browser has a share sheet; the shell renders only in the browser, so this never differs from a server render. */
export const hasShareSheet = (): boolean => typeof navigator !== "undefined" && typeof navigator.share === "function";

/**
 * Shares through the browser's share sheet where it has one (#171), otherwise, or when the sheet fails, copies `text`
 * to the clipboard. Closing the sheet is the player's call, so nothing is copied then.
 */
export const shareOrCopy = async (data: ShareData, text: string): Promise<ShareOutcome> => {
  if (hasShareSheet() && navigator.canShare?.(data) !== false) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "dismissed";
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
};
