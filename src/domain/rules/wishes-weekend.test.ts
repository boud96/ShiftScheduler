import { describe, it, expect, vi } from 'vitest';
import { ctxFor, noWishes, rowsOf, rules, run, units } from '../../test/rulekit';
import type { PersonPatch } from '../../test/rulekit';
import { CODE_NAMES } from '../codes';
import type { MonthContext } from '../context';
import { defaultSettings } from '../defaults';
import type { Level, Settings, WeekdayShift, WishId } from '../types';
import { evaluatePerson } from './person';
import { twelveDays } from './personMusts';
import { cellsWith, report } from './personWishes';
import type { Finding } from './types';

// The helpers that build a finding or the cells of one are counted (the real ones still run), so
// that a test can see whether anything was built.
vi.mock('./personWishes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./personWishes')>();
  return { ...actual, report: vi.fn(actual.report), cellsWith: vi.fn(actual.cellsWith) };
});
vi.mock('./personMusts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./personMusts')>();
  return { ...actual, twelveDays: vi.fn(actual.twelveDays) };
});

const u = (p: PersonPatch, strip: string, id: Parameters<typeof units>[2]) => {
  const c = ctxFor('2027-02', [p]); return units(run(c, rowsOf(c, [strip])), c, id);
};

describe('weekend and preference wishes', () => {
  it('W5a: distance from 2', () => {
    expect(u({}, '- - - - - R12', 'W5a')).toBe(1);
    expect(u({}, '- - - - - R12 R12', 'W5a')).toBe(0);
    expect(u({}, '- - - - - R12 R12 | - - - - - R12', 'W5a')).toBe(1);
  });
  it('W5b: whole weekends', () => {
    expect(u({ prefs: { weekendStyle: 'whole' } }, '- - - - - R12', 'W5b')).toBe(1);
    expect(u({ prefs: { weekendStyle: 'whole' } }, '- - - - - R12 N12', 'W5b')).toBe(1);
    expect(u({ prefs: { weekendStyle: 'whole' } }, '- - - - - R12 R12', 'W5b')).toBe(0);
    expect(u({ prefs: { weekendStyle: 'single' } }, '- - - - - R12 R12', 'W5b')).toBe(1);
  });
  it('W5c: days off after a weekend', () => {
    expect(u({ prefs: { afterWeekend: 'want' } }, '- - R2 R2 R2 R12 R12 | R1', 'W5c')).toBe(1);
    expect(u({ prefs: { afterWeekend: 'want' } }, '- - R2 R2 R2 R12 R12 | - -', 'W5c')).toBe(0);
    expect(u({ prefs: { afterWeekend: 'noAutomatic' } }, '- - R2 R2 R2 R12 R12 | - -', 'W5c')).toBe(1);
    expect(u({ prefs: { afterWeekend: 'noAutomatic' } }, '- - - - - R12 R12 | R1 R1 R1', 'W5c')).toBe(0);
  });
  it('W5d: R12 neighbours', () => {
    expect(u({}, '- - - - - R12 R12 | O', 'W5d')).toBe(1);
    expect(u({}, '- - - - R1 R12 R12 | R2', 'W5d')).toBe(0);
  });
  it('W6: ratings and even spread', () => {
    expect(u({ prefs: { ratings: { O: 1 } } }, 'O O O', 'W6')).toBe(18);
    expect(u({ prefs: { ratings: { R1: 5 } } }, 'R1 R1', 'W6')).toBe(0);
    expect(u({ prefs: { ratings: {} } }, 'R1 R1 R1 R1 R1', 'W6')).toBe(8);
  });
});

// --- Beyond the brief: what its examples leave open ---------------------------------------------
// February 2027 starts on a Monday: day i (counted from 0) is weekday i mod 7, and the weekends are
// days 5-6, 12-13, 19-20 and 26-27. A strip starts at day 0; a tail strip holds the 7 days before.

const c = ctxFor('2027-02', 1);
/** A seeded random number generator, so that the random rows below are the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A strip with the given codes on the given days (counted from 0) and nothing on the others. */
const at = (codes: Record<number, string>): string => {
  const days = Object.keys(codes).map(Number);
  return Array.from({ length: Math.max(-1, ...days) + 1 }, (_, i) => codes[i] ?? '-').join(' ');
};
/** A context for one person with `prefs`, in `month`. */
const solo = (prefs: PersonPatch['prefs'], month = '2027-02', settings: Partial<Settings> = {}) =>
  ctxFor(month, [{ prefs }], settings);
/** The findings of wish `id` for one person's strip (and the 7 days before the month). */
const found = (id: WishId, strip: string, tail: string[] = [], ctx = c) =>
  rules(run(ctx, rowsOf(ctx, [strip], tail)), id);
/** The units of wish `id` for one person's strip (and the 7 days before the month). */
const unitsOf = (id: WishId, strip: string, ctx = c, tail: string[] = []) =>
  units(run(ctx, rowsOf(ctx, [strip], tail)), ctx, id);
