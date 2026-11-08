import { describe, it, expect, vi } from 'vitest';
import { mulberry32 } from '../../generator/rng';
import { ctxFor, noWishes, rowsOf, rules, run, units } from '../../test/rulekit';
import type { PersonPatch } from '../../test/rulekit';
import type { MonthContext } from '../context';
import { defaultSettings } from '../defaults';
import { days as fmtDays, fmtH } from '../format';
import type { Level, Preferences, Settings, WishId } from '../types';
import { evaluatePerson } from './person';
import type { Finding } from './types';

// fmtH and days are counted (the real ones still run), so that a test can see whether a message
// text was built.
vi.mock('../format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../format')>();
  return { ...actual, fmtH: vi.fn(actual.fmtH), days: vi.fn(actual.days) };
});

const c = ctxFor('2027-02', 1);
const u = (strip: string, id: Parameters<typeof units>[2], ctx = c) => units(run(ctx, rowsOf(ctx, [strip])), ctx, id);

describe('rhythm wishes', () => {
  it('W1: overtime above FPD', () => {
    const s = 'R2 R2 R2 R2 R2 R12 R12 | - R2 R2 R2 R2 - - | R2 R2 R2 R2 R2 - - | R2 R2 R2';
    const ev = run(c, rowsOf(c, [s]));
    expect(ev.persons[0].hours).toBe(150.5);
    expect(units(ev, c, 'W1')).toBeCloseTo(0.5);
  });
  it('W2: changes and short blocks', () => {
    expect(u('R1 R1 R1 R1 R1 - - | O20 O20 O20 O20 O20', 'W2')).toBe(0);
    expect(u('R1 R2 O20 R2 R1', 'W2')).toBe(4 + 5 * 3);
    expect(u('- - - - - - - | - - - - - - - | - - - - - - - | - - - - R1 - -', 'W2')).toBe(3);
  });
  it('W3: long stretches and lone free days', () => {
    expect(u('- - R2 R2 R2 R12 R12 | - - R1 R1 R1', 'W3')).toBe(0);
    // 7 days (M9's), 1 day off, 5 days: 1 for the day off after 5 or more, 3 for 12 days with
    // one day off, and a half for the lone day off
    expect(u('R1 R1 R1 R1 R1 R12 R12 | - O O O O N12', 'W3')).toBe(1 + 3 + 0.5);
  });
  it('W3 counts a stretch that started last month', () => {
    const j = ctxFor('2027-01', 1);
    // Dec 28 – Jan 2 is a 6-day stretch
    expect(units(run(j, rowsOf(j, ['R12 R12'], ['- - - R1 R1 R1 R1'])), j, 'W3')).toBe(1);
  });
  it('W4a: runs', () => {
    const x = ctxFor('2027-02', [{ prefs: { nights: 'extra' } }]);
    expect(u('- - - - - N12 N12 | N N N - - - - | N N N N N', 'W4a', x)).toBe(0);
    expect(u('N N - - - - - | N N', 'W4a', x)).toBe(2);
    expect(u('N N N - - - - | N N N - - - - | N N N', 'W4a', x)).toBe(1);
  });
  it('W4b: before nights', () => {
    expect(u('R1 - N N N', 'W4b')).toBe(1);
    expect(u('R2 N N', 'W4b')).toBe(2);
    expect(u('R2 - N N N', 'W4b')).toBe(0);
  });
  it('W4c: after nights', () => {
    expect(u('N N N - R1', 'W4c')).toBe(2);
    expect(u('N N N - O20', 'W4c')).toBe(1);
    expect(u('N N N - - R1', 'W4c')).toBe(0);
    const f = ctxFor('2027-02', [{ prefs: { afterNights: ['R2'] } }]);
    expect(u('N N N - R2', 'W4c', f)).toBe(1);
  });
  it('W4d: by willingness', () => {
    const k = (nights: 'extra' | 'normal' | 'ifNeeded') => { const x = ctxFor('2027-02', [{ prefs: { nights } }]); return u('N N N', 'W4d', x); };
    expect([k('extra'), k('normal'), k('ifNeeded')]).toEqual([0, 3, 12]);
  });
});

// --- Beyond the brief: what its examples leave open ---------------------------------------------
// February 2027 starts on a Monday: day i (counted from 0) is weekday i mod 7, and the weekends are
// days 5-6, 12-13, 19-20 and 26-27. A strip starts at day 0; a tail strip holds the 7 days before.

/** The wishes this file tests. */
const RHYTHM: WishId[] = ['W1', 'W2', 'W3', 'W4a', 'W4b', 'W4c', 'W4d'];
/** Wish levels with only these wishes on: a score is then that of the musts and these wishes. */
function onlyRhythm(): Settings['wishLevels'] {
  const levels = noWishes();
  for (const id of RHYTHM) levels[id] = 3;
  return levels;
}
/** `n` empty days, then `codes`. */
const pad = (n: number, ...codes: string[]) => [...Array(n).fill('-'), ...codes].join(' ');
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => from + k);
/** The findings of wish `id` for one person's strip (and the 7 days before the month). */
const found = (id: WishId, strip: string, tail: string[] = [], ctx = c) =>
  rules(run(ctx, rowsOf(ctx, [strip], tail)), id);
