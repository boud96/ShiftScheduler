// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { buildMonthGrid } from '../../domain/context';
import { newAppData } from '../../domain/defaults';
import * as engine from '../../domain/rules/evaluate';
import { evaluateMonth } from '../../domain/rules/evaluate';
import type { Finding } from '../../domain/rules/types';
import type { AppData, CodeName, ISODate, MonthKey, PersonId, WishId } from '../../domain/types';
import { memoryStorage } from '../../storage/adapter';
import { syntheticTeam } from '../../test/team';
import { inProcessRunner } from '../../worker/runner';
import { App } from '../App';
import { AppProvider, useApp } from '../store';
import { minutesOf } from './CellMenu';
import { checksOf } from './ChecksPanel';
import { MonthScreen } from './MonthScreen';

// The tests count how often the month is built and evaluated, so these two call through to the
// real functions and keep a record of the calls.
vi.mock('../../domain/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../domain/context')>();
  return { ...actual, buildMonthGrid: vi.fn(actual.buildMonthGrid) };
});
vi.mock('../../domain/rules/evaluate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../domain/rules/evaluate')>();
  return { ...actual, evaluateMonth: vi.fn(actual.evaluateMonth) };
});

// A warning from React, or an error from jsdom, would end up in the output: the tests fail on it.
let errors: MockInstance;

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  const calls = [...errors.mock.calls];
  vi.restoreAllMocks(); // the spies
  vi.useRealTimers(); // the clock that a test has set
  expect(calls).toEqual([]);
});

/** The latest value of `useApp()`: a test reads what the screen stored through it. */
let app: ReturnType<typeof useApp>;

function Probe() {
  app = useApp();
  return null;
}

/** The plan with the first `count` made-up operators, A to H, and no cells. */
function plan(count = 8): AppData {
  return { ...newAppData(), people: syntheticTeam().slice(0, count) };
}

/**
 * A plan in which nothing is wrong and nothing is wished for, until a test makes it so: no one is
 * below FPD, no shift is required (nor any weekend shift), and every wish is switched off.
 */
function calm(count = 8): AppData {
  const data = plan(count);
  const { settings } = data;
  settings.fpdHoursPerWeekday = 0;
  settings.minWeekendShifts = 0;
  for (const range of Object.values(settings.coverage)) {
    range.min = 0;
    range.max = null;
  }
  for (const id of Object.keys(settings.wishLevels) as WishId[]) settings.wishLevels[id] = 0;
  return data;
}

/** Stores `code` for `person` on `date`. */
function put(data: AppData, date: ISODate, person: PersonId, code: CodeName, pinned = false) {
  (data.cells[date] ??= {})[person] = pinned ? { code, pinned } : { code };
}

/** Stores a doctor's note for `person` on `date`, in minutes from midnight. */
function putNote(data: AppData, date: ISODate, person: PersonId, from: number, to: number) {
  (data.doctor[date] ??= {})[person] = { from, to };
}

function renderMonth(data: AppData = plan(), month: MonthKey = '2027-01') {
  return render(
    <AppProvider storage={memoryStorage(data)} runner={inProcessRunner}>
      <MonthScreen initialMonth={month} />
      <Probe />
    </AppProvider>,
  );
}

const MONDAY = '2027-01-04';

const cell = (person: PersonId, date: ISODate) => screen.getByTestId(`cell-${person}-${date}`);
const stored = (date: ISODate, person: PersonId) => (app.data as AppData).cells[date]?.[person];
const storedNote = (date: ISODate, person: PersonId) =>
  (app.data as AppData).doctor[date]?.[person];
const menu = () => screen.getByRole('menu');
const item = (name: string) => screen.getByRole('menuitem', { name });
const itemNames = () => within(menu()).getAllByRole('menuitem').map((i) => i.textContent);
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
const checks = () => within(screen.getByRole('region', { name: 'Kontrola' }));
/** The text of each line of the checks list, in order. */
const lines = () => checks().queryAllByRole('button').map((line) => line.textContent);
const next = () => userEvent.click(screen.getByText('▶'));
const previous = () => userEvent.click(screen.getByText('◀'));

/** Opens the menu of a cell and picks an item. */
async function choose(person: PersonId, date: ISODate, name: string) {
  await userEvent.click(cell(person, date));
  await userEvent.click(item(name));
}

// --- The brief's tests -----------------------------------------------------------------------

describe('the brief', () => {
  it('edits a cell and reacts with checks and totals', async () => {
    renderMonth();
    expect(screen.getByRole('heading', { name: 'Leden 2027' })).toBeInTheDocument();
    expect(screen.getByTestId('cell-A-2026-12-31')).toHaveClass('tail');
    await userEvent.click(screen.getByTestId('cell-C-2027-01-06'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'O' }));
    await userEvent.click(screen.getByTestId('cell-C-2027-01-07'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'R1' }));
    expect(screen.getByTestId('cell-C-2027-01-07')).toHaveTextContent('R1📌');
    expect(screen.getByText(/R1 hned po O: jen 8 h odpočinku/)).toBeInTheDocument();
    expect(screen.getByTestId('totals-C')).toHaveTextContent('15 / 157,5');
    expect(screen.getByTestId('coverage-2027-01-04')).toHaveTextContent('chybí R1');
  });

  it('offers only 12-hour shifts on a weekend', async () => {
    renderMonth();
    await userEvent.click(screen.getByTestId('cell-A-2027-01-09'));
    expect(screen.queryByRole('menuitem', { name: 'R1' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'R12' })).toBeInTheDocument();
  });
});

// --- The heading, the month and its status ----------------------------------------------------

describe('the month', () => {
  it.each([
    ['in autumn', new Date(2026, 10, 5, 10, 0), 'Prosinec 2026'],
    ['at the end of the year', new Date(2026, 11, 20, 10, 0), 'Leden 2027'],
    // The zone is Prague (see globalSetup.ts): the local date, not the UTC one, picks the month.
    ['just after midnight on 1 December', new Date('2026-11-30T23:30:00Z'), 'Leden 2027'],
    ['just after midnight on 1 January', new Date('2026-12-31T23:30:00Z'), 'Únor 2027'],
  ])('is the month after today by default: %s', (_when, now, expected) => {
    vi.setSystemTime(now);
    render(
      <AppProvider storage={memoryStorage(plan(2))} runner={inProcessRunner}>
        <MonthScreen />
      </AppProvider>,
    );
    expect(heading()).toBe(expected);
  });

  it('steps through the months with ◀ and ▶, over the turn of the year', async () => {
    renderMonth(plan(2));
    expect(heading()).toBe('Leden 2027');
    const arrow = (name: string) => screen.getByRole('button', { name });
    expect(arrow('▶')).toHaveAccessibleDescription('Další měsíc');
    expect(arrow('◀')).toHaveAccessibleDescription('Předchozí měsíc');
    await userEvent.click(screen.getByRole('button', { name: '▶' }));
    expect(heading()).toBe('Únor 2027');
    await userEvent.click(screen.getByRole('button', { name: '◀' }));
    await previous();
    expect(heading()).toBe('Prosinec 2026');
    await previous();
    expect(heading()).toBe('Listopad 2026');
    await next();
    await next();
    await next();
    expect(heading()).toBe('Únor 2027');
  });

  it('shows the days of the month that is shown', async () => {
    renderMonth(plan(2));
    await next();
    expect(screen.getByTestId('cell-A-2027-02-28')).toBeInTheDocument();
    expect(screen.queryByTestId('cell-A-2027-01-15')).toBeNull();
    expect(screen.getByTestId('cell-A-2027-01-25')).toHaveClass('tail'); // the tail of February
  });

  it('says what the month is: requests only, a draft, or closed', async () => {
    const data = plan(2);
    data.months['2027-01'] = { status: 'draft' };
    data.months['2027-02'] = { status: 'closed' };
    renderMonth(data);
    const badges = () => ['Žádosti', 'Návrh', 'Uzavřeno'].filter((b) => screen.queryByText(b));
    expect(badges()).toEqual(['Návrh']);
    await next();
    expect(badges()).toEqual(['Uzavřeno']);
    await next();
    expect(badges()).toEqual(['Žádosti']); // March has no data of its own
  });

  it('tells the FPD, the working days and the days with 12-hour shifts', async () => {
    const data = plan(2);
    renderMonth(data);
    // January 2027: 21 Mon-Fri days (the holiday on Friday the 1st among them), 10 weekend days
    // and that holiday are 12-hour days.
    const info = (text: string) => expect(screen.getByText(text)).toBeVisible();
    info('FPD 157,5 h · 21 pracovních dní · 11 dnů s 12h směnami');
    await next();
    info('FPD 150 h · 20 pracovních dní · 8 dnů s 12h směnami');
  });

  it('counts a day whose type is set to 12-hour as one of them', () => {
    const data = plan(2);
    data.settings.dayTypeOverrides['2027-01-05'] = 'twelve';
    data.settings.fpdHoursPerWeekday = 8;
    renderMonth(data);
    expect(screen.getByText('FPD 168 h · 21 pracovních dní · 12 dnů s 12h směnami')).toBeVisible();
  });
});

// --- The grid ---------------------------------------------------------------------------------