/** What findings say: the text, the days counted from day 1 (the tail is negative), the units. */
const listed = (fs: Finding[], ctx: MonthContext = c) =>
  fs
    .map((f) => ({
      message: f.message,
      days: f.days.map((d) => d - ctx.first),
      units: f.penalty / ctx.weights[f.rule as WishId],
    }))
    .sort((a, b) => (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));

describe('W5a in detail', () => {
  it('lists the 12-hour shifts of the month and the target, with the cells and the text', () => {
    expect(listed(found('W5a', '- - - - - R12'))).toEqual([
      { message: '1 dvanáctihodinová směna (cíl 2)', days: [5], units: 1 },
    ]);
    // R12 and N12 are counted alike
    expect(listed(found('W5a', at({ 5: 'N12', 6: 'N12', 12: 'R12', 13: 'R12' })))).toEqual([
      { message: '4 dvanáctihodinové směny (cíl 2)', days: [5, 6, 12, 13], units: 4 },
    ]);
  });
  it('puts the count in the Czech form: 1, 2 to 4, and 5 or more or none', () => {
    // a target far from every count, so that each one has a finding
    const far = ctxFor('2027-02', 1, { twelveTarget: 10 });
    const message = (n: number) => {
      const strip = at(Object.fromEntries([5, 6, 12, 13, 19].slice(0, n).map((d) => [d, 'R12'])));
      return found('W5a', strip, [], far)[0].message;
    };
    expect([0, 1, 2, 3, 4, 5].map(message)).toEqual([
      '0 dvanáctihodinových směn (cíl 10)',
      '1 dvanáctihodinová směna (cíl 10)',
      '2 dvanáctihodinové směny (cíl 10)',
      '3 dvanáctihodinové směny (cíl 10)',
      '4 dvanáctihodinové směny (cíl 10)',
      '5 dvanáctihodinových směn (cíl 10)',
    ]);
  });
  it('prints a target that is not whole with a decimal comma', () => {
    const k = ctxFor('2027-02', 1, { twelveTarget: 2.5 });
    expect(listed(found('W5a', '- - - - - R12 R12', [], k), k)).toEqual([
      { message: '2 dvanáctihodinové směny (cíl 2,5)', days: [5, 6], units: 0.25 },
    ]);
  });
  it('asks the square of the distance from the target', () => {
    const weekends = [5, 6, 12, 13, 19];
    const expected = [4, 1, 0, 1, 4, 9];
    expected.forEach((squared, k) => {
      const strip = at(Object.fromEntries(weekends.slice(0, k).map((d) => [d, 'R12'])));
      expect(unitsOf('W5a', strip)).toBe(squared);
    });
  });
  it('names no day when there is no 12-hour shift at all', () => {
    expect(listed(found('W5a', ''))).toEqual([
      { message: '0 dvanáctihodinových směn (cíl 2)', days: [], units: 4 },
    ]);
  });
  it('follows the target in the settings', () => {
    const k = ctxFor('2027-02', 1, { twelveTarget: 3 });
    expect(listed(found('W5a', '- - - - - R12 R12', [], k), k)).toEqual([
      { message: '2 dvanáctihodinové směny (cíl 3)', days: [5, 6], units: 1 },
    ]);
    expect(found('W5a', '- - - - - R12 R12 | - - - - - R12', [], k)).toEqual([]);
  });
  it('counts the 12-hour shifts of the month only', () => {
    // the whole tail is R12, and the month holds 2
    expect(unitsOf('W5a', '- - - - - R12 R12', c, ['R12 R12 R12 R12 R12 R12 R12'])).toBe(0);
  });
  it('is a finding for the team lead, not a quiet one', () => {
    // strictly equal: there is no `quiet` field at all, not even an undefined one
    expect(found('W5a', '- - - - - R12')).toStrictEqual([{
      rule: 'W5a',
      severity: 'wish',
      person: 0,
      days: [c.first + 5],
      message: '1 dvanáctihodinová směna (cíl 2)',
      penalty: c.weights.W5a,
    }]);
  });
});

