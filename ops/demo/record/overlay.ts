import type { Page } from "@playwright/test";

/**
 * A caption banner injected into the recorded page. It lives outside the React
 * root, is hidden from assistive technology, and never intercepts input, so the
 * game underneath behaves exactly as it does without it.
 */
export const CAPTION_ATTRIBUTE = "data-demo-caption";

const CAPTION_STYLE = [
  "position:fixed", "left:20px", "right:20px", "bottom:64px", "z-index:2147483647",
  "padding:16px 20px", "border-radius:18px", "border:2px solid #baff65",
  "background:rgba(3,10,8,.9)", "color:#effff8", "box-shadow:0 18px 60px #000a",
  "font:800 27px/1.2 Inter,ui-sans-serif,system-ui,sans-serif", "text-align:center",
  "letter-spacing:-.01em", "pointer-events:none", "opacity:0", "transform:translateY(8px)",
  "transition:opacity .22s ease-out,transform .22s ease-out",
].join(";");

/** The Next dev-mode indicator is not part of the game; keep it out of the recording. */
const DEV_INDICATOR_STYLE = "nextjs-portal{display:none !important}";

export const installCaption = async (page: Page): Promise<void> => {
  await page.evaluate(([attribute, style, devIndicatorStyle]) => {
    const existing = document.querySelector(`[${attribute}]`);
    if (existing) return;
    const hide = document.createElement("style");
    hide.textContent = devIndicatorStyle;
    document.head.append(hide);
    const banner = document.createElement("div");
    banner.setAttribute(attribute, "");
    banner.setAttribute("aria-hidden", "true");
    banner.setAttribute("style", style);
    document.body.append(banner);
  }, [CAPTION_ATTRIBUTE, CAPTION_STYLE, DEV_INDICATOR_STYLE] as const);
};

export const setCaption = async (page: Page, text: string): Promise<void> => {
  await installCaption(page);
  await page.evaluate(([attribute, value]) => {
    const banner = document.querySelector<HTMLElement>(`[${attribute}]`);
    if (!banner) return;
    banner.textContent = value;
    const visible = value.length > 0;
    banner.style.opacity = visible ? "1" : "0";
    banner.style.transform = visible ? "translateY(0)" : "translateY(8px)";
  }, [CAPTION_ATTRIBUTE, text] as const);
};
