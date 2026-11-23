import React from "react";
import BrandMark from "./BrandMark";

/** Catches a screen crash so the till shows a recovery message instead of a blank window. Data is saved on every action, so nothing typed into the database is lost. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: String((e as Error)?.message ?? e) }; }
  componentDidCatch(e: unknown) { console.error("Msingi screen error", e); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="loading" style={{ gap: 12, padding: 24, textAlign: "center" }} role="alert">
      <BrandMark size={56}/>
      <h2>Something went wrong on this screen</h2>
      <p style={{ maxWidth: 460, margin: 0 }}>Sales and records already saved are safe. Reload to carry on. If it keeps happening, note what you were doing and contact support.</p>
      <code style={{ fontSize: 12, opacity: 0.7, maxWidth: 520, overflowWrap: "anywhere" }}>{this.state.error}</code>
      <button className="primary" onClick={() => window.location.reload()}>Reload</button>
    </main>;
  }
}