describe('W5b in detail', () => {
  const whole = solo({ weekendStyle: 'whole' });
  const single = solo({ weekendStyle: 'single' });
  const indifferent = solo({ weekendStyle: 'any' });

  it('whole: lists a split weekend and one of two shifts, with the cells and the text', () => {
    const split = [{ message: 'rozdělený víkend', days: [5, 6], units: 1 }];
    expect(listed(found('W5b', '- - - - - R12', [], whole), whole)).toEqual(split);
    expect(listed(found('W5b', '- - - - - - R12', [], whole), whole)).toEqual(split);
    expect(listed(found('W5b', '- - - - - R12 N12', [], whole), whole)).toEqual([
      { message: 'víkend R12 + N12', days: [5, 6], units: 1 },
    ]);
    expect(listed(found('W5b', '- - - - - N12 R12', [], whole), whole)).toEqual([
      { message: 'víkend N12 + R12', days: [5, 6], units: 1 },
    ]);
  });
  it('whole: asks nothing of one shift on both days, or of no shift', () => {
    expect(unitsOf('W5b', '- - - - - R12 R12', whole)).toBe(0);
    expect(unitsOf('W5b', '- - - - - N12 N12', whole)).toBe(0);
    expect(unitsOf('W5b', 'R1 R1 R1 R1 R1', whole)).toBe(0);
  });
  it('whole: takes a request or an absence for a day not worked', () => {
    for (const off of ['x', 'DOV', 'MD', 'OP', 'NEM']) {
      expect(unitsOf('W5b', `- - - - - R12 ${off}`, whole)).toBe(1);
      expect(unitsOf('W5b', `- - - - - ${off} R12`, whole)).toBe(1);
      expect(unitsOf('W5b', `- - - - - ${off} ${off}`, whole)).toBe(0);
    }
  });
  it('whole: asks nothing of two days that are not worked, though their codes differ', () => {
    expect(unitsOf('W5b', '- - - - - x DOV', whole)).toBe(0);
    expect(unitsOf('W5b', '- - - - - - x', whole)).toBe(0);
    expect(unitsOf('W5b', '- - - - - DOV -', whole)).toBe(0);
  });
  it('whole: judges each weekend of the month on its own', () => {
    // split by its Saturday, whole, none, split by its Sunday
    const strip = at({ 5: 'R12', 12: 'R12', 13: 'R12', 20: 'R12' });
    expect(listed(found('W5b', strip, [], whole), whole)).toEqual([
      { message: 'rozdělený víkend', days: [5, 6], units: 1 },
      { message: 'rozdělený víkend', days: [19, 20], units: 1 },
    ]);
  });
  it('single: lists a weekend of two shifts, whatever they are', () => {
    const text = 'celý víkend, i když chce jednotlivé dny';
    expect(listed(found('W5b', '- - - - - R12 R12', [], single), single)).toEqual([
      { message: text, days: [5, 6], units: 1 },
    ]);
    expect(listed(found('W5b', '- - - - - N12 R12', [], single), single)).toEqual([
      { message: text, days: [5, 6], units: 1 },
    ]);
    expect(unitsOf('W5b', at({ 5: 'R12', 6: 'R12', 12: 'R12', 13: 'R12' }), single)).toBe(2);
  });
  it('single: asks nothing of single days', () => {
    expect(unitsOf('W5b', '- - - - - R12 -', single)).toBe(0);
    expect(unitsOf('W5b', '- - - - - - R12', single)).toBe(0);
    // single days on different weekends, and a day of a weekend with an absence
    expect(unitsOf('W5b', at({ 5: 'R12', 12: 'R12', 20: 'N12' }), single)).toBe(0);
    expect(unitsOf('W5b', '- - - - - R12 DOV', single)).toBe(0);
  });
  it('any: asks nothing', () => {
    for (const strip of ['- - - - - R12', '- - - - - R12 R12', '- - - - - R12 N12', '']) {
      expect(found('W5b', strip, [], indifferent)).toEqual([]);
    }
  });
  it('sees the weekend that ends the month, and the one that starts on day 1', () => {
    // Sat 27 and Sun 28 Feb 2027 are the last two days; Sat 1 May 2027 is the first day
    expect(unitsOf('W5b', at({ 26: 'R12' }), whole)).toBe(1);
    expect(unitsOf('W5b', at({ 26: 'R12', 27: 'R12' }), single)).toBe(1);
    const may = (weekendStyle: 'whole' | 'single') => solo({ weekendStyle }, '2027-05');
    expect(unitsOf('W5b', 'R12', may('whole'))).toBe(1);
    expect(unitsOf('W5b', 'R12 R12', may('whole'))).toBe(0);
    expect(unitsOf('W5b', 'R12 R12', may('single'))).toBe(1);
  });
  it('counts only a weekend that lies wholly in the month', () => {
    // Sun 1 Aug 2027: the Saturday before it is in the tail. Sat 31 Jul 2027: the Sunday after it
    // is in the next month. Neither is a weekend of the month.
    const aug = solo({ weekendStyle: 'whole' }, '2027-08');
    expect(unitsOf('W5b', 'R12', aug)).toBe(0);
    expect(unitsOf('W5b', 'R12', aug, ['- - - - - - R12'])).toBe(0);
    expect(unitsOf('W5b', at({ 6: 'R12' }), aug)).toBe(1); // Sat 7 Aug: a weekend of the month
    const jul = solo({ weekendStyle: 'whole' }, '2027-07');
    expect(unitsOf('W5b', at({ 30: 'R12' }), jul)).toBe(0);
    expect(unitsOf('W5b', at({ 23: 'R12' }), jul)).toBe(1); // Sat 24 Jul
    // the weekend of the tail is judged by the month it belongs to
    expect(unitsOf('W5b', '', c, ['- - - - - R12 -'])).toBe(0);
  });
  it('does not pair a holiday with a weekend day', () => {
    // Good Friday 26 Mar, Sat 27, Sun 28 and Easter Monday 29 Mar 2027 are days 25 to 28
    const mar = solo({ weekendStyle: 'whole' }, '2027-03');
    expect(unitsOf('W5b', at({ 25: 'R12', 26: 'R12' }), mar)).toBe(1); // Fri + Sat: Sun is free
    expect(unitsOf('W5b', at({ 27: 'R12', 28: 'R12' }), mar)).toBe(1); // Sun + Mon: Sat is free
    expect(unitsOf('W5b', at({ 25: 'R12', 26: 'R12', 27: 'R12', 28: 'R12' }), mar)).toBe(0);
  });
  it('takes the day types from the settings: a weekend needs two 12-hour days', () => {
    const day = (date: string, type: 'weekday' | 'twelve') =>
      solo({ weekendStyle: 'whole' }, '2027-02', { dayTypeOverrides: { [date]: type } });
    // Sat 6 Feb is set to a weekday: no weekend on days 5-6, though days 12-13 are one
    expect(unitsOf('W5b', '- - - - - - R12', day('2027-02-06', 'weekday'))).toBe(0);
    expect(unitsOf('W5b', at({ 12: 'R12' }), day('2027-02-06', 'weekday'))).toBe(1);
    // Sun 14 Feb is set to a weekday: days 12-13 are none
    expect(unitsOf('W5b', at({ 12: 'R12' }), day('2027-02-14', 'weekday'))).toBe(0);
    // Fri 5 Feb is set to a 12-hour day: it is no part of the weekend
    expect(unitsOf('W5b', at({ 4: 'R12', 5: 'R12' }), day('2027-02-05', 'twelve'))).toBe(1);
  });
});

