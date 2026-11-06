// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { newAppData } from '../../domain/defaults';
import type {
  AppData,
  CodeName,
  ISODate,
  Level,
  PersonId,
  Settings,
  WishId,
} from '../../domain/types';
import { memoryStorage } from '../../storage/adapter';
import { syntheticTeam } from '../../test/team';
import { inProcessRunner } from '../../worker/runner';
import { App } from '../App';
import { MonthScreen } from '../month/MonthScreen';
import { reduce } from '../reducer';
import { AppProvider, useApp } from '../store';
import { RulesScreen } from './RulesScreen';

// The tests look at the actions that reach the reducer, so it calls through to the real one and
// keeps a record of the calls.
vi.mock('../reducer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../reducer')>();
  return { ...actual, reduce: vi.fn(actual.reduce) };
});

// A warning from React, or an error from jsdom, would end up in the output: the tests fail on it.
let errors: MockInstance;

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(reduce).mockClear();
});

afterEach(() => {
  const calls = [...errors.mock.calls];
  vi.restoreAllMocks(); // the spies
  expect(calls).toEqual([]);
});

/** The latest value of `useApp()`: a test reads what the screen stored through it. */
let app: ReturnType<typeof useApp>;

function Probe() {
  app = useApp();
  return null;
}

const settings = () => (app.data as AppData).settings;

/** The actions that the reducer has been given since the test began, in order. */
const dispatched = () => vi.mocked(reduce).mock.calls.map(([, action]) => action);

/** The plan with the made-up operators A to H and no cells. */
function plan(): AppData {
  return { ...newAppData(), people: syntheticTeam() };
}

/** Stores `code` for `person` on `date`. */
function put(data: AppData, date: ISODate, person: PersonId, code: CodeName) {
  (data.cells[date] ??= {})[person] = { code };
}

function renderRules(data: AppData | null = newAppData()) {
  return render(
    <AppProvider storage={memoryStorage(data)} runner={inProcessRunner}>
      <RulesScreen />
      <Probe />
    </AppProvider>,
  );
}

// The numbers of the screen, as the brief gives them. `stored` is what a new plan holds, `valid`
// numbers inside the range that differ from it, and `invalid` ones the box must not store. `1e1`
// is ten to a browser, so in range for each box, but it is not a plain number. A number a hair off
// the step, such as 20.0000000001, is no number on the step.
const NUMBERS = [
  {
    label: 'Odpočinek mezi směnami (h)',
    key: 'minRestHours',
    min: 8,
    max: 24,
    step: 0.5,
    stored: 12,
    valid: ['8', '8.5', '10', '10.5', '24'],
    invalid: [
      '7.5', '7', '24.5', '25', '100', '10.25', '10.3', '-10', '1e1',
      '12.0000000001', '11.9999999999', '10.4999999999', '10.5000000001', // a hair off the step
    ],
  },
  {
    label: 'Max. 12h směn za měsíc',
    key: 'maxTwelvePerMonth',
    min: 1,
    max: 10,
    step: 1,
    stored: 3,
    valid: ['1', '5', '10'],
    invalid: ['0', '11', '2.5', '-1', '1e1', '3.0000000001', '2.9999999999'],
  },
  {
    label: 'Cíl 12h směn za měsíc',
    key: 'twelveTarget',
    min: 0,
    max: 10,
    step: 1,
    stored: 2,
    valid: ['0', '4', '10'],
    invalid: ['11', '1.5', '-1', '1e1', '2.0000000001', '1.9999999999'],
  },
  {
    label: 'Čas na generování (s)',
    key: 'generatorTimeBudgetSec',
    min: 3,
    max: 120,
    step: 1,
    stored: 20,
    valid: ['3', '45', '120'],
    invalid: ['2', '121', '30.5', '-5', '1e1', '20.0000000001', '19.9999999999'],
  },
] as const satisfies ReadonlyArray<{
  label: string;
  key: keyof Settings;
  min: number;
  max: number;
  step: number;
  stored: number;
  valid: readonly string[];
  invalid: readonly string[];
}>;

