import { useState } from 'react';
import type { ComponentType } from 'react';
import { SaveBar } from './SaveBar';
import { StartScreen } from './StartScreen';
import { useApp } from './store';
import { APP_TITLE, FILE_ERRORS, TABS_LABEL, TAB_LABELS, TAB_PANEL_SOON } from './text';

type TabId = keyof typeof TAB_LABELS;

const TAB_IDS: readonly TabId[] = ['month', 'team', 'rules'];

function ComingSoon() {
  return <p className="coming-soon">{TAB_PANEL_SOON}</p>;
}

/** The screen of each tab. A tab shows a placeholder until its screen is built. */
const SCREENS: Record<TabId, ComponentType> = {
  month: ComingSoon,
  team: ComingSoon,
  rules: ComingSoon,
};

/** The three tabs under the title and the save bar. Only the selected tab's screen is shown. */
function Shell() {
  const [tab, setTab] = useState<TabId>('month');
  const Screen = SCREENS[tab];
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
            aria-controls="tab-panel"
            onClick={() => setTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>
      <main id="tab-panel" className="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <Screen />
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

/** The start screen while there is no data, the three tabs once there is. */
export function App() {
  const { data, error, dismissError } = useApp();
  return (
    <div className="app">
      {error !== null && <ErrorBanner message={error} onDismiss={dismissError} />}
      {data === null ? <StartScreen /> : <Shell />}
    </div>
  );
}
