import React from 'react'

/**
 * General-purpose error boundary wrapping a whole module's content.
 *
 * Without this, an uncaught render error in any single module (a malformed
 * result, an unexpected null, a Plotly trace issue) propagates to the React
 * root and unmounts the entire app — the user sees a blank white screen with
 * no way to recover except a full reload. This boundary contains the failure
 * to the active module, shows a recovery UI, and keeps the rest of the app
 * (navbar, other modules) alive.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; label?: string },
  { hasError: boolean; message?: string }
> {
  state: { hasError: boolean; message?: string } = { hasError: false }

  static getDerivedStateFromError(err: unknown) {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) }
  }

  componentDidCatch(err: unknown) {
    // Surface in the console for debugging; the UI shows a friendly message.
    console.error('Module render error:', err)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center bg-gray-50 p-6">
          <div className="text-center max-w-md">
            <p className="text-sm font-semibold text-gray-700">
              {this.props.label ? `${this.props.label} — something went wrong` : 'Something went wrong'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              This view hit an error and was stopped to keep the rest of the app working.
            </p>
            {this.state.message && (
              <p className="text-[11px] text-gray-400 mt-2 font-mono break-words">{this.state.message}</p>
            )}
            <button
              onClick={() => this.setState({ hasError: false, message: undefined })}
              className="mt-3 px-4 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
