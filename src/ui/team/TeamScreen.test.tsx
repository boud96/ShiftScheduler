// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { newAppData } from '../../domain/defaults';
import type { AppData, CodeName, ISODate, PersonId } from '../../domain/types';
import { memoryStorage } from '../../storage/adapter';
import { syntheticTeam } from '../../test/team';
import { inProcessRunner } from '../../worker/runner';
import { App } from '../App';
import { MonthScreen } from '../month/MonthScreen';
import { AppProvider, useApp } from '../store';
import { TeamScreen } from './TeamScreen';

// A warning from React, or an error from jsdom, would end up in the output: the tests fail on it.
let errors: MockInstance;

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  const calls = [...errors.mock.calls];
  vi.restoreAllMocks(); // the spies, window.confirm among them
  expect(calls).toEqual([]);
});

/** The latest value of `useApp()`: a test reads what the screen stored through it. */
let app: ReturnType<typeof useApp>;

function Probe() {
  app = useApp();
  return null;
}

const people = () => (app.data as AppData).people;

function renderTeam(data: AppData = newAppData()) {
  return render(
    <AppProvider storage={memoryStorage(data)} runner={inProcessRunner}>
      <TeamScreen />
      <Probe />
    </AppProvider>,
  );
}

/** The plan with its first `count` people: most tests need no more than a few cards. */
function team(count: number): AppData {
  const data = newAppData();
  data.people = data.people.slice(0, count);
  return data;
}

/** The made-up operators A to H, each with answers of their own (the first `count` of them). */
const surveyed = (count = 8): AppData => ({
  ...newAppData(),
  people: syntheticTeam().slice(0, count),
});

/** Stores `code` for `person` on `date`. */
function put(data: AppData, date: ISODate, person: PersonId, code: CodeName) {
  (data.cells[date] ??= {})[person] = { code };
}

/** The control with this label on the card with this index (the first by default). */
const field = (label: string, card = 0) => screen.getAllByLabelText(label)[card];
// R1, R2, O and O20 label a select and a checkbox on each card: the kind of box tells them apart.
const ofKind = <T extends HTMLElement>(label: string, kind: string): T[] =>
  screen.getAllByLabelText(label).filter((box) => box.matches(kind)) as T[];
const select = (name: string, card = 0) => ofKind<HTMLSelectElement>(name, 'select')[card];
const checkbox = (name: string, card = 0) =>
  ofKind<HTMLInputElement>(name, 'input[type="checkbox"]')[card];
const button = (name: string, card = 0) => screen.getAllByRole('button', { name })[card];

const names = () => screen.getAllByLabelText('Jméno').map((box) => (box as HTMLInputElement).value);
const optionsOf = (box: HTMLSelectElement) => Array.from(box.options, (option) => option.text);

/** Replaces what is in a box, by typing. */
async function enter(box: HTMLElement, text: string) {
  await userEvent.clear(box);
  await userEvent.type(box, text);
}

/** Puts a whole text into a box at once, as a paste does: no number on the way is stored. */
function paste(box: HTMLElement, text: string) {
  fireEvent.change(box, { target: { value: text } });
}

// The survey's wording, as the spec has it (§6.3) and the brief gives it.
const NIGHTS = {
  never: 'Noční směny nechci / preferuji jejich neplánování.',
  ifNeeded: 'Noční směny spíše nechci, ale v případě potřeby je mohu sloužit.',
  normal: 'Noční směny mi nevadí a mohu je standardně sloužit.',
  extra: 'Rád budu brát noční směny i za mé kolegy, pokud je to možné.',
};
const WEEKENDS = {
  whole: 'Jeden celý víkend (so + ne) v měsíci',
  single: 'Jednotlivé dny ve více víkendech',
  any: 'Je mi to jedno',
};
const AFTER_WEEKEND = {
  want: 'Chci po víkendu volné dny',
  noAutomatic: 'Nerozdávat automaticky volné dny po víkendu',
  any: 'Je mi to jedno',
};
const AFTER_NIGHTS = 'Po posledním nočním (po 1 dni volna) může přijít';
const STARTING_COUNTS = 'Počáteční počty (před prvním naplánovaným měsícem)';
const MAX_TWELVE = 'Max. 12h směn za měsíc';
const MAX_NIGHTS = 'Max. nočních za měsíc';

// --- The brief's tests -----------------------------------------------------------------------

