import * as React from "react";

import type { Level } from "../experiment/arms";
import { LOCAL_REAL_EXPERIMENT_NOTICE_BODY, LOCAL_REAL_EXPERIMENT_NOTICE_LINK } from "./local-real-experiment-loader.server";

/** Every page's frame: its theme (#125), the permanent notice and its About link (#168), and what a browser without scripts is told. */
export function PageFrame({ theme, children }: { readonly theme: Level<"theme">; readonly children: React.ReactNode }) {
  return (
    <div className="demo-page" data-theme={theme}>
      <p className="demo-notice">
        {LOCAL_REAL_EXPERIMENT_NOTICE_BODY} <a href="/about">{LOCAL_REAL_EXPERIMENT_NOTICE_LINK}</a>
      </p>
      <noscript><p className="demo-notice">CodeGuessr needs JavaScript to accept answers and reveal progressive evidence.</p></noscript>
      {children}
    </div>
  );
}
