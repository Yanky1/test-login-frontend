import { Component, type ReactNode } from 'react'

/** Catches render/chunk-load failures (typically a lazy route after a new deploy) and offers a reload instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="card" role="alert">
        <h1 tabIndex={-1}>Something went wrong</h1>
        <p>This page could not load. This usually happens right after we release an update. Reloading fixes it, and your saved progress is kept.</p>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>Reload</button>
      </main>
    )
  }
}
