import { describe, it, expect } from 'vitest';
import { monthDays, monthOf } from './calendar';
import type { DayInfo } from './calendar';
import { defaultSettings, newAppData } from './defaults';
import { addCounts, historyCounts, isClaimed, monthCounts } from './history';
import type {
  AppData,
  CodeName,
  FairnessCounts,
  ISODate,
  MonthKey,
  PersonId,
  StoredCell,
} from './types';

const NONE: FairnessCounts = { twelve: 0, nights: 0, holidayTwelve: 0, festive: 0 };
const counts = (patch: Partial<FairnessCounts>): FairnessCounts => ({ ...NONE, ...patch });

/** Stores `code` for person `id` on `date`; a pinned cell carries `pinned: true`. */
function put(data: AppData, date: ISODate, id: PersonId, code: CodeName, pinned = false): void {
  (data.cells[date] ??= {})[id] = pinned ? { code, pinned } : { code };
}

/** Gives each of `months` a record, as the app does for a month it has planned (a draft). */
function planMonths(data: AppData, ...months: MonthKey[]): void {
  for (const month of months) data.months[month] = { status: 'draft' };
}

/** The day `date` as the calendar describes it, with `dayTypeOverrides` of the settings. */
function dayOf(date: ISODate, overrides: Record<ISODate, 'weekday' | 'twelve'> = {}): DayInfo {
  const settings = { ...defaultSettings(), dayTypeOverrides: overrides };
  return monthDays(monthOf(date), settings).find((day) => day.date === date) as DayInfo;
}

