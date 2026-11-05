import { useState } from 'react';
import type { ComponentType } from 'react';
import { SaveBar } from './SaveBar';
import { StartScreen } from './StartScreen';
import { MonthScreen } from './month/MonthScreen';
import { useApp } from './store';
import { TeamScreen } from './team/TeamScreen';
import { APP_TITLE, FILE_ERRORS, TABS_LABEL, TAB_LABELS, TAB_PANEL_SOON } from './text';

type TabId = keyof typeof TAB_LABELS;
type Screens = Record<TabId, ComponentType>;

const TAB_IDS: readonly TabId[] = ['month', 'team', 'rules'];

function ComingSoon() {
  return <p className="coming-soon">{TAB_PANEL_SOON}</p>;
}

/** The screen of each tab. A tab shows a placeholder until its screen is built. */
const SCREENS: Screens = {
  month: MonthScreen,
  team: TeamScreen,
  rules: ComingSoon,
};

/**
 * The three tabs under the title and the save bar. Every tab's panel stays mounted, and the ones
 * that are not selected are hidden. So a screen keeps its own state while another tab is open: the
 * month it shows, a run of the generator that is still going.
 */
function Shell({ screens }: { screens: Screens }) {
  const [tab, setTab] = useState<TabId>('month');
  return (
    <>
      <header className="app-header">
        <h1>{APP_TITLE}</h1>
        <SaveBar />
      </header>
      <div className="tabs" role="tablist" aria-label={TABS_LABEL}>
        {TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            className="tab"
            aria-selected={id === tab}
            aria-controls={`tab-panel-${id}`}
            onClick={() => setTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>
      <main>
        {TAB_IDS.map((id) => {
          const Screen = screens[id];
          return (
            <div
              key={id}
              id={`tab-panel-${id}`}
              className="tab-panel"
              role="tabpanel"
              aria-labelledby={`tab-${id}`}
              hidden={id !== tab}
            >
              <Screen />
            </div>
          );
        })}
      </main>
    </>
  );
}

/** A failed open or save, above whatever the page shows. The data it concerns is untouched. */
function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      <button type="button" className="button" onClick={onDismiss}>
        {FILE_ERRORS.dismiss}
      </button>
    </div>
  );
}

/**
 * The start screen while there is no data, the three tabs once there is. `screens` replaces the
 * screen of a tab. The page leaves it out; a test uses it to put in a screen with state of its own.
 */
export function App({ screens }: { screens?: Partial<Screens> }) {
  const { data, error, dismissError } = useApp();
  return (
    <div className="app">
      {error !== null && <ErrorBanner message={error} onDismiss={dismissError} />}
      {data === null ? <StartScreen /> : <Shell screens={{ ...SCREENS, ...screens }} />}
    </div>
  );
}
