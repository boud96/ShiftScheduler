import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fileUrl, POLICY_MESSAGE } from './support';

// jsdom has no hour and minute parts in a time box, so only a browser can tell how Tab and
// Shift+Tab move in the form of the doctor's note: in Chromium a press of Tab goes from the hour
// to the minute of a box, and from there to the next one, with `document.activeElement` on the
// same box until the last part.

/**
 * A new plan on the Month screen, with the form of the doctor's note open on day 4 of the month
 * for `person`. The month it opens on depends on today's date, which does not matter here.
 */
async function openForm(page: Page, person = 'p1') {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Začít nový' }).click();
  const month = page.getByRole('tabpanel', { name: 'Měsíc', exact: true });
  // The first seven cells of a row are the tail of the previous month.
  const cell = month.locator(`[data-testid^="cell-${person}-"]`).nth(10);
  await cell.click();
  await page.getByRole('menuitem', { name: 'Lékař…' }).click();
  const from = page.getByLabel('od', { exact: true });
  await expect(from).toBeFocused(); // the focus goes to the first box when the form opens
  return {
    month,
    cell,
    dialog: page.getByRole('dialog'),
    from,
    to: page.getByLabel('do', { exact: true }),
    save: page.getByRole('button', { name: 'Uložit lékaře' }),
  };
}

test('Shift+Tab goes back through the parts of a time box, and the form stays open', async ({
  page,
}) => {
  const { dialog, from, to } = await openForm(page);
  await from.fill('08:00');
  await to.fill('12:00');
  await from.focus(); // on the hour of the first box

  await page.keyboard.press('Tab'); // on to the minute: the same box, so the focus is still on it
  await expect(from).toBeFocused();
  await page.keyboard.press('Shift+Tab'); // and back to the hour, not out of the form
  await expect(from).toBeFocused();
  await expect(dialog).toBeVisible();
  await expect(from).toHaveValue('08:00');
  await expect(to).toHaveValue('12:00');
});

test('Shift+Tab out of the first box closes the form, and the cell has the focus', async ({
  page,
}) => {
  const { cell, dialog } = await openForm(page);
  await page.keyboard.press('Shift+Tab');
  await expect(dialog).toBeHidden();
  await expect(cell).toBeFocused();
});

test('Tab goes through both boxes to the button, and past the button closes the form', async ({
  page,
}) => {
  const { cell, dialog, save } = await openForm(page);
  // The parts of both boxes (and the picker of each) are stops before the button: as many as the
  // browser has.
  for (let stops = 0; stops < 12; stops++) {
    if (await save.evaluate((button) => button === document.activeElement)) break;
    await page.keyboard.press('Tab');
    await expect(dialog).toBeVisible();
  }
  await expect(save).toBeFocused();

  await page.keyboard.press('Tab'); // past the last control, which is the button
  await expect(dialog).toBeHidden();
  await expect(cell).toBeFocused();
});

// In Chromium a press of the mouse on a button focuses it, so a click on the cell of the form takes
// the focus out of the form before the click itself comes. jsdom does not show what a browser does
// with the press, and the first of these is the one that bit.

test('a click on the cell whose form is open closes it, and opens nothing', async ({ page }) => {
  const { cell, dialog } = await openForm(page);
  await cell.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(cell).toHaveAttribute('aria-expanded', 'false');
});

test('a click on another cell opens its list, and a click on the heading closes a form', async ({
  page,
}) => {
  const { month, dialog } = await openForm(page);
  // The form lies under the cell of p1, over the four cells below it (the 10th to the 13th of the
  // row of p2). The 18th is clear of it, in the window at this size, and not under the totals,
  // which the 25th is: Playwright would scroll the grid to a cell that is covered, and the scroll
  // closes the form by itself. So the click is checked to land on the cell.
  const other = month.locator('[data-testid^="cell-p2-"]').nth(18);
  const box = await other.boundingBox();
  if (box === null) throw new Error('the cell has a box');
  const top = await page.evaluate(
    ([x, y]) =>
      document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'),
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(top, 'nothing covers the cell').toBe(await other.getAttribute('data-testid'));
  await other.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('menu', { name: /^Operátor 2 · / })).toBeVisible();

  // The form of that cell this time, and then a click away from the grid.
  await page.getByRole('menuitem', { name: 'Lékař…' }).click();
  await expect(dialog).toBeVisible();
  await month.getByRole('heading', { level: 2 }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('a click inside the form, on a label, a box or the padding, keeps it and its times', async ({
  page,
}) => {
  const { dialog, from, to } = await openForm(page);
  await from.fill('08:00');
  await dialog.getByText('do', { exact: true }).click(); // the label of the other box
  await expect(to).toBeFocused(); // which the label gives the focus
  await to.click();
  await dialog.click({ position: { x: 2, y: 2 } }); // the padding: no element takes the focus
  await expect(dialog).toBeVisible();
  await expect(from).toHaveValue('08:00');
});

test('Enter sends no form: the message is shown, and nothing is requested', async ({
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

  const { cell, dialog, from, to } = await openForm(page);
  // Times that make no note: the form is not left, so a form that was sent would be seen here.
  await from.fill('12:00');
  await to.fill('08:00');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(dialog).toBeVisible();

  await to.fill('13:00');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(cell).toHaveAttribute('title', /lékař 12:00–13:00$/);
  expect(requests).toEqual([]);
  expect(policyMessages).toEqual([]);
});

test('the whole form stays in the window when its message makes it taller', async ({ page }) => {
  // First how tall the form is, and where the last row ends, in a window with room to spare.
  await page.setViewportSize({ width: 1500, height: 900 });
  const roomy = await openForm(page, 'p8');
  const formBox = await roomy.dialog.boundingBox();
  const cellBox = await roomy.cell.boundingBox();
  if (formBox === null || cellBox === null) throw new Error('the form and the cell have a box');
  await page.keyboard.press('Escape');

  // Then a window with room for the form under the cell (4 px between them, 8 px kept free at the
  // edge of the window), and not for the form with its message.
  const height = Math.ceil(cellBox.y + cellBox.height + 4 + formBox.height + 8 + 2);
  await page.setViewportSize({ width: 1500, height });
  await roomy.cell.click();
  await page.getByRole('menuitem', { name: 'Lékař…' }).click();
  const below = await roomy.dialog.boundingBox();
  if (below === null) throw new Error('the form has a box');
  expect(below.y).toBeGreaterThan(cellBox.y + cellBox.height); // under the cell
  expect(below.y + below.height).toBeLessThanOrEqual(height);

  // Times that do not make a note: the message is shown, and the form has to move to fit.
  await roomy.from.fill('12:00');
  await roomy.to.fill('08:00');
  await roomy.save.click();
  await expect(page.getByRole('alert')).toBeVisible();
  const grown = await roomy.dialog.boundingBox();
  const button = await roomy.save.boundingBox();
  if (grown === null || button === null) throw new Error('the form has a box');
  expect(grown.y).toBeGreaterThanOrEqual(0);
  expect(grown.y + grown.height).toBeLessThanOrEqual(height);
  expect(button.y + button.height).toBeLessThanOrEqual(height);
});
