import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { browserStorage } from './storage/adapter';
import { App } from './ui/App';
import { AppProvider } from './ui/store';
import './ui/styles.css';
import { workerRunner } from './worker/runner';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider storage={browserStorage()} runner={workerRunner}>
      <App />
    </AppProvider>
  </StrictMode>,
);