describe('W5c in detail', () => {
  const want = solo({ afterWeekend: 'want' });
  const none = solo({ afterWeekend: 'noAutomatic' });
  const indifferent = solo({ afterWeekend: 'any' });
  const weekend = '- - R2 R2 R2 R12 R12'; // Wed to Sun
  /** A request or an absence: a day off that is the person's own, not one the plan hands out. */
  const own = ['x', 'DOV', 'MD', 'OP', 'NEM'];

  it('want: lists a shift on the Monday, with the cells and the text', () => {
    expect(listed(found('W5c', `${weekend} | R1`, [], want), want)).toEqual([
      { message: 'po víkendu nemá volno', days: [5, 6, 7], units: 1 },
    ]);
    // R12 and N12 are shifts too, though M8 has something to say about them on a Monday
    for (const code of ['R1', 'R2', 'O20', 'O', 'N', 'R12', 'N12']) {
      expect(unitsOf('W5c', `${weekend} | ${code}`, want)).toBe(1);
    }
  });
  it('want: asks nothing of a Monday that is off, whatever the day off is', () => {
    for (const code of ['-', ...own]) {
      expect(unitsOf('W5c', `${weekend} | ${code}`, want)).toBe(0);
    }
  });
  it('noAutomatic: lists an empty Monday, a day off handed out, with cells and text', () => {
    expect(listed(found('W5c', `${weekend} | -`, [], none), none)).toEqual([
      { message: 'po víkendu volno, i když ho nechce', days: [5, 6, 7], units: 1 },
    ]);
    expect(unitsOf('W5c', weekend, none)).toBe(1); // the Monday is left out of the strip: empty
  });
  it.each(own)('noAutomatic: asks nothing of %s on the Monday, an own day off', (code) => {
    expect(found('W5c', `${weekend} | ${code}`, [], none)).toEqual([]);
    expect(unitsOf('W5c', `${weekend} | ${code}`, none)).toBe(0);
  });
  it('noAutomatic: counts only the empty Mondays among the Mondays after weekends', () => {
    // Mondays after the three weekends: DOV, empty, x
    const strip = at({
      5: 'R12', 6: 'R12', 7: 'DOV', 12: 'R12', 13: 'R12', 19: 'R12', 20: 'R12', 21: 'x',
    });
    expect(listed(found('W5c', strip, [], none), none)).toEqual([
      { message: 'po víkendu volno, i když ho nechce', days: [12, 13, 14], units: 1 },
    ]);
    // someone who wants days off after a weekend is satisfied by all three
    expect(unitsOf('W5c', strip, want)).toBe(0);
  });
  it('noAutomatic: asks nothing of a Monday with a shift', () => {
    for (const code of ['R1', 'R2', 'O20', 'O', 'N', 'R12', 'N12']) {
      expect(unitsOf('W5c', `${weekend} | ${code}`, none)).toBe(0);
    }
  });
  it('any: asks nothing', () => {
    expect(unitsOf('W5c', `${weekend} | R1`, indifferent)).toBe(0);
    expect(unitsOf('W5c', `${weekend} | -`, indifferent)).toBe(0);
  });
  it('asks something only of R12 on both days', () => {
    for (const days of ['R12 N12', 'N12 N12', 'N12 R12', 'R12 -', '- R12', 'R1 R12']) {
      expect(unitsOf('W5c', `- - R2 R2 R2 ${days} | R1`, want)).toBe(0);
      expect(unitsOf('W5c', `- - R2 R2 R2 ${days} | -`, none)).toBe(0);
    }
  });
  it('judges each weekend on its own', () => {
    // Mondays: a shift, a day off, a shift
    const strip = at({
      5: 'R12', 6: 'R12', 7: 'R1', 12: 'R12', 13: 'R12', 19: 'R12', 20: 'R12', 21: 'R2',
    });
    expect(listed(found('W5c', strip, [], want), want)).toEqual([
      { message: 'po víkendu nemá volno', days: [5, 6, 7], units: 1 },
      { message: 'po víkendu nemá volno', days: [19, 20, 21], units: 1 },
    ]);
    expect(unitsOf('W5c', strip, none)).toBe(1);
  });
  it('needs a Monday in the month: the last weekend of the month has none', () => {
    const last = at({ 26: 'R12', 27: 'R12' }); // Sun 28 Feb, and Monday is 1 Mar
    expect(unitsOf('W5c', last, want)).toBe(0);
    expect(unitsOf('W5c', last, none)).toBe(0);
  });
  it('needs a Monday that is a weekday: a holiday Monday is skipped', () => {
    // Easter Monday 29 Mar 2027 is day 28; the Monday after the first weekend is day 7
    const mar = (afterWeekend: 'want' | 'noAutomatic') => solo({ afterWeekend }, '2027-03');
    const easter = (monday: string) => at({ 26: 'R12', 27: 'R12', 28: monday });
    expect(unitsOf('W5c', easter('R1'), mar('want'))).toBe(0);
    expect(unitsOf('W5c', easter('-'), mar('noAutomatic'))).toBe(0);
    expect(unitsOf('W5c', at({ 5: 'R12', 6: 'R12', 7: 'R1' }), mar('want'))).toBe(1);
    // Mon 5 Jul 2027 is a holiday, the Monday after the weekend of 3-4 Jul; 12 Jul is not
    const jul = solo({ afterWeekend: 'want' }, '2027-07');
    expect(unitsOf('W5c', at({ 2: 'R12', 3: 'R12', 4: 'R1' }), jul)).toBe(0);
    expect(unitsOf('W5c', at({ 9: 'R12', 10: 'R12', 11: 'R1' }), jul)).toBe(1);
  });
  it('needs a Monday that is a weekday by the settings', () => {
    const strip = '- - - - - R12 R12 | R1';
    const k = (type: 'weekday' | 'twelve') =>
      solo({ afterWeekend: 'want' }, '2027-02', { dayTypeOverrides: { '2027-02-08': type } });
    expect(unitsOf('W5c', strip, k('twelve'))).toBe(0);
    expect(unitsOf('W5c', strip, k('weekday'))).toBe(1);
  });
  it('needs the weekend to lie wholly in the month', () => {
    // Sun 1 Aug 2027 is R12, and so is the Saturday before it, in the tail; Monday is a shift
    const aug = solo({ afterWeekend: 'want' }, '2027-08');
    expect(unitsOf('W5c', 'R12 R1', aug, ['- - - - - - R12'])).toBe(0);
    expect(unitsOf('W5c', at({ 6: 'R12', 7: 'R12', 8: 'R1' }), aug)).toBe(1);
  });
});

