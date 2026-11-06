import { describe, it, expect, vi } from 'vitest';
import { mulberry32 } from '../../generator/rng';
import { ctxFor, noWishes, rowsOf, rules, run, units } from '../../test/rulekit';
import type { PersonPatch } from '../../test/rulekit';
import type { MonthContext } from '../context';
import { defaultSettings } from '../defaults';
import type { FairnessCounts, Level, Preferences, Settings, WeekdayShift, WishId } from '../types';
import { evaluateDay } from './day';
import { evaluateMonth } from './evaluate';
import { evaluateGlobal } from './global';
import { evaluatePerson } from './person';
import { report } from './personWishes';
import type { DayStats, Finding, PersonStats } from './types';

// `report` is counted (the real one still runs), so that a test can see whether a finding was
// built.
vi.mock('./personWishes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./personWishes')>();
  return { ...actual, report: vi.fn(actual.report) };
});

describe('global wishes', () => {
  it('W7: history decides who gets the extra 12-hour shifts', () => {
    const c = ctxFor('2027-02', [{ startingCounts: { twelve: 5 } }, {}]);
    const heavy = units(run(c, rowsOf(c, ['- - - - - R12 R12 | - - - - - R12', '- - - - - N12'])), c, 'W7');
    const light = units(run(c, rowsOf(c, ['- - - - - N12', '- - - - - R12 R12 | - - - - - R12'])), c, 'W7');
    expect(heavy).toBeCloseTo(24.5);
    expect(light).toBeCloseTo(4.5);
  });
  it('W7: nights count only among "ifNeeded" people', () => {
    const c = ctxFor('2027-02', [{ prefs: { nights: 'ifNeeded' } }, { prefs: { nights: 'ifNeeded' } }, { prefs: { nights: 'extra' } }]);
    expect(units(run(c, rowsOf(c, ['N N', '-', 'N N N N'])), c, 'W7')).toBeCloseTo(2);
  });
  it('W8: disliked shifts spread evenly among those who dislike them', () => {
    const p = { prefs: { ratings: { O: 1 as const } } };
    const c = ctxFor('2027-02', [p, p, p]);
    const piled = units(run(c, rowsOf(c, ['O O O O', '-', '-'])), c, 'W8');
    const spread = units(run(c, rowsOf(c, ['O O', 'O', '- - O'])), c, 'W8');
    expect(spread).toBeLessThan(piled);
  });
  it('W9: R2 spread across weekdays', () => {
    const c = ctxFor('2027-02', 3);
    const lumpy = units(run(c, rowsOf(c, ['R2', 'R2', 'R2'])), c, 'W9');
    const even = units(run(c, rowsOf(c, ['R2', '- R2', '- - R2'])), c, 'W9');
    expect(even).toBeLessThan(lumpy);
  });
});

// --- Beyond the brief: what its examples leave open ---------------------------------------------
// February 2027 starts on a Monday: day i (counted from 0) is weekday i mod 7, and the weekends are
// days 5-6, 12-13, 19-20 and 26-27. January 2027 starts on a Friday, a holiday and a festive day:
// day 0 is Fri 1 Jan, day 3 is Mon 4 Jan, and the weekdays are days 3-7, 10-14, 17-21 and 24-28.
// A strip starts at day 0. Wish levels are the default ones (3), so W7 weighs 20, W8 10 and W9 5.

/** A strip with the given codes on the given days (counted from 0) and nothing on the others. */
const at = (codes: Record<number, string>): string => {
  const days = Object.keys(codes).map(Number);
  return Array.from({ length: Math.max(-1, ...days) + 1 }, (_, i) => codes[i] ?? '-').join(' ');
};
/** The same strip for each of three people. */
const everyone = (codes: Record<number, string>): string[] => [at(codes), at(codes), at(codes)];
/** A person who has rated some shifts. */
const rating = (ratings: Preferences['ratings']): PersonPatch => ({ prefs: { ratings } });
/** The days of the month (counted from 0) that are weekdays by the settings. */
const weekdaysOf = (ctx: MonthContext): number[] =>
  ctx.days.slice(ctx.first).flatMap((day, i) => (day.dayType === 'weekday' ? [i] : []));
/** A strip with R2 on every weekday of the month but the ones in `except` (counted from 0). */
const r2EveryWeekday = (ctx: MonthContext, except: number[] = []): string =>
  at(Object.fromEntries(weekdaysOf(ctx).filter((i) => !except.includes(i)).map((i) => [i, 'R2'])));
/** The findings of wish `id` for the strips of a team. */
const found = (ctx: MonthContext, id: WishId, strips: string[]) =>
  rules(run(ctx, rowsOf(ctx, strips)), id);
/** The units of wish `id` for the strips of a team. */
const unitsOf = (ctx: MonthContext, id: WishId, strips: string[]) =>
  units(run(ctx, rowsOf(ctx, strips)), ctx, id);