describe('historyCounts', () => {
  it('counts January when February is built', () => {
    const data = newAppData();
    planMonths(data, '2027-01');
    put(data, '2027-01-02', 'p1', 'R12'); // Saturday
    put(data, '2027-01-09', 'p1', 'R12'); // Saturday
    put(data, '2027-01-04', 'p1', 'N');
    put(data, '2027-01-05', 'p1', 'N');
    put(data, '2027-01-06', 'p1', 'N');
    expect(historyCounts(data, '2027-02', 'p1')).toEqual(counts({ twelve: 2, nights: 3 }));
  });

  it('leaves out months beyond the fairness window', () => {
    const data = newAppData();
    planMonths(data, '2026-12', '2027-01');
    put(data, '2026-12-05', 'p1', 'R12'); // Saturday, two months before February
    put(data, '2027-01-02', 'p1', 'R12'); // Saturday, the month before
    data.settings.fairnessWindowMonths = 1;
    expect(historyCounts(data, '2027-02', 'p1').twelve).toBe(1); // January only
    data.settings.fairnessWindowMonths = 2;
    expect(historyCounts(data, '2027-02', 'p1').twelve).toBe(2); // December too
  });

  it('looks back 6 months by default, across the turn of a year', () => {
    const data = newAppData();
    planMonths(data, '2026-07', '2026-08', '2026-12');
    put(data, '2026-07-03', 'p1', 'N'); // 7 months before February 2027
    put(data, '2026-08-03', 'p1', 'N'); // 6 months before
    put(data, '2026-12-08', 'p1', 'N');
    expect(data.settings.fairnessWindowMonths).toBe(6);
    expect(historyCounts(data, '2027-02', 'p1').nights).toBe(2);
  });

  it.each([0, -3])('counts nothing when the window is %i months', (months) => {
    const data = newAppData();
    planMonths(data, '2027-01');
    put(data, '2027-01-05', 'p1', 'N');
    data.settings.fairnessWindowMonths = months;
    expect(historyCounts(data, '2027-02', 'p1')).toEqual(NONE);
  });

  it('clamps a window above 24 months to 24', () => {
    const data = newAppData();
    planMonths(data, '2027-02', '2027-03');
    put(data, '2027-02-02', 'p1', 'N'); // 25 months before March 2029
    put(data, '2027-03-02', 'p1', 'N'); // 24 months before
    for (const months of [24, 25, 1000]) {
      data.settings.fairnessWindowMonths = months;
      expect(historyCounts(data, '2029-03', 'p1').nights, `a window of ${months}`).toBe(1);
    }
  });

  it('does not count the month itself, nor the months after it', () => {
    const data = newAppData();
    planMonths(data, '2027-02', '2027-03');
    put(data, '2027-02-02', 'p1', 'N');
    put(data, '2027-03-02', 'p1', 'N');
    expect(historyCounts(data, '2027-02', 'p1')).toEqual(NONE);
  });

  it('counts a draft month and a closed month alike', () => {
    const data = newAppData();
    data.months['2027-01'] = { status: 'draft' };
    data.months['2026-12'] = { status: 'closed' };
    put(data, '2027-01-05', 'p1', 'N');
    put(data, '2026-12-08', 'p1', 'N');
    expect(historyCounts(data, '2027-02', 'p1').nights).toBe(2);
  });

  it('does not count a month that has cells but no record', () => {
    const data = newAppData();
    put(data, '2027-01-02', 'p1', 'R12');
    put(data, '2027-01-05', 'p1', 'N');
    expect(historyCounts(data, '2027-02', 'p1')).toEqual(NONE);
    planMonths(data, '2027-01'); // once the month is planned, the same cells count
    expect(historyCounts(data, '2027-02', 'p1')).toEqual(counts({ twelve: 1, nights: 1 }));
  });

  it('counts the months that have a record, and only those, within the window', () => {
    const data = newAppData();
    planMonths(data, '2026-11', '2027-01'); // December has none
    put(data, '2026-11-10', 'p1', 'N');
    put(data, '2026-12-08', 'p1', 'N');
    put(data, '2027-01-05', 'p1', 'N');
    expect(historyCounts(data, '2027-02', 'p1').nights).toBe(2);
  });

  it('leaves out the tail of December that January has as context: December has no record', () => {
    const data = newAppData();
    put(data, '2026-12-25', 'p1', 'R12'); // Friday, a holiday
    put(data, '2026-12-26', 'p1', 'N12'); // Saturday, a holiday
    put(data, '2026-12-31', 'p1', 'N');
    expect(historyCounts(data, '2027-01', 'p1')).toEqual(NONE);
  });

  it('counts only the cells of the person asked for', () => {
    const data = newAppData();
    planMonths(data, '2027-01');
    put(data, '2027-01-05', 'p1', 'N');
    put(data, '2027-01-05', 'p2', 'N');
    put(data, '2027-01-06', 'p2', 'N');
    expect(historyCounts(data, '2027-02', 'p1').nights).toBe(1);
    expect(historyCounts(data, '2027-02', 'p2').nights).toBe(2);
    expect(historyCounts(data, '2027-02', 'p3')).toEqual(NONE);
    expect(historyCounts(data, '2027-02', 'nobody')).toEqual(NONE);
  });

  it('adds the months up, field by field', () => {
    const data = newAppData();
    planMonths(data, '2026-12', '2027-01');
    put(data, '2026-12-24', 'p1', 'N12'); // a holiday and a festive day
    put(data, '2026-12-30', 'p1', 'R1');
    put(data, '2027-01-02', 'p1', 'R12'); // Saturday
    put(data, '2027-01-04', 'p1', 'N');
    expect(historyCounts(data, '2027-02', 'p1')).toEqual({
      twelve: 2,
      nights: 2,
      holidayTwelve: 1,
      festive: 1,
    });
  });

  it('does not count a claimed holiday shift as twelve', () => {
    const data = newAppData();
    planMonths(data, '2027-01');
    put(data, '2027-01-01', 'p1', 'R12', true);
    expect(historyCounts(data, '2027-02', 'p1')).toEqual(counts({ holidayTwelve: 1, festive: 1 }));
  });

  it('does count a holiday shift that nobody has claimed as twelve', () => {
    const data = newAppData();
    planMonths(data, '2027-01');
    put(data, '2027-01-01', 'p1', 'R12'); // not pinned
    expect(historyCounts(data, '2027-02', 'p1')).toEqual(
      counts({ twelve: 1, holidayTwelve: 1, festive: 1 }),
    );
  });

  it('does not change the data', () => {
    const data = newAppData();
    planMonths(data, '2027-01');
    put(data, '2027-01-01', 'p1', 'R12', true);
    const before = structuredClone(data);
    historyCounts(data, '2027-02', 'p1');
    expect(data).toEqual(before);
  });
});