describe('W5d in detail', () => {
  it('lists each pair, with the cells and the text', () => {
    expect(listed(found('W5d', '- - - - O R12 R12 N'))).toEqual([
      { message: 'vedle R12 je N (lépe R1 nebo R2)', days: [6, 7], units: 1 },
      { message: 'vedle R12 je O (lépe R1 nebo R2)', days: [4, 5], units: 1 },
    ]);
  });
  it.each([
    ['R1', 0], ['R2', 0], ['O20', 1], ['O', 1], ['N', 1], ['R12', 0], ['N12', 0],
    ['x', 0], ['DOV', 0], ['-', 0],
  ])('next to an R12, %s gives %i, before it and after it', (code, k) => {
    expect(unitsOf('W5d', `- - - - ${code} R12`)).toBe(k);
    expect(unitsOf('W5d', `- - - - - R12 ${code}`)).toBe(k);
  });
  it('asks a unit for each neighbour, and for each R12 of a shift between two', () => {
    expect(unitsOf('W5d', '- - - - O R12 N')).toBe(2);
    expect(unitsOf('W5d', '- - - - O R12 R12 N')).toBe(2); // the pair of R12 is no pair
    expect(unitsOf('W5d', '- - - - - R12 O R12')).toBe(2); // the O is next to both
  });
  it('is no business of N12', () => {
    expect(unitsOf('W5d', '- - - - O N12')).toBe(0);
    expect(unitsOf('W5d', '- - - - - N12 O')).toBe(0);
  });
  it('sees an R12 on the last day of the month, and a neighbour on it', () => {
    expect(unitsOf('W5d', at({ 26: 'O', 27: 'R12' }))).toBe(1);
    expect(unitsOf('W5d', at({ 26: 'R12', 27: 'O' }))).toBe(1);
  });
  it('judges a pair across the turn of the month, in either order, and none in the tail', () => {
    expect(listed(found('W5d', 'O', ['- - - - - - R12']))).toEqual([
      { message: 'vedle R12 je O (lépe R1 nebo R2)', days: [-1, 0], units: 1 },
    ]);
    expect(listed(found('W5d', 'R12', ['- - - - - - N']))).toEqual([
      { message: 'vedle R12 je N (lépe R1 nebo R2)', days: [-1, 0], units: 1 },
    ]);
    expect(found('W5d', 'R1', ['- - - - - - R12'])).toEqual([]);
    expect(found('W5d', 'R2 O', ['- - - - - - R12'])).toEqual([]);
    // wholly in the previous month
    expect(found('W5d', '', ['- - - - - R12 O'])).toEqual([]);
    expect(found('W5d', 'R1', ['- - - - O R12 -'])).toEqual([]);
  });
});