/** What findings say: the person, the text, the days counted from day 1, the units, if quiet. */
const listed = (fs: Finding[], ctx: MonthContext) =>
  fs
    .map((f) => ({
      person: f.person,
      message: f.message,
      days: f.days.map((d) => d - ctx.first),
      units: f.penalty / ctx.weights[f.rule as WishId],
      quiet: f.quiet,
    }))
    .sort((a, b) =>
      a.message < b.message ? -1 : a.message > b.message ? 1 : (a.person ?? -1) - (b.person ?? -1),
    );
/** The `listed` form of a finding of W7 that is shown, and of one that is quiet. */
const shown = (person: number, message: string, units: number) =>
  ({ person, message, days: [], units, quiet: undefined });
const quiet = (person: number, message: string, units: number) =>
  ({ person, message, days: [], units, quiet: true });
/** Whether `a` and `b` differ by no more than rounding errors, which grow with the numbers. */
const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));

describe('W7 in detail', () => {
  it('shows a finding for whoever is ahead and keeps one quiet for whoever is behind', () => {
    const c = ctxFor('2027-02', [{ startingCounts: { twelve: 5 } }, {}]);
    // T = 8 and 1: the mean is 4.5, both are 3.5 away, and 3.5 x 3.5 = 12.25 units each. Strictly
    // equal: the finding to show has no `quiet` field at all, not even an undefined one.
    expect(found(c, 'W7', ['- - - - - R12 R12 | - - - - - R12', '- - - - - N12'])).toStrictEqual([
      {
        rule: 'W7',
        severity: 'wish',
        person: 0,
        days: [],
        message: 'víc dvanáctihodinových směn než ostatní',
        penalty: 12.25 * c.weights.W7,
      },
      {
        rule: 'W7',
        severity: 'wish',
        person: 1,
        days: [],
        message: 'méně dvanáctihodinových směn než ostatní',
        penalty: 12.25 * c.weights.W7,
        quiet: true,
      },
    ]);
  });
  it('shows a finding from one above the mean, and keeps it quiet below that', () => {
    const two = ctxFor('2027-02', 2);
    // T = 3 and 1: the mean is 2, and the first is exactly one above it
    const strips = [at({ 5: 'R12', 6: 'R12', 12: 'R12' }), at({ 5: 'N12' })];
    expect(listed(found(two, 'W7', strips), two)).toEqual([
      quiet(1, 'méně dvanáctihodinových směn než ostatní', 1),
      shown(0, 'víc dvanáctihodinových směn než ostatní', 1),
    ]);
    // T = 1, 0 and 0: the mean is 1/3, so nobody is a whole one away, but the units still count
    const three = ctxFor('2027-02', 3);
    const fs = found(three, 'W7', [at({ 5: 'R12' })]);
    expect(fs.map((f) => [f.person, f.message, f.quiet])).toEqual([
      [0, 'víc dvanáctihodinových směn než ostatní', true],
      [1, 'méně dvanáctihodinových směn než ostatní', true],
      [2, 'méně dvanáctihodinových směn než ostatní', true],
    ]);
    expect(unitsOf(three, 'W7', [at({ 5: 'R12' })])).toBeCloseTo(2 / 3, 12);
  });
  it('compares the nights of the people who take them "if needed" only', () => {
    const c = ctxFor('2027-02', [
      { prefs: { nights: 'ifNeeded' } },
      { prefs: { nights: 'ifNeeded' } },
      { prefs: { nights: 'extra' } },
    ]);
    // T = 3 and 0: the mean is 1.5, and 1.5 x 1.5 = 2.25 units each; the third one's six nights
    // are none of W7's business
    expect(listed(found(c, 'W7', ['N N N', '', 'N N N N N N']), c)).toEqual([
      quiet(1, 'méně nočních než ostatní', 2.25),
      shown(0, 'víc nočních než ostatní', 2.25),
    ]);
  });
  it('counts an N12 as a night and as a 12-hour shift', () => {
    const needed: PersonPatch = { prefs: { nights: 'ifNeeded' } };
    const c = ctxFor('2027-02', [needed, needed]);
    // T = 1 and 0 in both counts: half a unit away, 0.25 + 0.25 in each
    expect(unitsOf(c, 'W7', [at({ 5: 'N12' })])).toBe(1);
    expect(found(c, 'W7', [at({ 5: 'N12' })]).map((f) => f.message).sort()).toEqual([
      'méně dvanáctihodinových směn než ostatní',
      'méně nočních než ostatní',
      'víc dvanáctihodinových směn než ostatní',
      'víc nočních než ostatní',
    ]);
  });
  it('counts the 12-hour shifts on public holidays as a count of its own', () => {
    // Good Friday (Fri 26 Mar) and Easter Monday (Mon 29 Mar) 2027 are days 25 and 28
    const c = ctxFor('2027-03', 2);
    expect(listed(found(c, 'W7', [at({ 25: 'R12', 28: 'R12' })]), c)).toEqual([
      quiet(1, 'méně dvanáctihodinových směn než ostatní', 1),
      quiet(1, 'méně směn o svátcích než ostatní', 1),
      shown(0, 'víc dvanáctihodinových směn než ostatní', 1),
      shown(0, 'víc směn o svátcích než ostatní', 1),
    ]);
  });
  it('counts a shift of any kind on a festive day as a count of its own', () => {
    const c = ctxFor('2027-02', 2, { festiveDays: ['02-02', '02-03'] });
    expect(listed(found(c, 'W7', [at({ 1: 'R1', 2: 'R1' })]), c)).toEqual([
      quiet(1, 'méně směn o Vánocích a Silvestru než ostatní', 1),
      shown(0, 'víc směn o Vánocích a Silvestru než ostatní', 1),
    ]);
  });
  it('takes the festive days from the settings: 24, 25, 26 and 31 Dec and 1 Jan', () => {
    const c = ctxFor('2026-12', 2);
    // Thu 31 Dec is festive, Wed 30 Dec is not: T = 1 and 0
    expect(unitsOf(c, 'W7', [at({ 30: 'R1' }), at({ 29: 'R1' })])).toBeCloseTo(0.5, 12);
  });
  it('adds the history to the month in every count', () => {
    const ahead: PersonPatch = {
      prefs: { nights: 'ifNeeded' },
      startingCounts: { twelve: 4, nights: 4, holidayTwelve: 4, festive: 4 },
    };
    const c = ctxFor('2027-02', [ahead, { prefs: { nights: 'ifNeeded' } }]);
    // no shift at all: T = 4 and 0 in each of the four counts, 2 away from the mean, 4 units each
    expect(unitsOf(c, 'W7', [])).toBe(32);
    // (listed sorts by text, and a capital sorts before a small letter: Vánocích before svátcích)
    expect(listed(found(c, 'W7', []), c)).toEqual([
      quiet(1, 'méně dvanáctihodinových směn než ostatní', 4),
      quiet(1, 'méně nočních než ostatní', 4),
      quiet(1, 'méně směn o Vánocích a Silvestru než ostatní', 4),
      quiet(1, 'méně směn o svátcích než ostatní', 4),
      shown(0, 'víc dvanáctihodinových směn než ostatní', 4),
      shown(0, 'víc nočních než ostatní', 4),
      shown(0, 'víc směn o Vánocích a Silvestru než ostatní', 4),
      shown(0, 'víc směn o svátcích než ostatní', 4),
    ]);
  });
  it('asks nothing of a count that fewer than two people have', () => {
    const alone = ctxFor('2027-02', [{ startingCounts: { twelve: 5 } }]);
    expect(found(alone, 'W7', ['- - - - - R12'])).toEqual([]);
    // only one of the three takes nights "if needed", so their nights are compared with nobody's
    const c = ctxFor('2027-02', [
      { prefs: { nights: 'ifNeeded' } },
      { prefs: { nights: 'normal' } },
      { prefs: { nights: 'extra' } },
    ]);
    expect(found(c, 'W7', ['N N N N', 'N N', 'N'])).toEqual([]);
  });
  it('asks nothing when the counts are level', () => {
    const c = ctxFor('2027-02', [
      { startingCounts: { twelve: 2 } },
      { startingCounts: { twelve: 1 } },
    ]);
    expect(found(c, 'W7', ['', at({ 5: 'R12' })])).toEqual([]); // T = 2 + 0 and 1 + 1
    expect(found(ctxFor('2027-02', 3), 'W7', [])).toEqual([]);
  });
});