/** What findings say: the text, the days counted from day 1 (the tail is negative), the units. */
const listed = (fs: Finding[], ctx: MonthContext = c) =>
  fs
    .map((f) => ({
      message: f.message,
      days: f.days.map((d) => d - ctx.first),
      units: f.penalty / ctx.weights[f.rule as WishId],
    }))
    .sort((a, b) => (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));

describe('W1 in detail', () => {
  const week = 'R2 R2 R2 R2 R2 - -';
  const fpd = [week, week, week, week].join(' | '); // 20 x 7.5 = 150 h, exactly the FPD

  it('lists the overtime, in hours', () => {
    const s = 'R2 R2 R2 R2 R2 R12 R12 | - R2 R2 R2 R2 - - | R2 R2 R2 R2 R2 - - | R2 R2 R2';
    expect(rules(run(c, rowsOf(c, [s])), 'W1')).toEqual([{
      rule: 'W1',
      severity: 'wish',
      person: 0,
      days: [],
      message: 'přesčas 0,5 h',
      penalty: 0.5 * c.weights.W1,
    }]);
  });
  it('counts every hour over the FPD', () => {
    // 15 R2 and 5 R2 + 2 R12 make 173 h
    expect(u([week, week, week, 'R2 R2 R2 R2 R2 R12 R12'].join(' | '), 'W1')).toBeCloseTo(23);
  });
  it('asks nothing at the FPD or below it, whatever the previous month held', () => {
    expect(u(fpd, 'W1')).toBe(0);
    expect(u('R2 R2', 'W1')).toBe(0);
    expect(units(run(c, rowsOf(c, [fpd], ['R12 R12 R12 R12 R12 R12 R12'])), c, 'W1')).toBe(0);
  });
  it('measures person p against the FPD of person p', () => {
    const t = ctxFor('2027-02', [{}, { activeFrom: '2027-02-15' }]); // FPD 150 h and 75 h
    const [row] = rowsOf(t, [pad(14, 'R2 R2 R2 R2 R2 - - R2 R2 R2 R2 R2 R2')]); // 11 R2 = 82.5 h
    const over = (p: number) => {
      const seen: Finding[] = [];
      evaluatePerson(t, p, row, (f) => seen.push(f));
      return seen.filter((f) => f.rule === 'W1').map((f) => f.message);
    };
    expect([over(0), over(1)]).toEqual([[], ['přesčas 7,5 h']]);
  });
  it('does not take rounding noise for overtime', () => {
    // 20 shifts of 7.15 h add up to 143.00000000000006 h, a hair above the FPD of 20 x 7.15 h
    const k = ctxFor('2027-02', 1, {
      shifts: { ...defaultSettings().shifts, R2: { start: 480, end: 960, hours: 7.15 } },
      fpdHoursPerWeekday: 7.15,
    });
    const ev = run(k, rowsOf(k, [fpd]));
    expect(ev.persons[0].hours).toBeGreaterThan(k.people[0].fpd);
    expect(rules(ev, 'W1')).toEqual([]);
  });
});