describe('the brief', () => {
  it('shows what is typed into a name', async () => {
    renderTeam();
    const first = field('Jméno');
    await enter(first, 'Nové jméno');
    expect(first).toHaveValue('Nové jméno');
    expect(people()[0].name).toBe('Nové jméno');
    expect(people()[1].name).toBe('Operátor 2'); // the other cards are as they were
  });

  it('stores the nights sentence that is chosen', async () => {
    renderTeam();
    await userEvent.selectOptions(select('Noční'), NIGHTS.extra);
    expect(people()[0].prefs.nights).toBe('extra');
  });

  it('adds a person', async () => {
    renderTeam();
    expect(screen.getAllByLabelText('Jméno')).toHaveLength(8);
    await userEvent.click(screen.getByRole('button', { name: 'Přidat člověka' }));
    expect(screen.getAllByLabelText('Jméno')).toHaveLength(9);
  });

  it('removes a person when the question is answered yes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderTeam();
    await userEvent.click(button('Odebrat'));
    expect(screen.getAllByLabelText('Jméno')).toHaveLength(7);
  });

  it('moves a person down, and the second name is first', async () => {
    renderTeam();
    await userEvent.click(button('Posunout dolů'));
    expect(names().slice(0, 3)).toEqual(['Operátor 2', 'Operátor 1', 'Operátor 3']);
  });
});

// --- The card ---------------------------------------------------------------------------------

