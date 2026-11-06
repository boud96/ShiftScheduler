// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { Code } from '../../domain/codes';
import type { CodeInt } from '../../domain/codes';
import { newAppData } from '../../domain/defaults';
import type { AppData, CodeName, ISODate, MonthKey, PersonId } from '../../domain/types';
import type { SearchResult } from '../../generator/search';
import { memoryStorage } from '../../storage/adapter';
import { scenario } from '../../test/scenarios';
import { syntheticTeam } from '../../test/team';
import { inProcessRunner } from '../../worker/runner';
import type { GeneratorInput, GeneratorRunner } from '../../worker/runner';
import { App } from '../App';
import { AppProvider, useApp } from '../store';
import { MonthScreen } from './MonthScreen';

// A warning from React, or an error from jsdom, would end up in the output: the tests fail on it.
let errors: MockInstance;

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  // jsdom has neither a Clipboard API nor document.execCommand: what a test puts there goes again.
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
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

/** Stores `code` for `person` on `date`. */
function put(data: AppData, date: ISODate, person: PersonId, code: CodeName, pinned = false) {
  (data.cells[date] ??= {})[person] = pinned ? { code, pinned } : { code };
}

interface RenderOptions {
  month?: MonthKey;
  runner?: GeneratorRunner;
  strict?: boolean;
}

function renderMonth(
  data: AppData = plan(),
  { month = '2027-01', runner = inProcessRunner, strict = false }: RenderOptions = {},
) {
  const tree = (
    <AppProvider storage={memoryStorage(data)} runner={runner}>
      <MonthScreen initialMonth={month} />
      <Probe />
    </AppProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const COPIED = 'Zkopírováno – vložte do řádku směna v Excelu';
const FAILED = 'Kopírování se nepodařilo.';
const NAMES_LINE = 'První sloupec vypadá jako jména, vynechá se.';

const cell = (person: PersonId, date: ISODate) => screen.getByTestId(`cell-${person}-${date}`);
const stored = (date: ISODate, person: PersonId) => (app.data as AppData).cells[date]?.[person];
const next = () => userEvent.click(screen.getByText('▶'));

const opener = () => screen.getByRole('button', { name: 'Vložit z Excelu' });
const dialog = () => screen.getByRole('dialog', { name: 'Vložit z Excelu' });
const area = () => within(dialog()).getByLabelText('Sem vložte buňky z Excelu (Ctrl+V)');
const apply = () => within(dialog()).getByRole('button', { name: 'Použít' });
const cancel = () => within(dialog()).getByRole('button', { name: 'Zrušit' });
const summary = () => within(dialog()).getByText(/^Rozpoznáno:/);
const ignored = () => within(dialog()).queryAllByRole('listitem').map((item) => item.textContent);

const open = () => userEvent.click(opener());
/** Pastes into the focused field, as Ctrl+V does. */
const paste = (text: string) => userEvent.paste(text);
/** Sets the whole text of the field at once: the way to put tabs and line breaks in by hand. */
const setText = (value: string) => fireEvent.change(area(), { target: { value } });

const copyButton = (name: string) =>
  screen.getByRole('button', { name: `Kopírovat řádek ${name}` });
const note = (text: string) => screen.queryByText(text);

type WriteText = (text: string) => Promise<void>;

/**
 * Gives the page a Clipboard API whose writeText is `writeText`. `undefined` takes the API away, as
 * it is on a page that is not a secure context.
 */
function setClipboard(writeText: WriteText | undefined): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText === undefined ? undefined : { writeText },
  });
}

/**
 * Puts a `document.execCommand` on the page, which jsdom lacks. `copied` collects what a `copy`
 * finds selected in the focused field, the text a browser would put on the clipboard.
 */
function setCommand(run: () => boolean = () => true) {
  const copied: string[] = [];
  const command = vi.fn((name: string) => {
    const field = document.activeElement;
    if (name === 'copy' && field instanceof HTMLTextAreaElement) {
      copied.push(field.value.slice(field.selectionStart, field.selectionEnd));
    }
    return run();
  });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: command });
  return { command, copied };
}

// --- The brief's tests -----------------------------------------------------------------------