describe('W2 in detail', () => {
  it('reports a change and each short block, with the cells and the text', () => {
    expect(listed(found('W2', 'R1 R2'))).toEqual([
      { message: 'krátký blok R1 (jen 1 den)', days: [0], units: 3 },
      { message: 'krátký blok R2 (jen 1 den)', days: [1], units: 3 },
      { message: 'změna směny uprostřed bloku (R1 → R2)', days: [0, 1], units: 1 },
    ]);
    expect(listed(found('W2', 'R1 R1'))).toEqual([
      { message: 'krátký blok R1 (jen 2 dny)', days: [0, 1], units: 2 },
    ]);
    // a shift that comes back is a new block, with its own cells
    expect(listed(found('W2', 'R1 R2 R1'))).toEqual([
      { message: 'krátký blok R1 (jen 1 den)', days: [0], units: 3 },
      { message: 'krátký blok R1 (jen 1 den)', days: [2], units: 3 },
      { message: 'krátký blok R2 (jen 1 den)', days: [1], units: 3 },
      { message: 'změna směny uprostřed bloku (R1 → R2)', days: [0, 1], units: 1 },
      { message: 'změna směny uprostřed bloku (R2 → R1)', days: [1, 2], units: 1 },
    ]);
    expect(listed(found('W2', 'O20 O20 O20'))).toEqual([
      { message: 'krátký blok O20 (jen 3 dny)', days: [0, 1, 2], units: 1 },
    ]);
  });
  it('lists the cells of the block, and only those, when other shifts lie among them', () => {
    // the R12 on Saturday is no part of the block of R1
    expect(listed(found('W2', '- - - - - R1 R12 R1 R1'))).toEqual([
      { message: 'krátký blok R1 (jen 3 dny)', days: [5, 7, 8], units: 1 },
    ]);
  });
  it('lets N, R12 and N12 neither change a block nor break it', () => {
    expect(u('R1 R1 R1 R1 R1 R12 R12 | R1 R1 R1 R1', 'W2')).toBe(0);
    expect(u('R1 R1 N R1 R1', 'W2')).toBe(0);
    expect(u('N N N N N R12 N12', 'W2')).toBe(0);
  });
  it('starts afresh after a day off, whatever it is', () => {
    for (const off of ['-', 'x', 'DOV', 'MD', 'OP', 'NEM']) {
      expect(u(`R1 R1 ${off} R1 R1`, 'W2')).toBe(2 + 2);
    }
  });
  it('exempts the last block of a stretch that reaches the last day of the month', () => {
    expect(u(pad(26, 'R1', 'R1'), 'W2')).toBe(0); // days 26-27, the last two
    expect(u(pad(25, 'R1', 'R1'), 'W2')).toBe(2); // days 25-26, and 27 is empty
    // The R12 are no part of the block, but the stretch reaches the last day, a Sunday: the block
    // goes on on Monday, in the next month.
    expect(u(pad(24, 'R1', 'R1', 'R12', 'R12'), 'W2')).toBe(0);
    expect(u(pad(25, 'R2', 'R2', 'N'), 'W2')).toBe(0); // a night, too, leaves the block open
    // Only the last block may go on: the R1 before the R2 may not.
    expect(listed(found('W2', pad(23, 'R1', 'R2', 'R2', 'R12', 'R12')))).toEqual([
      { message: 'krátký blok R1 (jen 1 den)', days: [23], units: 3 },
      { message: 'změna směny uprostřed bloku (R1 → R2)', days: [23, 24], units: 1 },
    ]);
  });
  it('gives a block no exemption if its stretch ends before the last day of the month', () => {
    // The same R1 R1 R12 R12, on days 17-20: the stretch ends on the Sunday of the third weekend,
    // a week before the last day, so the block cannot go on.
    expect(u(pad(17, 'R1', 'R1', 'R12', 'R12'), 'W2')).toBe(2);
    expect(u(pad(24, 'R1', 'R1', 'R12'), 'W2')).toBe(2); // ends on Saturday, a day before the last
  });
  it('counts a block that began last month with its days there', () => {
    expect(found('W2', 'R1', ['- - - - R1 R1 R1'])).toEqual([]); // 4 days, with day 1
    expect(found('W2', '', ['- - - - R1 R1 R1'])).toEqual([]); // 3 days, all last month's
    expect(listed(found('W2', 'R1', ['- - - - - R1 R1']))).toEqual([
      { message: 'krátký blok R1 (jen 3 dny)', days: [-2, -1, 0], units: 1 },
    ]);
  });
  it('counts a change at the turn of the month, but not one inside the previous month', () => {
    expect(listed(found('W2', 'R2 R2 R2 R2', ['- - - - - R1 R1']))).toEqual([
      { message: 'změna směny uprostřed bloku (R1 → R2)', days: [-1, 0], units: 1 },
    ]);
    expect(found('W2', '', ['R1 R2 - - - - -'])).toEqual([]);
  });
});