describe('W8 in detail', () => {
  it('is one finding for the shift, with the whole penalty, and no person or day', () => {
    const c = ctxFor('2027-02', [rating({ O: 1 }), rating({ O: 1 }), rating({ O: 1 })]);
    const [finding, ...others] = found(c, 'W8', ['O O O O', '', '']);
    expect(others).toEqual([]);
    // counts 4, 0 and 0: the mean is 4/3, and the squares of the distances add up to 96/9
    const { penalty, ...rest } = finding;
    expect(rest).toStrictEqual({
      rule: 'W8',
      severity: 'wish',
      person: null,
      days: [],
      message: 'směny O rozdělené nerovnoměrně mezi ty, kdo je nemají rádi',
    });
    expect(penalty / c.weights.W8).toBeCloseTo(96 / 9, 12);
  });
  it('compares only the people who rate the shift 2 or lower', () => {
    const c = ctxFor('2027-02', [rating({ O: 1 }), rating({ O: 2 }), rating({ O: 3 }), rating({})]);
    // counts 2 and 0 for the two who dislike O, so the mean is 1; the 5 and 5 of the others do not
    // count
    const strips = ['O O', '', 'O O O O O', 'O O O O O'];
    expect(found(c, 'W8', strips)).toHaveLength(1);
    expect(unitsOf(c, 'W8', strips)).toBe(2);
  });
  it('asks nothing of a shift that fewer than two people rate 2 or lower', () => {
    const lonely = ctxFor('2027-02', [rating({ O: 1 }), rating({ O: 3 }), rating({})]);
    expect(found(lonely, 'W8', ['O O O O', '', ''])).toEqual([]);
    const content = ctxFor('2027-02', [rating({ O: 3 }), rating({ O: 4 })]);
    expect(found(content, 'W8', ['O O O O', ''])).toEqual([]);
  });
  it('makes one finding for each shift, in the order R1, R2, O20, O, N', () => {
    const c = ctxFor('2027-02', [rating({ R1: 1, N: 2 }), rating({ R1: 2, N: 1 })]);
    // R1: counts 2 and 0, the mean is 1, so 1 + 1
    // N: counts 1 and 0, the mean is 0.5, so 0.25 + 0.25
    const fs = found(c, 'W8', ['R1 R1 - N', '']);
    expect(fs.map((f) => [f.message, f.penalty / c.weights.W8])).toEqual([
      ['směny R1 rozdělené nerovnoměrně mezi ty, kdo je nemají rádi', 2],
      ['směny N rozdělené nerovnoměrně mezi ty, kdo je nemají rádi', 0.5],
    ]);
  });
  it('asks nothing when the shift is spread evenly or not worked at all', () => {
    const c = ctxFor('2027-02', [rating({ O: 1 }), rating({ O: 1 }), rating({ O: 1 })]);
    expect(found(c, 'W8', ['O', 'O', 'O'])).toEqual([]);
    expect(found(c, 'W8', [])).toEqual([]);
  });
  it('does not count a 12-hour shift', () => {
    const c = ctxFor('2027-02', [rating({ O: 1, R1: 1 }), rating({ O: 1, R1: 1 })]);
    expect(found(c, 'W8', [at({ 5: 'R12', 6: 'N12' }), ''])).toEqual([]);
  });
});

