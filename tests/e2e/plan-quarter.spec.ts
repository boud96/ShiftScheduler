import { test, expect } from '@playwright/test';
import { fileUrl, monthNumber, POLICY_MESSAGE } from './support';

/**
 * The first quarter of 2027 in the order it is planned: the title that the Month screen shows for
 * each month, the `YYYY-MM` that its coverage cells are named after, and the number of its days.
 */
const QUARTER = [
  { title: 'Leden 2027', key: '2027-01', days: 31 },
  { title: 'Únor 2027', key: '2027-02', days: 28 },
  { title: 'Březen 2027', key: '2027-03', days: 31 },
];

// plan-january.spec.ts plans one month. A quarter is planned month by month, and each run starts
// from the drafts of the months before it: the rest and the days in a row across the boundary, and
// the counts that fairness balances. So a month that is fine on its own may not be fine after the
// month before it, and the second and the third run are the ones that this spec is for.
test('plans a quarter month by month: all days covered, no must broken, nothing leaves', async ({
  page,
}) => {
  // A run is waited for up to 30 s, so three months could take more than the 30 s that a test is
  // given by default. Even three slow months end within the 120 s given here, and a month that
  // hangs fails on its own wait and names the month.
  test.setTimeout(120_000);

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

  // Pravidla: each run is given 5 s, as in plan-january.spec.ts. Measured with this spec's steps
  // in Chromium, four quarters at a time: before the generator repaired the hours (repairHours),
  // 41 of 50 quarters were clean at 5 s, the others ending February or March with someone one
  // shift below FPD; with the repair, 50 of 50 were.
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
  const first = monthNumber(QUARTER[0].title);
  let shown = (await heading.textContent()) ?? '';
  while (shown !== QUARTER[0].title) {
    const arrow = monthNumber(shown) < first ? '▶' : '◀';
    await month.getByRole('button', { name: arrow, exact: true }).click();
    await expect(heading).not.toHaveText(shown);
    shown = (await heading.textContent()) ?? '';
  }

  const checks = month.getByRole('region', { name: 'Kontrola', exact: true });
  for (const [index, { title, key, days }] of QUARTER.entries()) {
    if (index > 0) {
      // On to the next month. The run is for the month on show, so wait until its heading is up.
      await month.getByRole('button', { name: '▶', exact: true }).click();
      await expect(heading).toHaveText(title);
    }

    await month.getByRole('button', { name: 'Vygenerovat', exact: true }).click();
    // How a run ended is told only with the month it was for, so the Hotovo of the month before
    // is not the one waited for here.
    await expect(month.getByText(/^Hotovo\./), `${title}: the run ends`).toBeVisible({
      timeout: 30_000,
    });

    // Every day of the month is covered: the coverage row reads ✓ on all of them.
    await expect(
      month.locator(`[data-testid^="coverage-${key}-"]`),
      `${title}: every day is covered`,
    ).toHaveText(Array<string>(days).fill('✓'));
    // And Kontrola finds no must broken. The lines of those it finds go into the message, so that
    // a failure tells which.
    const mustLines = await checks.locator('[data-severity="must"]').allInnerTexts();
    const broken = mustLines.length > 0 ? ` (${mustLines.join('; ')})` : '';
    await expect(
      checks.getByText(/^Musí: \d+ · Přání: \d+$/),
      `${title}: Kontrola finds no must broken${broken}`,
    ).toHaveText(/^Musí: 0 /);
  }

  expect(requests).toEqual([]);
  expect(policyMessages).toEqual([]);
});