describe('W3 in detail', () => {
  const five = 'R1 R1 R1 R1 R1';
  const six = 'R1 R1 R1 R1 R1 R12';

  it('six days costs W3', () => {
    expect(listed(found('W3', six))).toEqual([
      { message: '6 dní v kuse (ideálně nejvýš 5)', days: range(0, 5), units: 1 },
    ]);
  });
  it('a single day off is a quiet W3', () => {
    expect(found('W3', 'R1 R1 - R1 R1')).toEqual([{
      rule: 'W3',
      severity: 'wish',
      person: 0,
      days: [c.first + 1, c.first + 2, c.first + 3],
      message: 'jen 1 den volna',
      penalty: 0.5 * c.weights.W3,
      quiet: true,
    }]);
  });
  it('seven days is no W3 but M9', () => {
    const ev = run(c, rowsOf(c, ['R1 R1 R1 R1 R1 R12 R12']));
    expect(rules(ev, 'W3')).toEqual([]);
    expect(rules(ev, 'M9')).toHaveLength(1);
  });
  it('asks nothing of 5 days in a row, nor of more than 6, which are M9\'s', () => {
    expect(u(five, 'W3')).toBe(0);
    expect(u('R1 R1 R1 R1 R1 R12 R12 | R1', 'W3')).toBe(0);
  });
  it('charges each day over 5 up to the maximum in a row, and leaves longer runs to M9', () => {
    const seven = 'R1 R1 R1 R1 R1 R12 R12';
    // at most 7 in a row: 7 days are 2 over the ideal, and break no must
    const k7 = ctxFor('2027-02', 1, { maxDaysInRow: 7 });
    const ev7 = run(k7, rowsOf(k7, [seven]));
    expect(listed(rules(ev7, 'W3'), k7)).toEqual([
      { message: '7 dní v kuse (ideálně nejvýš 5)', days: range(0, 6), units: 2 },
    ]);
    expect(rules(ev7, 'M9')).toEqual([]);
    // at most 5 in a row: 6 days are M9's alone
    const k5 = ctxFor('2027-02', 1, { maxDaysInRow: 5 });
    const ev5 = run(k5, rowsOf(k5, [six]));
    expect(rules(ev5, 'W3')).toEqual([]);
    expect(rules(ev5, 'M9')).toHaveLength(1);
  });
  it('adds a unit when 5 days of work are followed by 1 day off and more work', () => {
    expect(listed(found('W3', `${five} - R1`))).toEqual([
      { message: 'jen 1 den volna', days: [4, 5, 6], units: 0.5 },
      { message: 'po 5 dnech práce jen 1 den volna', days: range(0, 6), units: 1 },
    ]);
    expect(u('R1 R1 R1 R1 - R1', 'W3')).toBe(0.5); // only 4 days: the lone day off alone
    expect(u(`${five} - - R1`, 'W3')).toBe(0); // 2 days off
    expect(u(pad(22, five), 'W3')).toBe(0); // the day off is the last day: no work follows
  });
  it('adds 3 for a day off between stretches that make 12 days or more', () => {
    expect(listed(found('W3', `${six} - ${six}`))).toEqual([
      { message: '12 pracovních dní jen s jedním dnem volna', days: range(0, 12), units: 3 },
      { message: '6 dní v kuse (ideálně nejvýš 5)', days: range(0, 5), units: 1 },
      { message: '6 dní v kuse (ideálně nejvýš 5)', days: range(7, 12), units: 1 },
      { message: 'jen 1 den volna', days: [5, 6, 7], units: 0.5 },
      { message: 'po 6 dnech práce jen 1 den volna', days: range(0, 7), units: 1 },
    ]);
    // 6 + 5 = 11: the 6 days, the day off after them, and the lone day off
    expect(u(`${six} - ${five}`, 'W3')).toBe(1 + 1 + 0.5);
  });
  it('takes an absence or a request for a day off like any other', () => {
    for (const off of ['-', 'x', 'DOV', 'MD', 'OP', 'NEM']) {
      expect(u(`${six} ${off} ${six}`, 'W3')).toBe(2 + 1 + 3 + 0.5);
    }
  });
  it('judges each single day off on its own', () => {
    // three times 6 days, two days off after 6, twice 12 days, two lone days off
    expect(u(`${six} - ${six} - ${six}`, 'W3')).toBe(3 + 2 + 2 * 3 + 2 * 0.5);
    expect(u(`${five} - ${five} - ${five}`, 'W3')).toBe(2 + 2 * 0.5);
  });
  it('sees the work at the very end of the month', () => {
    expect(u(pad(22, 'R1 R1 R1 R1 R12 R12'), 'W3')).toBe(1); // 6 days up to the last
    expect(u(pad(21, five, '-', 'R1'), 'W3')).toBe(1 + 0.5); // 5 days, 1 off, work on the last
  });
  it('counts a stretch that began last month, but not one that ended there', () => {
    expect(found('W3', '', ['R1 R1 R1 R1 R1 R1 -'])).toEqual([]); // 6 days, all last month's
    expect(listed(found('W3', 'R1', ['- - R1 R1 R1 R1 R1']))).toEqual([
      { message: '6 dní v kuse (ideálně nejvýš 5)', days: range(-5, 0), units: 1 },
    ]);
  });
  it('counts a day off at the turn of the month against the work after it', () => {
    const tail = ['- R1 R1 R1 R1 R1 -'];
    expect(listed(found('W3', `${five} R1`, tail))).toEqual([
      { message: '6 dní v kuse (ideálně nejvýš 5)', days: range(0, 5), units: 1 },
      { message: 'jen 1 den volna', days: [-2, -1, 0], units: 0.5 },
      { message: 'po 5 dnech práce jen 1 den volna', days: range(-6, 0), units: 1 },
    ]);
    // 7 days of work after the day off (M9's): 1 for the day off after 5, 3 for 5 + 7 = 12, and
    // a half for the lone day off
    expect(units(run(c, rowsOf(c, [`${five} R1 R1`], tail)), c, 'W3')).toBe(1 + 3 + 0.5);
    // a day off between two stretches of the previous month is last month's
    expect(found('W3', '', ['R1 R1 R1 R1 R1 - R1'])).toEqual([]);
    expect(found('W3', 'R1', ['R1 R1 R1 R1 R1 - R1'])).toEqual([]);
  });
});

