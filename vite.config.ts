import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vitest/config';

// The built page may not talk to the network at all. Inline script and style, blob: workers
// and data: images are all the single-file build needs.
const CSP =
  "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";

// Build only: the dev server needs module scripts and a websocket, which this policy would block.
function cspMeta(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(
          /<head(?:\s[^>]*)?>/i,
          (head) => `${head}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}">`,
        ),
    },
  };
}

export default defineConfig({
  plugins: [react(), viteSingleFile(), cspMeta()],
  build: {
    // The single-file page has nothing to preload. Vite's polyfill for browsers that cannot
    // preload modules would `fetch` the hrefs, which `connect-src 'none'` forbids.
    modulePreload: false,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    globals: true,
    globalSetup: ['src/test/globalSetup.ts'],
    setupFiles: ['src/test/setup.ts'],
    // A timeout is there to end a hang, not to judge speed. Two UI tests take about 4 s on a calm
    // machine and fail on a busy desktop at the default 5 s. GitHub's runners are slower still.
    testTimeout: process.env.CI ? 60_000 : 20_000,
  },
});
