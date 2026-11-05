import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { browserStorage } from './storage/adapter';
import { App } from './ui/App';
import { AppProvider } from './ui/store';
import './ui/styles.css';
import { inProcessRunner } from './worker/runner';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider storage={browserStorage()} runner={inProcessRunner}>
      <App />
    </AppProvider>
  </StrictMode>,
);