describe('W4a in detail', () => {
  it('reports a short run and a split month, with the cells and the text', () => {
    expect(listed(found('W4a', 'N N'))).toEqual([
      { message: 'krátký blok nočních (2 dny)', days: [0, 1], units: 1 },
    ]);
    expect(listed(found('W4a', 'N N N - N N N - N N N'))).toEqual([
      { message: 'noční rozdělené do 3 bloků', days: [0, 1, 2, 4, 5, 6, 8, 9, 10], units: 1 },
    ]);
  });
  it('asks 2 of a night on its own', () => {
    expect(u('N', 'W4a')).toBe(2);
    expect(u('N - - N', 'W4a')).toBe(2 + 2);
  });
  it('asks for more only of a run that does not reach the last day of the month', () => {
    expect(u(pad(27, 'N12'), 'W4a')).toBe(0);
    expect(u(pad(26, 'N12', 'N12'), 'W4a')).toBe(0);
    expect(u(pad(25, 'N12', 'N12'), 'W4a')).toBe(1); // ends a day before the last
  });
  it('splits hairs only above 5 nights', () => {
    expect(u('N N N - N N', 'W4a')).toBe(1); // 5 nights: just the run of 2
    expect(u('N N N - N N N', 'W4a')).toBe(0); // 6 nights in 2 runs, as ceil(6 / 5)
  });
  it('wants runs of about 5: 11 nights in 3 runs are as few as ceil(11 / 5)', () => {
    expect(u('N N N - N N N - N N N N N', 'W4a')).toBe(0);
  });
  it('asks a unit for each run beyond ceil(nights / 5)', () => {
    // 15 nights in 5 runs: 5 - 3
    expect(u('N N N - N N N - N N N - N N N - N N N', 'W4a')).toBe(2);
  });
  it('counts a run that began last month with its days there', () => {
    // 3 nights with the first of the month
    expect(found('W4a', 'N', ['- - - - - N N'])).toEqual([]);
    expect(found('W4a', '', ['- - - - - N N'])).toEqual([]); // 2 nights, all last month's
    expect(listed(found('W4a', 'N', ['- - - - - - N']))).toEqual([
      { message: 'krátký blok nočních (2 dny)', days: [-1, 0], units: 1 },
    ]);
  });
  it('does not count a run that stayed in the previous month among the runs', () => {
    // 6 nights in 2 runs, as ceil(6 / 5); the run of last month would make it 3
    expect(found('W4a', 'N N N - N N N', ['N N N - - - -'])).toEqual([]);
  });
  it('counts a run that began last month among the runs of the month', () => {
    // 8 nights of the month in 3 runs, the first begun last month: 3 - ceil(8 / 5)
    const split = found('W4a', 'N N - - N N N - - N N N', ['- - - - - - N']);
    expect(listed(split)).toEqual([
      { message: 'noční rozdělené do 3 bloků', days: [0, 1, 4, 5, 6, 9, 10, 11], units: 1 },
    ]);
  });
});

describe('W4b in detail', () => {
  it('reports a night right after a shift, and a bad shift two days before', () => {
    expect(listed(found('W4b', 'R2 N N'))).toEqual([
      { message: 'před nočními chybí den volna', days: [0, 1], units: 2 },
    ]);
    expect(listed(found('W4b', 'R1 - N N N'))).toEqual([
      { message: 'před nočními R1 (lépe R2, O20 nebo O)', days: [0, 1, 2], units: 1 },
    ]);
  });
  it('asks nothing of nights with nothing but days off before them', () => {
    expect(u('N N N', 'W4b')).toBe(0);
    expect(u(pad(10, 'N', 'N', 'N'), 'W4b')).toBe(0);
  });
  it.each([['R2', 0], ['O20', 0], ['O', 0], ['R1', 1], ['R12', 1], ['N', 1], ['N12', 1]])(
    'two days before the nights, %s gives %i',
    (code, k) => expect(u(`${code} - N N N`, 'W4b')).toBe(k),
  );
  it('sees a night on the last day of the month', () => {
    expect(u(pad(26, 'R12', 'N12'), 'W4b')).toBe(2);
  });
  it('takes an absence, a request or an empty day for the day off', () => {
    for (const off of ['-', 'x', 'DOV', 'OP']) {
      expect(u(`R1 ${off} N N N`, 'W4b')).toBe(1);
      expect(u(`R2 ${off} N N N`, 'W4b')).toBe(0);
    }
  });
  it('judges only the runs that start in the month', () => {
    expect(found('W4b', 'N N', ['- - - - R1 N N'])).toEqual([]); // begun last month
    expect(listed(found('W4b', 'N N N', ['- - - - - - R1']))).toEqual([
      { message: 'před nočními chybí den volna', days: [-1, 0], units: 2 },
    ]);
    expect(listed(found('W4b', 'N N N', ['- - - - - R1 -']))).toEqual([
      { message: 'před nočními R1 (lépe R2, O20 nebo O)', days: [-2, -1, 0], units: 1 },
    ]);
    expect(found('W4b', 'N N N', ['- - - - - R2 -'])).toEqual([]);
  });
});