/** The wishes in the order of the screen, with their labels: the plan's, W5a's per ruling R3. */
const WISHES: ReadonlyArray<readonly [WishId, string]> = [
  ['W1', 'Co nejméně přesčasů'],
  ['W2', 'Stejná směna 4–5 dní v řadě'],
  ['W3', 'Po 5–6 dnech 2 dny volna'],
  ['W4a', 'Noční v delších blocích'],
  ['W4b', 'Před nočními volno (a předtím R2, O20 nebo O)'],
  ['W4c', 'Po nočních 2 dny volna'],
  ['W4d', 'Noční podle ochoty'],
  ['W5a', 'Držet se cíle 12h směn'],
  ['W5b', 'Celé víkendy podle přání'],
  ['W5c', 'Volno po víkendu podle přání'],
  ['W5d', 'Vedle R12 jen R1 nebo R2'],
  ['W6', 'Oblíbené směny'],
  ['W7', 'Férovost napříč měsíci'],
  ['W8', 'Neoblíbené směny rovnoměrně'],
  ['W9', 'Vyrovnané dny (R2)'],
];

/** The levels from 0 to 5, as the options show them. */
const LEVELS = ['0 – vypnuto', '1', '2', '3 – běžně', '4', '5 – hodně'];

const number = (label: string) => screen.getByRole('spinbutton', { name: label });
const wish = (label: string) => screen.getByRole('combobox', { name: label });
const optionsOf = (box: HTMLElement) =>
  Array.from((box as HTMLSelectElement).options, (option) => option.text);

/** Replaces what is in a box, by typing. */
async function enter(box: HTMLElement, text: string) {
  await userEvent.clear(box);
  await userEvent.type(box, text);
}

/** Puts a whole text into a box at once, as a paste does: no number on the way is stored. */
function paste(box: HTMLElement, text: string) {
  fireEvent.change(box, { target: { value: text } });
}

// --- The brief's tests -----------------------------------------------------------------------

describe('the brief', () => {
  it('checks the rest between shifts against the setting', async () => {
    // C works O20 on Wednesday 6 January and R1 the next morning: 10 h of rest.
    const data = plan();
    put(data, '2027-01-06', 'C', 'O20');
    put(data, '2027-01-07', 'C', 'R1');
    render(
      <AppProvider storage={memoryStorage(data)} runner={inProcessRunner}>
        <MonthScreen initialMonth="2027-01" />
        <RulesScreen />
        <Probe />
      </AppProvider>,
    );
    const kontrola = within(screen.getByRole('region', { name: 'Kontrola' }));
    expect(
      kontrola.getByText('Operátor C · 6. 1.: R1 hned po O20: jen 10 h odpočinku (min. 12 h)'),
    ).toBeInTheDocument();

    await enter(number('Odpočinek mezi směnami (h)'), '10');
    expect(settings().minRestHours).toBe(10);
    expect(kontrola.queryByText(/R1 hned po O20/)).toBeNull();
  });

  it('switches a wish off', async () => {
    renderRules();
    await userEvent.selectOptions(wish('Oblíbené směny'), '0 – vypnuto');
    expect(settings().wishLevels.W6).toBe(0);
  });
});

// --- The screen -------------------------------------------------------------------------------

