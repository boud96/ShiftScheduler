import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';

const fileUrl = 'file://' + path.resolve('dist/index.html');

// A number box that holds a letter has no value in a browser: the value is the empty text, the same
// as that of an empty box, and only `validity.badInput` tells them apart. A page that took the
// empty text for a box that was emptied would erase the limit of a person for a stray `e`. A limit
// of nights is a must, so with the limit gone the generator would give nights again and nothing on
// the screen would say so. jsdom keeps no letters, so the unit tests can only stub `badInput`;
// these tests type into the real box (OptionalNumberField in src/ui/form.tsx).
//
// What is stored is seen where the user sees it, in Kontrola: the first person has three nights,
// one over a limit of 2, so Kontrola has a line about them exactly while that limit is stored.

/** Switches to a screen and waits for its panel: the panels of the other screens are hidden. */
async function show(page: Page, screen: 'Měsíc' | 'Tým') {
  await page.getByRole('tab', { name: screen, exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: screen, exact: true })).toBeVisible();
}

/**
 * A new plan with three nights for the first person, on the first three weekdays of the month that
 * the Month screen opens on. The month depends on today's date, which does not matter here.
 */
async function newPlanWithThreeNights(page: Page) {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Začít nový' }).click();
  const month = page.getByRole('tabpanel', { name: 'Měsíc', exact: true });
  const weekdays = month.locator('[data-testid^="cell-p1-"]:not(.twelve):not(.tail)');
  for (let day = 0; day < 3; day++) {
    await weekdays.nth(day).click();
    await page.getByRole('menuitem', { name: 'N', exact: true }).click();
  }
}

/** The box of the first person's limit of nights, on the Team screen. */
const limitBox = (page: Page) =>
  page
    .getByRole('tabpanel', { name: 'Tým', exact: true })
    .getByRole('article', { name: 'Operátor 1', exact: true })
    .getByLabel('Max. nočních měsíčně', { exact: true });

/** The line of Kontrola about nights over the limit, on the Month screen: there is none or one. */
const nightsLine = (page: Page) =>
  page
    .getByRole('tabpanel', { name: 'Měsíc', exact: true })
    .getByRole('region', { name: 'Kontrola', exact: true })
    .getByRole('button', { name: /\d+ noční \(max\. \d+\)$/ });

/** Whether the box shows something that is no number: the letter that was typed into it. */
const showsLetter = (box: Locator) =>
  box.evaluate((input) => (input as HTMLInputElement).validity.badInput);

test('a letter typed over a limit of 2 is not kept: the box and the limit stay 2', async ({
  page,
}) => {
  await newPlanWithThreeNights(page);
  const limit = limitBox(page);

  await show(page, 'Tým');
  await limit.fill('2');
  await limit.blur();
  await expect(limit).toHaveValue('2');
  await show(page, 'Měsíc');
  await expect(nightsLine(page)).toHaveText(/^Operátor 1 · .+: 3 noční \(max\. 2\)$/);

  await show(page, 'Tým');
  await limit.press('e');
  // The letter is in the box, which has no value for it: that is what the page has to tell from an
  // emptied box.
  expect(await showsLetter(limit), 'the letter is shown in the box').toBe(true);
  await expect(limit).toHaveValue('');
  await limit.blur();
  await expect(limit).toHaveValue('2');
  await expect.poll(() => showsLetter(limit)).toBe(false);

  await show(page, 'Měsíc');
  await expect(nightsLine(page)).toHaveText(/^Operátor 1 · .+: 3 noční \(max\. 2\)$/);
  // The Team screen is drawn again when its tab is shown, and the box still holds the 2.
  await show(page, 'Tým');
  await expect(limit).toHaveValue('2');
});

test('an emptied limit box is no limit: the line of Kontrola goes', async ({ page }) => {
  await newPlanWithThreeNights(page);
  const limit = limitBox(page);

  await show(page, 'Tým');
  await limit.fill('2');
  await limit.blur();
  await show(page, 'Měsíc');
  await expect(nightsLine(page)).toHaveCount(1); // the line is there to be gone

  await show(page, 'Tým');
  await limit.fill('');
  await limit.blur();
  await expect(limit).toHaveValue('');
  await show(page, 'Měsíc');
  await expect(nightsLine(page)).toHaveCount(0);
});

test('a letter typed into an empty limit box is not kept: it stays empty, with no limit', async ({
  page,
}) => {
  await newPlanWithThreeNights(page);
  const limit = limitBox(page);

  await show(page, 'Tým');
  await expect(limit).toHaveValue('');
  await limit.press('e');
  expect(await showsLetter(limit), 'the letter is shown in the box').toBe(true);
  await limit.blur();
  await expect(limit).toHaveValue('');
  // An empty box has the text '' before and after, so the page draws nothing and the letter would
  // stay in it unless the page takes it out.
  await expect.poll(() => showsLetter(limit)).toBe(false);

  await show(page, 'Měsíc');
  await expect(nightsLine(page)).toHaveCount(0);
});