describe('the brief', () => {
  it('pastes cells from Excel, starting at the selected cell', async () => {
    renderMonth(plan());
    await userEvent.click(cell('A', '2027-01-01'));
    await open();
    await paste('x\tDOV\nMD');
    await userEvent.click(apply());

    expect(cell('A', '2027-01-01')).toHaveTextContent(/^x$/);
    expect(cell('A', '2027-01-02')).toHaveTextContent(/^DOV$/);
    expect(cell('B', '2027-01-01')).toHaveTextContent(/^MD$/); // B is the next row
    expect(stored('2027-01-01', 'A')).toStrictEqual({ code: 'x' });
    expect(stored('2027-01-02', 'A')).toStrictEqual({ code: 'DOV' });
    expect(stored('2027-01-01', 'B')).toStrictEqual({ code: 'MD' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('copies the row of a person for Excel', async () => {
    const writeText = vi.fn<WriteText>(async () => undefined);
    setClipboard(writeText);
    renderMonth(scenario('jan2027').data);
    await userEvent.click(copyButton('Operátor A'));

    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0];
    expect(text.startsWith('x\tx\tx\t')).toBe(true);
    expect(text.split('\t')).toHaveLength(31);
    // A asked for 1 to 3 January off, and has nothing else in the month.
    expect(text).toBe(`x\tx\tx${'\t'.repeat(28)}`);
    expect(await screen.findByText(COPIED)).toBeInTheDocument();
  });
});

// --- The button and the dialog -----------------------------------------------------------------

describe('Vložit z Excelu', () => {
  it('is a button in the head of the month, and opens nothing until it is pressed', async () => {
    renderMonth();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener()).toBeEnabled();
    // It sits with the generator's button, in the head, and not among the cells of the grid.
    expect(opener().closest('.month-head')).toContainElement(
      screen.getByRole('button', { name: 'Vygenerovat' }),
    );
    expect(opener().closest('table')).toBeNull();
  });

  it('opens a modal dialog named by its heading, with the focus on the field', async () => {
    renderMonth();
    await open();
    expect(dialog()).toHaveAttribute('aria-modal', 'true');
    // The start line describes it, so that a page reader tells where the paste begins.
    expect(dialog()).toHaveAccessibleDescription('Začátek: Operátor A, 1. 1.');
    expect(within(dialog()).getByRole('heading', { name: 'Vložit z Excelu' })).toBeVisible();
    expect(area().tagName).toBe('TEXTAREA');
    expect(area()).toHaveValue('');
    expect(area()).toHaveFocus();
  });

  it('offers Použít, off until something is recognised, and Zrušit', async () => {
    renderMonth();
    await open();
    const buttons = within(dialog()).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Použít', 'Zrušit']);
    expect(apply()).toBeDisabled();
    expect(cancel()).toBeEnabled();
  });

  it('is off for a month with nobody in the team, on again for one they are in', async () => {
    const data = plan(3);
    for (const person of data.people) person.activeTo = '2027-01-31';
    renderMonth(data);
    expect(opener()).toBeEnabled();
    await next();
    expect(opener()).toBeDisabled();
    await userEvent.click(opener());
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByText('◀'));
    expect(opener()).toBeEnabled();
  });

  it('is off when there is nobody in the team at all', () => {
    const data = plan();
    data.people = [];
    renderMonth(data);
    expect(opener()).toBeDisabled();
  });
});

// --- Where the paste starts ------------------------------------------------------------------

describe('where a paste starts', () => {
  it('is the first person on day 1 when no cell is selected', async () => {
    renderMonth(plan(3));
    await open();
    expect(within(dialog()).getByText('Začátek: Operátor A, 1. 1.')).toBeVisible();
    await paste('R1\tR2');
    await userEvent.click(apply());
    expect(stored('2027-01-01', 'A')).toStrictEqual({ code: 'R1', pinned: true });
    expect(stored('2027-01-02', 'A')).toStrictEqual({ code: 'R2', pinned: true });
  });

  it('is the selected cell, whichever person and day it is', async () => {
    renderMonth(plan(4));
    await userEvent.click(cell('C', '2027-01-06'));
    await open();
    expect(within(dialog()).getByText('Začátek: Operátor C, 6. 1.')).toBeVisible();
    await paste('O\tR1\nx');
    await userEvent.click(apply());
    expect(stored('2027-01-06', 'C')).toStrictEqual({ code: 'O', pinned: true });
    expect(stored('2027-01-07', 'C')).toStrictEqual({ code: 'R1', pinned: true });
    expect(stored('2027-01-06', 'D')).toStrictEqual({ code: 'x' });
    expect(stored('2027-01-01', 'A')).toBeUndefined();
  });

  it('is a cell of the tail too, and the paste goes on into the month', async () => {
    renderMonth(plan(3));
    await userEvent.click(cell('B', '2026-12-30'));
    await open();
    expect(within(dialog()).getByText('Začátek: Operátor B, 30. 12.')).toBeVisible();
    await paste('N\tR1\tx');
    await userEvent.click(apply());
    expect(stored('2026-12-30', 'B')).toStrictEqual({ code: 'N', pinned: true });
    expect(stored('2026-12-31', 'B')).toStrictEqual({ code: 'R1', pinned: true });
    expect(stored('2027-01-01', 'B')).toStrictEqual({ code: 'x' });
    expect(cell('B', '2026-12-30')).toHaveTextContent('N📌');
  });

  it('is the first person of the month grid, who may not be the first of the team', async () => {
    const data = plan(3);
    data.people[0].activeFrom = '2027-02-01'; // A joins after the month
    renderMonth(data);
    await open();
    expect(within(dialog()).getByText('Začátek: Operátor B, 1. 1.')).toBeVisible();
    await paste('x');
    await userEvent.click(apply());
    expect(stored('2027-01-01', 'B')).toStrictEqual({ code: 'x' });
    expect(stored('2027-01-01', 'A')).toBeUndefined();
  });

  it('is day 1 of the month that is shown', async () => {
    renderMonth(plan(2));
    await next();
    await open();
    expect(within(dialog()).getByText('Začátek: Operátor A, 1. 2.')).toBeVisible();
  });

  it('forgets a cell selected in another month', async () => {
    renderMonth(plan(3));
    await userEvent.click(cell('B', '2027-01-05'));
    await next();
    await open();
    expect(within(dialog()).getByText('Začátek: Operátor A, 1. 2.')).toBeVisible();
  });

  it('falls back to the first person when the selected one has left the team', async () => {
    renderMonth(plan(3));
    await userEvent.click(cell('C', '2027-01-06'));
    act(() => app.dispatch({ type: 'removePerson', personId: 'C' }));
    await open();
    expect(within(dialog()).getByText('Začátek: Operátor A, 1. 1.')).toBeVisible();
  });

  it('closes the menu of the selected cell, which keeps the cell as the start', async () => {
    renderMonth(plan(3));
    await userEvent.click(cell('B', '2027-01-06'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await open();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(within(dialog()).getByText('Začátek: Operátor B, 6. 1.')).toBeVisible();
  });
});

// --- The preview -----------------------------------------------------------------------------

describe('the preview', () => {
  it('counts what is recognised and what is ignored, and follows the text', async () => {
    renderMonth();
    await open();
    expect(summary()).toHaveTextContent(/^Rozpoznáno: 0 · Ignorováno: 0$/);
    setText('x');
    expect(summary()).toHaveTextContent(/^Rozpoznáno: 1 · Ignorováno: 0$/);
    setText('x\tfoo\tDOV');
    expect(summary()).toHaveTextContent(/^Rozpoznáno: 2 · Ignorováno: 1$/);
    setText('\tfoo'); // an empty first column is a day, so that foo is a value left out
    expect(summary()).toHaveTextContent(/^Rozpoznáno: 0 · Ignorováno: 1$/);
    setText('');
    expect(summary()).toHaveTextContent(/^Rozpoznáno: 0 · Ignorováno: 0$/);
  });

  it('is a live region, so that the count is read out when it changes', async () => {
    renderMonth();
    await open();
    expect(summary().closest('[role="status"]')).not.toBeNull();
  });

  it('lists the ignored values in the order pasted, with their row and column', async () => {
    renderMonth();
    await open();
    setText('x\tfoo\nbar\tR1\n\tbaz');
    expect(summary()).toHaveTextContent(/^Rozpoznáno: 2 · Ignorováno: 3$/);
    expect(ignored()).toEqual([
      'foo (řádek 1, sloupec 2)',
      'bar (řádek 2, sloupec 1)',
      'baz (řádek 3, sloupec 2)',
    ]);
    expect(within(dialog()).queryByText(NAMES_LINE)).toBeNull();
  });

  it('shows no list, not even an empty box, when everything is recognised', async () => {
    renderMonth();
    await open();
    setText('x\tDOV');
    expect(summary()).toHaveTextContent(/^Rozpoznáno: 2 · Ignorováno: 0$/);
    expect(within(dialog()).queryByRole('list')).toBeNull();
  });

  it('says when the first column is taken for names, and counts columns as pasted', async () => {
    renderMonth(plan(3));
    await open();
    setText('Operátor A\tx\tfoo\nOperátor B\tR1\tbar');
    expect(within(dialog()).getByText(NAMES_LINE)).toBeVisible();
    expect(summary()).toHaveTextContent(/^Rozpoznáno: 2 · Ignorováno: 2$/);
    // The names are not listed as ignored, and the column of foo is its place in the text.
    expect(ignored()).toEqual(['foo (řádek 1, sloupec 3)', 'bar (řádek 2, sloupec 3)']);

    await userEvent.click(apply());
    expect(stored('2027-01-01', 'A')).toStrictEqual({ code: 'x' });
    expect(stored('2027-01-01', 'B')).toStrictEqual({ code: 'R1', pinned: true });
    expect(stored('2027-01-02', 'A')).toBeUndefined(); // foo went nowhere
  });

  it('ignores rows beyond the last person and days beyond the month', async () => {
    renderMonth(plan());
    await userEvent.click(cell('H', '2027-01-30'));
    await open();
    expect(within(dialog()).getByText('Začátek: Operátor H, 30. 1.')).toBeVisible();
    setText('x\tR1\tDOV\nMD');
    expect(summary()).toHaveTextContent(/^Rozpoznáno: 2 · Ignorováno: 2$/);
    expect(ignored()).toEqual(['DOV (řádek 1, sloupec 3)', 'MD (řádek 2, sloupec 1)']);
  });

  it('shows an ignored value as it was pasted, words and capitals included', async () => {
    renderMonth();
    await open();
    setText('x\tPrázdniny na Maledivách');
    expect(ignored()).toEqual(['Prázdniny na Maledivách (řádek 1, sloupec 2)']);
  });

  it('keeps a long list of ignored values in a box that scrolls', () => {
    // jsdom does not load the style sheet, so this reads it.
    const css = readFileSync(join(import.meta.dirname, '../styles.css'), 'utf8');
    const rule = /\.paste-ignored\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/max-height:/);
    expect(rule).toMatch(/overflow(-y)?:\s*auto/);
  });

  it.each([
    ['nothing is pasted', ''],
    ['only empty cells are pasted', '\t\t\n\t'],
    ['no value is a code', 'foo\tbar\nbaz'],
  ])('keeps Použít off while nothing is recognised: %s', async (_when, text) => {
    renderMonth();
    await open();
    setText(text);
    expect(summary()).toHaveTextContent(/^Rozpoznáno: 0 /);
    expect(apply()).toBeDisabled();
    const before = app.data;
    await userEvent.click(apply());
    expect(dialog()).toBeVisible(); // a click on it does nothing
    expect(app.data).toBe(before);
  });

  it('keeps Použít off when every code falls outside the month', async () => {
    renderMonth();
    await userEvent.click(cell('H', '2027-01-31'));
    await open();
    setText('\tx\nR1'); // x is on 1 February, and R1 is below the last person
    expect(summary()).toHaveTextContent(/^Rozpoznáno: 0 · Ignorováno: 2$/);
    expect(apply()).toBeDisabled();
  });

  it('turns Použít on when something is recognised, and off again when it is not', async () => {
    renderMonth();
    await open();
    setText('\tfoo');
    expect(apply()).toBeDisabled();
    setText('x\tfoo');
    expect(apply()).toBeEnabled();
    setText('\tfoo');
    expect(apply()).toBeDisabled();
  });
});

// --- Closing the dialog ----------------------------------------------------------------------

describe('closing the dialog', () => {
  it('changes nothing on Zrušit, and gives the focus back to the button', async () => {
    renderMonth(plan(3));
    const before = app.data;
    await open();
    await paste('x\tDOV');
    await userEvent.click(cancel());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(app.data).toBe(before);
    expect(opener()).toHaveFocus();
  });

  it('changes nothing on Escape, and gives the focus back to the button', async () => {
    renderMonth(plan(3));
    const before = app.data;
    await open();
    await paste('x\tDOV');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(app.data).toBe(before);
    expect(opener()).toHaveFocus();
  });

  it('closes on Escape from Zrušit too', async () => {
    renderMonth();
    await open();
    await userEvent.tab();
    expect(cancel()).toHaveFocus(); // Použít is off, so the next stop is Zrušit
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener()).toHaveFocus();
  });

  it('stores the recognised cells on Použít, closes, and gives the focus back', async () => {
    renderMonth(plan(3));
    await open();
    await paste('R1');
    await userEvent.click(apply());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stored('2027-01-01', 'A')).toStrictEqual({ code: 'R1', pinned: true });
    expect(opener()).toHaveFocus();
  });

  it('starts empty each time it is opened', async () => {
    renderMonth();
    await open();
    await paste('x');
    await userEvent.click(cancel());
    await open();
    expect(area()).toHaveValue('');
    expect(summary()).toHaveTextContent(/^Rozpoznáno: 0 /);
    expect(apply()).toBeDisabled();
  });

  it('keeps the focus on its controls when Tab and Shift+Tab are pressed', async () => {
    renderMonth();
    await open();
    await paste('x');
    expect(area()).toHaveFocus();
    await userEvent.tab();
    expect(apply()).toHaveFocus();
    await userEvent.tab();
    expect(cancel()).toHaveFocus();
    await userEvent.tab(); // past the last, round to the first
    expect(area()).toHaveFocus();
    await userEvent.tab({ shift: true }); // before the first, round to the last
    expect(cancel()).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(apply()).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(area()).toHaveFocus();
  });

  it('skips Použít on Tab while it is off', async () => {
    renderMonth();
    await open();
    await userEvent.tab();
    expect(cancel()).toHaveFocus();
    await userEvent.tab();
    expect(area()).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(cancel()).toHaveFocus();
  });

  it('keeps the focus when its text or the page behind is clicked, so Escape works', async () => {
    renderMonth();
    await open();
    await userEvent.click(within(dialog()).getByText('Začátek: Operátor A, 1. 1.'));
    expect(area()).toHaveFocus();
    await userEvent.click(dialog().parentElement as HTMLElement); // the dimmed page behind it
    expect(area()).toHaveFocus();
    expect(dialog()).toBeVisible(); // a click behind it does not close it

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lets the field take the focus back when it is clicked', async () => {
    renderMonth();
    await open();
    await userEvent.tab();
    expect(cancel()).toHaveFocus();
    await userEvent.click(area());
    expect(area()).toHaveFocus();
  });
});