describe('W4c in detail', () => {
  it('reports the shift after one day off, with the cells and the text', () => {
    expect(listed(found('W4c', 'N N N - R1'))).toEqual([
      { message: 'po nočních jen 1 den volna a pak R1', days: [2, 3, 4], units: 2 },
    ]);
    expect(listed(found('W4c', 'N N N - O'))).toEqual([
      { message: 'po nočních jen 1 den volna', days: [2, 3, 4], units: 1 },
    ]);
  });
  it('asks nothing when 2 days off follow, or when no shift does', () => {
    expect(u('N N N - - R1', 'W4c')).toBe(0);
    expect(u('N N N', 'W4c')).toBe(0);
    expect(u('N N N -', 'W4c')).toBe(0);
    expect(u(pad(24, 'N', 'N', 'N'), 'W4c')).toBe(0); // day 27 is off, then the month ends
    expect(u(pad(27, 'N12'), 'W4c')).toBe(0); // the nights reach the last day
  });
  it('leaves a shift right after the nights to M2', () => {
    expect(u('N N N R1', 'W4c')).toBe(0);
    expect(u('N N N R1 R1', 'W4c')).toBe(0);
  });
  it('sees a shift on the last day of the month', () => {
    expect(u(pad(23, 'N', 'N', 'N', '-', 'R1'), 'W4c')).toBe(2);
  });
  it('takes a request or an absence after the nights for that day off', () => {
    for (const off of ['x', 'DOV', 'NEM']) expect(u(`N N N ${off} R1`, 'W4c')).toBe(2);
  });
  it.each<[Preferences['afterNights'], string, number]>([
    [[], 'O20', 1], [[], 'O', 1], [[], 'R1', 2], [[], 'R2', 2], [[], 'R12', 2], [[], 'N', 2],
    [['R1'], 'R1', 1], [['R1'], 'R2', 2], [['R1', 'R2'], 'R2', 1], [['O'], 'R1', 2],
  ])('after a day off, with %j chosen, %s gives %i', (afterNights, code, k) => {
    const x = ctxFor('2027-02', [{ prefs: { afterNights } }]);
    expect(u(`N N N - ${code}`, 'W4c', x)).toBe(k);
  });
  it('does not take another night for a fallback', () => {
    expect(listed(found('W4c', 'N N N - N N N'))).toEqual([
      { message: 'po nočních jen 1 den volna a pak N', days: [2, 3, 4], units: 2 },
    ]);
  });
  it('looks at the first days of the month after nights at the end of the last one', () => {
    expect(listed(found('W4c', '- R1', ['- - - - N N N']))).toEqual([
      { message: 'po nočních jen 1 den volna a pak R1', days: [-1, 0, 1], units: 2 },
    ]);
    expect(listed(found('W4c', 'R1', ['- - - N N N -']))).toEqual([
      { message: 'po nočních jen 1 den volna a pak R1', days: [-2, -1, 0], units: 2 },
    ]);
    expect(found('W4c', '', ['- - N N N - R1'])).toEqual([]); // all of it last month's
  });
});

describe('W4d in detail', () => {
  const nights = (pref: Preferences['nights']) => ctxFor('2027-02', [{ prefs: { nights: pref } }]);

  it('lists the nights of someone who takes them only if needed', () => {
    const x = nights('ifNeeded');
    expect(listed(found('W4d', 'N N N', [], x), x)).toEqual([
      { message: '3× noční, i když je bere jen v nouzi', days: [0, 1, 2], units: 12 },
    ]);
  });
  it('counts N12 as a night, and only the nights of the month', () => {
    const x = nights('ifNeeded');
    expect(listed(found('W4d', pad(5, 'N12'), [], x), x)).toEqual([
      { message: '1× noční, i když je bere jen v nouzi', days: [5], units: 4 },
    ]);
    expect(units(run(x, rowsOf(x, [''], ['N N N N N N N'])), x, 'W4d')).toBe(0);
  });
  it('lists a night on the last day of the month', () => {
    const x = nights('ifNeeded');
    expect(listed(found('W4d', pad(26, 'N12', 'N12'), [], x), x)).toEqual([
      { message: '2× noční, i když je bere jen v nouzi', days: [26, 27], units: 8 },
    ]);
  });
  it('asks nothing for a night of someone who never takes them: S1 has it', () => {
    const x = nights('never');
    expect(u('N N N', 'W4d', x)).toBe(0);
    expect(rules(run(x, rowsOf(x, ['N N N'])), 'S1')).toHaveLength(3);
  });
  it('reports the nights of someone who takes them as usual in a quiet finding', () => {
    // The units of 'normal' are in the findings, because that is how the score is explained;
    // `quiet` keeps the finding out of the list of checks.
    const x = nights('normal');
    expect(found('W4d', 'N N N', [], x)).toEqual([{
      rule: 'W4d',
      severity: 'wish',
      person: 0,
      days: [x.first, x.first + 1, x.first + 2],
      message: '3× noční',
      penalty: 3 * x.weights.W4d,
      quiet: true,
    }]);
  });
  it('does not make the nights of someone who takes them only if needed quiet', () => {
    const x = nights('ifNeeded');
    // strictly equal: there is no `quiet` field at all, not even an undefined one
    expect(found('W4d', 'N N N', [], x)).toStrictEqual([{
      rule: 'W4d',
      severity: 'wish',
      person: 0,
      days: [x.first, x.first + 1, x.first + 2],
      message: '3× noční, i když je bere jen v nouzi',
      penalty: 12 * x.weights.W4d,
    }]);
  });
});

