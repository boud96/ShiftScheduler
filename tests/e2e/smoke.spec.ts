import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const fileUrl = 'file://' + path.resolve('dist/index.html');

test('built file opens from disk without any network request', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
  await page.goto(fileUrl);
  await expect(page).toHaveTitle('Plánování směn');
  await expect(page.getByRole('heading', { name: 'Plánování směn' })).toBeVisible();
  expect(requests).toEqual([]);
});

test('build is a single file with a CSP that blocks connections', () => {
  expect(fs.readdirSync('dist')).toEqual(['index.html']);
  const html = fs.readFileSync('dist/index.html', 'utf8');
  expect(html).toContain("connect-src 'none'");
  // A second layer under the policy. With build.modulePreload off (vite.config.ts) the build has
  // no call of fetch: Vite's polyfill for module preload would bring one, which the policy would
  // then block at run time. The build is checked here, before anything can be blocked.
  expect(html).not.toContain('fetch(');
});
