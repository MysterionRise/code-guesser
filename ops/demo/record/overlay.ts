import type { BrowserContext, Page } from "@playwright/test";

/**
 * A caption banner injected into the recorded page. It lives outside the React
 * root, is hidden from assistive technology, and never intercepts input, so the
 * game underneath behaves exactly as it does without it.
 */
export const CAPTION_ATTRIBUTE = "data-demo-caption";

/** How a scene shows its captions: a banner along the bottom, or a tilted sticker near the top for the vertical demo. */
export type CaptionStyle = "banner" | "sticker";

const CAPTION_STYLES: Readonly<Record<CaptionStyle, Readonly<{ style: string; hidden: string; shown: string }>>> = Object.freeze({
  banner: {
    style: [
      "position:fixed", "left:20px", "right:20px", "bottom:64px", "z-index:2147483647",
      "padding:16px 20px", "border-radius:18px", "border:2px solid #baff65",
      "background:rgba(3,10,8,.9)", "color:#effff8", "box-shadow:0 18px 60px #000a",
      "font:800 27px/1.2 Inter,ui-sans-serif,system-ui,sans-serif", "text-align:center",
      "letter-spacing:-.01em", "pointer-events:none", "opacity:0", "transform:translateY(8px)",
      "transition:opacity .22s ease-out,transform .22s ease-out",
    ].join(";"),
    hidden: "translateY(8px)",
    shown: "translateY(0)",
  },
  sticker: {
    style: [
      "position:fixed", "left:50%", "top:58px", "z-index:2147483647", "max-width:86%", "width:max-content",
      "padding:10px 16px", "border-radius:14px", "background:#baff65", "color:#07120f",
      "box-shadow:0 10px 0 #07120f,0 18px 50px #000c", "border:3px solid #07120f",
      "font:900 26px/1.15 Inter,ui-sans-serif,system-ui,sans-serif", "text-align:center",
      "letter-spacing:-.02em", "pointer-events:none", "opacity:0",
      "transform:translateX(-50%) rotate(-3deg) scale(.7)",
      "transition:opacity .16s ease-out,transform .22s cubic-bezier(.2,1.6,.4,1)",
    ].join(";"),
    hidden: "translateX(-50%) rotate(-3deg) scale(.7)",
    shown: "translateX(-50%) rotate(-2deg) scale(1)",
  },
});

/** The Next dev-mode indicator is not part of the game; keep it out of the recording. */
const DEV_INDICATOR_STYLE = "nextjs-portal{display:none !important}";

/**
 * Hides the dev indicator from the first frame of every page. A stylesheet added this early does not survive the
 * page load, so an observer hides each `nextjs-portal` the moment it is attached.
 */
export const hideDevIndicator = async (context: BrowserContext): Promise<void> => {
  // No named inner functions: the compiled script runs in the page, where bundler helpers such as `__name` do not exist.
  await context.addInitScript(() => {
    new MutationObserver(() => {
      for (const portal of document.querySelectorAll<HTMLElement>("nextjs-portal")) portal.style.setProperty("display", "none", "important");
    }).observe(document, { childList: true, subtree: true });
  });
};

export const installCaption = async (page: Page, captionStyle: CaptionStyle = "banner"): Promise<void> => {
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
  }, [CAPTION_ATTRIBUTE, CAPTION_STYLES[captionStyle].style, DEV_INDICATOR_STYLE] as const);
};

export const setCaption = async (page: Page, text: string, captionStyle: CaptionStyle = "banner"): Promise<void> => {
  await installCaption(page, captionStyle);
  const { hidden, shown } = CAPTION_STYLES[captionStyle];
  await page.evaluate(([attribute, value, hiddenTransform, shownTransform]) => {
    const banner = document.querySelector<HTMLElement>(`[${attribute}]`);
    if (!banner) return;
    // Hide first, so each new caption pops in rather than replacing the last one in place.
    banner.style.opacity = "0";
    banner.style.transform = hiddenTransform;
    banner.textContent = value;
    if (value.length === 0) return;
    void banner.offsetWidth;
    banner.style.opacity = "1";
    banner.style.transform = shownTransform;
  }, [CAPTION_ATTRIBUTE, text, hidden, shown] as const);
};