describe('the wishes of a person', () => {
  // Every wish fires: a 7-day stretch of changing shifts (W2) and lone days off (W3), overtime
  // (W1), and three runs of nights (W4a), the first short, after R2, R1 and N (W4b) and before R1
  // and N (W4c), for someone who takes nights only in need (W4d).
  const messy =
    'R1 R2 R2 R1 O R12 R12 | - R2 R2 R2 R2 R12 - | R2 N N - R1 - N | N N - N N N -';
  const ifNeeded = ctxFor('2027-02', [{ prefs: { nights: 'ifNeeded' } }]);
  const row = rowsOf(ifNeeded, [messy])[0];

  it('fire together (the row used below really does fire all of them)', () => {
    const seen = new Set<string>();
    evaluatePerson(ifNeeded, 0, row, (f) => seen.add(f.rule));
    for (const id of ['W1', 'W2', 'W3', 'W4a', 'W4b', 'W4c', 'W4d']) expect(seen).toContain(id);
  });
  it('add up: the findings make the score, and the wishes leave the must units alone', () => {
    // only these wishes on, so that wishes of other files cannot come into it
    const person: PersonPatch[] = [{ prefs: { nights: 'ifNeeded' } }];
    const mine = ctxFor('2027-02', person, { wishLevels: onlyRhythm() });
    const none = ctxFor('2027-02', person, { wishLevels: noWishes() });
    const seen: Finding[] = [];
    const withSink = evaluatePerson(mine, 0, row, (f) => seen.push(f));
    const musts = evaluatePerson(none, 0, row);
    expect(withSink).toEqual(evaluatePerson(mine, 0, row));
    expect(withSink.stats).toEqual(musts.stats);
    const wishes = seen.filter((f) => f.severity === 'wish');
    const sum = wishes.reduce((total, f) => total + f.penalty, 0);
    expect(withSink.score - musts.score).toBeCloseTo(sum, 3);
    expect(sum).toBeGreaterThan(0);
  });
  it('use the preferences of person p', () => {
    const t = ctxFor('2027-02', [
      { prefs: { nights: 'extra', afterNights: ['R1'] } },
      { prefs: { nights: 'ifNeeded', afterNights: [] } },
    ]);
    const [shared] = rowsOf(t, ['N N N - R1']);
    const unitsOf = (p: number, id: WishId) => {
      const seen: Finding[] = [];
      evaluatePerson(t, p, shared, (f) => seen.push(f));
      const sum = seen.filter((f) => f.rule === id).reduce((total, f) => total + f.penalty, 0);
      return sum / t.weights[id];
    };
    expect([unitsOf(0, 'W4d'), unitsOf(1, 'W4d')]).toEqual([0, 12]);
    expect([unitsOf(0, 'W4c'), unitsOf(1, 'W4c')]).toEqual([1, 2]);
  });
  it.each<[WishId, string]>([
    ['W1', 'R2 R2 R2 R2 R2 R12 R12 | - R2 R2 R2 R2 - - | R2 R2 R2 R2 R2 - - | R2 R2 R2'],
    ['W2', 'R1 R2'],
    ['W3', 'R1 R1 R1 R1 R1 R12'],
    ['W4a', 'N N'],
    ['W4b', 'R2 N N'],
    ['W4c', 'N N N - R1'],
    ['W4d', 'N N N'],
  ])('%s costs the weight of its own level, and nothing when switched off', (id, strip) => {
    const at = (level: Level) =>
      ctxFor('2027-02', 1, { wishLevels: { ...defaultSettings().wishLevels, [id]: level } });
    const cost = (ctx: MonthContext) =>
      found(id, strip, [], ctx).reduce((sum, f) => sum + f.penalty, 0);
    expect(cost(at(1))).toBeGreaterThan(0);
    expect(cost(at(5)) / cost(at(1))).toBe(16); // level 5 is x4, level 1 is x0.25
    expect(u(strip, id, at(5))).toBe(u(strip, id, at(1))); // the units do not depend on the level
    expect(found(id, strip, [], at(0))).toEqual([]);
  });
  it('are switched off one by one: the others go on', () => {
    const k = ctxFor('2027-02', 1, { wishLevels: { ...defaultSettings().wishLevels, W2: 0 } });
    expect(found('W2', 'R1 R2 N N', [], k)).toEqual([]);
    expect(found('W4a', 'R1 R2 N N', [], k)).not.toEqual([]);
  });
  it('builds no message text unless a sink is given', () => {
    vi.mocked(fmtH).mockClear();
    vi.mocked(fmtDays).mockClear();
    evaluatePerson(ifNeeded, 0, row);
    expect(fmtH).not.toHaveBeenCalled();
    expect(fmtDays).not.toHaveBeenCalled();
    evaluatePerson(ifNeeded, 0, row, () => undefined);
    expect(fmtH).toHaveBeenCalled();
    expect(fmtDays).toHaveBeenCalled();
  });
});