// --- What Použít stores ----------------------------------------------------------------------

describe('what Použít stores', () => {
  it('pins every shift, and stores x and the absences as they are', async () => {
    renderMonth(plan(2));
    await open();
    setText('R1\tR2\tO20\tO\tN\tR12\tN12\tDOV\tMD\tOP\tNEM\tx');
    await userEvent.click(apply());
    expect([
      stored('2027-01-01', 'A'),
      stored('2027-01-02', 'A'),
      stored('2027-01-03', 'A'),
      stored('2027-01-04', 'A'),
      stored('2027-01-05', 'A'),
      stored('2027-01-06', 'A'),
      stored('2027-01-07', 'A'),
      stored('2027-01-08', 'A'),
      stored('2027-01-09', 'A'),
      stored('2027-01-10', 'A'),
      stored('2027-01-11', 'A'),
      stored('2027-01-12', 'A'),
    ]).toStrictEqual([
      { code: 'R1', pinned: true },
      { code: 'R2', pinned: true },
      { code: 'O20', pinned: true },
      { code: 'O', pinned: true },
      { code: 'N', pinned: true },
      { code: 'R12', pinned: true },
      { code: 'N12', pinned: true },
      { code: 'DOV' },
      { code: 'MD' },
      { code: 'OP' },
      { code: 'NEM' },
      { code: 'x' },
    ]);
  });

  it('replaces what a cell held, a pin included, and leaves the cells it misses', async () => {
    const data = plan(2);
    put(data, '2027-01-01', 'A', 'R1', true);
    put(data, '2027-01-02', 'A', 'O');
    put(data, '2027-01-03', 'A', 'N', true);
    put(data, '2027-01-01', 'B', 'DOV');
    renderMonth(data);
    await open();
    setText('x\tDOV\t\nR2'); // the third cell is empty: it writes nothing
    await userEvent.click(apply());
    expect(stored('2027-01-01', 'A')).toStrictEqual({ code: 'x' }); // no pin left behind
    expect(stored('2027-01-02', 'A')).toStrictEqual({ code: 'DOV' });
    expect(stored('2027-01-03', 'A')).toStrictEqual({ code: 'N', pinned: true });
    expect(stored('2027-01-01', 'B')).toStrictEqual({ code: 'R2', pinned: true });
  });

  it('shows the cells at once, and the checks follow like after any edit', async () => {
    const data = plan();
    data.settings.fpdHoursPerWeekday = 0;
    renderMonth(data);
    await userEvent.click(cell('C', '2027-01-06'));
    await open();
    await paste('O\tR1'); // 8 h of rest between them: rule M2
    await userEvent.click(apply());
    expect(cell('C', '2027-01-06')).toHaveTextContent('O📌');
    expect(cell('C', '2027-01-07')).toHaveTextContent('R1📌');
    expect(screen.getByText(/Operátor C · 6\. 1\.: R1 hned po O: jen 8 h odpočinku/)).toBeVisible();
    expect(screen.getByTestId('totals-C')).toHaveTextContent('15 / 0');
  });
});