describe('monthCounts', () => {
  // [what is stored, the day, its code, pinned, the counts of that month]
  it.each<[string, ISODate, CodeName, boolean, Partial<FairnessCounts>]>([
    ['a weekday shift on a plain day', '2027-01-05', 'R1', false, {}],
    ['a night on a plain day', '2027-01-05', 'N', false, { nights: 1 }],
    ['an R12 on a plain Saturday', '2027-01-02', 'R12', false, { twelve: 1 }],
    ['a pinned R12 on a plain Saturday', '2027-01-02', 'R12', true, { twelve: 1 }],
    ['an N12 on a plain Sunday', '2027-01-03', 'N12', false, { twelve: 1, nights: 1 }],
    ['an R12 on a holiday', '2027-03-26', 'R12', false, { twelve: 1, holidayTwelve: 1 }],
    ['a claimed R12 on a holiday', '2027-03-26', 'R12', true, { holidayTwelve: 1 }],
    ['a claimed N12 on a holiday', '2027-03-26', 'N12', true, { nights: 1, holidayTwelve: 1 }],
    ['a claimed R12 on a Saturday holiday', '2027-05-08', 'R12', true, { holidayTwelve: 1 }],
    [
      'an R12 on a festive holiday',
      '2027-01-01', 'R12', false,
      { twelve: 1, holidayTwelve: 1, festive: 1 },
    ],
    [
      'a claimed R12 on a festive holiday',
      '2027-01-01', 'R12', true,
      { holidayTwelve: 1, festive: 1 },
    ],
    ['an N on a festive day, no holiday', '2026-12-31', 'N', false, { nights: 1, festive: 1 }],
    ['an R1 on a festive day', '2026-12-31', 'R1', false, { festive: 1 }],
    ['nothing for a vacation day on a festive day', '2026-12-31', 'DOV', false, {}],
    ['nothing for a request on a festive day', '2026-12-31', 'x', false, {}],
    ['nothing for a pinned sick day', '2026-12-31', 'NEM', true, {}],
  ])('counts %s', (_what, date, code, pinned, expected) => {
    const data = newAppData();
    put(data, date, 'p1', code, pinned);
    expect(monthCounts(data, monthOf(date), 'p1')).toEqual(counts(expected));
  });

  it('adds up a whole month: twelve, nights, holiday and festive shifts', () => {
    const data = newAppData();
    put(data, '2026-12-24', 'p1', 'R12'); // Thursday: holiday, festive
    put(data, '2026-12-25', 'p1', 'N12', true); // Friday: holiday, festive, claimed
    put(data, '2026-12-26', 'p1', 'R12'); // Saturday: holiday, festive
    put(data, '2026-12-27', 'p1', 'N12'); // Sunday: no holiday
    put(data, '2026-12-28', 'p1', 'N');
    put(data, '2026-12-29', 'p1', 'DOV');
    put(data, '2026-12-31', 'p1', 'R1'); // festive, no holiday
    expect(monthCounts(data, '2026-12', 'p1')).toEqual({
      twelve: 3, // the R12 of the 24th and the 26th, the N12 of the 27th; the claimed N12 is extra
      nights: 3, // the N12 of the 25th and the 27th, the N of the 28th
      holidayTwelve: 3, // the 24th, 25th and 26th, claimed or not
      festive: 4, // the 24th, 25th, 26th and 31st
    });
  });

  it('counts the days of the month only', () => {
    const data = newAppData();
    put(data, '2026-12-31', 'p1', 'N');
    put(data, '2027-01-01', 'p1', 'N');
    put(data, '2027-01-31', 'p1', 'N');
    put(data, '2027-02-01', 'p1', 'N');
    expect(monthCounts(data, '2027-01', 'p1').nights).toBe(2);
    expect(monthCounts(data, '2026-12', 'p1').nights).toBe(1);
    expect(monthCounts(data, '2027-02', 'p1').nights).toBe(1);
  });

  it('uses the festive days of the settings', () => {
    const data = newAppData();
    put(data, '2027-01-05', 'p1', 'R1');
    put(data, '2027-01-06', 'p1', 'R1');
    data.settings.festiveDays = ['01-05'];
    expect(monthCounts(data, '2027-01', 'p1').festive).toBe(1);
  });

  it('is empty for a month with no cells and for a person with none', () => {
    const data = newAppData();
    put(data, '2027-01-05', 'p2', 'N');
    expect(monthCounts(data, '2027-01', 'p1')).toEqual(NONE);
    expect(monthCounts(data, '2027-03', 'p2')).toEqual(NONE);
    expect(monthCounts(data, '2027-01', 'nobody')).toEqual(NONE);
  });
});

