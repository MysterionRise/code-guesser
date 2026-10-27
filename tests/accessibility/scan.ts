import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** The narrowest phone the game supports, and a laptop. */
export const WIDTHS = [{ width: 320, height: 568 }, { width: 1280, height: 800 }] as const;

/** Every WCAG 2 A and AA rule axe checks, contrast among them, as the browser tests' theme checks use. */
const violations = async (page: Page): Promise<string[]> => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations
  .map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(" ")).slice(0, 3).join(", ")}`);

/** When the page scrolls sideways, the last few elements that reach past its edge; otherwise none. */
const sidewaysScroll = (): string[] => {
  const width = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth <= width) return [];
  return [...document.querySelectorAll("body *")].filter((element) => element.getBoundingClientRect().right > width + 1)
    .map((element) => [element.tagName.toLowerCase(), ...[...element.classList]].join(".")).slice(-5);
};

/**
 * Checks the page as it stands at each width: no axe violation, no sideways scroll (reflow, WCAG 1.4.10), and, since
 * the checks run with reduced motion, no animation. Leaves the page at the widest.
 */
export const scan = async (page: Page, state: string): Promise<void> => {
  for (const size of WIDTHS) {
    await page.setViewportSize(size);
    const label = `${state} at ${size.width} px`;
    expect(await page.evaluate(sidewaysScroll), `${label} scrolls sideways`).toEqual([]);
    expect(await page.evaluate(() => document.getAnimations().length), `${label} animates`).toBe(0);
    expect(await violations(page), label).toEqual([]);
  }
};
