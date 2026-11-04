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
  expect(fs.readFileSync('dist/index.html', 'utf8')).toContain("connect-src 'none'");
});
