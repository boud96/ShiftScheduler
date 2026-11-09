import { defineConfig } from '@playwright/test';

// Set PLAYWRIGHT_CHROMIUM to a locally installed Chromium or Chrome when the browser
// downloaded by `npx playwright install chromium` cannot run on this OS.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM;

export default defineConfig({
  testDir: 'tests/e2e',
  // GitHub's runners are slower than a desktop, and the generator's runs have a time budget, so a
  // spec gets one more try there. Locally a failure fails at once.
  retries: process.env.CI ? 1 : 0,
  use: {
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : {},
  },
});