// --- While a run goes on ---------------------------------------------------------------------

/** The cells a test says a run found, as codes. */
type Found = Array<[PersonId, ISODate, CodeInt]>;

/**
 * A runner whose run ends when the test says so, with the rows it was given and the cells that the
 * test names set to other codes.
 */
function heldRunner() {
  let input!: GeneratorInput;
  let end!: (result: SearchResult) => void;
  const runner: GeneratorRunner = (given) => {
    input = given;
    const result = new Promise<SearchResult>((resolve) => {
      end = resolve;
    });
    return { result, stop: () => undefined };
  };
  const finish = (found: Found) => {
    const rows = input.rows.map((row) => row.slice());
    for (const [person, date, code] of found) {
      const p = input.ctx.people.findIndex((who) => who.id === person);
      rows[p][input.ctx.days.findIndex((day) => day.date === date)] = code;
    }
    end({ rows, score: 0, mustUnits: 0, iterations: 0 });
  };
  return { runner, finish };
}

describe('while a run of the generator goes on', () => {
  it('can be used, and the run does not take the pasted cells back', async () => {
    const { runner, finish } = heldRunner();
    renderMonth(plan(), { runner });
    await userEvent.click(screen.getByRole('button', { name: 'Vygenerovat' }));
    expect(screen.getByRole('button', { name: 'Zastavit' })).toBeInTheDocument();
    expect(opener()).toBeEnabled();

    await userEvent.click(cell('C', '2027-01-05'));
    await open();
    await paste('R1\tx\tDOV');
    await userEvent.click(apply());
    expect(stored('2027-01-05', 'C')).toStrictEqual({ code: 'R1', pinned: true });

    // The run found other codes for those three days, and one for a day that nobody touched.
    await act(async () =>
      finish([
        ['C', '2027-01-05', Code.O],
        ['C', '2027-01-06', Code.R2],
        ['C', '2027-01-07', Code.O20],
        ['C', '2027-01-08', Code.N],
      ]),
    );
    expect(await screen.findByText(/^Hotovo/)).toBeInTheDocument();
    expect(stored('2027-01-05', 'C')).toStrictEqual({ code: 'R1', pinned: true });
    expect(stored('2027-01-06', 'C')).toStrictEqual({ code: 'x' });
    expect(stored('2027-01-07', 'C')).toStrictEqual({ code: 'DOV' });
    expect(stored('2027-01-08', 'C')).toStrictEqual({ code: 'N' });
  });
});

