/** A date as the player's machine names it, `YYYY-MM-DD`: today's five's date (#172) and the records' days (#63). */
export const localDate = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
