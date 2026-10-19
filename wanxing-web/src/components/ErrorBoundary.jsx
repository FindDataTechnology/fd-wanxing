import { Component } from "react";

// Console-scoped error boundary (fix-wanxing-console-ux): an uncaught render
// error anywhere below unmounts the whole tree when nothing catches it — the
// deployer sees a blank dark page with no clue. This keeps the shell (header,
// tabs, other panels) alive and shows the failure where it happened.
// Scoped to one subtree by `label` so the message says which panel died.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    console.error(`[wanxing] ${this.props.label ?? "panel"} render failed:`, err, info?.componentStack);
  }

  // A tab switch or a new focus slug is a fresh screen: let the subtree retry
  // instead of pinning a stale error forever.
  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null });
  }

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    return (
      <div
        className="rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 px-4 py-3 text-sm space-y-1"
        data-testid="console-error-boundary"
      >
        <div className="font-semibold">
          {this.props.label ?? "此面板"}渲染出错
        </div>
        <div className="font-mono text-xs break-all">{String(err?.message || err)}</div>
        <div className="text-xs">其余面板与导航不受影响——这不是你的数据丢了，是这一段显示失败了。</div>
      </div>
    );
  }
}