// --- The copy button -------------------------------------------------------------------------

describe('the copy button of a row', () => {
  it('sits in the name cell of each person, named and titled after the person', () => {
    const data = plan(3);
    data.people[1].name = 'Jiné jméno';
    renderMonth(data);
    const buttons = screen.getAllByRole('button', { name: /^Kopírovat řádek / });
    const labels = [
      'Kopírovat řádek Operátor A',
      'Kopírovat řádek Jiné jméno',
      'Kopírovat řádek Operátor C',
    ];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(labels);
    expect(buttons.map((button) => button.getAttribute('title'))).toEqual(labels);
    expect(buttons[1].closest('th')).toBe(screen.getByRole('rowheader', { name: 'Jiné jméno' }));
    expect(buttons[1].closest('th')).toHaveAttribute('scope', 'row');
    // The glyph is what the eye sees, and the coverage row has no one to copy.
    for (const button of buttons) expect(button.textContent).not.toBe('');
    const coverage = screen.getByRole('rowheader', { name: 'Obsazeno' });
    expect(within(coverage).queryByRole('button')).toBeNull();
  });

  it('keeps the row header named by the person alone, with the button inside it', () => {
    renderMonth(plan(2));
    const header = screen.getByRole('rowheader', { name: 'Operátor B' });
    const button = within(header).getByRole('button', { name: 'Kopírovat řádek Operátor B' });
    expect(button).toBeVisible();
  });

  it('copies the row of the person whose button it is', async () => {
    const writeText = vi.fn<WriteText>(async () => undefined);
    setClipboard(writeText);
    renderMonth(scenario('jan2027').data);
    await userEvent.click(copyButton('Operátor B')); // on leave on the 1st, wants 2 and 3 off
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(`DOV\tx\tx${'\t'.repeat(28)}`);
    await screen.findByText(COPIED);
  });

  it('copies the month shown: tabs between the days, nothing for an empty one', async () => {
    const writeText = vi.fn<WriteText>(async () => undefined);
    setClipboard(writeText);
    const data = plan(2);
    put(data, '2027-02-03', 'A', 'R1', true);
    put(data, '2027-02-28', 'A', 'N');
    put(data, '2027-01-03', 'A', 'x'); // January's, not to be copied
    renderMonth(data);
    await next();
    await userEvent.click(copyButton('Operátor A'));
    // February 2027 has 28 days: 28 fields, a pin is just the name of the shift.
    expect(writeText).toHaveBeenCalledWith(`\t\tR1${'\t'.repeat(24)}\tN`);
    await screen.findByText(COPIED);
  });

  it('changes nothing in the plan and selects nothing', async () => {
    setClipboard(async () => undefined);
    renderMonth(plan(2));
    const before = app.data;
    await userEvent.click(copyButton('Operátor A'));
    await screen.findByText(COPIED);
    expect(app.data).toBe(before);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(cell('A', '2027-01-01')).not.toHaveClass('selected');
  });
});