describe('W9 in detail', () => {
  const jan = ctxFor('2027-01', 3);

  it('has the weekdays of January 2027 that the tests below count on', () => {
    expect(weekdaysOf(jan)).toEqual([
      ...[3, 4, 5, 6, 7],
      ...[10, 11, 12, 13, 14],
      ...[17, 18, 19, 20, 21],
      ...[24, 25, 26, 27, 28],
    ]);
  });
  it('shows a day far from the mean, and names the day', () => {
    // 3 people on R2 on Mon 4 Jan and nobody on the 19 other weekdays: the mean is 0.15, and the
    // squares of the distances add up to 9 - 20 x 0.15^2 = 8.55
    const [finding, ...others] = found(jan, 'W9', everyone({ 3: 'R2' }));
    expect(others).toEqual([]);
    const { penalty, ...rest } = finding;
    expect(rest).toStrictEqual({
      rule: 'W9',
      severity: 'wish',
      person: null,
      days: [jan.first + 3],
      message: 'nevyrovnaný počet R2',
    });
    expect(penalty / jan.weights.W9).toBeCloseTo(8.55, 12);
  });
  it('names every day that far, in order, and leaves the dates to the page', () => {
    const [finding] = found(jan, 'W9', everyone({ 3: 'R2', 10: 'R2' }));
    expect(finding.message).toBe('nevyrovnaný počet R2');
    expect(finding.days).toEqual([jan.first + 3, jan.first + 10]);
    expect(finding.penalty / jan.weights.W9).toBeCloseTo(16.2, 12); // 9 + 9 - 20 x 0.3^2
  });
  it('names only the days at least 2 away from the mean', () => {
    // r2 is 3 on Mon 4 Jan and 2 on Mon 11 Jan: the mean is 0.25, so they are 2.75 and 1.75 away
    const strips = [at({ 3: 'R2', 10: 'R2' }), at({ 3: 'R2', 10: 'R2' }), at({ 3: 'R2' })];
    const [finding] = found(jan, 'W9', strips);
    expect(finding.message).toBe('nevyrovnaný počet R2');
    expect(finding.days).toEqual([jan.first + 3]);
    expect(finding.penalty / jan.weights.W9).toBeCloseTo(11.75, 12);
  });
  it('names a day far below the mean as well', () => {
    // everyone on R2 on every weekday but Mon 4 Jan: the mean is 2.85, and 0 is 2.85 away from it
    const busy = r2EveryWeekday(jan, [3]);
    const [finding] = found(jan, 'W9', [busy, busy, busy]);
    expect(finding.message).toBe('nevyrovnaný počet R2');
    expect(finding.days).toEqual([jan.first + 3]);
    expect(finding.penalty / jan.weights.W9).toBeCloseTo(8.55, 12);
  });
  it('has the same message in any month: the dates are written from the days', () => {
    // Mon 4 Oct 2027 is day 3 as well
    const oct = ctxFor('2027-10', 3);
    const [finding] = found(oct, 'W9', everyone({ 3: 'R2' }));
    expect(finding.message).toBe('nevyrovnaný počet R2');
    expect(finding.days).toEqual([oct.first + 3]);
  });
  it('keeps the finding quiet when no day is 2 away, and names no day', () => {
    // one person on R2 on the five days of one week: r2 is 1 on 5 days, the mean is 0.25, and the
    // squares of the distances add up to 5 x 0.75^2 + 15 x 0.25^2 = 3.75
    const one = ctxFor('2027-01', 1);
    expect(found(one, 'W9', [at({ 3: 'R2', 4: 'R2', 5: 'R2', 6: 'R2', 7: 'R2' })])).toStrictEqual([
      {
        rule: 'W9',
        severity: 'wish',
        person: null,
        days: [],
        message: 'počet R2 se mezi všedními dny liší',
        penalty: 3.75 * one.weights.W9,
        quiet: true,
      },
    ]);
  });
  it('asks nothing of the same number of R2 on every weekday, or of none', () => {
    const one = ctxFor('2027-01', 1);
    expect(found(one, 'W9', [r2EveryWeekday(one)])).toEqual([]);
    expect(found(one, 'W9', [])).toEqual([]);
  });
  it('spreads over the weekdays only: a 12-hour day is no part of the mean', () => {
    const feb = ctxFor('2027-02', 3);
    // 3 people on R2 on Mon 1 Feb: 20 weekdays, so 9 - 20 x (3/20)^2 = 8.55
    expect(unitsOf(feb, 'W9', everyone({ 0: 'R2' }))).toBeCloseTo(8.55, 12);
    // R2 is not a shift on a Saturday: nothing is counted there
    expect(found(feb, 'W9', everyone({ 5: 'R2' }))).toEqual([]);
  });
  it('compares as few as two weekdays, and asks nothing of one', () => {
    const feb = ctxFor('2027-02', 3);
    const twelveExcept = (keep: number[]) =>
      ctxFor('2027-02', 3, {
        dayTypeOverrides: Object.fromEntries(
          weekdaysOf(feb)
            .filter((i) => !keep.includes(i))
            .map((i) => [feb.days[feb.first + i].date, 'twelve' as const]),
        ),
      });
    // 3 on R2 on Mon 1 Feb and 0 on Tue 2 Feb: the mean is 1.5, so 2.25 + 2.25
    expect(unitsOf(twelveExcept([0, 1]), 'W9', everyone({ 0: 'R2' }))).toBe(4.5);
    // one weekday is nothing to spread over
    expect(unitsOf(twelveExcept([0]), 'W9', everyone({ 0: 'R2' }))).toBe(0);
  });
  it('takes the weekdays from the day types of the settings', () => {
    const strips = everyone({ 0: 'R2' });
    // Wed 3 Feb set to a 12-hour day: 19 weekdays
    const fewer = ctxFor('2027-02', 3, { dayTypeOverrides: { '2027-02-03': 'twelve' } });
    expect(unitsOf(fewer, 'W9', strips)).toBeCloseTo(9 - 9 / 19, 12);
    // Sat 6 Feb set to a weekday: 21 weekdays
    const more = ctxFor('2027-02', 3, { dayTypeOverrides: { '2027-02-06': 'weekday' } });
    expect(unitsOf(more, 'W9', strips)).toBeCloseTo(9 - 9 / 21, 12);
    // and R2 on that Saturday counts: r2 is 3 there and 0 on the other 20 weekdays
    expect(unitsOf(more, 'W9', everyone({ 5: 'R2' }))).toBeCloseTo(9 - 9 / 21, 12);
  });
});

