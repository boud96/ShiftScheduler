import { test, expect } from '@playwright/test';
import { fileUrl, monthNumber, POLICY_MESSAGE } from './support';

const TARGET = 'Leden 2027';

test('plans January 2027 from the built file: all days covered, no must broken, nothing leaves', async ({
  page,
}) => {
  // The run takes the 5 s set below; the wait for its end is allowed 30 s.
  test.setTimeout(60_000);

  const requests: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  const policyMessages: string[] = [];
  page.on('console', (message) => {
    if (POLICY_MESSAGE.test(message.text())) policyMessages.push(message.text());
  });

  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Začít nový' }).click();

  // Pravidla: the run is given 5 s.
  await page.getByRole('tab', { name: 'Pravidla', exact: true }).click();
  const rules = page.getByRole('tabpanel', { name: 'Pravidla', exact: true });
  const budget = rules.getByLabel('Čas na generování (s)');
  await budget.fill('5');
  // A box that is left shows the number that is stored: it shows 5 only if 5 was stored.
  await budget.blur();
  await expect(budget).toHaveValue('5');

  // Měsíc: step to January 2027. The month it opens on depends on today's date, so the loop reads
  // the heading and does not count clicks.
  await page.getByRole('tab', { name: 'Měsíc', exact: true }).click();
  const month = page.getByRole('tabpanel', { name: 'Měsíc', exact: true });
  const heading = month.getByRole('heading', { level: 2 });
  const target = monthNumber(TARGET);
  let shown = (await heading.textContent()) ?? '';
  while (shown !== TARGET) {
    const arrow = monthNumber(shown) < target ? '▶' : '◀';
    await month.getByRole('button', { name: arrow, exact: true }).click();
    await expect(heading).not.toHaveText(shown);
    shown = (await heading.textContent()) ?? '';
  }

  await month.getByRole('button', { name: 'Vygenerovat', exact: true }).click();
  await expect(month.getByText(/^Hotovo\./)).toBeVisible({ timeout: 30_000 });

  // Every day of the month is covered: the coverage row reads ✓ on all 31.
  await expect(month.locator('[data-testid^="coverage-2027-01-"]')).toHaveText(
    Array<string>(31).fill('✓'),
  );
  // And Kontrola finds no must broken.
  const checks = month.getByRole('region', { name: 'Kontrola', exact: true });
  await expect(checks.getByText(/^Musí: \d+ · Přání: \d+$/)).toHaveText(/^Musí: 0 /);

  expect(requests).toEqual([]);
  expect(policyMessages).toEqual([]);
});
