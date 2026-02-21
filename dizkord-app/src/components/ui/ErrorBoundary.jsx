import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[dizkord] component crash:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-void flex items-center justify-center">
          <div className="glass rounded-2xl p-8 max-w-md mx-4 border border-neon-pink/30 text-center">
            <p className="text-3xl mb-3">💀</p>
            <h2 className="font-display font-bold text-neon-pink text-lg mb-2">something broke</h2>
            <p className="text-text-muted text-sm font-mono mb-4">
              {this.state.error?.message || 'unknown error'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-neon-green text-void rounded-lg font-display font-semibold text-sm
                         hover:bg-neon-green/90 transition-all hover:shadow-[0_0_20px_rgba(0,255,136,0.4)]"
            >
              RELOAD
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * Lightweight error boundary for individual panels/sections.
 * Shows inline error instead of killing the whole app.
 */
export class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error(`[dizkord] ${this.props.name || 'panel'} crash:`, error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <p className="text-neon-pink text-sm font-mono mb-2">
              {this.props.name || 'this section'} crashed
            </p>
            <p className="text-text-muted text-xs font-mono mb-3">
              {this.state.error?.message || 'unknown error'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-1.5 bg-void-lighter text-text-secondary rounded-lg text-xs font-mono
                         hover:text-text-primary border border-void-border transition-all"
            >
              retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