// --- The three wishes together ------------------------------------------------------------------

/** The wishes this file tests. */
const MINE: WishId[] = ['W7', 'W8', 'W9'];
/** Wish levels with only these wishes on: a score is then that of the musts and these wishes. */
function onlyMine(): Settings['wishLevels'] {
  const levels = noWishes();
  for (const id of MINE) levels[id] = 3;
  return levels;
}

describe('the global wishes W7 to W9 together', () => {
  // Four people with other preferences and counts, in January 2027, and a month in which every
  // global wish fires. A and B take nights "if needed", A is ahead in 12-hour shifts and nights
  // (history), D is ahead in festive days (history). A, B and C dislike O, B and C dislike N. On
  // Thu 7 Jan four people are on R2, and on Fri 8 Jan two.
  const team: PersonPatch[] = [
    {
      prefs: { nights: 'ifNeeded', ratings: { O: 1, R1: 2 } },
      startingCounts: { twelve: 3, nights: 2 },
    },
    { prefs: { nights: 'ifNeeded', ratings: { O: 2, N: 1 } } },
    { prefs: { nights: 'extra', ratings: { O: 1, N: 2 } } },
    { prefs: { nights: 'normal' }, startingCounts: { festive: 2 } },
  ];
  const strips = [
    at({ 0: 'R12', 1: 'R12', 3: 'O', 4: 'O', 5: 'O', 6: 'R2', 7: 'R2', 11: 'N', 12: 'N' }),
    at({ 3: 'O', 6: 'R2', 8: 'R12', 12: 'N' }),
    at({ 4: 'O', 5: 'O', 6: 'R2', 7: 'O', 10: 'N', 11: 'N' }),
    at({ 6: 'R2', 7: 'R2', 10: 'R2', 15: 'R12' }),
  ];
  const levelSets: Array<[string, Settings['wishLevels']]> = [
    ['the default levels', defaultSettings().wishLevels],
    ['every wish off', noWishes()],
    ['only these wishes on', onlyMine()],
    ['every wish at 5', Object.fromEntries(
      Object.keys(defaultSettings().wishLevels).map((id) => [id, 5])) as Settings['wishLevels']],
    ['a mixture', { ...defaultSettings().wishLevels, W7: 1, W8: 0, W9: 5 }],
  ];

  it('fires every wish, and shows some findings of W7 and keeps others quiet', () => {
    const ctx = ctxFor('2027-01', team);
    const ev = run(ctx, rowsOf(ctx, strips));
    for (const id of MINE) expect(rules(ev, id), id).not.toEqual([]);
    const w7 = rules(ev, 'W7');
    expect(w7.some((f) => f.quiet === true)).toBe(true);
    expect(w7.some((f) => f.quiet === undefined)).toBe(true);
    expect(rules(ev, 'W8').map((f) => f.message.split(' ')[1])).toEqual(['O', 'N']);
    expect(rules(ev, 'W8').every((f) => f.quiet === undefined)).toBe(true);
    const w9 = rules(ev, 'W9');
    expect(w9.map((f) => [f.message, f.quiet])).toEqual([
      ['nevyrovnaný počet R2', undefined],
    ]);
    expect(ev.findings.every((f) => f.message !== '')).toBe(true);
  });
  it.each(levelSets)('with %s, the findings add up to the score', (_, wishLevels) => {
    const ctx = ctxFor('2027-01', team, { wishLevels });
    const ev = run(ctx, rowsOf(ctx, strips));
    const sum = ev.findings.reduce((total, f) => total + f.penalty, 0);
    expect(ev.score).toBeGreaterThan(0);
    // The two sums add the same penalties in another order, and the musts are 1e9 or 1e6 each:
    // hence a relative tolerance. A penalty that lacks a finding would be far above it.
    expect(close(sum, ev.score)).toBe(true);
  });
  it('are scored by evaluateMonth on top of the persons and the days', () => {
    const ctx = ctxFor('2027-01', team);
    const rows = rowsOf(ctx, strips);
    const { score, persons, days } = evaluateMonth(ctx, rows);
    let rest = 0;
    ctx.people.forEach((_, p) => {
      rest += evaluatePerson(ctx, p, rows[p]).score;
    });
    for (let d = ctx.first; d < ctx.days.length; d++) rest += evaluateDay(ctx, d, rows).score;
    const global = evaluateGlobal(ctx, persons, days);
    expect(global).toBeGreaterThan(0);
    expect(close(score, rest + global)).toBe(true);
  });
  it.each<[WishId, PersonPatch[], string[]]>([
    [
      'W7',
      [{ startingCounts: { twelve: 5 } }, {}],
      ['- - - - - R12 R12 | - - - - - R12', '- - - - - N12'],
    ],
    ['W8', [rating({ O: 1 }), rating({ O: 1 }), rating({ O: 1 })], ['O O O O', '', '']],
    ['W9', [{}, {}, {}], everyone({ 0: 'R2' })],
  ])('%s costs the weight of its own level, and nothing when switched off', (id, people, rows) => {
    const atLevel = (level: Level) =>
      ctxFor('2027-02', people, { wishLevels: { ...defaultSettings().wishLevels, [id]: level } });
    const cost = (ctx: MonthContext) =>
      found(ctx, id, rows).reduce((sum, f) => sum + f.penalty, 0);
    expect(cost(atLevel(1))).toBeGreaterThan(0);
    expect(cost(atLevel(5)) / cost(atLevel(1))).toBe(16); // level 5 is x4, level 1 is x0.25
    expect(unitsOf(atLevel(5), id, rows)).toBe(unitsOf(atLevel(1), id, rows)); // not the level
    expect(found(atLevel(0), id, rows)).toEqual([]);
  });
  it('are switched off one by one: the others go on', () => {
    const levels = (off: WishId) => ({ ...defaultSettings().wishLevels, [off]: 0 });
    for (const off of MINE) {
      const ctx = ctxFor('2027-01', team, { wishLevels: levels(off) });
      const ev = run(ctx, rowsOf(ctx, strips));
      for (const id of MINE) {
        expect(rules(ev, id).length === 0, `${id} with ${off} off`).toBe(id === off);
      }
    }
  });
  it('score nothing and build nothing when they are all switched off', () => {
    const ctx = ctxFor('2027-01', team, { wishLevels: noWishes() });
    const { persons, days } = evaluateMonth(ctx, rowsOf(ctx, strips));
    const seen: Finding[] = [];
    expect(evaluateGlobal(ctx, persons, days, (f) => seen.push(f))).toBe(0);
    expect(seen).toEqual([]);
  });
  it('build no finding and no text unless a sink is given', () => {
    const ctx = ctxFor('2027-01', team);
    const { persons, days } = evaluateMonth(ctx, rowsOf(ctx, strips));
    const spy = vi.mocked(report);

    spy.mockClear();
    const plain = evaluateGlobal(ctx, persons, days);
    expect(spy).not.toHaveBeenCalled();

    const seen: Finding[] = [];
    expect(evaluateGlobal(ctx, persons, days, (f) => seen.push(f))).toBe(plain);
    expect(spy).toHaveBeenCalled();
    expect(seen.length).toBe(spy.mock.calls.length);
  });
  it('reads only the stats it is given: one DayStats for each day of the month, from day 1', () => {
    const ctx = ctxFor('2027-02', 2);
    const stats = (twelve: number): PersonStats => ({
      hours: 0,
      twelve,
      nights: 0,
      holidayTwelve: 0,
      festive: 0,
      perShift: [0, 0, 0, 0, 0],
      mustUnits: 0,
    });
    const days: DayStats[] = Array.from({ length: 28 }, () => ({ r2: 0, mustUnits: 0 }));
    // T = 3 and 1 in 12-hour shifts: the mean is 2, so 1 + 1 units of 20
    expect(evaluateGlobal(ctx, [stats(3), stats(1)], days)).toBe(40);
    // 3 on R2 on Mon 1 Feb, the first day: 8.55 units of 5
    days[0] = { r2: 3, mustUnits: 0 };
    expect(evaluateGlobal(ctx, [stats(1), stats(1)], days)).toBeCloseTo(8.55 * 5, 12);
  });
});

