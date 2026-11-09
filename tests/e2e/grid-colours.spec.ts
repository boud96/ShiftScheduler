import { test, expect } from '@playwright/test';
import { fileUrl } from './support';

// --danger-bg and --danger-text of the style sheet, as the browser computes them.
const DANGER_BG = 'rgb(253, 232, 232)';
const DANGER_TEXT = 'rgb(140, 29, 29)';

// jsdom does not run the cascade, so only a browser can tell which of two rules wins.
test('a gap is red in the coverage row on a 12-hour day too, and hours below FPD are red', async ({
  page,
}) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Začít nový' }).click();
  const month = page.getByRole('tabpanel', { name: 'Měsíc', exact: true });

  // A new plan has nobody on a shift: every day of the month has a gap, the weekends and the
  // holidays too, where the column is otherwise grey.
  const weekendGap = month.locator('tr.month-coverage td.twelve.short').first();
  const weekdayGap = month.locator('tr.month-coverage td.short:not(.twelve)').first();
  await expect(weekendGap).toHaveCSS('background-color', DANGER_BG);
  await expect(weekdayGap).toHaveCSS('background-color', DANGER_BG);

  // Everybody is below FPD in it, and the hours of each person say so.
  const hours = month.locator('[data-testid^="totals-"] span[title="Hodiny / FPD"]');
  await expect(hours.first()).toHaveCSS('color', DANGER_TEXT);
  await expect(hours.last()).toHaveCSS('color', DANGER_TEXT);
});