describe('W5 of a person', () => {
  it('uses the preferences of person p', () => {
    const t = ctxFor('2027-02', [
      { prefs: { weekendStyle: 'whole', afterWeekend: 'want' } },
      { prefs: { weekendStyle: 'single', afterWeekend: 'noAutomatic' } },
    ]);
    const [shared] = rowsOf(t, ['- - - - - R12 R12 | R1']);
    const unitsFor = (p: number, id: WishId) => {
      const seen: Finding[] = [];
      evaluatePerson(t, p, shared, (f) => seen.push(f));
      const sum = seen.filter((f) => f.rule === id).reduce((total, f) => total + f.penalty, 0);
      return sum / t.weights[id];
    };
    expect([unitsFor(0, 'W5b'), unitsFor(1, 'W5b')]).toEqual([0, 1]);
    expect([unitsFor(0, 'W5c'), unitsFor(1, 'W5c')]).toEqual([1, 0]);
  });
});

describe('W5 and W6 together', () => {
  it.each<[string, WishId, PersonPatch['prefs'], string]>([
    ['W5a', 'W5a', {}, '- - - - - R12'],
    ['W5b', 'W5b', { weekendStyle: 'whole' }, '- - - - - R12'],
    ['W5c', 'W5c', { afterWeekend: 'want' }, '- - R2 R2 R2 R12 R12 | R1'],
    ['W5d', 'W5d', {}, '- - - - - R12 R12 | O'],
    ['W6 by ratings', 'W6', { ratings: { O: 1 } }, 'O O O'],
    ['W6 by even spread', 'W6', { ratings: {} }, 'R1 R1 R1 R1 R1'],
  ])('%s costs the weight of its level, and nothing when switched off', (_, id, prefs, strip) => {
    const atLevel = (level: Level) =>
      solo(prefs, '2027-02', { wishLevels: { ...defaultSettings().wishLevels, [id]: level } });
    const cost = (ctx: MonthContext) =>
      found(id, strip, [], ctx).reduce((sum, f) => sum + f.penalty, 0);
    expect(cost(atLevel(1))).toBeGreaterThan(0);
    expect(cost(atLevel(5)) / cost(atLevel(1))).toBe(16); // level 5 is x4, level 1 is x0.25
    expect(unitsOf(id, strip, atLevel(5))).toBe(unitsOf(id, strip, atLevel(1))); // not the level
    expect(found(id, strip, [], atLevel(0))).toEqual([]);
  });
  it('are switched off one by one: the others go on', () => {
    const k = solo({ weekendStyle: 'whole' }, '2027-02', {
      wishLevels: { ...defaultSettings().wishLevels, W5b: 0 },
    });
    expect(found('W5b', '- - - - - R12', [], k)).toEqual([]);
    expect(found('W5a', '- - - - - R12', [], k)).not.toEqual([]);
  });
  it('build no finding and no list of days unless a sink is given', () => {
    // Two people, the first with ratings and the second with none; the row fires all five wishes:
    // 3 twelve-hour shifts, a split weekend and a whole one, a Monday with a shift, an O20 next to
    // an R12, and O rated 1 (shown), R1 rated 3 (quiet) and an even spread.
    const t = ctxFor('2027-02', [
      { prefs: { weekendStyle: 'whole', afterWeekend: 'want', ratings: { O: 1, R1: 3 } } },
      { prefs: { weekendStyle: 'single', afterWeekend: 'noAutomatic', ratings: {} } },
    ]);
    const [row] = rowsOf(t, ['R1 - - - O20 R12 R12 | R1 O O O - R12 - | N']);
    const spies = [report, cellsWith, twelveDays].map((fn) => vi.mocked(fn));

    spies.forEach((spy) => spy.mockClear());
    evaluatePerson(t, 0, row);
    evaluatePerson(t, 1, row);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();

    evaluatePerson(t, 0, row, () => undefined);
    evaluatePerson(t, 1, row, () => undefined);
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});

/** The wishes this file tests. */
const MINE: WishId[] = ['W5a', 'W5b', 'W5c', 'W5d', 'W6'];
/** Wish levels with only these wishes on: a score is then that of the musts and these wishes. */
function onlyMine(): Settings['wishLevels'] {
  const levels = noWishes();
  for (const id of MINE) levels[id] = 3;
  return levels;
}
/** Whether `a` and `b` differ by no more than rounding errors, which grow with the numbers. */
const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));