// --- Rows of any kind ---------------------------------------------------------------------------

/** The counts W7 compares, and the words that complete "víc … než ostatní" for each. */
const LABELS: Record<keyof FairnessCounts, string> = {
  twelve: 'dvanáctihodinových směn',
  nights: 'nočních',
  holidayTwelve: 'směn o svátcích',
  festive: 'směn o Vánocích a Silvestru',
};
const KINDS = Object.keys(LABELS) as Array<keyof FairnessCounts>;
const SHIFTS: WeekdayShift[] = ['R1', 'R2', 'O20', 'O', 'N'];

/** How far each value is from the mean of them all; nothing is compared below two values. */
function offsets(values: number[]): number[] {
  if (values.length < 2) return values.map(() => 0);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return values.map((v) => v - mean);
}
const squares = (values: number[]) => offsets(values).reduce((sum, d) => sum + d * d, 0);

/** Who W7 compares for a count: everyone, but for nights only those who take them "if needed". */
const among = (ctx: MonthContext, kind: keyof FairnessCounts) =>
  ctx.people.flatMap((person, p) =>
    kind !== 'nights' || person.prefs.nights === 'ifNeeded' ? [p] : []);
/** The count of person `p`: the history and the month. */
const totalOf = (
  ctx: MonthContext,
  persons: PersonStats[],
  kind: keyof FairnessCounts,
  p: number,
) => ctx.people[p].history[kind] + persons[p][kind];
/** Who W8 compares for a shift: those who rate it 2 or lower. */
const dislike = (ctx: MonthContext, name: WeekdayShift) =>
  ctx.people.flatMap((person, p) => {
    const rate = person.prefs.ratings[name];
    return rate !== undefined && rate <= 2 ? [p] : [];
  });