describe('a card', () => {
  it('is there for each person, named after them, in the order of the team', () => {
    renderTeam();
    expect(names()).toEqual(Array.from({ length: 8 }, (_, i) => `Operátor ${i + 1}`));
    expect(screen.getAllByRole('article')).toHaveLength(8);
    expect(screen.getByRole('article', { name: 'Operátor 3' })).toBeInTheDocument();
  });

  it('holds the survey, the dates, the note, the numbers and the buttons', () => {
    renderTeam(team(1));
    const card = within(screen.getAllByRole('article')[0]);
    for (const name of ['R1', 'R2', 'O20', 'O', 'N', 'Noční', 'Víkendy', 'Po víkendu']) {
      expect(card.getByRole('combobox', { name })).toBeInTheDocument();
    }
    for (const name of ['Jméno', 'Poznámka']) {
      expect(card.getByRole('textbox', { name })).toBeInTheDocument();
    }
    for (const label of ['V týmu od', 'V týmu do']) {
      expect(card.getByLabelText(label)).toHaveAttribute('type', 'date');
    }
    const numbers = [
      'Dovolená / rok',
      'MyDay / rok',
      'Max. 12h směn za měsíc',
      'Max. nočních za měsíc',
      '12h směny',
      'Noční směny',
      'Svátky',
      'Vánoce',
    ];
    for (const name of numbers) {
      expect(card.getByRole('spinbutton', { name })).toBeInTheDocument();
    }
    for (const name of ['Posunout nahoru', 'Posunout dolů', 'Odebrat']) {
      expect(card.getByRole('button', { name })).toBeInTheDocument();
    }
    const counts = card.getByRole('group', { name: STARTING_COUNTS });
    expect(within(counts).getAllByRole('spinbutton')).toHaveLength(4);
  });

  it('lists the selects in the order of the survey: ratings, nights, weekends, after', () => {
    renderTeam(team(1));
    const labels = within(screen.getByRole('article'))
      .getAllByRole('combobox')
      .map((box) => (box as HTMLSelectElement).labels?.[0]?.textContent);
    expect(labels).toEqual(['R1', 'R2', 'O20', 'O', 'N', 'Noční', 'Víkendy', 'Po víkendu']);
  });

  it('shows what is stored for a person, in the words of the survey', () => {
    renderTeam(surveyed(6));
    // Operátor B: R1 5, R2 4, O20 3, O 1, N 2; nights if needed; a whole weekend; O and O20 after.
    expect(select('R1', 1)).toHaveDisplayValue('nejvíce preferuji');
    expect(select('R2', 1)).toHaveDisplayValue('spíše preferuji');
    expect(select('O20', 1)).toHaveDisplayValue('neutrální');
    expect(select('O', 1)).toHaveDisplayValue('nejméně preferuji');
    expect(select('N', 1)).toHaveDisplayValue('spíše nepreferuji');
    expect(select('Noční', 1)).toHaveDisplayValue(NIGHTS.ifNeeded);
    expect(select('Víkendy', 1)).toHaveDisplayValue(WEEKENDS.whole);
    expect(select('Po víkendu', 1)).toHaveDisplayValue(AFTER_WEEKEND.any);
    expect(['R1', 'R2', 'O', 'O20'].map((name) => checkbox(name, 1).checked)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    // Operátor F: nights extra, any weekend, no automatic days off after one.
    expect(select('Noční', 5)).toHaveDisplayValue(NIGHTS.extra);
    expect(select('Víkendy', 5)).toHaveDisplayValue(WEEKENDS.any);
    expect(select('Po víkendu', 5)).toHaveDisplayValue(AFTER_WEEKEND.noAutomatic);
    expect(checkbox('R2', 5).checked).toBe(true);
  });

  it('leaves the other people as they were when one is changed', async () => {
    renderTeam(surveyed(4));
    const before = people();
    await userEvent.selectOptions(select('R1', 2), 'neutrální');
    await userEvent.selectOptions(select('Noční', 2), NIGHTS.never);
    expect(people().filter((_, i) => i !== 2)).toEqual(before.filter((_, i) => i !== 2));
    expect(people()[2].prefs.ratings.R1).toBe(3);
  });
});

// --- Ratings ----------------------------------------------------------------------------------

describe('a rating', () => {
  it('offers the survey answers, from the most preferred, and none', () => {
    renderTeam(team(2));
    for (const shift of ['R1', 'R2', 'O20', 'O', 'N']) {
      expect(optionsOf(select(shift))).toEqual([
        '—',
        'nejvíce preferuji',
        'spíše preferuji',
        'neutrální',
        'spíše nepreferuji',
        'nejméně preferuji',
      ]);
    }
  });

  it('shows no rating as — for a person who has none', () => {
    renderTeam(team(2));
    for (const shift of ['R1', 'R2', 'O20', 'O', 'N']) {
      expect(select(shift)).toHaveDisplayValue('—');
    }
  });

  it('is stored as 5 for the most preferred down to 1 for the least', async () => {
    renderTeam(team(2));
    // Each step changes the rating, so each is a change the screen has to store.
    const steps: Array<[string, number]> = [
      ['nejvíce preferuji', 5],
      ['spíše preferuji', 4],
      ['neutrální', 3],
      ['spíše nepreferuji', 2],
      ['nejméně preferuji', 1],
    ];
    for (const [answer, rating] of steps) {
      await userEvent.selectOptions(select('R1'), answer);
      expect(people()[0].prefs.ratings.R1, answer).toBe(rating);
    }
  });

  it('is stored under the shift of its own select', async () => {
    renderTeam(team(2));
    for (const shift of ['R1', 'R2', 'O20', 'O', 'N']) {
      await userEvent.selectOptions(select(shift), 'spíše preferuji');
    }
    expect(people()[0].prefs.ratings).toEqual({ R1: 4, R2: 4, O20: 4, O: 4, N: 4 });
  });

  it('is removed by —, and the other ratings stay', async () => {
    renderTeam(surveyed(2)); // Operátor A: R1 4, R2 5, O20 2, O 2, N 1
    await userEvent.selectOptions(select('R1'), '—');
    expect(people()[0].prefs.ratings).toEqual({ R2: 5, O20: 2, O: 2, N: 1 });
    expect(people()[0].prefs.ratings).not.toHaveProperty('R1');
    expect(select('R1')).toHaveDisplayValue('—');
  });
});

// --- The other answers of the survey ----------------------------------------------------------

describe('the answers about nights, weekends and the days after', () => {
  it('offers the survey sentences for nights, in its order', () => {
    renderTeam(team(1));
    expect(optionsOf(select('Noční'))).toEqual([
      NIGHTS.never,
      NIGHTS.ifNeeded,
      NIGHTS.normal,
      NIGHTS.extra,
    ]);
  });

  it('stores each of the four nights sentences', async () => {
    renderTeam(team(2)); // the first person starts at normal; each step changes the answer
    const steps = [
      ['never', NIGHTS.never],
      ['ifNeeded', NIGHTS.ifNeeded],
      ['normal', NIGHTS.normal],
      ['extra', NIGHTS.extra],
    ] as const;
    for (const [stored, sentence] of steps) {
      await userEvent.selectOptions(select('Noční'), sentence);
      expect(people()[0].prefs.nights, sentence).toBe(stored);
    }
  });

  it('keeps the rest of the person when nights change', async () => {
    renderTeam(surveyed(4));
    const before = people()[3];
    await userEvent.selectOptions(select('Noční', 3), NIGHTS.normal);
    expect(people()[3]).toEqual({ ...before, prefs: { ...before.prefs, nights: 'normal' } });
  });

  it('offers and stores the weekend styles', async () => {
    renderTeam(team(2)); // the first person starts at whole
    expect(optionsOf(select('Víkendy'))).toEqual([
      WEEKENDS.whole,
      WEEKENDS.single,
      WEEKENDS.any,
    ]);
    const steps = [
      ['single', WEEKENDS.single],
      ['any', WEEKENDS.any],
      ['whole', WEEKENDS.whole],
    ] as const;
    for (const [stored, label] of steps) {
      await userEvent.selectOptions(select('Víkendy'), label);
      expect(people()[0].prefs.weekendStyle, label).toBe(stored);
    }
  });

  it('offers and stores what is wanted after a weekend', async () => {
    renderTeam(team(2)); // the first person starts at any
    expect(optionsOf(select('Po víkendu'))).toEqual([
      AFTER_WEEKEND.want,
      AFTER_WEEKEND.noAutomatic,
      AFTER_WEEKEND.any,
    ]);
    const steps = [
      ['want', AFTER_WEEKEND.want],
      ['noAutomatic', AFTER_WEEKEND.noAutomatic],
      ['any', AFTER_WEEKEND.any],
    ] as const;
    for (const [stored, label] of steps) {
      await userEvent.selectOptions(select('Po víkendu'), label);
      expect(people()[0].prefs.afterWeekend, label).toBe(stored);
    }
  });

  it('lists R1, R2, O and O20 under what may come after the last night', () => {
    renderTeam(team(1));
    const group = screen.getAllByRole('group', { name: AFTER_NIGHTS })[0];
    const boxes = within(group).getAllByRole('checkbox');
    expect(boxes.map((box) => box.parentElement?.textContent)).toEqual(['R1', 'R2', 'O', 'O20']);
    expect(boxes.some((box) => (box as HTMLInputElement).checked)).toBe(false);
  });

  it('stores the checked shifts in the order of the list, not of the clicks', async () => {
    renderTeam(team(2));
    await userEvent.click(checkbox('O20'));
    await userEvent.click(checkbox('R1'));
    await userEvent.click(checkbox('O'));
    expect(people()[0].prefs.afterNights).toEqual(['R1', 'O', 'O20']);
    expect(checkbox('R2').checked).toBe(false);

    await userEvent.click(checkbox('R1')); // unchecked
    expect(people()[0].prefs.afterNights).toEqual(['O', 'O20']);
    expect(checkbox('R1').checked).toBe(false);
    expect(checkbox('R1', 1).checked).toBe(false); // the next card is not the one that changed
  });

  it('keeps the note of a person', async () => {
    renderTeam(team(2));
    await enter(field('Poznámka'), 'Ve škole o některých víkendech');
    expect(people()[0].prefs.notes).toBe('Ve škole o některých víkendech');
    expect(field('Poznámka')).toHaveValue('Ve škole o některých víkendech');
    expect(field('Poznámka', 1)).toHaveValue('');
  });
});

// --- Dates ------------------------------------------------------------------------------------

describe('the dates a person is in the team', () => {
  it('stores them as YYYY-MM-DD', () => {
    renderTeam(team(2));
    fireEvent.change(field('V týmu od'), { target: { value: '2027-01-15' } });
    fireEvent.change(field('V týmu do'), { target: { value: '2027-03-31' } });
    expect(people()[0].activeFrom).toBe('2027-01-15');
    expect(people()[0].activeTo).toBe('2027-03-31');
    expect(field('V týmu od')).toHaveValue('2027-01-15');
    expect(field('V týmu do')).toHaveValue('2027-03-31');
    expect(field('V týmu od', 1)).toHaveValue('');
  });

  it('stores null, not an empty text, when a date is cleared', () => {
    const data = team(2);
    data.people[0].activeFrom = '2027-01-15';
    data.people[0].activeTo = '2027-03-31';
    renderTeam(data);
    expect(field('V týmu od')).toHaveValue('2027-01-15');

    fireEvent.change(field('V týmu od'), { target: { value: '' } });
    expect(people()[0].activeFrom).toBeNull();
    expect(people()[0].activeTo).toBe('2027-03-31'); // the other date stays

    fireEvent.change(field('V týmu do'), { target: { value: '' } });
    expect(people()[0].activeTo).toBeNull();
    expect(field('V týmu od')).toHaveValue('');
  });

  it('keeps the stored date when the box holds something but a YYYY-MM-DD date', () => {
    // A browser lets the year have more than four digits: one digit too many is not to clear
    // the date, and it is not to be stored.
    const data = team(2);
    data.people[0].activeFrom = '2027-01-15';
    renderTeam(data);
    fireEvent.change(field('V týmu od'), { target: { value: '20271-01-15' } });
    expect(people()[0].activeFrom).toBe('2027-01-15');
    expect(field('V týmu od')).toHaveValue('2027-01-15');
  });
});

// --- Numbers ----------------------------------------------------------------------------------

describe('the numbers', () => {
  it('start from what is stored', () => {
    renderTeam(team(2));
    expect(field('Dovolená / rok')).toHaveValue(25);
    expect(field('MyDay / rok')).toHaveValue(5);
    for (const label of ['12h směny', 'Noční směny', 'Svátky', 'Vánoce']) {
      expect(field(label)).toHaveValue(0);
    }
  });

  it('are stored as the allowance and the starting count that they are labelled for', async () => {
    renderTeam(team(2));
    await enter(field('Dovolená / rok'), '20');
    await enter(field('MyDay / rok'), '3');
    await enter(field('12h směny'), '4');
    await enter(field('Noční směny'), '5');
    await enter(field('Svátky'), '6');
    await enter(field('Vánoce'), '7');
    expect(people()[0].allowance).toEqual({ DOV: 20, MD: 3 });
    expect(people()[0].startingCounts).toEqual({
      twelve: 4,
      nights: 5,
      holidayTwelve: 6,
      festive: 7,
    });
    expect(people()[1].allowance).toEqual({ DOV: 25, MD: 5 }); // the next card is as it was
  });

  it('keep the last whole number while the box is empty, and show it on leaving', async () => {
    renderTeam(team(2));
    const box = field('Dovolená / rok');
    await userEvent.clear(box);
    expect(box).toHaveValue(null); // he can type the new number
    expect(people()[0].allowance.DOV).toBe(25);

    await userEvent.tab();
    expect(box).toHaveValue(25);
    expect(people()[0].allowance.DOV).toBe(25);
  });

  it('can be replaced by typing: every number on the way is stored, the last stays', async () => {
    renderTeam(team(2));
    const box = field('Dovolená / rok');
    await userEvent.clear(box);
    await userEvent.type(box, '1');
    expect(people()[0].allowance.DOV).toBe(1);
    await userEvent.type(box, '8');
    expect(box).toHaveValue(18);
    expect(people()[0].allowance.DOV).toBe(18);
  });

  it('leave the plan as it is when the number typed again is the one stored', async () => {
    renderTeam(team(2));
    const before = app.data;
    await enter(field('MyDay / rok'), '5'); // emptied, then the same number
    expect(field('MyDay / rok')).toHaveValue(5);
    expect(app.data).toBe(before); // nothing changed, so nothing is to be saved
  });

  it('store 0, but not a negative number', async () => {
    renderTeam(team(2));
    const box = field('MyDay / rok');
    await enter(box, '0');
    expect(people()[0].allowance.MD).toBe(0);

    await enter(box, '-3');
    expect(people()[0].allowance.MD).toBe(0); // not changed to -3
    await userEvent.tab();
    expect(box).toHaveValue(0);
  });

  it('do not store a number that cannot be exact, nor one too long to be a number', async () => {
    renderTeam(team(2));
    const box = field('Vánoce');
    await enter(box, '9'.repeat(30));
    const stored = people()[0].startingCounts.festive;
    expect(Number.isSafeInteger(stored)).toBe(true); // JSON keeps it as it is
    expect(JSON.parse(JSON.stringify(stored))).toBe(stored);
    await enter(box, '9'.repeat(400)); // would be Infinity, which a file would hold as null
    expect(Number.isFinite(people()[0].startingCounts.festive)).toBe(true);
  });

  it('do not store a fraction', async () => {
    renderTeam(team(2));
    const box = field('Svátky');
    await enter(box, '2.5');
    expect(Number.isInteger(people()[0].startingCounts.holidayTwelve)).toBe(true);
    expect(people()[0].startingCounts.holidayTwelve).toBe(2); // the "2" on the way to 2.5
    await userEvent.tab();
    expect(box).toHaveValue(2);
  });

  it('do not store a number a hair off a whole number', async () => {
    renderTeam(team(2));
    for (const [label, text] of [
      ['Dovolená / rok', '25.0000000001'],
      ['MyDay / rok', '4.9999999999'],
      ['Noční směny', '2.0000000001'],
    ] as const) {
      const box = field(label);
      await enter(box, text);
      expect(Object.values(people()[0].allowance).every(Number.isInteger)).toBe(true);
      expect(Object.values(people()[0].startingCounts).every(Number.isInteger)).toBe(true);
      await userEvent.tab();
      expect(Number.isInteger(Number((box as HTMLInputElement).value))).toBe(true);
    }
    expect(people()[0].allowance).toEqual({ DOV: 25, MD: 4 }); // the whole numbers on the way
    expect(people()[0].startingCounts.nights).toBe(2);
  });

  it('show the numbers of another plan that is opened for the same people', async () => {
    renderTeam(team(2));
    await userEvent.clear(field('Dovolená / rok')); // a box that waits for a number
    const other = newAppData();
    other.people[0].allowance.DOV = 30;
    other.people[1].startingCounts.festive = 2;
    act(() => {
      app.dispatch({ type: 'load', data: other });
    });
    expect(field('Dovolená / rok')).toHaveValue(30);
    expect(field('Vánoce', 1)).toHaveValue(2);
    expect(field('MyDay / rok')).toHaveValue(5);
  });
});

// --- The limits and the starting counts -------------------------------------------------------

/** January 2027 beside the cards: Kontrola lists what the limits of a card break. */
function renderBeside(data: AppData) {
  return render(
    <AppProvider storage={memoryStorage(data)} runner={inProcessRunner}>
      <MonthScreen initialMonth="2027-01" />
      <TeamScreen />
      <Probe />
    </AppProvider>,
  );
}

const kontrola = () => within(screen.getByRole('region', { name: 'Kontrola' }));

describe('the limits and the starting counts, Phase 1.1', () => {
  it('clearing the 12-hour limit goes back to the general value', async () => {
    // D works four 12-hour shifts, on the first two weekends of January.
    const data = surveyed(4);
    for (const date of ['2027-01-02', '2027-01-03', '2027-01-09', '2027-01-10']) {
      put(data, date, 'D', 'R12');
    }
    renderBeside(data);
    const broken = 'Operátor D · 2. 1.: 4 dvanáctihodinové směny (max. 3)';
    expect(kontrola().getByText(broken)).toBeInTheDocument(); // the general maximum, 3

    await enter(field(MAX_TWELVE, 3), '4');
    expect(people()[3].maxTwelve).toBe(4);
    expect(kontrola().queryByText(/dvanáctihodinové směny \(max\./)).toBeNull(); // D's own limit

    await userEvent.clear(field(MAX_TWELVE, 3));
    expect(people()[3].maxTwelve).toBeNull(); // not 0, and not the 4 that was there
    expect(kontrola().getByText(broken)).toBeInTheDocument(); // the general maximum again

    // It follows the general maximum from now on, and does not keep a copy of it.
    act(() => {
      app.dispatch({ type: 'updateSettings', patch: { maxTwelvePerMonth: 4 } });
    });
    expect(kontrola().queryByText(/dvanáctihodinové směny \(max\./)).toBeNull();
    expect(field(MAX_TWELVE, 3)).toHaveAttribute('placeholder', 'obecně 4');
  });

  it('max nights 0 is stored as 0', async () => {
    const data = surveyed(4);
    put(data, '2027-01-05', 'D', 'N'); // D works one night
    renderBeside(data);
    expect(kontrola().queryByText(/noční \(max\./)).toBeNull(); // no limit, so none is broken

    await enter(field(MAX_NIGHTS, 3), '0');
    expect(Object.is(people()[3].maxNights, 0)).toBe(true); // 0, and not null for no limit
    expect(field(MAX_NIGHTS, 3)).toHaveValue(0);
    expect(kontrola().getByText('Operátor D · 5. 1.: 1 noční (max. 0)')).toBeInTheDocument();

    await userEvent.clear(field(MAX_NIGHTS, 3));
    expect(people()[3].maxNights).toBeNull();
    expect(kontrola().queryByText(/noční \(max\./)).toBeNull();
  });

  it('the starting counts say they are before the first planned month', () => {
    renderTeam(team(1));
    const counts = screen.getByRole('group', { name: STARTING_COUNTS });
    expect(within(counts).getAllByRole('spinbutton')).toHaveLength(4);
    expect(screen.queryByRole('group', { name: 'Výchozí počty' })).toBeNull();
  });
});

const LIMITS = [
  { label: MAX_TWELVE, key: 'maxTwelve', max: 10, empty: 'obecně 3', over: '11' },
  { label: MAX_NIGHTS, key: 'maxNights', max: 31, empty: 'bez limitu', over: '32' },
] as const;

describe.each(LIMITS)('the limit $label', (limit) => {
  it(`is a number box of 0 to ${limit.max}, and empty for a person who has no limit`, () => {
    renderTeam(team(2));
    for (const card of [0, 1]) {
      const box = field(limit.label, card);
      expect(box).toHaveAttribute('type', 'number');
      expect(box).toHaveAttribute('min', '0');
      expect(box).toHaveAttribute('max', String(limit.max));
      expect(box).toHaveAttribute('step', '1');
      expect(box).toHaveValue(null);
      expect(box).toHaveAttribute('placeholder', limit.empty);
    }
  });

  it('shows the limit that is stored for each person, 0 among them', () => {
    const data = team(3);
    data.people[1][limit.key] = 5;
    data.people[2][limit.key] = 0;
    renderTeam(data);
    expect([0, 1, 2].map((card) => (field(limit.label, card) as HTMLInputElement).value)).toEqual([
      '',
      '5',
      '0',
    ]);
  });

  it('is stored for the person of its card, and nothing else of anyone changes', async () => {
    renderTeam(surveyed(3));
    const before = people();
    await enter(field(limit.label, 1), '2');
    expect(people()[1]).toEqual({ ...before[1], [limit.key]: 2 });
    expect([people()[0], people()[2]]).toEqual([before[0], before[2]]);
  });

  it('takes 0 and the most, and 0 is not an empty box', () => {
    renderTeam(team(2));
    paste(field(limit.label), String(limit.max));
    expect(people()[0][limit.key]).toBe(limit.max);
    paste(field(limit.label), '0');
    expect(Object.is(people()[0][limit.key], 0)).toBe(true);
    expect(field(limit.label)).toHaveValue(0);
  });

  it('keeps the limit that is stored for a number that is not good', async () => {
    renderTeam(team(2));
    const box = field(limit.label);
    paste(box, '2');
    await userEvent.click(box);
    for (const text of [limit.over, '2.5', '-1', '1e1', '2.0000000001']) {
      paste(box, text);
      expect(people()[0][limit.key], text).toBe(2);
      await userEvent.tab();
      expect(box, text).toHaveValue(2);
      await userEvent.click(box);
    }
  });

  it('is cleared with the box: null is stored, once, and the placeholder shows', async () => {
    renderTeam(team(2));
    const box = field(limit.label);
    paste(box, '3');
    await userEvent.clear(box);
    expect(people()[0][limit.key]).toBeNull();
    expect(box).toHaveValue(null);
    expect(box).toHaveAttribute('placeholder', limit.empty);

    await userEvent.type(box, '-5'); // not good, so not stored: still no limit
    const before = app.data;
    await userEvent.clear(box); // the limit was not set and is not: nothing changes or is saved
    expect(app.data).toBe(before);
  });

  it('shows the limits of another plan that is opened', async () => {
    renderTeam(team(2));
    await userEvent.type(field(limit.label), '4'); // a box with a number typed in it
    const other = team(2);
    other.people[0][limit.key] = null;
    other.people[1][limit.key] = 6;
    act(() => {
      app.dispatch({ type: 'load', data: other });
    });
    expect(field(limit.label, 0)).toHaveValue(null);
    expect(field(limit.label, 1)).toHaveValue(6);
  });
});

describe('the placeholder of the 12-hour limit', () => {
  it('names the general maximum, as the Rules screen has it now', () => {
    const data = team(2);
    data.settings.maxTwelvePerMonth = 4;
    renderTeam(data);
    expect(field(MAX_TWELVE, 0)).toHaveAttribute('placeholder', 'obecně 4');
    expect(field(MAX_TWELVE, 1)).toHaveAttribute('placeholder', 'obecně 4');
    act(() => {
      app.dispatch({ type: 'updateSettings', patch: { maxTwelvePerMonth: 6 } });
    });
    expect(field(MAX_TWELVE, 0)).toHaveAttribute('placeholder', 'obecně 6');
    expect(field(MAX_TWELVE, 1)).toHaveAttribute('placeholder', 'obecně 6');
  });

  it('is on a card whose limit is cleared, not on one that has a limit', () => {
    const data = team(2);
    data.people[1].maxTwelve = 2;
    renderTeam(data);
    expect(field(MAX_TWELVE, 0)).toHaveAttribute('placeholder', 'obecně 3');
    expect(field(MAX_TWELVE, 1)).toHaveValue(2);
  });
});

// --- Order ------------------------------------------------------------------------------------

describe('the order of the team', () => {
  it('has no way up for the first person and no way down for the last', () => {
    renderTeam(team(3));
    const up = screen.getAllByRole('button', { name: 'Posunout nahoru' });
    const down = screen.getAllByRole('button', { name: 'Posunout dolů' });
    expect(up.map((b) => (b as HTMLButtonElement).disabled)).toEqual([true, false, false]);
    expect(down.map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, false, true]);
  });

  it('moves a person up', async () => {
    renderTeam(team(3));
    await userEvent.click(button('Posunout nahoru', 2));
    expect(names()).toEqual(['Operátor 1', 'Operátor 3', 'Operátor 2']);
    expect(people().map((p) => p.id)).toEqual(['p1', 'p3', 'p2']);
  });

  it('moves a person down, with the answers on the card', async () => {
    renderTeam(surveyed(2));
    await userEvent.click(button('Posunout dolů', 0));
    expect(names().slice(0, 2)).toEqual(['Operátor B', 'Operátor A']);
    expect(select('Noční', 0)).toHaveDisplayValue(NIGHTS.ifNeeded); // B
    expect(select('Noční', 1)).toHaveDisplayValue(NIGHTS.never); // A
  });

  it('moves the arrows to the ends of the new order', async () => {
    renderTeam(team(3));
    await userEvent.click(button('Posunout dolů', 0));
    expect(button('Posunout nahoru', 0)).toBeDisabled(); // Operátor 2 is first now
    expect(button('Posunout nahoru', 1)).toBeEnabled(); // and Operátor 1 is not
  });
});

// --- Adding -----------------------------------------------------------------------------------

describe('adding a person', () => {
  it('puts a new person last, named after the size of the team, with an id', async () => {
    renderTeam(team(3));
    await userEvent.click(screen.getByRole('button', { name: 'Přidat člověka' }));
    expect(names()).toEqual(['Operátor 1', 'Operátor 2', 'Operátor 3', 'Operátor 4']);
    const ids = people().map((p) => p.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[3]).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/); // a UUID
  });

  it('gives each new person a different id', async () => {
    renderTeam(team(2));
    await userEvent.click(screen.getByRole('button', { name: 'Přidat člověka' }));
    await userEvent.click(screen.getByRole('button', { name: 'Přidat člověka' }));
    expect(names().slice(2)).toEqual(['Operátor 3', 'Operátor 4']);
    expect(new Set(people().map((p) => p.id)).size).toBe(4);
  });

  it('puts the cursor in the name of the new person, to type it', async () => {
    renderTeam(team(2));
    expect(document.body).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Přidat člověka' }));
    expect(field('Jméno', 2)).toHaveFocus();
    await userEvent.keyboard('!');
    expect(names()[2]).toBe('Operátor 3!');
  });

  it('shows the answers of a new person on the new card', async () => {
    renderTeam(team(2));
    await userEvent.click(screen.getByRole('button', { name: 'Přidat člověka' }));
    expect(select('R1', 2)).toHaveDisplayValue('—');
    expect(select('Noční', 2)).toHaveDisplayValue(NIGHTS.normal);
    expect(field('Dovolená / rok', 2)).toHaveValue(25);
    expect(button('Posunout dolů', 2)).toBeDisabled(); // the last one now
    expect(button('Posunout dolů', 1)).toBeEnabled();
  });
});

// --- Removing ---------------------------------------------------------------------------------

describe('removing a person', () => {
  it('asks with the name, and removes the person, their shifts, requests and notes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderTeam(team(3));
    act(() => {
      app.dispatch({ type: 'setCell', date: '2027-01-05', personId: 'p1', cell: { code: 'R1' } });
      app.dispatch({ type: 'setCell', date: '2027-01-05', personId: 'p2', cell: { code: 'x' } });
      const note = { from: 480, to: 720 };
      app.dispatch({ type: 'setDoctor', date: '2027-01-05', personId: 'p1', note });
      app.dispatch({ type: 'setDoctor', date: '2027-01-06', personId: 'p2', note });
    });

    await userEvent.click(button('Odebrat', 0));
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(
      'Odebrat Operátor 1 z týmu? Smažou se i všechny směny, žádosti a návštěvy lékaře této osoby.',
    );
    expect(names()).toEqual(['Operátor 2', 'Operátor 3']);
    expect(app.data?.cells).toEqual({ '2027-01-05': { p2: { code: 'x' } } });
    expect(app.data?.doctor).toEqual({ '2027-01-06': { p2: { from: 480, to: 720 } } });
  });

  it('asks for the person of the card that was pressed, by the name as it is now', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderTeam(team(5));
    await enter(field('Jméno', 2), 'Jiné jméno');
    await userEvent.click(button('Odebrat', 2));
    expect(confirm).toHaveBeenCalledWith(
      'Odebrat Jiné jméno z týmu? Smažou se i všechny směny, žádosti a návštěvy lékaře této osoby.',
    );
    expect(names()).toEqual(['Operátor 1', 'Operátor 2', 'Operátor 4', 'Operátor 5']);
  });

  it('keeps the person and everything of theirs when the question is answered no', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderTeam(team(2));
    act(() => {
      app.dispatch({ type: 'setCell', date: '2027-01-05', personId: 'p1', cell: { code: 'R1' } });
    });
    const before = app.data;

    await userEvent.click(button('Odebrat', 0));
    expect(confirm).toHaveBeenCalledOnce();
    expect(names()).toHaveLength(2);
    expect(app.data).toBe(before);
  });
});