describe('the wishes W5 and W6 on rows of any kind', () => {
  // Rows of 35 cells with a bit of everything, from a fixed seed, in three months with other
  // weekends: Feb 2027 starts on a Monday, Mar 2027 ends with Easter Monday, Aug 2027 starts on a
  // Sunday.
  const people: PersonPatch[] = [
    { prefs: { weekendStyle: 'whole', afterWeekend: 'want', ratings: {} } },
    { prefs: { weekendStyle: 'single', afterWeekend: 'noAutomatic', ratings: { O: 1, R1: 2 } } },
    {
      prefs: {
        weekendStyle: 'any',
        afterWeekend: 'any',
        ratings: { R1: 5, R2: 4, O20: 3, O: 2, N: 1 },
      },
    },
    { prefs: { weekendStyle: 'whole', afterWeekend: 'noAutomatic', ratings: { N: 5, R2: 2 } } },
  ];
  const months = ['2027-02', '2027-03', '2027-08'].map((month) => ({
    on: ctxFor(month, people, { wishLevels: onlyMine() }),
    off: ctxFor(month, people, { wishLevels: noWishes() }),
  }));
  const mineOf = (fs: Finding[]) => fs.filter((f) => MINE.includes(f.rule as WishId));

  it('are scored the same with and without a sink, and every penalty is listed', () => {
    const random = mulberry32(20270301);
    const fired: Record<string, number> = {
      W5a: 0, W5b: 0, W5c: 0, W5d: 0, W6: 0, shown: 0, quiet: 0,
    };
    for (let k = 0; k < 900; k++) {
      const { on, off } = months[k % months.length];
      const row = new Uint8Array(on.days.length);
      const shifty = random() < 0.5 ? 0.85 : 0.45; // some rows are dense, some sparse
      for (let i = 0; i < row.length; i++) {
        if (random() >= shifty) {
          row[i] = random() < 0.15 ? 8 + Math.floor(random() * 5) : 0; // an absence, x or none
        } else if (on.days[i].dayType === 'twelve' && random() < 0.7) {
          row[i] = random() < 0.8 ? 6 : 7; // mostly R12 on a 12-hour day
        } else {
          row[i] = 1 + Math.floor(random() * 7);
        }
      }
      const p = k % people.length;
      const prefs = people[p].prefs ?? {};
      const seen: Finding[] = [];
      const withSink = evaluatePerson(on, p, row, (f) => seen.push(f));
      const musts = evaluatePerson(off, p, row);
      expect(withSink).toEqual(evaluatePerson(on, p, row));
      expect(withSink.stats).toEqual(musts.stats);

      const wishes = mineOf(seen);
      expect(seen.filter((f) => f.severity === 'wish')).toEqual(wishes); // no other wish is on
      const sum = wishes.reduce((total, f) => total + f.penalty, 0);
      // compared as totals: the musts may be 1e9 each, and a difference would lose the digits
      expect(close(withSink.score, musts.score + sum)).toBe(true);
      for (const f of wishes) {
        expect(f.severity).toBe('wish');
        expect(f.person).toBe(p);
        expect(f.penalty).toBeGreaterThan(0);
        expect(f.message).not.toBe('');
        for (const d of f.days) expect(Number.isInteger(d) && d >= 0 && d < row.length).toBe(true);
        // a wish is reported only if it touches the month (W5a and W6 may name no day)
        if (f.days.length > 0) expect(Math.max(...f.days)).toBeGreaterThanOrEqual(on.first);

        // quiet: W6 for all but the shifts someone dislikes; no other wish of this file
        let quiet = false;
        if (f.rule === 'W6') {
          const rated = Object.keys(prefs.ratings ?? {}).length > 0;
          expect(f.days.length === 0).toBe(!rated); // the even spread names no day
          const name = CODE_NAMES[row[f.days[0]]] as WeekdayShift;
          const rating = rated ? prefs.ratings?.[name] : undefined;
          quiet = !rated || rating === undefined || rating > 2;
        }
        expect(f.quiet).toBe(quiet ? true : undefined);
        fired[f.rule]++;
        fired[quiet ? 'quiet' : 'shown']++;
      }

      // a wish that is switched off scores nothing and reports nothing
      const silent: Finding[] = [];
      evaluatePerson(off, p, row, (f) => silent.push(f));
      expect(mineOf(silent)).toEqual([]);
    }
    // the rows really did fire every wish, and both kinds of finding
    for (const [rule, count] of Object.entries(fired)) expect(count, rule).toBeGreaterThan(100);
  });
});

