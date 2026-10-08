import { authorizeLocalExperimentReveal } from "./actions";
import { DemoArcade } from "../demo/demo-arcade";
import {
  LOCAL_REAL_EXPERIMENT_NOTICE,
  activeLocalRealExperiment,
} from "../demo/local-real-experiment-loader.server";

export default function Page() {
  const loaded = activeLocalRealExperiment();
  return (
    <div className="demo-page">
      <p className="demo-notice">
        <strong>{LOCAL_REAL_EXPERIMENT_NOTICE}</strong> {loaded.ok ? "Five playable rounds." : "No rounds are available."}
      </p>
      <noscript><p className="demo-notice">CodeGuessr needs JavaScript to accept answers and reveal progressive evidence.</p></noscript>
      {loaded.ok
        ? <DemoArcade mode={loaded.experiment.mode} authorizeRevealAction={authorizeLocalExperimentReveal} />
        : (
          <p className="demo-notice" role="alert">
            The generated experiment artifact is missing or failed validation, so there is nothing to play.
            Run <code>pnpm prepare:poc</code>, verify the artifact hash, and record it before starting the game.
          </p>
        )}
    </div>
  );
}
