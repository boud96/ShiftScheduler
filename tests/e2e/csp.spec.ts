import { test, expect } from '@playwright/test';
import path from 'node:path';

const fileUrl = 'file://' + path.resolve('dist/index.html');

// A made-up address: ".invalid" never resolves. It is not meant to be reached, and it cannot be:
// the route below answers for every http(s) request, so nothing leaves the machine even if the
// policy did not hold.
const PROBE_URL = 'https://probe.invalid/ping';

// What the browser prints when the page's Content Security Policy stops something. The January
// spec looks for violations with the same pattern, so this test also shows that it matches.
const POLICY_MESSAGE = /\bCSP\b|security[\s-]policy/i;

test('the built page carries a CSP that the browser enforces, so nothing can leave it', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  const policyMessages: string[] = [];
  page.on('console', (message) => {
    if (POLICY_MESSAGE.test(message.text())) policyMessages.push(message.text());
  });
  // A request that is not stopped by the policy gets as far as this route, and gets an answer.
  const answered: string[] = [];
  await page.route(/^https?:/, (route) => {
    answered.push(route.request().url());
    return route.fulfill({ status: 200, body: 'reached' });
  });

  await page.goto(fileUrl);
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    'content',
    /connect-src 'none'/,
  );

  const settled = await page.evaluate(
    (url) => fetch(url).then(() => 'answered', () => 'rejected'),
    PROBE_URL,
  );
  expect(settled, 'the fetch was let through').toBe('rejected');
  // The browser reports the block to the console a moment later.
  await expect.poll(() => policyMessages.length).toBeGreaterThan(0);
  // The policy stops the request before the network: Playwright sees no request, and the route is
  // not reached.
  expect(answered).toEqual([]);
  expect(requests).toEqual([]);
});