describe('the wishes on a row longer than the month', () => {
  // The month ends where ctx.days does. Cells after it are none of the rules' business, so a row
  // with a few more cells scores and reports like the same row cut at the last day.
  it('read nothing after the last day', () => {
    const random = mulberry32(20270401);
    const people: PersonPatch[] = [
      { prefs: { weekendStyle: 'whole', afterWeekend: 'want', nights: 'extra' } },
      { prefs: { weekendStyle: 'single', afterWeekend: 'noAutomatic', ratings: { O: 1 } } },
    ];
    for (const month of ['2027-02', '2027-03', '2027-08']) {
      const ctx = ctxFor(month, people);
      const n = ctx.days.length;
      for (let k = 0; k < 150; k++) {
        const row = new Uint8Array(n + 4);
        for (let i = 0; i < row.length; i++) {
          row[i] = random() < 0.25 ? 0 : 1 + Math.floor(random() * 7);
        }
        const cut = row.slice(0, n);
        const seenLong: Finding[] = [];
        const seenCut: Finding[] = [];
        const ofLong = evaluatePerson(ctx, k % 2, row, (f) => seenLong.push(f));
        const ofCut = evaluatePerson(ctx, k % 2, cut, (f) => seenCut.push(f));
        expect(ofLong).toEqual(ofCut);
        expect(seenLong).toEqual(seenCut);
      }
    }
  });
});

describe('the findings of a month with all the wishes W5 and W6', () => {
  // Four people with other preferences, and a month in which every one of these wishes fires:
  // A splits two weekends (W5b), works four 12-hour shifts (W5a) and an R12 after an O20 (W5d), and
  // is on R2 the Monday after a weekend (W5c); B is on both days of a weekend but wants single days
  // (W5b), is off on the Monday after it but wants no days off (W5c), and has shifts rated 1 and 2
  // (shown), 3 and 4 (quiet) and none (quiet); C has an N after an R12 and rated N 1; D has no
  // 12-hour shift at all. A and D have rated nothing, so their shifts must come about evenly.
  const team: PersonPatch[] = [
    { prefs: { weekendStyle: 'whole', afterWeekend: 'want', ratings: {} } },
    {
      prefs: {
        weekendStyle: 'single',
        afterWeekend: 'noAutomatic',
        ratings: { O: 1, R1: 2, R2: 3, O20: 4 },
      },
    },
    { prefs: { weekendStyle: 'any', afterWeekend: 'any', ratings: { R1: 5, N: 1 } } },
    { prefs: { weekendStyle: 'whole', afterWeekend: 'any', ratings: {} } },
  ];
  const strips = [
    'R1 R1 R1 R1 O20 R12 - | R1 O O O O - R12 | - - - - - R12 R12 | R2',
    '- - - - - R12 R12 | - O O O O - - | R1 R1 R2 O20 O20 - N',
    '- - - - O R12 R12 | N',
    'R1 R1 R1 R1 R1 - - | R2 R2 R2 R2 R2',
  ];
  const levelSets: Array<[string, Settings['wishLevels']]> = [
    ['the default levels', defaultSettings().wishLevels],
    ['every wish off', noWishes()],
    ['only these wishes on', onlyMine()],
    ['every wish at 5', Object.fromEntries(
      Object.keys(defaultSettings().wishLevels).map((id) => [id, 5])) as Settings['wishLevels']],
    ['a mixture', { ...defaultSettings().wishLevels, W5a: 0, W5b: 1, W5c: 5, W5d: 2, W6: 4 }],
  ];

  it('fires every wish, and shows some findings of W6 and keeps others quiet', () => {
    const ctx = ctxFor('2027-02', team);
    const ev = run(ctx, rowsOf(ctx, strips));
    const seen = new Set(ev.findings.map((f) => f.rule));
    for (const id of MINE) expect(seen, id).toContain(id);
    const w6 = rules(ev, 'W6');
    expect(w6.some((f) => f.quiet === true)).toBe(true);
    expect(w6.some((f) => f.quiet === undefined)).toBe(true);
    for (const id of ['W5a', 'W5b', 'W5c', 'W5d'] as const) {
      expect(rules(ev, id).every((f) => f.quiet === undefined), id).toBe(true); // all of them shown
    }
    expect(ev.findings.every((f) => f.message !== '')).toBe(true);
  });
  it.each(levelSets)('with %s, the findings add up to the score', (_, wishLevels) => {
    const ctx = ctxFor('2027-02', team, { wishLevels });
    const ev = run(ctx, rowsOf(ctx, strips));
    const sum = ev.findings.reduce((total, f) => total + f.penalty, 0);
    expect(ev.score).toBeGreaterThan(0);
    expect(close(sum, ev.score)).toBe(true);
  });
});
