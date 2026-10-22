import * as React from "react";

import { fragmentNames, type FragmentNames } from "./duel-text";

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

/**
 * The names in the page's fragment (#173), cleaned. A browser never sends a fragment, so the server renders none and
 * the browser fills them in as it hydrates.
 */
export const useFragmentNames = (): FragmentNames => {
  const hash = React.useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  return React.useMemo(() => fragmentNames(hash), [hash]);
};