// --- In the app -------------------------------------------------------------------------------

describe('the Tým tab', () => {
  it('shows the cards, and the button that adds a person', async () => {
    render(
      <AppProvider storage={memoryStorage(newAppData())} runner={inProcessRunner}>
        <App />
        <Probe />
      </AppProvider>,
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Tým' }));
    const panel = within(screen.getByRole('tabpanel', { name: 'Tým' }));
    expect(panel.getAllByLabelText('Jméno')).toHaveLength(8);
    expect(panel.getByRole('button', { name: 'Přidat člověka' })).toBeVisible();
    expect(panel.queryByText('Připravuje se…')).toBeNull();

    await userEvent.click(panel.getByRole('button', { name: 'Přidat člověka' }));
    expect(panel.getAllByLabelText('Jméno')).toHaveLength(9);
    expect(people()).toHaveLength(9);
  });
});

describe('the page as it runs', () => {
  it('works under StrictMode, which renders everything twice', async () => {
    render(
      <StrictMode>
        <AppProvider storage={memoryStorage(team(2))} runner={inProcessRunner}>
          <TeamScreen />
          <Probe />
        </AppProvider>
      </StrictMode>,
    );
    await enter(field('Dovolená / rok'), '12');
    expect(field('Dovolená / rok')).toHaveValue(12);
    expect(people()[0].allowance.DOV).toBe(12);

    await userEvent.click(screen.getByRole('button', { name: 'Přidat člověka' }));
    expect(names()).toEqual(['Operátor 1', 'Operátor 2', 'Operátor 3']);
    expect(field('Jméno', 2)).toHaveFocus();
  });
});
