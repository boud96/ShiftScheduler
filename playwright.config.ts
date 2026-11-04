import { defineConfig } from '@playwright/test';

// Set PLAYWRIGHT_CHROMIUM to a locally installed Chromium or Chrome when the browser
// downloaded by `npx playwright install chromium` cannot run on this OS.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM;

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : {},
  },
});