/** The R2 of each weekday of the month. */
const r2Of = (ctx: MonthContext, days: DayStats[]) =>
  days.flatMap((day, i) => (ctx.days[ctx.first + i].dayType === 'weekday' ? [day.r2] : []));

/** W7 to W9 as the plan words them, in plain code that builds whatever it likes. */
function reference(ctx: MonthContext, persons: PersonStats[], days: DayStats[]): number {
  let w7 = 0;
  for (const kind of KINDS) {
    w7 += squares(among(ctx, kind).map((p) => totalOf(ctx, persons, kind, p)));
  }
  let w8 = 0;
  SHIFTS.forEach((name, k) => {
    w8 += squares(dislike(ctx, name).map((p) => persons[p].perShift[k]));
  });
  const w9 = squares(r2Of(ctx, days));
  return w7 * ctx.weights.W7 + w8 * ctx.weights.W8 + w9 * ctx.weights.W9;
}

describe('the global wishes on rows of any kind', () => {
  // Five people with other preferences and counts, in three months with holidays and festive days:
  // Dec 2026 (24, 25, 26 and 31 Dec), Jan 2027 (1 Jan) and Mar 2027 (Good Friday, Easter Monday).
  const people: PersonPatch[] = [
    {
      prefs: { nights: 'ifNeeded', ratings: { O: 1, R1: 2 } },
      startingCounts: { twelve: 2, nights: 3, holidayTwelve: 1, festive: 0 },
    },
    { prefs: { nights: 'ifNeeded', ratings: { O: 2, N: 1 } }, startingCounts: { nights: 1 } },
    { prefs: { nights: 'normal', ratings: { O: 1, R1: 1, R2: 2 } } },
    { prefs: { nights: 'extra', ratings: {} }, startingCounts: { festive: 2 } },
    { prefs: { nights: 'never', ratings: { R2: 1, N: 2 } }, startingCounts: { twelve: 1 } },
  ];
  const months = ['2026-12', '2027-01', '2027-03'].map((month) => ctxFor(month, people));

  /** Month cells with a bit of everything: some rows are dense, some sparse. */
  function randomRow(ctx: MonthContext, random: () => number): Uint8Array {
    const row = new Uint8Array(ctx.days.length);
    const shifty = random() < 0.5 ? 0.8 : 0.4;
    for (let i = ctx.first; i < row.length; i++) {
      if (random() >= shifty) continue;
      row[i] = ctx.days[i].dayType === 'twelve' && random() < 0.7
        ? 6 + Math.floor(random() * 2) // R12 or N12 on a 12-hour day
        : 1 + Math.floor(random() * 7); // any shift
    }
    return row;
  }

  it('are scored like the plain reference, with a sink or without, and all is listed', () => {
    const random = mulberry32(20270601);
    const fired = { w7Shown: 0, w7Quiet: 0, w8: 0, w9Shown: 0, w9Quiet: 0 };
    for (let k = 0; k < 900; k++) {
      const ctx = months[k % months.length];
      const rows = ctx.people.map(() => randomRow(ctx, random));
      const { persons, days, score } = evaluateMonth(ctx, rows);

      const seen: Finding[] = [];
      const withSink = evaluateGlobal(ctx, persons, days, (f) => seen.push(f));
      const plain = evaluateGlobal(ctx, persons, days);
      expect(withSink).toBe(plain);
      expect(close(plain, reference(ctx, persons, days))).toBe(true);
      expect(close(seen.reduce((total, f) => total + f.penalty, 0), plain)).toBe(true);

      // evaluateMonth adds exactly that to the persons and the days
      let rest = 0;
      ctx.people.forEach((_, p) => {
        rest += evaluatePerson(ctx, p, rows[p]).score;
      });
      for (let d = ctx.first; d < ctx.days.length; d++) rest += evaluateDay(ctx, d, rows).score;
      expect(close(score, rest + plain)).toBe(true);

      // W7: a finding for everyone who is off the mean in a count, shown from 1 above the mean
      const w7 = seen.filter((f) => f.rule === 'W7');
      let w7Expected = 0;
      for (const kind of KINDS) {
        const who = among(ctx, kind);
        const off = offsets(who.map((p) => totalOf(ctx, persons, kind, p)));
        w7Expected += off.filter((d) => d !== 0).length;
        who.forEach((p, i) => {
          const text = `${off[i] > 0 ? 'víc' : 'méně'} ${LABELS[kind]} než ostatní`;
          const mine = w7.filter((f) => f.person === p && f.message === text);
          if (off[i] === 0) {
            expect(mine).toEqual([]);
            return;
          }
          expect(mine).toHaveLength(1);
          const f = mine[0];
          expect(f.severity).toBe('wish');
          expect(f.days).toEqual([]);
          expect(close(f.penalty, off[i] * off[i] * ctx.weights.W7)).toBe(true);
          expect(f.quiet).toBe(off[i] >= 1 ? undefined : true);
          fired[off[i] >= 1 ? 'w7Shown' : 'w7Quiet']++;
        });
      }
      expect(w7).toHaveLength(w7Expected);

      // W8: one finding to show for each shift that is spread unevenly among those who dislike it
      const w8 = seen.filter((f) => f.rule === 'W8');
      const uneven = SHIFTS.filter((name, k) =>
        squares(dislike(ctx, name).map((p) => persons[p].perShift[k])) > 0);
      expect(w8.map((f) => f.message.split(' ')[1])).toEqual(uneven);
      for (const f of w8) {
        expect(f.severity).toBe('wish');
        expect(f.person).toBeNull();
        expect(f.days).toEqual([]);
        expect(f.quiet).toBeUndefined();
        expect(f.message).toMatch(/^směny \S+ rozdělené nerovnoměrně mezi ty, kdo je nemají rádi$/);
        fired.w8++;
      }

      // W9: one finding, to show if a weekday is 2 or more away from the mean, with those days
      const w9 = seen.filter((f) => f.rule === 'W9');
      const r2 = r2Of(ctx, days);
      const r2Offsets = offsets(r2);
      if (squares(r2) === 0) {
        expect(w9).toEqual([]);
      } else {
        expect(w9).toHaveLength(1);
        const [f] = w9;
        expect(f.severity).toBe('wish');
        expect(f.person).toBeNull();
        expect(close(f.penalty, squares(r2) * ctx.weights.W9)).toBe(true);
        const far = weekdaysOf(ctx).filter((_, i) => Math.abs(r2Offsets[i]) >= 2);
        if (far.length === 0) {
          expect(f.quiet).toBe(true);
          expect(f.days).toEqual([]);
          expect(f.message).toBe('počet R2 se mezi všedními dny liší');
          fired.w9Quiet++;
        } else {
          expect(f.quiet).toBeUndefined();
          expect(f.days).toEqual(far.map((i) => ctx.first + i));
          expect(f.message).toBe('nevyrovnaný počet R2');
          fired.w9Shown++;
        }
      }
    }
    // the rows really did fire every kind of finding
    for (const [kind, count] of Object.entries(fired)) expect(count, kind).toBeGreaterThan(20);
  });
});