describe('the screen', () => {
  it('has the two sections, each named by its heading', () => {
    renderRules();
    for (const name of ['Nastavení', 'Důležitost přání']) {
      const section = screen.getByRole('region', { name });
      expect(within(section).getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('region')).toHaveLength(2);
  });

  it('holds the four numbers, in the order of the brief, in Nastavení', () => {
    renderRules();
    const section = within(screen.getByRole('region', { name: 'Nastavení' }));
    const boxes = section.getAllByRole('spinbutton');
    expect(boxes.map((box) => (box as HTMLInputElement).labels?.[0]?.textContent)).toEqual(
      NUMBERS.map((n) => n.label),
    );
    expect(section.queryByRole('combobox')).toBeNull();
  });

  it('holds one select for each wish, from W1 to W9, in Důležitost přání', () => {
    renderRules();
    const section = within(screen.getByRole('region', { name: 'Důležitost přání' }));
    const boxes = section.getAllByRole('combobox');
    expect(boxes.map((box) => (box as HTMLSelectElement).labels?.[0]?.textContent)).toEqual(
      WISHES.map(([, label]) => label),
    );
    expect(section.queryByRole('spinbutton')).toBeNull();
  });

  it('labels the importance of W5a differently from the target of 12-hour shifts', () => {
    // Two controls must not share a name (R3): the number keeps the plan's label, the select not.
    renderRules();
    expect(number('Cíl 12h směn za měsíc')).toBeInTheDocument();
    expect(wish('Držet se cíle 12h směn')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Cíl 12h směn za měsíc')).toHaveLength(1);
  });

  it('shows the numbers that are stored, and the level of each wish', () => {
    const data = newAppData();
    Object.assign(data.settings, {
      minRestHours: 10.5,
      maxTwelvePerMonth: 4,
      twelveTarget: 1,
      generatorTimeBudgetSec: 45,
    });
    WISHES.forEach(([id], i) => {
      data.settings.wishLevels[id] = (i % 6) as Level;
    });
    renderRules(data);
    expect(number('Odpočinek mezi směnami (h)')).toHaveValue(10.5);
    expect(number('Max. 12h směn za měsíc')).toHaveValue(4);
    expect(number('Cíl 12h směn za měsíc')).toHaveValue(1);
    expect(number('Čas na generování (s)')).toHaveValue(45);
    WISHES.forEach(([, label], i) => {
      expect(wish(label), label).toHaveDisplayValue(LEVELS[i % 6]);
    });
  });

  it('shows the defaults of a new plan', () => {
    renderRules();
    expect(NUMBERS.map((n) => (number(n.label) as HTMLInputElement).valueAsNumber)).toEqual([
      12, 3, 2, 20,
    ]);
    for (const [, label] of WISHES) expect(wish(label), label).toHaveDisplayValue('3 – běžně');
  });

  it('shows the settings of another plan that is opened', async () => {
    renderRules();
    await userEvent.clear(number('Čas na generování (s)')); // a box that waits for a number
    const other = newAppData();
    Object.assign(other.settings, {
      minRestHours: 9,
      maxTwelvePerMonth: 4,
      twelveTarget: 1,
      generatorTimeBudgetSec: 60,
    });
    other.settings.wishLevels.W6 = 5;
    act(() => {
      app.dispatch({ type: 'load', data: other });
    });
    expect(number('Odpočinek mezi směnami (h)')).toHaveValue(9);
    expect(number('Max. 12h směn za měsíc')).toHaveValue(4);
    expect(number('Cíl 12h směn za měsíc')).toHaveValue(1);
    expect(number('Čas na generování (s)')).toHaveValue(60);
    expect(wish('Oblíbené směny')).toHaveDisplayValue('5 – hodně');
    expect(wish('Co nejméně přesčasů')).toHaveDisplayValue('3 – běžně');
  });

  it('shows nothing until there is a plan', () => {
    const { container } = renderRules(null);
    expect(container).toBeEmptyDOMElement();
  });
});

// --- The numbers ------------------------------------------------------------------------------

describe.each(NUMBERS)('the number $label', (n) => {
  it('is a number box with the range of the brief', () => {
    renderRules();
    const box = number(n.label);
    expect(box).toHaveAttribute('type', 'number');
    expect(box).toHaveAttribute('min', String(n.min));
    expect(box).toHaveAttribute('max', String(n.max));
    expect(box).toHaveAttribute('step', String(n.step));
  });

  it('is stored under its own setting, and nothing else changes', async () => {
    renderRules();
    const before = settings();
    await enter(number(n.label), n.valid[1]);
    expect(settings()).toEqual({ ...before, [n.key]: Number(n.valid[1]) });
    expect(settings().shifts).toBe(before.shifts);
    expect(settings().coverage).toBe(before.coverage);
    expect(settings().wishLevels).toBe(before.wishLevels);
  });

  it('takes the least, the most and the numbers between', () => {
    renderRules();
    for (const text of n.valid) {
      paste(number(n.label), text);
      expect(settings()[n.key], text).toBe(Number(text));
      expect(number(n.label)).toHaveValue(Number(text));
    }
  });

  it('does not store a number outside the range or off the step', async () => {
    renderRules();
    const box = number(n.label);
    for (const text of n.invalid) {
      await userEvent.click(box); // the focus is in the box
      paste(box, text);
      expect(settings()[n.key], text).toBe(n.stored);
      await userEvent.tab(); // and leaving it shows the number that is stored
      expect(box, text).toHaveValue(n.stored);
    }
  });

  it('keeps the stored number while the box is empty, and shows it on leaving', async () => {
    renderRules();
    const box = number(n.label);
    await userEvent.clear(box);
    expect(box).toHaveValue(null); // the new number can be typed
    expect(settings()[n.key]).toBe(n.stored);

    await userEvent.tab();
    expect(box).toHaveValue(n.stored);
    expect(settings()[n.key]).toBe(n.stored);
  });

  it('leaves the plan as it is when the number typed again is the one stored', async () => {
    renderRules();
    const before = app.data;
    await enter(number(n.label), String(n.stored)); // emptied, then the same number
    expect(number(n.label)).toHaveValue(n.stored);
    expect(app.data).toBe(before); // nothing changed, so nothing is to be saved
  });
});

describe('typing a number', () => {
  it('stores each number on the way that is good, and the last one stays', async () => {
    renderRules();
    const box = number('Odpočinek mezi směnami (h)');
    await userEvent.clear(box);
    await userEvent.type(box, '1');
    expect(settings().minRestHours).toBe(12); // 1 h is less than the least, 8 h
    await userEvent.type(box, '0');
    expect(box).toHaveValue(10);
    expect(settings().minRestHours).toBe(10);
  });

  it('takes a half hour of rest', async () => {
    renderRules();
    const box = number('Odpočinek mezi směnami (h)');
    await enter(box, '10.5');
    expect(box).toHaveValue(10.5);
    expect(settings().minRestHours).toBe(10.5);
  });

  it('does not take a fraction where only whole numbers are', async () => {
    renderRules();
    const box = number('Cíl 12h směn za měsíc');
    await enter(box, '2.5');
    expect(settings().twelveTarget).toBe(2); // the "2" on the way to 2.5
    await userEvent.tab();
    expect(box).toHaveValue(2);
  });

  it('takes a target above the maximum: the screen checks nothing across fields', async () => {
    renderRules();
    await enter(number('Max. 12h směn za měsíc'), '2');
    await enter(number('Cíl 12h směn za měsíc'), '6');
    expect(settings().maxTwelvePerMonth).toBe(2);
    expect(settings().twelveTarget).toBe(6);
  });
});

// --- What is dispatched -----------------------------------------------------------------------

describe('what the screen dispatches', () => {
  it.each(NUMBERS)('stores $label with updateSettings, and that setting alone', (n) => {
    renderRules();
    paste(number(n.label), n.valid[1]);
    expect(dispatched()).toEqual([
      { type: 'updateSettings', patch: { [n.key]: Number(n.valid[1]) } },
    ]);
  });

  it('stores a wish with the levels of all 15 wishes, the one that changed among them', async () => {
    renderRules();
    await userEvent.selectOptions(wish('Oblíbené směny'), '0 – vypnuto');
    // The patch replaces the levels as they are, so it holds every one of them.
    const levels = { ...newAppData().settings.wishLevels, W6: 0 };
    expect(dispatched()).toEqual([{ type: 'updateSettings', patch: { wishLevels: levels } }]);
  });

  it('builds the levels of a second change on the first, not on the plan as it was', async () => {
    renderRules();
    await userEvent.selectOptions(wish('Oblíbené směny'), '0 – vypnuto');
    await userEvent.selectOptions(wish('Férovost napříč měsíci'), '5 – hodně');
    const levels = { ...newAppData().settings.wishLevels, W6: 0, W7: 5 };
    expect(dispatched().at(-1)).toEqual({ type: 'updateSettings', patch: { wishLevels: levels } });
  });

  it('dispatches nothing for a number that is not good, or is the one stored', async () => {
    renderRules();
    for (const n of NUMBERS) {
      for (const text of [...n.invalid, String(n.stored)]) paste(number(n.label), text);
    }
    expect(dispatched()).toEqual([]);
  });
});

// --- The wishes -------------------------------------------------------------------------------

describe('a wish', () => {
  it('offers the six levels, from 0 – vypnuto to 5 – hodně', () => {
    renderRules();
    for (const [, label] of WISHES) expect(optionsOf(wish(label)), label).toEqual(LEVELS);
  });

  it.each(WISHES)('%s is stored under its own id when %s is changed', async (id, label) => {
    renderRules();
    const before = settings();
    await userEvent.selectOptions(wish(label), '5 – hodně');
    expect(settings().wishLevels[id]).toBe(5);
    // The other 14 levels are as they were, and so is everything else in the settings.
    expect(settings().wishLevels).toEqual({ ...before.wishLevels, [id]: 5 });
    expect({ ...settings(), wishLevels: null }).toEqual({ ...before, wishLevels: null });
    expect(wish(label)).toHaveDisplayValue('5 – hodně');
  });

  it('is stored as the number of the level, for each of the six', async () => {
    renderRules();
    // The new plan holds 3, so start with a level that changes it, and go up and down.
    const steps: Array<[string, number]> = [
      ['0 – vypnuto', 0],
      ['1', 1],
      ['2', 2],
      ['3 – běžně', 3],
      ['4', 4],
      ['5 – hodně', 5],
      ['0 – vypnuto', 0],
    ];
    for (const [option, level] of steps) {
      await userEvent.selectOptions(wish('Férovost napříč měsíci'), option);
      expect(settings().wishLevels.W7, option).toBe(level);
    }
  });

  it('keeps the changes to other wishes made before', async () => {
    renderRules();
    await userEvent.selectOptions(wish('Co nejméně přesčasů'), '1');
    await userEvent.selectOptions(wish('Vyrovnané dny (R2)'), '0 – vypnuto');
    await userEvent.selectOptions(wish('Oblíbené směny'), '4');
    expect(settings().wishLevels).toEqual({
      ...newAppData().settings.wishLevels,
      W1: 1,
      W9: 0,
      W6: 4,
    });
  });
});

// --- In the app -------------------------------------------------------------------------------

/** The Měsíc tab, on the month of the examples. */
const January = () => <MonthScreen initialMonth="2027-01" />;
const Nothing = () => null;

function renderApp(data: AppData) {
  return render(
    <AppProvider storage={memoryStorage(data)} runner={inProcessRunner}>
      <App screens={{ month: January, team: Nothing }} />
      <Probe />
    </AppProvider>,
  );
}

describe('the Pravidla tab', () => {
  it('shows the screen in place of the placeholder', async () => {
    renderApp(plan());
    await userEvent.click(screen.getByRole('tab', { name: 'Pravidla' }));
    // The panels of the other tabs stay in the page, hidden: ask the one that is shown.
    const panel = within(screen.getByRole('tabpanel', { name: 'Pravidla' }));
    expect(panel.getByRole('region', { name: 'Nastavení' })).toBeVisible();
    expect(panel.getByRole('region', { name: 'Důležitost přání' })).toBeVisible();
    expect(panel.getAllByRole('spinbutton')).toHaveLength(4);
    expect(panel.getAllByRole('combobox')).toHaveLength(15);
    expect(panel.queryByText('Připravuje se…')).toBeNull();
  });

  it('changes what the Měsíc tab checks', async () => {
    const data = plan();
    put(data, '2027-01-06', 'C', 'O20');
    put(data, '2027-01-07', 'C', 'R1');
    renderApp(data);
    const shown = () => within(screen.getByRole('tabpanel'));
    const line = /R1 hned po O20: jen 10 h odpočinku \(min\. 12 h\)/;
    expect(shown().getByText(line)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Pravidla' }));
    await enter(shown().getByRole('spinbutton', { name: 'Odpočinek mezi směnami (h)' }), '11');
    await userEvent.click(screen.getByRole('tab', { name: 'Měsíc' }));
    expect(shown().getByText(/jen 10 h odpočinku \(min\. 11 h\)/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Pravidla' }));
    await enter(shown().getByRole('spinbutton', { name: 'Odpočinek mezi směnami (h)' }), '10');
    await userEvent.click(screen.getByRole('tab', { name: 'Měsíc' }));
    expect(shown().queryByText(/R1 hned po O20/)).toBeNull();
  });
});

describe('the page as it runs', () => {
  it('works under StrictMode, which renders everything twice', async () => {
    render(
      <StrictMode>
        <AppProvider storage={memoryStorage(newAppData())} runner={inProcessRunner}>
          <RulesScreen />
          <Probe />
        </AppProvider>
      </StrictMode>,
    );
    await enter(number('Odpočinek mezi směnami (h)'), '9.5');
    expect(number('Odpočinek mezi směnami (h)')).toHaveValue(9.5);
    expect(settings().minRestHours).toBe(9.5);

    await userEvent.selectOptions(wish('Oblíbené směny'), '1');
    expect(settings().wishLevels.W6).toBe(1);
  });
});
