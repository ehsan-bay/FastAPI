import { Component, type ReactNode } from "react";

export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth-page">
        <div className="card auth-card center">
          <h2>مشکلی پیش آمد 😕</h2>
          <p className="muted small ltr">{this.state.error.message}</p>
          <button className="btn primary" onClick={() => window.location.assign("/")}>بازگشت به خانه</button>
        </div>
      </div>
    );
  }
}
