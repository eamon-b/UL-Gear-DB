import { Component, type ReactNode } from 'react';

/** Keeps one broken page (bad share link, corrupt saved data) from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page">
        <h1>Something went wrong</h1>
        <p className="warn">{error.message}</p>
        {/* reload: a hash change alone can't reset a boundary above the router, or one already on #/ */}
        <p>
          <a
            href="#/"
            onClick={(e) => {
              e.preventDefault();
              window.location.hash = '#/';
              window.location.reload();
            }}
          >
            Back to browse
          </a>
        </p>
      </div>
    );
  }
}
