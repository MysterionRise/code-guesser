import { visualizerDocument, type Visualizer } from "./visualizer-spec";

/**
 * A checked visualizer page in a sandbox: scripts may run, but with an opaque origin, so the page can't reach the
 * game, its storage, or its cookies; it may not open windows, submit forms, or navigate the game; and its own CSP
 * allows no network. The summary beside it says in words what it shows.
 */
export function VisualizerView({ visualizer }: { readonly visualizer: Visualizer }) {
  return (
    <figure className="genui-visualizer">
      <figcaption>{visualizer.title}</figcaption>
      <iframe className="visualizer-frame" title={visualizer.title} sandbox="allow-scripts" allow="" referrerPolicy="no-referrer"
        srcDoc={visualizerDocument(visualizer.html)} />
      <p className="visualizer-summary">{visualizer.summary}</p>
    </figure>
  );
}
