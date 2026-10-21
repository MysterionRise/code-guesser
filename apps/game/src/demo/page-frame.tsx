import * as React from "react";

import type { Level } from "../experiment/arms";
import { LOCAL_REAL_EXPERIMENT_NOTICE_BODY, LOCAL_REAL_EXPERIMENT_NOTICE_LEAD } from "./local-real-experiment-loader.server";

/** Every page's frame: its theme (#125), the local experiment's notice, and what a browser without scripts is told. */
export function PageFrame({ theme, children }: { readonly theme: Level<"theme">; readonly children: React.ReactNode }) {
  return (
    <div className="demo-page" data-theme={theme}>
      <p className="demo-notice">
        <strong>{LOCAL_REAL_EXPERIMENT_NOTICE_LEAD}</strong> {LOCAL_REAL_EXPERIMENT_NOTICE_BODY}
      </p>
      <noscript><p className="demo-notice">CodeGuessr needs JavaScript to accept answers and reveal progressive evidence.</p></noscript>
      {children}
    </div>
  );
}