// --- The note after a copy -------------------------------------------------------------------

describe('the note after a copy', () => {
  /** Presses a copy button and lets the copy end, without letting any timer run. */
  const copyRow = (name: string) =>
    act(async () => {
      fireEvent.click(copyButton(name));
    });

  it('tells that the row is copied, in a live region, and nothing before that', async () => {
    setClipboard(async () => undefined);
    renderMonth(plan(2));
    expect(note(COPIED)).toBeNull();
    expect(note(FAILED)).toBeNull();
    await userEvent.click(copyButton('Operátor A'));
    const shown = await screen.findByText(COPIED);
    expect(shown.closest('[role="status"]')).not.toBeNull();
    expect(shown).not.toHaveAttribute('data-failed');
  });

  it('stays for 4 s, and then it is gone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setClipboard(async () => undefined);
    renderMonth(plan(2));
    await copyRow('Operátor A');
    expect(note(COPIED)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(note(COPIED)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(note(COPIED)).toBeNull();
  });

  it('is replaced by the next copy, which gets its own 4 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const writeText = vi
      .fn<WriteText>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('refused'));
    setClipboard(writeText);
    renderMonth(plan(2));

    await copyRow('Operátor A'); // at 0 s: copied
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    await copyRow('Operátor B'); // at 3 s: the copy fails and takes the place of the note
    expect(note(COPIED)).toBeNull();
    expect(note(FAILED)).toBeInTheDocument();
    expect(note(FAILED)).toHaveAttribute('data-failed');

    act(() => {
      vi.advanceTimersByTime(3000); // at 6 s: past the first note's 4 s, within the second's
    });
    expect(note(FAILED)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000); // at 7 s: 4 s after the second copy
    });
    expect(note(FAILED)).toBeNull();
  });

  it('is shown anew when the same thing is told again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setClipboard(async () => undefined);
    renderMonth(plan(2));
    await copyRow('Operátor A');
    const first = note(COPIED);
    await copyRow('Operátor B');
    // A page reader tells a live region again only when something new is put into it.
    expect(note(COPIED)).not.toBe(first);
    expect(first?.isConnected).toBe(false);
  });
});

