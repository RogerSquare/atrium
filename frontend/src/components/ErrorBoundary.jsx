import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo })
    console.error('[ErrorBoundary] Caught rendering error:', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-app-bg text-app-text flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-app-card border border-app-border rounded-2xl shadow-xl p-8 text-center">
            <div className="flex justify-center mb-4">
              <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-7 h-7 text-red-500" />
              </div>
            </div>

            <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
            <p className="text-app-text-muted text-sm mb-6">
              An unexpected error occurred while rendering this page. Your data is safe.
            </p>

            <div className="flex gap-3 justify-center mb-6">
              <button
                onClick={this.handleRetry}
                className="flex items-center gap-2 px-4 py-2 bg-app-accent hover:bg-app-accent-hover text-white rounded-lg text-sm font-semibold transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
              <button
                onClick={this.handleReload}
                className="flex items-center gap-2 px-4 py-2 bg-app-card border border-app-border hover:border-app-text-muted text-app-text rounded-lg text-sm font-semibold transition-colors"
              >
                Reload Page
              </button>
            </div>

            {this.state.error && (
              <details className="text-left">
                <summary className="text-xs text-app-text-muted cursor-pointer hover:text-app-text transition-colors">
                  Error details
                </summary>
                <pre className="mt-2 p-3 bg-app-bg rounded-lg border border-app-border text-xs text-red-400 overflow-auto max-h-40 whitespace-pre-wrap break-words">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