describe('the grid', () => {
  it('has a row for each person, in the order of the team, named from the team', () => {
    const data = plan(3);
    data.people[1].name = 'Jiné jméno';
    renderMonth(data);
    // A name cell holds the button that copies the row too: the header is still called the name.
    // Its aria-label gives the accessible name by itself, so the name that is seen is checked too.
    const names = ['Operátor A', 'Jiné jméno', 'Operátor C', 'Obsazeno'];
    const rows = screen.getAllByRole('rowheader');
    expect(rows).toHaveLength(names.length);
    names.forEach((name, k) => {
      expect(rows[k]).toHaveAccessibleName(name);
      expect(rows[k]).toHaveTextContent(name);
    });
  });

  it('has no row for someone who is not in the team at all that month', () => {
    const data = plan(4);
    data.people[1].activeFrom = '2027-02-01'; // joins after the month
    data.people[2].activeTo = '2026-12-31'; // left before it, but is in the team in the tail
    renderMonth(data);
    expect(screen.queryByTestId('cell-B-2027-01-04')).toBeNull();
    expect(screen.queryByTestId('cell-C-2027-01-04')).toBeNull();
    expect(screen.getByTestId('cell-A-2027-01-04')).toBeInTheDocument();
    expect(screen.getByTestId('cell-D-2027-01-04')).toBeInTheDocument();
  });

  it('has the last 7 days of the previous month, then the days of the month', () => {
    renderMonth(plan(2));
    const ids = screen.getAllByTestId(/^cell-A-/).map((c) => c.getAttribute('data-testid'));
    expect(ids).toHaveLength(7 + 31);
    expect(ids.slice(0, 8)).toEqual(
      ['25', '26', '27', '28', '29', '30', '31']
        .map((day) => `cell-A-2026-12-${day}`)
        .concat('cell-A-2027-01-01'),
    );
    expect(ids.at(-1)).toBe('cell-A-2027-01-31');

    // The heads: the weekday and the day of the month, then the totals. The corner above the
    // names is no head.
    const heads = screen.getAllByRole('columnheader').map((head) => head.textContent);
    expect(heads.slice(0, 2)).toEqual(['pá 25', 'so 26']);
    expect(heads.slice(6, 9)).toEqual(['čt 31', 'pá 1', 'so 2']);
    expect(heads.at(-2)).toBe('ne 31');
    expect(heads).toHaveLength(38 + 1); // the days, the totals
  });

  it('marks the tail, the 12-hour days and the days outside the team', () => {
    const data = plan(2);
    data.people[1].activeFrom = '2027-01-10';
    data.people[1].activeTo = '2027-01-20';
    renderMonth(data);

    expect(cell('A', '2026-12-25')).toHaveClass('tail');
    expect(cell('A', '2026-12-31')).toHaveClass('tail');
    expect(cell('A', '2027-01-01')).not.toHaveClass('tail');

    expect(cell('A', '2027-01-01')).toHaveClass('twelve'); // a holiday, on a Friday
    expect(cell('A', '2027-01-02')).toHaveClass('twelve'); // a Saturday
    expect(cell('A', MONDAY)).not.toHaveClass('twelve');
    expect(cell('A', '2026-12-26')).toHaveClass('tail', 'twelve');
    expect(cell('A', '2026-12-30')).not.toHaveClass('twelve');

    expect(cell('A', '2027-01-09')).not.toHaveClass('inactive'); // A has no dates
    expect(cell('B', '2026-12-31')).toHaveClass('inactive'); // before the first day
    expect(cell('B', '2027-01-09')).toHaveClass('inactive');
    expect(cell('B', '2027-01-10')).not.toHaveClass('inactive'); // the first day is in
    expect(cell('B', '2027-01-20')).not.toHaveClass('inactive'); // so is the last
    expect(cell('B', '2027-01-21')).toHaveClass('inactive');
  });

  it('takes the type of a day from the settings, whatever the weekday', () => {
    const data = plan(1);
    data.settings.dayTypeOverrides['2027-01-05'] = 'twelve';
    data.settings.dayTypeOverrides['2027-01-09'] = 'weekday';
    renderMonth(data);
    expect(cell('A', '2027-01-05')).toHaveClass('twelve');
    expect(cell('A', '2027-01-09')).not.toHaveClass('twelve');
  });

  it('shows what is stored: the code, a pin only on a shift, x in lower case', () => {
    const data = plan(2);
    put(data, MONDAY, 'A', 'R1', true);
    put(data, MONDAY, 'B', 'R2');
    put(data, '2027-01-05', 'A', 'x');
    put(data, '2027-01-06', 'A', 'DOV');
    data.cells['2027-01-07'] = { A: { code: 'MD', pinned: true } }; // a pin that means nothing
    renderMonth(data);
    expect(cell('A', MONDAY)).toHaveTextContent('R1📌');
    expect(cell('B', MONDAY)).toHaveTextContent(/^R2$/);
    expect(cell('A', '2027-01-05')).toHaveTextContent(/^x$/);
    expect(cell('A', '2027-01-06')).toHaveTextContent(/^DOV$/);
    expect(cell('A', '2027-01-07')).toHaveTextContent(/^MD$/);
    expect(cell('B', '2027-01-05')).toBeEmptyDOMElement();
  });

  it('keeps the shifts of the tail, and shows them in their cells', () => {
    const data = plan(2);
    put(data, '2026-12-31', 'A', 'N');
    renderMonth(data);
    expect(cell('A', '2026-12-31')).toHaveTextContent(/^N$/);
  });

  it('makes each cell a button that the keyboard opens the menu on', async () => {
    renderMonth(plan(2));
    const target = cell('A', MONDAY);
    expect(target.tagName).toBe('BUTTON');
    expect(target).toHaveAttribute('type', 'button');

    expect(target).toHaveAttribute('aria-haspopup', 'menu');
    expect(target).toHaveAttribute('aria-expanded', 'false');
    target.focus();
    expect(target).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(menu()).toBeInTheDocument();
    expect(target).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(target).toHaveFocus();

    await userEvent.keyboard(' ');
    expect(menu()).toBeInTheDocument();
  });

  it('gives a cell a name for a tooltip and for the page readers: the person and the day', () => {
    renderMonth(plan(2));
    expect(cell('B', '2027-01-05')).toHaveAttribute('title', 'Operátor B · 5. 1.');
    expect(cell('A', '2026-12-31')).toHaveAttribute('title', 'Operátor A · 31. 12.');
  });

  it('paints each code in the colours of the brief', () => {
    // jsdom does not load the style sheet, so this reads it: the colours are given verbatim.
    const css = readFileSync(join(import.meta.dirname, '../styles.css'), 'utf8');
    const rule = (code: string) =>
      new RegExp(`\\[data-code='${code}'\\][^{]*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(rule('R1')).toContain('#fff2a8');
    expect(rule('R2')).toContain('#a6ecf2');
    expect(rule('O20')).toMatch(/background:\s*(#fff|white)\b/);
    expect(rule('O20')).toContain('border');
    expect(rule('O')).toContain('#fcd5b4');
    expect(rule('N')).toContain('#33b5f0');
    expect(rule('N12')).toContain('#1f78c8');
    expect(rule('N12')).toMatch(/color:\s*(#fff|white)\b/);
    expect(rule('R12')).toContain('#f9c6f0');
    for (const code of ['DOV', 'MD', 'OP', 'NEM']) expect(rule(code)).toContain('#c6efce');
    expect(rule('x')).toMatch(/color:\s*#/);
    expect(rule('x')).toContain('italic');
  });

  it('tells the code of a cell to the style sheet', () => {
    const data = plan(1);
    put(data, MONDAY, 'A', 'O20');
    put(data, '2027-01-05', 'A', 'x');
    renderMonth(data);
    expect(cell('A', MONDAY)).toHaveAttribute('data-code', 'O20');
    expect(cell('A', '2027-01-05')).toHaveAttribute('data-code', 'x');
    expect(cell('A', '2027-01-06')).not.toHaveAttribute('data-code');
  });
});

// --- The cell menu ----------------------------------------------------------------------------

describe('the cell menu', () => {
  it('offers the weekday shifts, then the absences, x, Lékař… and Vymazat', async () => {
    renderMonth(plan(2));
    await userEvent.click(cell('A', MONDAY));
    expect(menu()).toBeInTheDocument();
    expect(itemNames()).toEqual(
      ['R1', 'R2', 'O20', 'O', 'N', 'DOV', 'MD', 'OP', 'NEM', 'x', 'Lékař…', 'Vymazat'],
    );
  });

  it('offers the 12-hour shifts on a weekend and on a holiday', async () => {
    renderMonth(plan(2));
    const twelve = ['R12', 'N12', 'DOV', 'MD', 'OP', 'NEM', 'x', 'Lékař…', 'Vymazat'];
    await userEvent.click(cell('A', '2027-01-09')); // a Saturday
    expect(itemNames()).toEqual(twelve);
    await userEvent.click(cell('A', '2027-01-01')); // a holiday on a Friday
    expect(itemNames()).toEqual(twelve);
  });

  it('follows the type that the settings give the day', async () => {
    const data = plan(1);
    data.settings.dayTypeOverrides['2027-01-09'] = 'weekday';
    renderMonth(data);
    await userEvent.click(cell('A', '2027-01-09'));
    expect(itemNames()[0]).toBe('R1');
  });

  it('offers Připnout on a shift that is not pinned, Odepnout on a pinned one', async () => {
    const data = plan(1);
    put(data, MONDAY, 'A', 'R1');
    put(data, '2027-01-05', 'A', 'R2', true);
    put(data, '2027-01-06', 'A', 'x');
    put(data, '2027-01-07', 'A', 'DOV');
    renderMonth(data);

    await userEvent.click(cell('A', MONDAY));
    expect(itemNames().slice(-2)).toEqual(['Vymazat', 'Připnout']);
    await userEvent.click(cell('A', '2027-01-05'));
    expect(itemNames().slice(-2)).toEqual(['Vymazat', 'Odepnout']);
    for (const date of ['2027-01-06', '2027-01-07', '2027-01-08']) {
      await userEvent.click(cell('A', date)); // x, an absence, and a cell with nothing in it
      expect(itemNames().at(-1)).toBe('Vymazat');
      expect(screen.queryByRole('menuitem', { name: /pnout$/ })).toBeNull();
    }
  });

  it.each([['R1'], ['R2'], ['O20'], ['O'], ['N']] as const)(
    'stores the weekday shift %s pinned, because a manual edit is to be kept',
    async (code) => {
      renderMonth(plan(2));
      await choose('A', MONDAY, code);
      expect(stored(MONDAY, 'A')).toStrictEqual({ code, pinned: true });
      expect(cell('A', MONDAY)).toHaveTextContent(`${code}📌`);
      expect(stored(MONDAY, 'B')).toBeUndefined(); // nobody else is touched
    },
  );

  it.each([['R12'], ['N12']] as const)('stores the 12-hour shift %s pinned', async (code) => {
    renderMonth(plan(2));
    await choose('A', '2027-01-09', code);
    expect(stored('2027-01-09', 'A')).toStrictEqual({ code, pinned: true });
  });

  it.each([['DOV'], ['MD'], ['OP'], ['NEM'], ['x']] as const)(
    'stores %s as it is, without a pin',
    async (code) => {
      renderMonth(plan(2));
      await choose('A', MONDAY, code);
      expect(stored(MONDAY, 'A')).toStrictEqual({ code });
      expect(cell('A', MONDAY)).toHaveTextContent(new RegExp(`^${code}$`));
    },
  );

  it('replaces a pinned shift with an absence that has no pin', async () => {
    const data = plan(1);
    put(data, MONDAY, 'A', 'R1', true);
    renderMonth(data);
    await choose('A', MONDAY, 'DOV');
    expect(stored(MONDAY, 'A')).toStrictEqual({ code: 'DOV' });
  });

  it('deletes the cell with Vymazat', async () => {
    const data = plan(2);
    put(data, MONDAY, 'A', 'R1', true);
    put(data, MONDAY, 'B', 'R2');
    renderMonth(data);
    await choose('A', MONDAY, 'Vymazat');
    expect(stored(MONDAY, 'A')).toBeUndefined();
    expect(Object.hasOwn((app.data as AppData).cells[MONDAY], 'A')).toBe(false);
    expect(stored(MONDAY, 'B')).toStrictEqual({ code: 'R2' });
    expect(cell('A', MONDAY)).toBeEmptyDOMElement();
  });

  it('pins a shift with Připnout and unpins it with Odepnout', async () => {
    const data = plan(1);
    put(data, MONDAY, 'A', 'R1');
    renderMonth(data);
    await choose('A', MONDAY, 'Připnout');
    expect(stored(MONDAY, 'A')).toStrictEqual({ code: 'R1', pinned: true });
    expect(cell('A', MONDAY)).toHaveTextContent('R1📌');
    await choose('A', MONDAY, 'Odepnout');
    expect(stored(MONDAY, 'A')).toStrictEqual({ code: 'R1' });
    expect(cell('A', MONDAY)).toHaveTextContent(/^R1$/);
  });

  it('edits the cells of the tail like any other: December is typed in', async () => {
    renderMonth(plan(2));
    await choose('A', '2026-12-31', 'N'); // a Thursday
    expect(stored('2026-12-31', 'A')).toStrictEqual({ code: 'N', pinned: true });
    expect(cell('A', '2026-12-31')).toHaveTextContent('N📌');

    await userEvent.click(cell('A', '2026-12-26')); // a holiday on a Saturday
    expect(itemNames().slice(0, 2)).toEqual(['R12', 'N12']);
    await userEvent.click(item('R12'));
    expect(stored('2026-12-26', 'A')).toStrictEqual({ code: 'R12', pinned: true });

    await choose('A', '2026-12-31', 'Vymazat');
    expect(stored('2026-12-31', 'A')).toBeUndefined();
  });

  it('opens on a day outside the team, so that a value stored there can be cleared', async () => {
    const data = plan(2);
    data.people[1].activeFrom = '2027-01-10';
    put(data, '2027-01-09', 'B', 'R12'); // a Saturday before B joins
    renderMonth(data);
    expect(cell('B', '2027-01-09')).toHaveClass('inactive');
    expect(cell('B', '2027-01-09')).toHaveTextContent('R12');

    await choose('B', '2027-01-09', 'Vymazat');
    expect(stored('2027-01-09', 'B')).toBeUndefined();
    await choose('B', '2027-01-09', 'DOV'); // and one can be put there
    expect(stored('2027-01-09', 'B')).toStrictEqual({ code: 'DOV' });
  });

  it('has a name: the person and the day of its cell', async () => {
    renderMonth(plan(2));
    await userEvent.click(cell('B', '2027-01-05'));
    expect(screen.getByRole('menu', { name: 'Operátor B · 5. 1.' })).toBeInTheDocument();
  });

  it('selects the cell, and the cell stays selected when the menu closes', async () => {
    renderMonth(plan(2));
    expect(cell('A', MONDAY)).not.toHaveClass('selected');
    await userEvent.click(cell('A', MONDAY));
    expect(cell('A', MONDAY)).toHaveClass('selected');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(cell('A', MONDAY)).toHaveClass('selected');

    await userEvent.click(cell('B', MONDAY)); // another one takes over
    expect(cell('A', MONDAY)).not.toHaveClass('selected');
    expect(cell('B', MONDAY)).toHaveClass('selected');
    expect(screen.getAllByRole('menu')).toHaveLength(1);
  });

  it('closes on Escape', async () => {
    renderMonth(plan(2));
    await userEvent.click(cell('A', MONDAY));
    expect(menu()).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(stored(MONDAY, 'A')).toBeUndefined(); // nothing was chosen
  });

  it('closes on Escape wherever the focus is', async () => {
    renderMonth(plan(2));
    await userEvent.click(cell('A', MONDAY));
    (document.activeElement as HTMLElement).blur();
    expect(document.body).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on a click outside, on the page or on something else on the screen', async () => {
    renderMonth(plan(2));
    await userEvent.click(cell('A', MONDAY));
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();

    await userEvent.click(cell('A', MONDAY));
    await userEvent.click(screen.getByRole('heading', { name: 'Leden 2027' }));
    expect(screen.queryByRole('menu')).toBeNull();

    await userEvent.click(cell('A', MONDAY));
    await userEvent.click(screen.getByRole('rowheader', { name: 'Operátor B' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('stays open for a click inside it', async () => {
    renderMonth(plan(2));
    await userEvent.click(cell('A', MONDAY));
    await userEvent.click(menu());
    expect(menu()).toBeInTheDocument();
  });

  it('closes when the cell it belongs to is clicked again', async () => {
    renderMonth(plan(2));
    await userEvent.click(cell('A', MONDAY));
    await userEvent.click(cell('A', MONDAY));
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(cell('A', MONDAY)); // and a third click opens it again
    expect(menu()).toBeInTheDocument();
  });

  it('moves to another cell that is clicked', async () => {
    renderMonth(plan(2));
    await userEvent.click(cell('A', MONDAY));
    await userEvent.click(cell('B', '2027-01-09'));
    expect(screen.getByRole('menu', { name: 'Operátor B · 9. 1.' })).toBeInTheDocument();
    expect(itemNames()[0]).toBe('R12');
  });

  it('closes after a choice', async () => {
    renderMonth(plan(2));
    await choose('A', MONDAY, 'R1');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('puts the focus on the first item, moves it with the keys, and gives it back', async () => {
    renderMonth(plan(2));
    const target = cell('A', MONDAY);
    await userEvent.click(target);
    expect(item('R1')).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    expect(item('R2')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}'); // past the first, round to the last
    expect(item('Vymazat')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}'); // and round to the first
    expect(item('R1')).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(item('Vymazat')).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(item('R1')).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}'); // O20
    expect(stored(MONDAY, 'A')).toStrictEqual({ code: 'O20', pinned: true });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(target).toHaveFocus();
  });

  it('gives the focus back to the cell on Escape, and leaves the page on Tab', async () => {
    renderMonth(plan(2));
    const target = cell('A', MONDAY);
    await userEvent.click(target);
    await userEvent.keyboard('{Escape}');
    expect(target).toHaveFocus();

    await userEvent.click(target);
    expect(menu()).toBeInTheDocument();
    await userEvent.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(target).toHaveFocus();
  });

  it('does not take the focus from what a click outside has focused', async () => {
    renderMonth(oneMustOneWish());
    await userEvent.click(cell('A', MONDAY));
    const line = checks().getAllByRole('button')[0];
    await userEvent.click(line); // outside the menu: it closes, and the line has the focus
    expect(screen.queryByRole('menu')).toBeNull();
    expect(line).toHaveFocus();
  });

  it('closes, and nothing is selected, when the month changes', async () => {
    renderMonth(plan(2));
    await userEvent.click(cell('A', MONDAY));
    await next();
    expect(screen.queryByRole('menu')).toBeNull();
    await previous();
    expect(cell('A', MONDAY)).not.toHaveClass('selected');
  });

  it('closes for a day that the next month shows in its tail, too', async () => {
    renderMonth(plan(2));
    await userEvent.click(cell('A', '2027-01-28')); // a day of January, and of the tail of February
    await next();
    expect(cell('A', '2027-01-28')).toHaveClass('tail');
    expect(cell('A', '2027-01-28')).not.toHaveClass('selected');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('is not left open for a person who is gone', async () => {
    renderMonth(plan(3));
    await userEvent.click(cell('C', '2027-01-06'));
    act(() => app.dispatch({ type: 'removePerson', personId: 'C' }));
    expect(screen.queryByTestId('cell-C-2027-01-06')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// --- The doctor's note: the menu and the grid ---------------------------------------------------

describe("the doctor's note", () => {
  const dialog = () => screen.getByRole('dialog');
  const fromBox = () => screen.getByLabelText('od');
  const toBox = () => screen.getByLabelText('do');
  const button = (name: string) => screen.getByRole('button', { name });
  const noButton = (name: string) => screen.queryByRole('button', { name });

  /** Opens the menu of a cell, chooses `Lékař…`, and so opens the form of the note. */
  async function openForm(person: PersonId, date: ISODate) {
    await userEvent.click(cell(person, date));
    await userEvent.click(item('Lékař…'));
  }

  /** Types the two times, as `HH:MM`, into the form. */
  async function typeTimes(from: string, to: string) {
    await userEvent.type(fromBox(), from);
    await userEvent.type(toBox(), to);
  }

  it("the menu stores a doctor's note", async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    await typeTimes('08:00', '12:00');
    await userEvent.click(button('Uložit lékaře'));

    expect(storedNote(MONDAY, 'A')).toStrictEqual({ from: 480, to: 720 });
    expect(cell('A', MONDAY)).toHaveTextContent(/^L$/);
    expect(cell('A', MONDAY).title).toContain('lékař 8:00–12:00');
    expect(stored(MONDAY, 'A')).toBeUndefined(); // a note is no code: the cell holds none
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(cell('A', MONDAY)).toHaveFocus();
    expect(cell('B', MONDAY)).toBeEmptyDOMElement(); // nobody else is touched
  });

  it('a note and a shift share a cell', () => {
    const data = plan(2);
    put(data, MONDAY, 'A', 'R1', true);
    putNote(data, MONDAY, 'A', 480, 720);
    renderMonth(data);
    expect(cell('A', MONDAY)).toHaveTextContent('R1');
    expect(cell('A', MONDAY)).toHaveTextContent('📌');
    expect(within(cell('A', MONDAY)).getByText('L')).toBeInTheDocument();
    expect(cell('A', MONDAY)).toHaveAttribute('data-code', 'R1'); // painted as the shift
    expect(cell('A', MONDAY).title).toContain('lékař 8:00–12:00');
    expect(cell('B', MONDAY)).toBeEmptyDOMElement();
  });

  it('keeps the shift and its pin when a note is stored beside it', async () => {
    const data = plan(2);
    put(data, MONDAY, 'A', 'R1', true);
    renderMonth(data);
    await openForm('A', MONDAY);
    await typeTimes('13:30', '15:00');
    await userEvent.click(button('Uložit lékaře'));
    expect(stored(MONDAY, 'A')).toStrictEqual({ code: 'R1', pinned: true });
    expect(storedNote(MONDAY, 'A')).toStrictEqual({ from: 810, to: 900 });
    expect(cell('A', MONDAY)).toHaveTextContent('R1');
    expect(cell('A', MONDAY)).toHaveTextContent('L');
  });

  it('appends the note to the title of the cell, and names the menu by the day alone', async () => {
    const data = plan(2);
    putNote(data, MONDAY, 'B', 570, 645);
    renderMonth(data);
    expect(cell('B', MONDAY)).toHaveAttribute('title', 'Operátor B · 4. 1. · lékař 9:30–10:45');
    expect(cell('A', MONDAY)).toHaveAttribute('title', 'Operátor A · 4. 1.'); // no note, no change
    await userEvent.click(cell('B', MONDAY));
    expect(screen.getByRole('menu', { name: 'Operátor B · 4. 1.' })).toBeInTheDocument();
  });

  it('shows the marker on an empty cell, an absence and a day outside the team', () => {
    const data = plan(2);
    data.people[1].activeFrom = '2027-01-10';
    put(data, '2027-01-05', 'A', 'DOV');
    putNote(data, '2027-01-05', 'A', 480, 720);
    putNote(data, '2027-01-09', 'B', 480, 720); // B joins the next day
    putNote(data, '2026-12-31', 'A', 480, 720); // a day of the tail
    renderMonth(data);
    expect(cell('A', '2027-01-05')).toHaveTextContent(/^DOVL$/);
    expect(cell('B', '2027-01-09')).toHaveTextContent(/^L$/);
    expect(cell('A', '2026-12-31')).toHaveTextContent(/^L$/);
    expect(cell('A', '2027-01-06')).toBeEmptyDOMElement();
  });

  it('opens a form named by the person and the day, with the focus on the first time', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    expect(screen.getByRole('dialog', { name: 'Operátor A · 4. 1.' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull(); // the list of codes gives way to the form
    expect(fromBox()).toHaveAttribute('type', 'time');
    expect(toBox()).toHaveAttribute('type', 'time');
    expect(fromBox()).toHaveFocus();
    expect(fromBox()).toHaveValue('');
    expect(toBox()).toHaveValue('');
    expect(button('Uložit lékaře')).toBeInTheDocument();
    expect(noButton('Odebrat lékaře')).toBeNull(); // there is no note to remove
  });

  it('shows the times of the note that is there, and changes it', async () => {
    const data = plan(2);
    putNote(data, MONDAY, 'A', 480, 720);
    renderMonth(data);
    await openForm('A', MONDAY);
    expect(fromBox()).toHaveValue('08:00');
    expect(toBox()).toHaveValue('12:00');
    await userEvent.clear(fromBox());
    await userEvent.type(fromBox(), '09:15');
    await userEvent.click(button('Uložit lékaře'));
    expect(storedNote(MONDAY, 'A')).toStrictEqual({ from: 555, to: 720 });
    expect(cell('A', MONDAY).title).toContain('lékař 9:15–12:00');
  });

  it('removes the note with Odebrat lékaře, and leaves the shift', async () => {
    const data = plan(2);
    put(data, MONDAY, 'A', 'R2');
    putNote(data, MONDAY, 'A', 480, 720);
    putNote(data, MONDAY, 'B', 480, 720);
    renderMonth(data);
    await openForm('A', MONDAY);
    await userEvent.click(button('Odebrat lékaře'));
    expect(storedNote(MONDAY, 'A')).toBeUndefined();
    expect(storedNote(MONDAY, 'B')).toStrictEqual({ from: 480, to: 720 });
    expect(stored(MONDAY, 'A')).toStrictEqual({ code: 'R2' });
    expect(cell('A', MONDAY)).toHaveTextContent(/^R2$/);
    expect(cell('A', MONDAY).title).toBe('Operátor A · 4. 1.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves the note when the cell is cleared with Vymazat', async () => {
    const data = plan(2);
    put(data, MONDAY, 'A', 'R1', true);
    putNote(data, MONDAY, 'A', 480, 720);
    renderMonth(data);
    await choose('A', MONDAY, 'Vymazat');
    expect(stored(MONDAY, 'A')).toBeUndefined();
    expect(storedNote(MONDAY, 'A')).toStrictEqual({ from: 480, to: 720 });
    expect(cell('A', MONDAY)).toHaveTextContent(/^L$/);
  });

  it.each([
    ['ends before it starts', '12:00', '08:00'],
    ['ends where it starts', '10:00', '10:00'],
  ])('refuses a note that %s, says why, and stores nothing', async (_what, from, to) => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    await typeTimes(from, to);
    await userEvent.click(button('Uložit lékaře'));
    expect(screen.getByRole('alert')).toHaveTextContent('Čas od musí být dřív než čas do.');
    expect(storedNote(MONDAY, 'A')).toBeUndefined();
    expect(dialog()).toBeInTheDocument(); // the form stays, with what was typed
    expect(fromBox()).toHaveValue(from);
    expect(toBox()).toHaveValue(to);

    // The message goes with the next change, and a note that is right is stored.
    await userEvent.clear(toBox());
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.type(toBox(), '23:59');
    await userEvent.click(button('Uložit lékaře'));
    expect(storedNote(MONDAY, 'A')).toStrictEqual({
      from: Number(from.slice(0, 2)) * 60,
      to: 1439,
    });
  });

  it.each([
    ['both times', '', ''],
    ['the start', '', '12:00'],
    ['the end', '08:00', ''],
  ])('asks for the times when %s is missing', async (_what, from, to) => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    if (from !== '') await userEvent.type(fromBox(), from);
    if (to !== '') await userEvent.type(toBox(), to);
    await userEvent.click(button('Uložit lékaře'));
    expect(screen.getByRole('alert')).toHaveTextContent('Vyplňte čas od i čas do.');
    expect(storedNote(MONDAY, 'A')).toBeUndefined();
    expect(dialog()).toBeInTheDocument();
  });

  it('stores the note on Enter in a box, like the button', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    await typeTimes('06:00', '07:30');
    await userEvent.keyboard('{Enter}');
    expect(storedNote(MONDAY, 'A')).toStrictEqual({ from: 360, to: 450 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the end of the day, which a time box cannot hold, as 23:59', async () => {
    const data = plan(2);
    putNote(data, MONDAY, 'A', 1320, 1440);
    renderMonth(data);
    expect(cell('A', MONDAY).title).toContain('lékař 22:00–24:00');
    await openForm('A', MONDAY);
    expect(fromBox()).toHaveValue('22:00');
    expect(toBox()).toHaveValue('23:59');
  });

  it('closes on Escape without storing, and gives the focus back to the cell', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    await typeTimes('08:00', '12:00');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(storedNote(MONDAY, 'A')).toBeUndefined();
    expect(cell('A', MONDAY)).toHaveFocus();
  });

  it('lets Tab go from control to control, and leaves at either end as the list does', async () => {
    const data = plan(2);
    putNote(data, MONDAY, 'A', 480, 720);
    renderMonth(data);
    await openForm('A', MONDAY);
    expect(fromBox()).toHaveFocus();
    await userEvent.tab();
    expect(toBox()).toHaveFocus();
    await userEvent.tab();
    expect(button('Uložit lékaře')).toHaveFocus();
    await userEvent.tab();
    expect(button('Odebrat lékaře')).toHaveFocus();
    expect(dialog()).toBeInTheDocument();
    await userEvent.tab(); // past the last control: the form closes, the cell has the focus
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cell('A', MONDAY)).toHaveFocus();

    await openForm('A', MONDAY);
    await userEvent.tab({ shift: true }); // before the first control
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cell('A', MONDAY)).toHaveFocus();
  });

  it('does not leave on a Tab that stays in a box, as between the parts of one', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    await typeTimes('08:00', '12:00');
    act(() => fromBox().focus());
    // A browser moves from the hour to the minute of a box, and back, with the focus on the box.
    // jsdom has no parts in a time box: the key is pressed, and the focus stays where it is.
    fireEvent.keyDown(fromBox(), { key: 'Tab', shiftKey: true });
    fireEvent.keyDown(fromBox(), { key: 'Tab' });
    expect(dialog()).toBeInTheDocument();
    expect(fromBox()).toHaveValue('08:00');
    expect(toBox()).toHaveValue('12:00');
  });

  it('closes when the focus goes out of it, and leaves the focus where it went', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    await typeTimes('08:00', '12:00');
    act(() => cell('B', MONDAY).focus());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cell('B', MONDAY)).toHaveFocus();
    expect(storedNote(MONDAY, 'A')).toBeUndefined(); // closing is no saving
  });

  it('stays open when the focus goes to no element of the page, and Escape closes it', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    (document.activeElement as HTMLElement).blur(); // as when another window is switched to
    expect(document.body).toHaveFocus();
    expect(dialog()).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on a click outside', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    await userEvent.click(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(storedNote(MONDAY, 'A')).toBeUndefined();
  });

  it('stays open for a click inside it', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    await userEvent.click(dialog());
    await userEvent.click(fromBox());
    expect(dialog()).toBeInTheDocument();
  });

  // A press of the mouse on a button focuses it, so a click on the cell of the form takes the focus
  // out of the form before the click itself comes: the cell's own click is what closes the menu.
  it('closes on a click on its own cell, as the list does, and opens nothing', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    await userEvent.click(cell('A', MONDAY));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(cell('A', MONDAY)).toHaveAttribute('aria-expanded', 'false');
    expect(storedNote(MONDAY, 'A')).toBeUndefined(); // closing is no saving
  });

  it('is not closed by the press on its cell, but by the click that follows it', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    await typeTimes('08:00', '12:00');
    const own = cell('A', MONDAY);
    fireEvent.mouseDown(own);
    act(() => own.focus()); // which is what a browser does with the press
    expect(dialog()).toBeInTheDocument();
    expect(fromBox()).toHaveValue('08:00');
    fireEvent.mouseUp(own);
    fireEvent.click(own);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('excuses the focus going to the pressed cell, and no other', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    fireEvent.mouseDown(cell('A', MONDAY)); // the mouse is down on the cell of the form
    act(() => cell('B', MONDAY).focus()); // and the focus goes elsewhere, say by a key
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cell('B', MONDAY)).toHaveFocus();
  });

  it('gives way to the list of another cell that is clicked', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    await userEvent.click(cell('B', MONDAY));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('menu', { name: 'Operátor B · 4. 1.' })).toBeInTheDocument();
    expect(cell('A', MONDAY)).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on a click on the heading of the month, and on the coverage row', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    await userEvent.click(screen.getByRole('heading', { name: 'Leden 2027' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await openForm('A', MONDAY);
    await userEvent.click(screen.getByTestId('coverage-2027-01-05'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on a Shift+Tab onto its cell, though the cell was pressed before', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    fireEvent.mouseDown(cell('A', MONDAY));
    fireEvent.mouseUp(document.body); // let go elsewhere: no click on the cell, the form is open
    expect(dialog()).toBeInTheDocument();
    act(() => fromBox().focus());
    await userEvent.tab({ shift: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cell('A', MONDAY)).toHaveFocus();
  });

  it('starts from the list of codes each time the menu opens', async () => {
    renderMonth(plan(2));
    await openForm('A', MONDAY);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(cell('A', MONDAY));
    expect(menu()).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stores a note on a day of the tail, as it does a shift', async () => {
    renderMonth(plan(2));
    await openForm('A', '2026-12-31');
    await typeTimes('08:00', '12:00');
    await userEvent.click(button('Uložit lékaře'));
    expect(storedNote('2026-12-31', 'A')).toStrictEqual({ from: 480, to: 720 });
    expect(cell('A', '2026-12-31')).toHaveTextContent('L');
  });

  it('is not left open for a person who is gone, and their note goes with them', async () => {
    const data = plan(3);
    putNote(data, MONDAY, 'C', 480, 720);
    renderMonth(data);
    await openForm('C', MONDAY);
    act(() => app.dispatch({ type: 'removePerson', personId: 'C' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId(`cell-C-${MONDAY}`)).toBeNull();
    expect((app.data as AppData).doctor).toStrictEqual({});
  });

  it('reaches the rules: a collision with the note is a quiet finding, not a line', async () => {
    const data = calm();
    data.settings.wishLevels.W10 = 3;
    put(data, MONDAY, 'A', 'R1', true); // 6:00-14:00
    renderMonth(data);
    await openForm('A', MONDAY);
    await typeTimes('08:00', '12:00');
    await userEvent.click(button('Uložit lékaře'));
    const { findings } = vi.mocked(evaluateMonth).mock.results.at(-1)?.value as ReturnType<
      typeof evaluateMonth
    >;
    expect(findings.filter((f) => f.rule === 'W10' && f.quiet === true)).toHaveLength(1);
    expect(lines()).toEqual([]);
    expect(checks().getByText('Musí: 0 · Přání: 0')).toBeInTheDocument();
  });

  it('works under StrictMode, which renders everything twice', async () => {
    render(
      <StrictMode>
        <AppProvider storage={memoryStorage(plan(2))} runner={inProcessRunner}>
          <MonthScreen initialMonth="2027-01" />
          <Probe />
        </AppProvider>
      </StrictMode>,
    );
    await openForm('A', MONDAY);
    await typeTimes('08:00', '12:00');
    await userEvent.click(button('Uložit lékaře'));
    expect(storedNote(MONDAY, 'A')).toStrictEqual({ from: 480, to: 720 });
  });
});

describe('the times of the form of a note', () => {
  it.each([
    ['00:00', 0],
    ['08:00', 480],
    ['12:30', 750],
    ['23:00', 1380],
    ['23:59', 1439],
  ])('reads %s as %i minutes after midnight', (text, minutes) => {
    expect(minutesOf(text)).toBe(minutes);
  });

  it.each([
    ['nothing', ''],
    ['an hour past 23', '24:00'],
    ['an hour and minutes past the day', '25:61'],
    ['minutes past 59', '08:60'],
    ['an hour of one digit', '8:00'],
    ['minutes of one digit', '08:0'],
    ['seconds', '08:00:30'],
    ['no digits', 'ab:cd'],
    ['a space', ' 08:00'],
  ])('reads no time from %s', (_what, text) => {
    expect(minutesOf(text)).toBeNull();
  });
});

describe('where the menu sits', () => {
  type Box = { top: number; left: number; width: number; height: number };
  /** jsdom has no layout: this gives the cells and the menu the boxes that a test asks for. */
  function layout(cellBox: () => Box, menuBox: Box) {
    const rect = ({ top, left, width, height }: Box) =>
      ({ top, left, width, height, bottom: top + height, right: left + width }) as DOMRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute('role') === 'menu') return rect(menuBox);
      if (this.getAttribute('data-testid')?.startsWith('cell-')) return rect(cellBox());
      return rect({ top: 0, left: 0, width: 0, height: 0 });
    });
  }
  const menuStyle = () => screen.getByRole('menu').style;
  const SIZE = { top: 0, left: 0, width: 120, height: 300 };

  it('puts the menu below its cell, at its left edge', async () => {
    layout(() => ({ top: 100, left: 200, width: 34, height: 30 }), SIZE);
    renderMonth(plan(1));
    await userEvent.click(cell('A', MONDAY));
    expect(menuStyle().top).toBe('134px'); // under the cell, with a gap of 4
    expect(menuStyle().left).toBe('200px');
  });

  it('puts it above the cell when there is no room below', async () => {
    layout(() => ({ top: 600, left: 200, width: 34, height: 30 }), SIZE);
    renderMonth(plan(1));
    await userEvent.click(cell('A', MONDAY)); // the window is 768 px high
    expect(menuStyle().top).toBe('296px'); // 600 - 4 - 300
  });

  it('keeps it in the window at the sides', async () => {
    let left = 1000;
    layout(() => ({ top: 100, left, width: 34, height: 30 }), SIZE);
    renderMonth(plan(1));
    await userEvent.click(cell('A', MONDAY)); // the window is 1024 px wide
    expect(menuStyle().left).toBe('896px'); // 1024 - 120 - 8
    left = -40;
    await userEvent.click(cell('A', '2027-01-05'));
    expect(menuStyle().left).toBe('8px');
  });

  /**
   * The list is 300 px high, the form 100 px, and 40 px more while it shows its message, and the
   * cell is at `cellTop`. The window of jsdom is 768 px high.
   */
  function layoutOfForm(cellTop: number) {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const role = this.getAttribute('role');
      const message = this.querySelector('[role="alert"]') !== null;
      const [top, height] = this.getAttribute('data-testid')?.startsWith('cell-')
        ? [cellTop, 30]
        : [0, role === 'menu' ? 300 : role === 'dialog' ? (message ? 140 : 100) : 0];
      const width = role === null ? 34 : 120;
      return { top, left: 200, width, height, bottom: top + height, right: 200 + width } as DOMRect;
    });
  }

  it('puts the form of a note beside the cell again, being smaller than the list', async () => {
    layoutOfForm(700); // neither fits below it, so each ends 4 px above it
    renderMonth(plan(1));
    await userEvent.click(cell('A', MONDAY));
    expect(menuStyle().top).toBe('396px'); // 700 - 4 - 300
    await userEvent.click(item('Lékař…'));
    expect(screen.getByRole('dialog').style.top).toBe('596px'); // 700 - 4 - 100, not 396 again
    expect(screen.getByRole('dialog').style.left).toBe('200px');
  });

  it('puts the form beside the cell again when its message makes it taller', async () => {
    layoutOfForm(600); // 634 + 100 fits in the window, and 634 + 140 does not
    renderMonth(plan(1));
    await userEvent.click(cell('A', MONDAY));
    await userEvent.click(item('Lékař…'));
    expect(screen.getByRole('dialog').style.top).toBe('634px'); // under the cell
    await userEvent.click(screen.getByRole('button', { name: 'Uložit lékaře' })); // no times
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog').style.top).toBe('456px'); // above it: 600 - 4 - 140
  });

  it('puts the form back where it was when the message goes', async () => {
    layoutOfForm(600);
    renderMonth(plan(1));
    await userEvent.click(cell('A', MONDAY));
    await userEvent.click(item('Lékař…'));
    await userEvent.click(screen.getByRole('button', { name: 'Uložit lékaře' }));
    expect(screen.getByRole('dialog').style.top).toBe('456px');
    await userEvent.type(screen.getByLabelText('od'), '08:00'); // a change takes the message away
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('dialog').style.top).toBe('634px');
  });

  it('closes when the window is resized', async () => {
    renderMonth(plan(1));
    await userEvent.click(cell('A', MONDAY));
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the form of a note when the window is resized', async () => {
    renderMonth(plan(1));
    await userEvent.click(cell('A', MONDAY));
    await userEvent.click(item('Lékař…'));
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when a scroll moves its cell, and stays for one that does not', async () => {
    let top = 100;
    layout(() => ({ top, left: 200, width: 34, height: 30 }), SIZE);
    renderMonth(plan(1));
    await userEvent.click(cell('A', MONDAY));
    // A scroll that began before the menu opened is reported after it: the cell has not moved.
    fireEvent.scroll(window);
    expect(menu()).toBeInTheDocument();
    fireEvent.scroll(menu()); // the menu's own scrolling is no reason either
    expect(menu()).toBeInTheDocument();

    top = 140; // the grid was scrolled under it
    fireEvent.scroll(window);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// --- Totals -----------------------------------------------------------------------------------

describe('the totals of a person', () => {
  it('show hours against FPD, overtime, 12-hour shifts, nights and each shift', () => {
    const data = plan(2);
    // A different number of each weekday shift, so that the order of the counts is told.
    for (const [date, code] of [
      ['2027-01-04', 'R1'],
      ['2027-01-05', 'R2'],
      ['2027-01-06', 'R2'],
      ['2027-01-07', 'O20'],
      ['2027-01-08', 'O20'],
      ['2027-01-11', 'O20'],
      ['2027-01-12', 'O'],
      ['2027-01-13', 'O'],
      ['2027-01-14', 'O'],
      ['2027-01-15', 'O'],
      ['2027-01-18', 'N'],
      ['2027-01-19', 'N'],
      ['2027-01-20', 'N'],
      ['2027-01-21', 'N'],
      ['2027-01-22', 'N'],
      ['2027-01-02', 'R12'],
      ['2027-01-03', 'N12'],
      ['2027-01-25', 'DOV'],
    ] as const) {
      put(data, date, 'A', code);
    }
    renderMonth(data);
    // 15 shifts of 7.5 h, R12 and N12 of 11.5 h, and 7.5 h of leave: 143 h of 157.5 h. The 12-hour
    // shifts are 2, and the nights are the 5 N and the N12.
    expect(screen.getByTestId('totals-A')).toHaveTextContent(
      '143 / 157,5 -14,5 2 6 R1 1 · R2 2 · O20 3 · O 4 · N 5',
    );
    expect(screen.getByTestId('totals-B')).toHaveTextContent(
      '0 / 157,5 -157,5 0 0 R1 0 · R2 0 · O20 0 · O 0 · N 0',
    );
  });

  it('name their columns in the head', () => {
    renderMonth(plan(1));
    for (const label of ['Hodiny / FPD', 'Přesčas', '12h', 'Noci']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('show overtime without a sign, and zero when the hours are the FPD', () => {
    const data = plan(2);
    data.months['2027-01'] = { status: 'draft', hoursAdjust: { A: -150, B: -150 } }; // FPD 7,5 h
    put(data, MONDAY, 'A', 'R1');
    put(data, '2027-01-05', 'A', 'R2');
    put(data, MONDAY, 'B', 'R1');
    renderMonth(data);
    expect(screen.getByTestId('totals-A')).toHaveTextContent(/^15 \/ 7,5 7,5 0 0 /);
    expect(screen.getByTestId('totals-B')).toHaveTextContent(/^7,5 \/ 7,5 0 0 0 /);
  });

  it('use the hours of the person in the month, and update with each edit', async () => {
    renderMonth(plan(1));
    expect(screen.getByTestId('totals-A')).toHaveTextContent(/^0 \/ 157,5 -157,5 /);
    await choose('A', MONDAY, 'R1');
    expect(screen.getByTestId('totals-A')).toHaveTextContent(/^7,5 \/ 157,5 -150 /);
    await choose('A', MONDAY, 'Vymazat');
    expect(screen.getByTestId('totals-A')).toHaveTextContent(/^0 \/ 157,5 /);
  });

  describe('mark the hours in red when they are below FPD', () => {
    /** The hours of person `id`: the `Hodiny / FPD` figure of the totals. */
    const hours = (id: PersonId) => within(screen.getByTestId(`totals-${id}`)).getByTitle('Hodiny / FPD');

    it('and only then: not at the FPD, not above it', () => {
      const data = plan(3);
      data.months['2027-01'] = { status: 'draft', hoursAdjust: { A: -150, B: -150, C: -150 } }; // FPD 7,5 h
      put(data, MONDAY, 'A', 'R1'); // 7,5 h: the FPD exactly
      put(data, MONDAY, 'B', 'R1');
      put(data, '2027-01-05', 'B', 'R2'); // 15 h: over it
      renderMonth(data); // C has nothing: 0 h
      expect(hours('A')).toHaveTextContent('7,5 / 7,5');
      expect(hours('A')).not.toHaveClass('below-fpd');
      expect(hours('B')).not.toHaveClass('below-fpd');
      expect(hours('C')).toHaveTextContent('0 / 7,5');
      expect(hours('C')).toHaveClass('below-fpd');
    });

    it('as the rule M6 does, which no cell shows: the hours, not a cell, turn red', () => {
      renderMonth(plan(2)); // both are below FPD, and Kontrola lists M6 for both
      expect(checks().getAllByRole('button', { name: /do FPD$/ })).toHaveLength(2);
      expect(hours('A')).toHaveClass('below-fpd');
      expect(hours('B')).toHaveClass('below-fpd');
      expect(document.querySelectorAll('.month-cell.must')).toHaveLength(0);
    });

    it('with each edit', async () => {
      const data = plan(1);
      data.months['2027-01'] = { status: 'draft', hoursAdjust: { A: -150 } }; // FPD 7,5 h
      renderMonth(data);
      expect(hours('A')).toHaveClass('below-fpd');
      await choose('A', MONDAY, 'R1');
      expect(hours('A')).not.toHaveClass('below-fpd');
      await choose('A', MONDAY, 'Vymazat');
      expect(hours('A')).toHaveClass('below-fpd');
    });

    it('not for a shortfall that is only the rounding of the sum, as M6 does not', () => {
      // 20 shifts of 7.1 h add up to 141.99999999999994, and the fund of the month is 142
      const data = plan(1);
      data.settings.shifts.R1 = { ...data.settings.shifts.R1, hours: 7.1 };
      data.settings.fpdHoursPerWeekday = 7.1;
      for (let day = 1; day <= 28; day++) {
        const date = `2027-02-${String(day).padStart(2, '0')}`;
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() % 6 !== 0; // not Sat, not Sun
        if (weekday) put(data, date, 'A', 'R1');
      }
      renderMonth(data, '2027-02');
      expect(hours('A')).toHaveTextContent('142 / 142');
      expect(hours('A')).not.toHaveClass('below-fpd');
      expect(checks().queryByText(/do FPD/)).toBeNull();
    });

    it('and the other figures of the totals stay as they were', () => {
      renderMonth(plan(1));
      const totals = screen.getByTestId('totals-A');
      for (const title of ['Přesčas', '12h', 'Noci']) {
        expect(within(totals).getByTitle(title)).not.toHaveClass('below-fpd');
      }
    });
  });

  describe('show the 12h figure as the counted shifts plus the claimed holiday shifts', () => {
    /** The 12h figure of person `id`, found by its title. */
    const figure = (id: PersonId, title = '12h') =>
      within(screen.getByTestId(`totals-${id}`)).getByTitle(title);
    const CLAIMED = (n: number) => `12h (z toho navíc zamluvené svátky: ${n})`;

    it('as the plain count, with the plain title, when no holiday shift is claimed', () => {
      const data = plan(2);
      for (const date of ['2027-01-02', '2027-01-03']) put(data, date, 'A', 'R12');
      put(data, '2027-01-09', 'A', 'R12', true); // pinned, but not on a holiday
      put(data, '2027-01-01', 'B', 'N12'); // on a holiday, but not pinned
      renderMonth(data);
      expect(figure('A')).toHaveTextContent(/^3$/);
      expect(figure('B')).toHaveTextContent(/^1$/);
      expect(within(screen.getByTestId('totals-A')).queryByText(/\+/)).toBeNull();
    });

    it('as 3+1 for three shifts and one claimed holiday shift, and says what the +1 is', () => {
      const data = plan(2);
      put(data, '2027-01-01', 'A', 'R12', true); // New Year's Day, entered by hand: claimed
      for (const date of ['2027-01-09', '2027-01-16', '2027-01-23']) put(data, date, 'A', 'R12');
      renderMonth(data);
      expect(figure('A', CLAIMED(1))).toHaveTextContent(/^3\+1$/);
      expect(within(screen.getByTestId('totals-A')).queryByTitle('12h')).toBeNull();
      expect(figure('B')).toHaveTextContent(/^0$/); // and the others read as they did
      // Four 12-hour shifts, one of them claimed: Kontrola lists no M5 for A.
      expect(checks().queryByText(/dvanáctihodinové směny \(max/)).toBeNull();
      expect(figure('A', CLAIMED(1))).not.toHaveClass('below-weekend'); // 3 are counted: enough
    });

    it('as 0+2 and in red for claimed holidays alone: they count toward nothing', () => {
      const data = plan(2);
      put(data, '2027-03-26', 'A', 'R12', true); // Good Friday
      put(data, '2027-03-29', 'A', 'N12', true); // Easter Monday
      renderMonth(data, '2027-03');
      expect(figure('A', CLAIMED(2))).toHaveTextContent(/^0\+2$/);
      expect(figure('A', CLAIMED(2))).toHaveClass('below-weekend');
      expect(checks().getByText('Operátor A: 0 víkendových směn (min. 2)')).toBeVisible();
    });

    it('with each edit', async () => {
      const data = plan(1);
      put(data, '2027-01-01', 'A', 'R12', true);
      renderMonth(data);
      expect(figure('A', CLAIMED(1))).toHaveTextContent(/^0\+1$/);
      await choose('A', '2027-01-09', 'R12');
      expect(figure('A', CLAIMED(1))).toHaveTextContent(/^1\+1$/);
      await choose('A', '2027-01-01', 'Vymazat');
      expect(figure('A')).toHaveTextContent(/^1$/);
    });
  });

  describe('mark the 12h figure in red when it is below the weekend minimum', () => {
    const twelve = (id: PersonId) => within(screen.getByTestId(`totals-${id}`)).getByTitle('12h');

    it('and only then: not at the minimum, not above it', () => {
      const data = plan(4);
      putNote(data, MONDAY, 'D', 480, 720); // a note changes nothing here
      put(data, '2027-01-02', 'B', 'R12');
      put(data, '2027-01-09', 'B', 'R12');
      for (const date of ['2027-01-02', '2027-01-09', '2027-01-16']) put(data, date, 'C', 'N12');
      put(data, '2027-01-02', 'A', 'R12'); // one: below the minimum of 2
      renderMonth(data); // D has none
      expect(twelve('A')).toHaveClass('below-weekend');
      expect(twelve('B')).not.toHaveClass('below-weekend');
      expect(twelve('C')).not.toHaveClass('below-weekend');
      expect(twelve('D')).toHaveClass('below-weekend');
    });

    it('as the rule M12 does, which no cell shows: the figure, not a cell, turns red', () => {
      renderMonth(plan(2)); // both are below the minimum, and Kontrola lists M12 for both
      const lines = checks().getAllByRole('button', { name: /víkendových směn \(min\. 2\)$/ });
      expect(lines).toHaveLength(2);
      expect(twelve('A')).toHaveClass('below-weekend');
      expect(twelve('B')).toHaveClass('below-weekend');
      expect(document.querySelectorAll('.month-cell.must')).toHaveLength(0);
    });

    it('as the minimum in the settings says: none at 0, the person with 2 at 3', () => {
      const data = plan(2);
      data.settings.minWeekendShifts = 0;
      put(data, '2027-01-02', 'B', 'R12');
      put(data, '2027-01-09', 'B', 'R12');
      const first = renderMonth(data);
      expect(twelve('A')).not.toHaveClass('below-weekend');
      expect(checks().queryByText(/víkendových směn/)).toBeNull();
      first.unmount();

      data.settings.minWeekendShifts = 3;
      renderMonth(data);
      expect(twelve('B')).toHaveClass('below-weekend');
      expect(checks().getByText('Operátor B: 2 víkendové směny (min. 3)')).toBeVisible();
    });

    it('not for a person at their own maximum, when that is below the minimum (R31)', () => {
      const data = plan(3);
      data.people[0].maxTwelve = 1; // A may work one 12-hour shift: one weekend shift is enough
      data.people[1].maxTwelve = 0; // B none at all: nothing is asked of B
      put(data, '2027-01-02', 'A', 'R12');
      renderMonth(data); // C has no maximum of their own, and no weekend shift
      expect(twelve('A')).not.toHaveClass('below-weekend');
      expect(twelve('B')).not.toHaveClass('below-weekend');
      expect(twelve('C')).toHaveClass('below-weekend');
      // Kontrola agrees: it lists M12 for C alone
      const lines = checks().getAllByRole('button', { name: /víkendových směn \(min\./ });
      expect(lines.map((line) => line.textContent)).toEqual([
        'Operátor C: 0 víkendových směn (min. 2)',
      ]);
    });

    it('with each edit', async () => {
      const data = plan(1);
      put(data, '2027-01-02', 'A', 'R12');
      renderMonth(data);
      expect(twelve('A')).toHaveClass('below-weekend');
      await choose('A', '2027-01-09', 'R12');
      expect(twelve('A')).not.toHaveClass('below-weekend');
      await choose('A', '2027-01-09', 'Vymazat');
      expect(twelve('A')).toHaveClass('below-weekend');
    });

    it('in the red of the hours, by the rule of the style sheet that they share', () => {
      // jsdom does not load the style sheet, so this reads it: both classes are in one rule.
      const css = readFileSync(join(import.meta.dirname, '../styles.css'), 'utf8');
      const rule = /\.below-fpd,\s*\.month-totals-grid \.below-weekend\s*\{([^}]*)\}/.exec(css);
      expect(rule?.[1]).toContain('color: var(--danger-text)');
    });

    it('apart from the hours, which are red for FPD alone', () => {
      const data = plan(1);
      data.months['2027-01'] = { status: 'draft', hoursAdjust: { A: -150 } }; // FPD 7,5 h
      put(data, '2027-01-04', 'A', 'R1'); // at FPD, and no weekend shift
      renderMonth(data);
      const totals = within(screen.getByTestId('totals-A'));
      expect(totals.getByTitle('12h')).toHaveClass('below-weekend');
      expect(totals.getByTitle('Hodiny / FPD')).not.toHaveClass('below-fpd');
      expect(totals.getByTitle('Hodiny / FPD')).not.toHaveClass('below-weekend');
    });
  });

  it('use the days that the person is in the team for the FPD', () => {
    const data = plan(2);
    data.people[1].activeFrom = '2027-01-15'; // Mon-Fri days from the 15th: 11 of them
    renderMonth(data);
    expect(screen.getByTestId('totals-B')).toHaveTextContent(/^0 \/ 82,5 /);
  });

  it('do not count the tail', () => {
    const data = plan(1);
    put(data, '2026-12-31', 'A', 'N');
    renderMonth(data);
    expect(screen.getByTestId('totals-A')).toHaveTextContent(/^0 \/ 157,5 -157,5 0 0 /);
  });
});

// --- The coverage row -------------------------------------------------------------------------

describe('the coverage row', () => {
  it('is called Obsazeno', () => {
    renderMonth(plan(1));
    expect(screen.getByRole('rowheader', { name: 'Obsazeno' })).toBeInTheDocument();
  });

  it('says ✓ for a covered day, and what is wrong with the others, joined with a comma', () => {
    const data = plan();
    for (const [person, code] of [
      ['A', 'R1'], ['B', 'R2'], ['C', 'O20'], ['D', 'O'], ['E', 'N'],
    ] as const) {
      put(data, '2027-01-05', person, code); // everything there
    }
    for (const [person, code] of [
      ['A', 'R1'], ['B', 'R1'], ['C', 'R2'], ['D', 'O20'], ['E', 'O'], ['F', 'N'],
    ] as const) {
      put(data, '2027-01-06', person, code); // R1 twice
    }
    for (const [person, code] of [['B', 'R2'], ['C', 'O20'], ['D', 'O']] as const) {
      put(data, '2027-01-07', person, code); // no R1 and no N
    }
    put(data, '2027-01-09', 'A', 'R12'); // a Saturday: N12 is missing
    put(data, '2027-01-10', 'A', 'R12');
    put(data, '2027-01-10', 'B', 'N12'); // a Sunday: both there
    renderMonth(data);

    expect(screen.getByTestId('coverage-2027-01-05')).toHaveTextContent(/^✓$/);
    expect(screen.getByTestId('coverage-2027-01-05')).not.toHaveClass('short');
    expect(screen.getByTestId('coverage-2027-01-06')).toHaveClass('short'); // red in the page
    expect(screen.getByTestId('coverage-2027-01-06')).toHaveTextContent(/^R1 2×$/);
    expect(screen.getByTestId('coverage-2027-01-07')).toHaveTextContent(/^chybí R1, chybí N$/);
    expect(screen.getByTestId('coverage-2027-01-04')).toHaveTextContent(
      'chybí R1, chybí R2, chybí O20, chybí O, chybí N',
    );
    expect(screen.getByTestId('coverage-2027-01-09')).toHaveTextContent(/^chybí N12$/);
    expect(screen.getByTestId('coverage-2027-01-10')).toHaveTextContent(/^✓$/);
    expect(screen.getByTestId('coverage-2027-01-02')).toHaveTextContent(
      /^chybí R12, chybí N12$/,
    );
  });

  it('is empty for the days of the previous month', () => {
    renderMonth(plan(2));
    for (const day of ['25', '28', '31']) {
      expect(screen.getByTestId(`coverage-2026-12-${day}`)).toBeEmptyDOMElement();
    }
    expect(screen.getByTestId('coverage-2027-01-01')).not.toBeEmptyDOMElement();
  });

  it('follows the edits of a day', async () => {
    renderMonth(plan(2));
    await choose('A', '2027-01-09', 'R12');
    expect(screen.getByTestId('coverage-2027-01-09')).toHaveTextContent(/^chybí N12$/);
    await choose('B', '2027-01-09', 'N12');
    expect(screen.getByTestId('coverage-2027-01-09')).toHaveTextContent(/^✓$/);
  });

  it('says nothing of a must that is not about coverage', () => {
    renderMonth(oneMustOneWish()); // a rest that is too short on 1 January, where no shift is asked
    expect(screen.getByTestId('coverage-2027-01-01')).toHaveTextContent(/^✓$/);
  });

  it('ignores a coverage that the settings do not ask for', () => {
    renderMonth(calm(2));
    expect(screen.getByTestId('coverage-2027-01-04')).toHaveTextContent(/^✓$/);
  });
});

// --- Kontrola ---------------------------------------------------------------------------------

/**
 * C has an O on 31 December and an R12 on 1 January: only 8 h of rest, so one must is broken. A
 * has one 12-hour shift more than the rest in the counts brought in, so one wish is shown.
 */
function oneMustOneWish(): AppData {
  const data = calm();
  data.settings.wishLevels.W7 = 3;
  data.people[0].startingCounts.twelve = 2;
  put(data, '2026-12-31', 'C', 'O');
  put(data, '2027-01-01', 'C', 'R12');
  return data;
}

/** Three people on R2 on each of `dates`: days far from the mean of R2, a wish of the team (W9). */
function crowdedR2(...dates: ISODate[]): AppData {
  const data = calm();
  data.settings.wishLevels.W9 = 3;
  for (const date of dates) for (const person of ['A', 'B', 'C']) put(data, date, person, 'R2');
  return data;
}

const M2_LINE = 'Operátor C · 1. 1.: R12 hned po O: jen 8 h odpočinku (min. 12 h)';
const W7_LINE = 'Operátor A: víc dvanáctihodinových směn než ostatní';
const S1_LINE = 'Operátor A · 27. 1.: noční směna, ale noční nechce';

/**
 * One line of each kind: a must (M2 for C), a wish on the 4th (W9, three people on R2) and, later
 * in the month, a strong wish: A never works nights, and has an N on the 27th.
 */
function strongBetween(): AppData {
  const data = crowdedR2(MONDAY);
  put(data, '2026-12-31', 'C', 'O');
  put(data, '2027-01-01', 'C', 'R12');
  put(data, '2027-01-27', 'A', 'N');
  return data;
}

describe('Kontrola', () => {
  it('is a region with a heading, and the number of musts and wishes', () => {
    renderMonth(oneMustOneWish());
    expect(screen.getByRole('region', { name: 'Kontrola' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kontrola' })).toBeInTheDocument();
    expect(checks().getByText('Musí: 1 · Přání: 1')).toBeInTheDocument();
  });

  it('lists the musts first, then the wishes', () => {
    renderMonth(oneMustOneWish());
    expect(lines()).toEqual([M2_LINE, W7_LINE]);
  });

  it('colours a must red and a wish amber', () => {
    renderMonth(oneMustOneWish());
    const [must, wish] = checks().getAllByRole('button');
    expect(must).toHaveAttribute('data-severity', 'must');
    expect(wish).toHaveAttribute('data-severity', 'wish');
  });

  it('a strong wish is listed before the wishes, and after the musts, whatever the days', () => {
    renderMonth(strongBetween());
    // The wish is on the 4th and the strong wish on the 27th: the order is not the days'.
    expect(lines()).toEqual([M2_LINE, S1_LINE, '4. 1.: nevyrovnaný počet R2']);
  });

  it('counts a strong wish as a wish in the summary', () => {
    renderMonth(strongBetween());
    expect(checks().getByText('Musí: 1 · Přání: 2')).toBeInTheDocument();
  });

  it('colours a strong wish amber like the wishes, and marks it as strong', () => {
    renderMonth(strongBetween());
    const [must, strong, wish] = checks().getAllByRole('button');
    expect(must).toHaveAttribute('data-severity', 'must');
    expect(strong).toHaveAttribute('data-severity', 'wish'); // amber, not the red of a must
    expect(strong).toHaveAttribute('data-strong');
    expect(wish).toHaveAttribute('data-severity', 'wish');
    expect(must).not.toHaveAttribute('data-strong');
    expect(wish).not.toHaveAttribute('data-strong');
  });

  it('lists a strong wish alone as a wish, and outlines its cell when picked', async () => {
    const data = calm();
    put(data, '2027-01-27', 'A', 'N'); // A never works nights
    renderMonth(data);
    expect(lines()).toEqual([S1_LINE]);
    expect(checks().getByText('Musí: 0 · Přání: 1')).toBeInTheDocument();
    expect(cell('A', '2027-01-27')).not.toHaveClass('must'); // a wish gets no red outline
    await userEvent.click(checks().getByText(S1_LINE));
    expect(cell('A', '2027-01-27')).toHaveClass('flagged');
  });

  it('goes when the night does', async () => {
    const data = calm();
    put(data, '2027-01-27', 'A', 'N');
    renderMonth(data);
    await choose('A', '2027-01-27', 'Vymazat');
    expect(lines()).toEqual([]);
  });

  it('puts the musts of every kind before every wish, whatever the day', () => {
    const data = oneMustOneWish();
    put(data, '2027-01-28', 'D', 'R12'); // a must late in the month: a Thursday is no 12-hour day
    renderMonth(data);
    const found = lines();
    expect(found).toHaveLength(3);
    expect(found.at(-1)).toBe(W7_LINE);
    expect(found[0]).toBe(M2_LINE);
    expect(found[1]).toBe('Operátor D · 28. 1.: R12 nepatří na všední den');
  });

  it('names the person and the first day of the month that the finding touches', async () => {
    const data = calm();
    put(data, '2027-01-06', 'C', 'O');
    put(data, '2027-01-07', 'C', 'R1');
    renderMonth(data);
    // The cells are the 6th and the 7th: the line has the 6th.
    expect(lines()).toEqual(['Operátor C · 6. 1.: R1 hned po O: jen 8 h odpočinku (min. 12 h)']);
  });

  it('takes the 1st of the month for a finding that begins in the tail', () => {
    renderMonth(oneMustOneWish());
    // The finding's cells are 31 December and 1 January: 31 December is not a day of the month.
    expect(lines()[0]).toBe(M2_LINE);
    expect(screen.queryByText(/31\. 12\./, { selector: 'button' })).toBeNull();
  });

  it('lists the last day of the month against what is stored for the day after it', () => {
    // 1 February is not on this screen, but a request or a shift stored there still matters.
    const data = calm();
    put(data, '2027-01-31', 'C', 'N12');
    put(data, '2027-02-01', 'C', 'x');
    put(data, '2027-01-31', 'D', 'N12');
    put(data, '2027-02-01', 'D', 'R1');
    renderMonth(data);
    expect(lines()).toEqual([
      'Operátor C · 31. 1.: noční N12 končí ráno 1. 2., kdy je x',
      'Operátor D · 31. 1.: R1 1. 2. hned po N12: jen 0 h odpočinku (min. 12 h)',
    ]);
    expect(checks().getByText('Musí: 2 · Přání: 0')).toBeInTheDocument();
    expect(cell('C', '2027-01-31')).toHaveClass('must'); // the last day is outlined
    expect(cell('D', '2027-01-31')).toHaveClass('must');
  });

  it('does not list the last day against a day after it on which the person has left the team', () => {
    const data = calm();
    data.people[2].activeTo = '2027-01-31'; // C
    put(data, '2027-01-31', 'C', 'N12');
    put(data, '2027-02-01', 'C', 'x');
    renderMonth(data);
    expect(lines()).toEqual([]);
    expect(checks().getByText('Musí: 0 · Přání: 0')).toBeInTheDocument();
  });

  it('reads the name alone for a person finding that has no day', () => {
    renderMonth(plan(2)); // no hours: both are below FPD (rule M6)
    expect(checks().getByText('Operátor A: 0 h z 157,5 h: chybí 157,5 h do FPD')).toBeVisible();
    expect(checks().getByText('Operátor B: 0 h z 157,5 h: chybí 157,5 h do FPD')).toBeVisible();
  });

  it('reads the date and the message for a finding about the team, with no name', () => {
    const data = calm();
    data.settings.coverage.R1 = { min: 1, max: 1 }; // R1 is asked on every weekday: no one has it
    renderMonth(data);
    // The gaps of different days read differently: each line has the day of its gap.
    const weekdays = [4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22, 25, 26, 27, 28, 29];
    expect(lines()).toEqual(weekdays.map((day) => `${day}. 1.: chybí R1`));
    expect(checks().getByText('4. 1.: chybí R1')).toBeVisible();
    expect(checks().getByText('5. 1.: chybí R1')).toBeVisible();
  });

  it('tells the gaps of a month with nothing in it apart by their days', () => {
    renderMonth(plan(2));
    const gaps = lines().filter((line) => /: chybí R1$/.test(line ?? ''));
    expect(gaps).toHaveLength(20); // one for each weekday of January
    expect(new Set(gaps).size).toBe(20); // and no two read alike
    const twelve = lines().filter((line) => /: chybí R12$/.test(line ?? ''));
    expect(twelve).toHaveLength(11); // and one for each 12-hour day
    expect(new Set(twelve).size).toBe(11);
  });

  it('keeps the message alone for a finding about the team that names no day', () => {
    // O20 is disliked by A, D and F (W8): A works it twice and they do not. No person, no day.
    const data = calm();
    data.settings.wishLevels.W8 = 3;
    put(data, MONDAY, 'A', 'O20');
    put(data, '2027-01-05', 'A', 'O20');
    renderMonth(data);
    expect(lines()).toEqual(['směny O20 rozdělené nerovnoměrně mezi ty, kdo je nemají rádi']);
    expect(checks().getByText('Musí: 0 · Přání: 1')).toBeInTheDocument();
  });

  it('reads the date once for a wish about the team that names a day', () => {
    renderMonth(crowdedR2(MONDAY));
    expect(lines()).toEqual(['4. 1.: nevyrovnaný počet R2']);
    expect(checks().getByText('Musí: 0 · Přání: 1')).toBeInTheDocument();
  });

  it('lists the dates of every day that a wish about the team names, in day order', () => {
    renderMonth(crowdedR2('2027-01-11', MONDAY));
    expect(lines()).toEqual(['4. 1., 11. 1.: nevyrovnaný počet R2']);
  });

  it('writes the month of a date as a number, however many digits', () => {
    renderMonth(crowdedR2('2027-10-04'), '2027-10');
    expect(lines()).toEqual(['4. 10.: nevyrovnaný počet R2']);
  });

  it('hides a finding that only explains the score, and does not count it', () => {
    const data = calm();
    data.settings.wishLevels.W7 = 3;
    data.people[0].startingCounts.twelve = 1; // under 1 above the mean: a quiet W7 for everyone
    renderMonth(data);
    expect(evaluateMonth).toHaveBeenCalled();
    const { findings } = vi.mocked(evaluateMonth).mock.results[0].value as ReturnType<
      typeof evaluateMonth
    >;
    expect(findings.filter((f) => f.quiet === true)).toHaveLength(8); // the engine has them
    expect(lines()).toEqual([]);
    expect(checks().getByText('Musí: 0 · Přání: 0')).toBeInTheDocument();
  });

  it('shows the same finding once it is more than 1 above the mean, and counts it', () => {
    const data = calm();
    data.settings.wishLevels.W7 = 3;
    data.people[0].startingCounts.twelve = 2;
    renderMonth(data);
    expect(lines()).toEqual([W7_LINE]);
    expect(checks().getByText('Musí: 0 · Přání: 1')).toBeInTheDocument();
  });

  it('counts the findings, not the units: three people on R1 are one must', () => {
    const data = calm();
    data.settings.coverage.R1 = { min: 0, max: 1 };
    for (const person of ['A', 'B', 'C']) put(data, MONDAY, person, 'R1');
    renderMonth(data);
    expect(lines()).toEqual(['4. 1.: R1 3×']); // two too many, on the 4th
    expect(checks().getByText('Musí: 1 · Přání: 0')).toBeInTheDocument();
  });

  it('is up to date after an edit', async () => {
    renderMonth(calm());
    expect(checks().getByText('Musí: 0 · Přání: 0')).toBeInTheDocument();
    await choose('C', '2027-01-06', 'O');
    await choose('C', '2027-01-07', 'R1');
    expect(checks().getByText('Musí: 1 · Přání: 0')).toBeInTheDocument();
    await choose('C', '2027-01-07', 'O20'); // 14 h of rest
    expect(checks().getByText('Musí: 0 · Přání: 0')).toBeInTheDocument();
    expect(lines()).toEqual([]);
  });
});

describe('the checks of a month', () => {
  const finding: Finding = {
    rule: 'W1',
    severity: 'wish',
    person: 0,
    days: [],
    message: 'přesčas 1 h',
    penalty: 1,
  };
  const names = ['Operátor A', 'Operátor B'];
  const ctx = () => buildMonthGrid(plan(2), '2027-01').ctx;

  it('give each line a key of its own, even for findings that are the same', () => {
    const checks = checksOf([finding, { ...finding }, { ...finding }], ctx(), names);
    expect(checks.map((check) => check.text)).toHaveLength(3);
    expect(new Set(checks.map((check) => check.key)).size).toBe(3);
  });

  it('name a finding by what it is, so that its key is the same the next time', () => {
    const other = { ...finding, person: 1, message: 'přesčas 2 h' };
    const first = checksOf([finding, other], ctx(), names);
    const later = checksOf([other, finding], ctx(), names); // in another order
    expect(first.map((check) => check.key).sort()).toEqual(later.map((check) => check.key).sort());
    expect(first[0].key).not.toBe(first[1].key);
  });

  /** The text of the line of a finding that is `patch` laid over the one above. */
  const textOf = (patch: Partial<Finding>) =>
    checksOf([{ ...finding, ...patch }], ctx(), names)[0].text;

  it('date a finding about the team by every day of the month that it names', () => {
    // The days are indices in `ctx.days`: 0 to 6 are 25 to 31 December, 7 is 1 January.
    const team = { person: null, rule: 'M1', severity: 'must', message: 'chybí R1' } as const;
    expect(textOf({ ...team, days: [10] })).toBe('4. 1.: chybí R1');
    expect(textOf({ ...team, days: [7] })).toBe('1. 1.: chybí R1');
    expect(textOf({ ...team, days: [9, 10] })).toBe('3. 1., 4. 1.: chybí R1');
    expect(textOf({ ...team, days: [3, 9] })).toBe('3. 1.: chybí R1'); // the tail day is no date
    expect(textOf({ ...team, days: [2, 3, 8, 14, 20] })).toBe('2. 1., 8. 1., 14. 1.: chybí R1');
  });

  it('put the dates of a finding about the team in day order, and leave its days alone', () => {
    const days = [14, 9, 10];
    const [check] = checksOf(
      [{ ...finding, person: null, message: 'nevyrovnaný počet R2', days }],
      ctx(),
      names,
    );
    expect(check.text).toBe('3. 1., 4. 1., 8. 1.: nevyrovnaný počet R2');
    expect(days).toEqual([14, 9, 10]); // the finding is not changed
  });

  it('keep the message alone for a finding about the team with no day in the month', () => {
    const team = { person: null, message: 'rozdělené nerovnoměrně' } as const;
    expect(textOf({ ...team, days: [] })).toBe('rozdělené nerovnoměrně');
    expect(textOf({ ...team, days: [2, 6] })).toBe('rozdělené nerovnoměrně'); // 27 and 31 Dec
  });

  it('leave the line of a finding about a person as it was: name, date, message', () => {
    expect(textOf({ days: [9, 10] })).toBe('Operátor A · 3. 1.: přesčas 1 h');
    expect(textOf({ days: [3, 9] })).toBe('Operátor A · 3. 1.: přesčas 1 h');
    expect(textOf({ days: [] })).toBe('Operátor A: přesčas 1 h');
    expect(textOf({ days: [3, 6] })).toBe('Operátor A: přesčas 1 h'); // the tail only
    expect(textOf({ person: 1, days: [10] })).toBe('Operátor B · 4. 1.: přesčas 1 h');
  });

  it('put the strong wishes between the musts and the other wishes, in any order', () => {
    const must: Finding = { ...finding, rule: 'M6', severity: 'must', message: 'chybí h' };
    const strong: Finding = { ...finding, rule: 'S1', strong: true, message: 'noční' };
    const early: Finding = { ...finding, message: 'brzy', days: [8] };
    // Each group keeps the order it came in: the wishes are `early`, then `finding`.
    const checks = checksOf([early, finding, strong, must], ctx(), names);
    expect(checks.map((check) => check.finding.message)).toEqual([
      'chybí h',
      'noční',
      'brzy',
      'přesčas 1 h',
    ]);
  });

  it('take the order of the tiers from the engine, not from a copy of its rule', () => {
    const must: Finding = { ...finding, rule: 'M6', severity: 'must', message: 'chybí h' };
    const strong: Finding = { ...finding, rule: 'S1', strong: true, message: 'noční' };
    // The engine with its tiers turned round: wishes, then strong wishes, then musts.
    const real = engine.tier;
    vi.spyOn(engine, 'tier').mockImplementation((f) => 2 - real(f));
    const checks = checksOf([must, strong, finding], ctx(), names);
    const messages = checks.map((check) => check.finding.message);
    expect(messages).toEqual(['přesčas 1 h', 'noční', 'chybí h']);
  });

  it('leave out the quiet findings and put the musts first', () => {
    const must: Finding = { ...finding, rule: 'M6', severity: 'must', message: 'chybí h' };
    const quiet: Finding = { ...finding, rule: 'W7', message: 'tiše', quiet: true };
    const checks = checksOf([finding, quiet, must], ctx(), names);
    expect(checks.map((check) => check.finding.message)).toEqual(['chybí h', 'přesčas 1 h']);
  });
});

describe('the outlines in the grid', () => {
  it('give every cell of a broken must a red outline, the tail among them', () => {
    renderMonth(oneMustOneWish());
    expect(cell('C', '2026-12-31')).toHaveClass('must');
    expect(cell('C', '2027-01-01')).toHaveClass('must');
    expect(cell('C', '2027-01-02')).not.toHaveClass('must');
    expect(cell('A', '2027-01-01')).not.toHaveClass('must');
  });

  it('go when the must is fixed, and come with a new one', async () => {
    renderMonth(oneMustOneWish());
    await choose('C', '2027-01-01', 'N12'); // 20 h of rest after the O
    expect(cell('C', '2026-12-31')).not.toHaveClass('must');
    expect(cell('C', '2027-01-01')).not.toHaveClass('must');

    await choose('C', '2027-01-01', 'R12');
    expect(cell('C', '2027-01-01')).toHaveClass('must');
  });

  it('are given for every 12-hour shift of the person, for too many of them', () => {
    const data = calm();
    for (const date of ['2027-01-02', '2027-01-03', '2027-01-09', '2027-01-10']) {
      put(data, date, 'D', 'R12');
    }
    renderMonth(data);
    expect(lines()).toEqual(['Operátor D · 2. 1.: 4 dvanáctihodinové směny (max. 3)']);
    for (const date of ['2027-01-02', '2027-01-03', '2027-01-09', '2027-01-10']) {
      expect(cell('D', date)).toHaveClass('must');
    }
    expect(cell('D', '2027-01-16')).not.toHaveClass('must');
  });

  it('are not given for a wish, though the wish names days', () => {
    const data = calm();
    data.settings.wishLevels.W2 = 3; // a block of one shift should last 4 days
    put(data, '2027-01-05', 'A', 'R1'); // one day of R1 and no more
    renderMonth(data);
    expect(lines()).toEqual(['Operátor A · 5. 1.: krátký blok R1 (jen 1 den)']);
    expect(cell('A', '2027-01-05')).not.toHaveClass('must');
  });

  it('are not given to a cell by a finding about a day: the coverage row says it', () => {
    renderMonth(plan(2));
    expect(cell('A', MONDAY)).not.toHaveClass('must');
  });
});

describe('selecting a line of Kontrola', () => {
  const line = (text: string) => checks().getByText(text);

  it('gives the cells of the finding an amber outline, and the line is marked', async () => {
    renderMonth(oneMustOneWish());
    expect(line(M2_LINE)).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(line(M2_LINE));
    expect(line(M2_LINE)).toHaveAttribute('aria-pressed', 'true');
    expect(cell('C', '2026-12-31')).toHaveClass('flagged');
    expect(cell('C', '2027-01-01')).toHaveClass('flagged');
    expect(cell('C', '2027-01-02')).not.toHaveClass('flagged');
    expect(cell('A', '2027-01-01')).not.toHaveClass('flagged');
    expect(cell('C', '2027-01-01')).toHaveClass('must'); // the red outline stays
  });

  it('is undone by a second click, and moves to another line that is clicked', async () => {
    renderMonth(oneMustOneWish());
    await userEvent.click(line(M2_LINE));
    await userEvent.click(line(M2_LINE));
    expect(line(M2_LINE)).toHaveAttribute('aria-pressed', 'false');
    expect(cell('C', '2027-01-01')).not.toHaveClass('flagged');

    await userEvent.click(line(M2_LINE));
    await userEvent.click(line(W7_LINE));
    expect(line(M2_LINE)).toHaveAttribute('aria-pressed', 'false');
    expect(line(W7_LINE)).toHaveAttribute('aria-pressed', 'true');
    expect(cell('C', '2027-01-01')).not.toHaveClass('flagged');
  });

  it('gives the cells of a wish an amber outline too, and not a red one', async () => {
    const data = calm();
    data.settings.wishLevels.W2 = 3;
    put(data, '2027-01-05', 'A', 'R1');
    renderMonth(data);
    await userEvent.click(line('Operátor A · 5. 1.: krátký blok R1 (jen 1 den)'));
    expect(cell('A', '2027-01-05')).toHaveClass('flagged');
    expect(cell('A', '2027-01-05')).not.toHaveClass('must');
    expect(cell('A', '2027-01-06')).not.toHaveClass('flagged');
  });

  it('stays selected through an edit that leaves the finding as it is', async () => {
    renderMonth(oneMustOneWish());
    await userEvent.click(line(M2_LINE));
    await choose('B', MONDAY, 'R1'); // nothing to do with C's rest
    expect(line(M2_LINE)).toHaveAttribute('aria-pressed', 'true');
    expect(cell('C', '2027-01-01')).toHaveClass('flagged');
  });

  it('is gone with the finding, when the finding is fixed', async () => {
    renderMonth(oneMustOneWish());
    await userEvent.click(line(M2_LINE));
    await choose('C', '2027-01-01', 'N12');
    expect(screen.queryByText(M2_LINE)).toBeNull();
    expect(cell('C', '2027-01-01')).not.toHaveClass('flagged');
  });

  it('marks the person of a finding that has no cell, by their name', async () => {
    renderMonth(oneMustOneWish());
    const name = screen.getByRole('rowheader', { name: 'Operátor A' });
    expect(name).not.toHaveClass('flagged');
    await userEvent.click(line(W7_LINE));
    expect(name).toHaveClass('flagged');
    expect(screen.getByRole('rowheader', { name: 'Operátor C' })).not.toHaveClass('flagged');
  });

  it('marks the days of a finding about the team in the coverage row', async () => {
    const data = calm();
    data.settings.coverage.R1 = { min: 0, max: 1 };
    for (const person of ['A', 'B']) put(data, MONDAY, person, 'R1');
    renderMonth(data);
    const coverage = screen.getByTestId('coverage-2027-01-04');
    expect(coverage).not.toHaveClass('flagged');
    await userEvent.click(checks().getByText('4. 1.: R1 2×'));
    expect(coverage).toHaveClass('flagged');
    expect(screen.getByTestId('coverage-2027-01-05')).not.toHaveClass('flagged');
    expect(cell('A', MONDAY)).not.toHaveClass('flagged');
  });

  it('marks each day that a line about the team names, in the coverage row', async () => {
    renderMonth(crowdedR2(MONDAY, '2027-01-11'));
    await userEvent.click(line('4. 1., 11. 1.: nevyrovnaný počet R2'));
    for (const date of [MONDAY, '2027-01-11']) {
      expect(screen.getByTestId(`coverage-${date}`)).toHaveClass('flagged');
    }
    expect(screen.getByTestId('coverage-2027-01-05')).not.toHaveClass('flagged');
  });

  it('is cleared when the month changes', async () => {
    renderMonth(oneMustOneWish());
    await userEvent.click(line(W7_LINE));
    await next();
    await previous();
    expect(line(W7_LINE)).toHaveAttribute('aria-pressed', 'false');
  });

  it('is a button that the keyboard reaches', async () => {
    renderMonth(oneMustOneWish());
    line(M2_LINE).focus();
    await userEvent.keyboard('{Enter}');
    expect(line(M2_LINE)).toHaveAttribute('aria-pressed', 'true');
  });

  it('closes the open menu, since the click is outside it', async () => {
    renderMonth(oneMustOneWish());
    await userEvent.click(cell('A', MONDAY));
    await userEvent.click(line(M2_LINE));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(line(M2_LINE)).toHaveAttribute('aria-pressed', 'true');
  });
});

// --- Work and wiring --------------------------------------------------------------------------

describe('the work the screen does', () => {
  it('builds and evaluates the month again only when the data or the month change', async () => {
    renderMonth();
    const builds = () => vi.mocked(buildMonthGrid).mock.calls.length;
    const evaluations = () => vi.mocked(evaluateMonth).mock.calls.length;
    const [built, evaluated] = [builds(), evaluations()];
    expect(built).toBeGreaterThan(0);
    expect(evaluated).toBeGreaterThan(0);

    // Selecting, opening and closing a menu, and picking a line of Kontrola: no new work.
    await userEvent.click(cell('A', MONDAY));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(cell('A', '2027-01-05'));
    await userEvent.click(checks().getAllByRole('button')[0]);
    expect([builds(), evaluations()]).toEqual([built, evaluated]);

    await userEvent.click(cell('A', '2027-01-05'));
    await userEvent.click(item('R1')); // an edit changes the data
    expect([builds(), evaluations()]).toEqual([built + 1, evaluated + 1]);

    await next(); // so does another month
    expect([builds(), evaluations()]).toEqual([built + 2, evaluated + 2]);
  });
});

describe('the Měsíc tab', () => {
  it('shows the month screen, with next month', () => {
    vi.setSystemTime(new Date(2026, 10, 5, 10, 0));
    render(
      <AppProvider storage={memoryStorage(plan(2))} runner={inProcessRunner}>
        <App />
      </AppProvider>,
    );
    // The panels of the other tabs stay in the page, hidden: ask the one that is shown.
    const panel = within(screen.getByRole('tabpanel'));
    expect(panel.getByRole('heading', { name: 'Prosinec 2026' })).toBeInTheDocument();
    expect(panel.getByRole('region', { name: 'Kontrola' })).toBeInTheDocument();
    expect(panel.queryByText('Připravuje se…')).toBeNull();
  });

  it('keeps the month it shows while another tab is open', async () => {
    vi.setSystemTime(new Date(2026, 10, 5, 10, 0));
    render(
      <AppProvider storage={memoryStorage(plan(2))} runner={inProcessRunner}>
        <App />
      </AppProvider>,
    );
    const shown = () => within(screen.getByRole('tabpanel'));
    await userEvent.click(shown().getByText('▶'));
    expect(shown().getByRole('heading', { level: 2 })).toHaveTextContent('Leden 2027');
    await userEvent.click(screen.getByRole('tab', { name: 'Tým' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Měsíc' }));
    expect(shown().getByRole('heading', { level: 2 })).toHaveTextContent('Leden 2027');
  });

  it('closes a menu that is open when another tab is clicked', async () => {
    vi.setSystemTime(new Date(2026, 10, 5, 10, 0)); // December 2026 is shown
    render(
      <AppProvider storage={memoryStorage(plan(2))} runner={inProcessRunner}>
        <App />
      </AppProvider>,
    );
    const panel = within(screen.getByRole('tabpanel'));
    await userEvent.click(panel.getByTestId('cell-A-2026-12-07'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Tým' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('the page as it runs', () => {
  it('works under StrictMode, which renders everything twice', async () => {
    render(
      <StrictMode>
        <AppProvider storage={memoryStorage(plan(2))} runner={inProcessRunner}>
          <MonthScreen initialMonth="2027-01" />
          <Probe />
        </AppProvider>
      </StrictMode>,
    );
    await choose('A', MONDAY, 'R1');
    expect(stored(MONDAY, 'A')).toStrictEqual({ code: 'R1', pinned: true });
    await userEvent.click(cell('A', MONDAY));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await next();
    expect(heading()).toBe('Únor 2027');
  });
});