describe('isClaimed', () => {
  const pinned = (code: CodeName): StoredCell => ({ code, pinned: true });

  it.each<[string, StoredCell, ISODate]>([
    ['a pinned R12 on a holiday', pinned('R12'), '2027-01-01'],
    ['a pinned N12 on a holiday', pinned('N12'), '2027-01-01'],
    ['a pinned R12 on a holiday that is a Saturday', pinned('R12'), '2027-05-08'],
    ['a pinned N12 on Christmas Day', pinned('N12'), '2027-12-25'],
  ])('is true for %s', (_what, cell, date) => {
    expect(isClaimed(cell, dayOf(date))).toBe(true);
  });

  it.each<[string, StoredCell | undefined, ISODate]>([
    ['an R12 on a holiday that is not pinned', { code: 'R12' }, '2027-01-01'],
    ['an R12 on a holiday with pinned: false', { code: 'R12', pinned: false }, '2027-01-01'],
    ['a pinned R12 on a plain Saturday', pinned('R12'), '2027-01-02'],
    ['a pinned N12 on a plain Sunday', pinned('N12'), '2027-01-03'],
    ['a pinned R12 on a plain weekday', pinned('R12'), '2027-01-05'],
    ['a pinned R1 on a holiday', pinned('R1'), '2027-01-01'],
    ['a pinned N on a holiday', pinned('N'), '2027-01-01'],
    ['a pinned vacation day on a holiday', pinned('DOV'), '2027-01-01'],
    ['a pinned request on a holiday', pinned('x'), '2027-01-01'],
    ['no cell on a holiday', undefined, '2027-01-01'],
  ])('is false for %s', (_what, cell, date) => {
    expect(isClaimed(cell, dayOf(date))).toBe(false);
  });

  it('goes by the public holiday, not by the type of the day', () => {
    // a plain Tuesday made a 12-hour day is no holiday; a holiday made a weekday is still one
    expect(isClaimed(pinned('R12'), dayOf('2027-01-05', { '2027-01-05': 'twelve' }))).toBe(false);
    expect(isClaimed(pinned('R12'), dayOf('2027-01-01', { '2027-01-01': 'weekday' }))).toBe(true);
  });
});

describe('addCounts', () => {
  it('adds the counts field by field and returns a new object', () => {
    const a = { twelve: 1, nights: 2, holidayTwelve: 3, festive: 4 };
    const b = { twelve: 10, nights: 20, holidayTwelve: 30, festive: 40 };
    const sum = addCounts(a, b);
    expect(sum).toEqual({ twelve: 11, nights: 22, holidayTwelve: 33, festive: 44 });
    expect(sum).not.toBe(a);
    expect(a).toEqual({ twelve: 1, nights: 2, holidayTwelve: 3, festive: 4 });
    expect(b).toEqual({ twelve: 10, nights: 20, holidayTwelve: 30, festive: 40 });
  });
});