// --- When the Clipboard API is missing or refuses ----------------------------------------------

describe('when the Clipboard API is missing or refuses', () => {
  const rowOfB = `DOV\tx\tx${'\t'.repeat(28)}`;

  it('copies through a hidden field and the copy command when there is no API', async () => {
    setClipboard(undefined);
    const { command, copied } = setCommand();
    renderMonth(scenario('jan2027').data);
    const button = copyButton('Operátor B');
    await userEvent.click(button);

    expect(await screen.findByText(COPIED)).toBeInTheDocument();
    expect(command).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith('copy');
    expect(copied).toEqual([rowOfB]); // the text was selected in a focused field
    expect(document.querySelector('textarea')).toBeNull(); // and the field is gone again
    expect(button).toHaveFocus();
  });

  it('does the same when the API refuses', async () => {
    const writeText = vi.fn<WriteText>().mockRejectedValue(new Error('NotAllowedError'));
    setClipboard(writeText);
    const { command, copied } = setCommand();
    renderMonth(scenario('jan2027').data);
    const button = copyButton('Operátor B');
    await userEvent.click(button);

    expect(await screen.findByText(COPIED)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledTimes(1);
    expect(copied).toEqual([rowOfB]);
    expect(document.querySelector('textarea')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('does not touch the copy command when the API works', async () => {
    setClipboard(async () => undefined);
    const { command } = setCommand();
    renderMonth(plan(2));
    await userEvent.click(copyButton('Operátor A'));
    await screen.findByText(COPIED);
    expect(command).not.toHaveBeenCalled();
  });

  it('tells that the copy failed when the copy command says no', async () => {
    setClipboard(undefined);
    const { command } = setCommand(() => false);
    renderMonth(plan(2));
    const button = copyButton('Operátor A');
    await userEvent.click(button);

    const failure = await screen.findByText(FAILED);
    expect(failure).toHaveAttribute('data-failed');
    expect(failure.closest('[role="status"]')).not.toBeNull();
    expect(note(COPIED)).toBeNull();
    expect(command).toHaveBeenCalledTimes(1);
    expect(document.querySelector('textarea')).toBeNull(); // even then the field goes
    expect(button).toHaveFocus();
  });

  it('tells that the copy failed when the copy command throws', async () => {
    setClipboard(async () => {
      throw new Error('refused');
    });
    setCommand(() => {
      throw new Error('not allowed');
    });
    renderMonth(plan(2));
    await userEvent.click(copyButton('Operátor A'));
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('tells that the copy failed when the page has neither way', async () => {
    renderMonth(plan(2)); // jsdom has no Clipboard API and no copy command
    await userEvent.click(copyButton('Operátor A'));
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(note(COPIED)).toBeNull();
  });
});

// --- In the page -----------------------------------------------------------------------------

describe('in the page', () => {
  it('works in the Měsíc tab, where the other tabs stay in the page, hidden', async () => {
    vi.setSystemTime(new Date(2026, 10, 5, 10, 0)); // December 2026 is shown
    render(
      <AppProvider storage={memoryStorage(plan(3))} runner={inProcessRunner}>
        <App />
        <Probe />
      </AppProvider>,
    );
    const panel = within(screen.getByRole('tabpanel'));
    await userEvent.click(panel.getByTestId('cell-B-2026-12-08'));
    await userEvent.click(panel.getByRole('button', { name: 'Vložit z Excelu' }));
    expect(panel.getByRole('dialog', { name: 'Vložit z Excelu' })).toHaveTextContent(
      'Začátek: Operátor B, 8. 12.',
    );
    await userEvent.paste('R2');
    await userEvent.click(panel.getByRole('button', { name: 'Použít' }));
    expect(panel.getByTestId('cell-B-2026-12-08')).toHaveTextContent('R2📌');
    expect(stored('2026-12-08', 'B')).toStrictEqual({ code: 'R2', pinned: true });
  });

  it('works under StrictMode, which renders everything twice', async () => {
    setClipboard(async () => undefined);
    renderMonth(plan(2), { strict: true });
    await open();
    expect(area()).toHaveFocus();
    await paste('x');
    await userEvent.click(apply());
    expect(stored('2027-01-01', 'A')).toStrictEqual({ code: 'x' });
    expect(opener()).toHaveFocus();

    await userEvent.click(copyButton('Operátor A'));
    expect(await screen.findByText(COPIED)).toBeInTheDocument();
  });
});