describe('the wishes on rows of any kind', () => {
  // A row of 35 cells with a bit of everything, from a fixed seed.
  const people: PersonPatch[] = [
    { prefs: { nights: 'extra' } },
    { prefs: { nights: 'normal', afterNights: ['R1', 'R2'] } },
    { prefs: { nights: 'ifNeeded', afterNights: ['O'] } },
    { prefs: { nights: 'never' } },
  ];
  // only the wishes of this file on, so that wishes of other files cannot come into it
  const t = ctxFor('2027-02', people, { wishLevels: onlyRhythm() });
  const off = ctxFor('2027-02', people, { wishLevels: noWishes() });
  const mineOf = (found: Finding[]) => found.filter((f) => RHYTHM.includes(f.rule as WishId));

  it('are scored the same with and without a sink, and every penalty is listed', () => {
    const random = mulberry32(20270201);
    let listedWishes = 0;
    for (let k = 0; k < 400; k++) {
      const row = new Uint8Array(t.days.length);
      const shifty = random() < 0.5 ? 0.8 : 0.45; // some rows are dense, some sparse
      for (let i = 0; i < row.length; i++) {
        const r = random();
        const code = r < shifty ? 1 + Math.floor(random() * 7) : r < 0.93 ? 0 : 8;
        row[i] = code === 8 ? 8 + Math.floor(random() * 5) : code; // 8 stands for an absence or x
      }
      const p = k % t.people.length;
      const seen: Finding[] = [];
      const withSink = evaluatePerson(t, p, row, (f) => seen.push(f));
      const musts = evaluatePerson(off, p, row);
      expect(withSink).toEqual(evaluatePerson(t, p, row));
      expect(withSink.stats).toEqual(musts.stats);

      const wishes = mineOf(seen);
      const sum = wishes.reduce((total, f) => total + f.penalty, 0);
      expect(withSink.score - musts.score).toBeCloseTo(sum, 3);
      for (const f of wishes) {
        expect(f.severity).toBe('wish');
        expect(f.person).toBe(p);
        expect(f.penalty).toBeGreaterThan(0);
        expect(f.message).not.toBe('');
        // only the nights of someone who takes them as usual and the lone days off are quiet; no
        // other has the field
        const quiet =
          (f.rule === 'W4d' && people[p].prefs?.nights === 'normal') ||
          (f.rule === 'W3' && f.message === 'jen 1 den volna');
        expect(f.quiet).toBe(quiet ? true : undefined);
        for (const d of f.days) expect(Number.isInteger(d) && d >= 0 && d < row.length).toBe(true);
        // a wish is reported only if it touches the month (W1 and the like name no day)
        if (f.days.length > 0) expect(Math.max(...f.days)).toBeGreaterThanOrEqual(t.first);
      }
      listedWishes += wishes.length;

      // a wish that is switched off scores nothing and reports nothing
      const quiet: Finding[] = [];
      evaluatePerson(off, p, row, (f) => quiet.push(f));
      expect(mineOf(quiet)).toEqual([]);
    }
    expect(listedWishes).toBeGreaterThan(1000); // the rows really did fire wishes
  });
});

describe('the findings of a month', () => {
  // Four people and a month that breaks seven musts, the strong wish S1 and all of these wishes:
  // coverage (M1), O -> R12 (M2), shifts before D joins (M3), nights before a request or an
  // absence (M4), 8 twelve-hour shifts for B (M5), hours below the FPD (M6), R12 on weekdays and N
  // on a Sunday (M8), and nights for D (S1). A takes nights as usual, so the month holds a quiet
  // finding.
  const team: PersonPatch[] = [
    { prefs: { nights: 'normal' } },
    { prefs: { nights: 'ifNeeded', afterNights: ['R1'] } },
    { prefs: { nights: 'extra' } },
    { prefs: { nights: 'never' }, activeFrom: '2027-02-08' },
  ];
  const strips = [
    'R1 R2 R2 R1 O R12 R12 | - R2 R2 R2 R2 R12 - | R2 N N - R1 - N | N N - N N N -',
    'R12 R12 R1 R1 R1 R12 R12 | R12 R12 R2 R2 N N N | N N - - R1 R12 R12',
    'N x R1 R1 R1 R1 R1 | N DOV - - R2 R2 R2 | R2 R2 R2 R2 R2 - - | O O O O O - -',
    'R1 R1 - - - - - | N N N - - - - | R2 R2 R2 R2 R2',
  ];
  const tails = ['R1 R1 R1 R1 R1 R1 R1', '- - - - N N N', '- - - - - N N'];
  const levelSets: Array<[string, Settings['wishLevels']]> = [
    ['the default levels', defaultSettings().wishLevels],
    ['every wish off', noWishes()],
    ['only these wishes on', onlyRhythm()],
    ['every wish at 5', { ...defaultSettings().wishLevels, ...Object.fromEntries(
      Object.keys(defaultSettings().wishLevels).map((id) => [id, 5])) }],
    ['a mixture', { ...defaultSettings().wishLevels, W1: 0, W2: 1, W3: 5, W4a: 2, W4b: 4, W4c: 0 }],
  ];

  it('has a message on every finding, and a quiet one among them', () => {
    const ctx = ctxFor('2027-02', team);
    const ev = run(ctx, rowsOf(ctx, strips, tails));
    expect(ev.findings.every((f) => f.message !== '')).toBe(true);
    expect(ev.findings.some((f) => f.quiet === true)).toBe(true);
    const seen = new Set(ev.findings.map((f) => f.rule));
    for (const id of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'S1', 'M8', ...RHYTHM]) {
      expect(seen).toContain(id); // the month really breaks every rule of this file and Task 4
    }
  });
  it.each(levelSets)('with %s, the findings add up to the score', (_, wishLevels) => {
    const ctx = ctxFor('2027-02', team, { wishLevels });
    const ev = run(ctx, rowsOf(ctx, strips, tails));
    const sum = ev.findings.reduce((total, f) => total + f.penalty, 0);
    expect(ev.score).toBeGreaterThan(0);
    // The two sums add the same penalties in another order. W6 spreads shifts over 5 codes, so its
    // penalties are fractions and the sums may differ by rounding errors, which grow with the
    // score (about 4e10 here): hence a relative tolerance. A penalty that lacks a finding would be
    // 1 or more, far above it.
    expect(Math.abs(sum - ev.score)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(ev.score)));
  });
});
