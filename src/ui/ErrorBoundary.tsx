import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useApp } from './store';
import { APP_TITLE, PLAN_ERROR, START_SCREEN } from './text';

interface ErrorBoundaryProps {
  /**
   * Changes when the plan's data is replaced (the store's `loads`). A boundary that has caught an
   * error draws its children again then, since they are drawn from other data now.
   */
  resetKey: number;
  /** What to draw instead of the children once one of them has failed to draw. */
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
  /** The `resetKey` that the state is for. */
  key: number;
}

/**
 * Catches an error thrown while the children are drawn, logs it to the console, and draws the
 * fallback in their place: without it, React unmounts the whole page and leaves it blank. The
 * fallback stays until `resetKey` changes.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('The plan could not be shown.', error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * What the page shows when the plan cannot be drawn: a sentence, and the two ways out of the start
 * screen. Opening a file or starting a new plan replaces the data, which makes the boundary try
 * again. It never asks before it replaces anything: the plan it would lose cannot be shown.
 */
export function PlanError() {
  const { openFile, newData } = useApp();
  return (
    <main className="start-screen" role="alert">
      <h1>{APP_TITLE}</h1>
      <p>
        <strong>{PLAN_ERROR.title}</strong> {PLAN_ERROR.hint}
      </p>
      <div className="start-screen-actions">
        <button type="button" className="button" onClick={() => void openFile()}>
          {START_SCREEN.open}
        </button>
        <button type="button" className="button button-primary" onClick={newData}>
          {START_SCREEN.create}
        </button>
      </div>
    </main>
  );
}
