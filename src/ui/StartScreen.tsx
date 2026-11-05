import { useApp } from './store';
import { APP_TITLE, START_SCREEN } from './text';

/**
 * What the page shows while it has no data: the cache is empty (first use, cleared browser, a new
 * copy of the page). The user opens his save file or starts a new plan. Opening never asks
 * before it replaces anything, since there is nothing to lose yet.
 */
export function StartScreen() {
  const { openFile, newData } = useApp();
  return (
    <main className="start-screen">
      <h1>{APP_TITLE}</h1>
      <p>{START_SCREEN.intro}</p>
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
