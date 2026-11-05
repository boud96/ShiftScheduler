import { describe, it, expect } from 'vitest';
import { ctxFor, rowsOf, rules, run, units } from '../../test/rulekit';
import type { MonthContext } from '../context';
import type { Preferences, Rating, WishId } from '../types';
import { evaluatePerson } from './person';
import type { Finding } from './types';

// February 2027 starts on a Monday: day i (counted from 0) is weekday i mod 7, and the weekends are
// days 5-6, 12-13, 19-20 and 26-27. A strip starts at day 0; a tail strip holds the 7 days before.
// These tests are about W6 only; the brief's examples of it are in wishes-weekend.test.ts.

/** A context for one person with the given ratings. */
const rated = (ratings: Preferences['ratings']) => ctxFor('2027-02', [{ prefs: { ratings } }]);
const unrated = rated({});
/** The findings of W6 for one person's strip (and the 7 days before the month). */
const found = (strip: string, ctx = unrated, tail: string[] = []) =>
  rules(run(ctx, rowsOf(ctx, [strip], tail)), 'W6');
/** The units of W6 for one person's strip (and the 7 days before the month). */
const unitsOf = (strip: string, ctx = unrated, tail: string[] = []) =>
  units(run(ctx, rowsOf(ctx, [strip], tail)), ctx, 'W6');
/** What findings say: the text, the days counted from day 1 (the tail is negative), the units. */
const listed = (fs: Finding[], ctx: MonthContext = unrated) =>
  fs
    .map((f) => ({
      message: f.message,
      days: f.days.map((d) => d - ctx.first),
      units: f.penalty / ctx.weights[f.rule as WishId],
      quiet: f.quiet,
    }))
    .sort((a, b) => (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));

describe('W6 by ratings', () => {
  it.each<[Rating, number]>([[5, 0], [4, 1], [3, 2], [2, 4], [1, 6]])(
    'a shift rated %i costs %i',
    (rating, cost) => {
      for (const code of ['R1', 'R2', 'O20', 'O', 'N']) {
        expect(unitsOf(`${code} ${code}`, rated({ [code]: rating }))).toBe(2 * cost);
      }
    },
  );
  it('reads the rating of each kind of shift', () => {
    const ctx = rated({ R1: 1, R2: 2, O20: 3, O: 4, N: 5 });
    expect(unitsOf('R1', ctx)).toBe(6);
    expect(unitsOf('R2', ctx)).toBe(4);
    expect(unitsOf('O20', ctx)).toBe(2);
    expect(unitsOf('O', ctx)).toBe(1);
    expect(unitsOf('N', ctx)).toBe(0);
    expect(unitsOf('R1 - - R2 R2 O20 O O O N N N N', ctx)).toBe(6 + 2 * 4 + 2 + 3 * 1 + 0);
  });
  it('counts a shift without a rating as a 3, once some are rated', () => {
    expect(unitsOf('O', rated({ R1: 5 }))).toBe(2);
    expect(unitsOf('R1 O O', rated({ R1: 5 }))).toBe(4);
    expect(unitsOf('O', rated({ O: undefined, R1: 1 }))).toBe(2);
  });
  it('counts weekday shifts only: no 12-hour shift, absence or request', () => {
    expect(unitsOf('R12 N12 DOV MD OP NEM x', rated({ R1: 1, O: 1, N: 1 }))).toBe(0);
  });
  it('counts the shifts of the month only', () => {
    const ctx = rated({ O: 1 });
    expect(unitsOf('', ctx, ['O O O O O O O'])).toBe(0);
    expect(unitsOf('O', ctx, ['O O O O O O O'])).toBe(6);
  });
  it('does not ask an even spread of someone who has rated some shifts', () => {
    // five R1 are an uneven spread (8 units), but R1 is rated 5
    expect(unitsOf('R1 R1 R1 R1 R1', rated({ R1: 5 }))).toBe(0);
    expect(unitsOf('R1 R1 R1 R1 R1')).toBe(8);
  });

  describe('the findings', () => {
    it.each<[Rating, number]>([[1, 6], [2, 4]])(
      'lists the shifts of a kind rated %i as a finding to show, with the cells',
      (rating, cost) => {
        const ctx = rated({ O: rating });
        // strictly equal: there is no `quiet` field at all, not even an undefined one
        expect(found('O O - - O', ctx)).toStrictEqual([{
          rule: 'W6',
          severity: 'wish',
          person: 0,
          days: [ctx.first, ctx.first + 1, ctx.first + 4],
          message: '3× O, kterou má nerad(a)',
          penalty: 3 * cost * ctx.weights.W6,
        }]);
      },
    );
    it('lists the shifts of a kind rated 3 or 4, or not rated, as quiet findings', () => {
      const ctx = rated({ R1: 4, R2: 3 });
      expect(listed(found('R1 R1 R2 O20 O20 O20', ctx), ctx)).toEqual([
        { message: '1× R2 (hodnocení 3)', days: [2], units: 2, quiet: true },
        { message: '2× R1 (hodnocení 4)', days: [0, 1], units: 2, quiet: true },
        { message: '3× O20 (bez hodnocení)', days: [3, 4, 5], units: 6, quiet: true },
      ]);
    });
    it('lists nothing for a kind rated 5', () => {
      expect(found('R1 R1 R1', rated({ R1: 5 }))).toEqual([]);
      expect(found('R1 R1 R1', rated({ R1: 5, O: 1 }))).toEqual([]);
    });
    it('makes one finding for each kind of shift, with its cells and count', () => {
      const ctx = rated({ R1: 1, O: 2 });
      expect(listed(found('R1 - O R1 - O O R12', ctx), ctx)).toEqual([
        { message: '2× R1, kterou má nerad(a)', days: [0, 3], units: 12, quiet: undefined },
        { message: '3× O, kterou má nerad(a)', days: [2, 5, 6], units: 12, quiet: undefined },
      ]);
    });
    it('leaves the tail out of the cells and of the count', () => {
      const ctx = rated({ O: 1 });
      expect(listed(found('O', ctx, ['O O O O O O O']), ctx)).toEqual([
        { message: '1× O, kterou má nerad(a)', days: [0], units: 6, quiet: undefined },
      ]);
    });
  });
});

describe('W6 by even spread', () => {
  it('asks the distance of each kind of shift from the mean', () => {
    expect(unitsOf('R1 R2 O20 O N')).toBe(0);
    expect(unitsOf('R1 R1 R2 R2 O20 O20 O O N N')).toBe(0);
    expect(unitsOf('R1 R1 R1 R1 R1')).toBe(8); // |5 - 1| + 4 x |0 - 1|
    expect(unitsOf('R1 R1 R2 O20 O')).toBe(2); // |2 - 1| + |0 - 1|, and three kinds at the mean
  });
  it('is fractional when the shifts do not divide by five', () => {
    expect(unitsOf('R1')).toBeCloseTo(1.6, 12); // |1 - 0.2| + 4 x 0.2
    expect(unitsOf('R1 R1 R1 R1 R1 R1 R1')).toBeCloseTo(11.2, 12); // |7 - 1.4| + 4 x 1.4
    expect(unitsOf('R1 R2')).toBeCloseTo(2.4, 12); // 2 x |1 - 0.4| + 3 x 0.4
  });
  it('asks nothing of a month without a weekday shift', () => {
    expect(found('')).toEqual([]);
    expect(found('R12 N12 DOV x')).toEqual([]);
  });
  it('counts the weekday shifts of the month only', () => {
    expect(unitsOf('R1 R2 O20 O N', unrated, ['R1 R1 R1 R1 R1 R1 R1'])).toBe(0);
    expect(unitsOf('', unrated, ['R1 R1 R1 R1 R1 R1 R1'])).toBe(0);
  });
  it('takes someone whose ratings are all missing for someone with none', () => {
    expect(unitsOf('R1 R1 R1 R1 R1', rated({ R1: undefined, N: undefined }))).toBe(8);
  });
  it('is a quiet finding with a text of its own, and names no day', () => {
    expect(found('R1 R1 R1 R1 R1')).toStrictEqual([{
      rule: 'W6',
      severity: 'wish',
      person: 0,
      days: [],
      message: 'nerovnoměrné rozdělení směn R1, R2, O20, O a N',
      penalty: 8 * unrated.weights.W6,
      quiet: true,
    }]);
  });
});

describe('W6 of a person', () => {
  it('uses the ratings of person p', () => {
    const t = ctxFor('2027-02', [
      { prefs: { ratings: { O: 1 } } },
      { prefs: { ratings: { O: 5 } } },
      { prefs: { ratings: {} } },
    ]);
    const [shared] = rowsOf(t, ['O O O']);
    const unitsFor = (p: number) => {
      const seen: Finding[] = [];
      evaluatePerson(t, p, shared, (f) => seen.push(f));
      const sum = seen.filter((f) => f.rule === 'W6').reduce((total, f) => total + f.penalty, 0);
      return sum / t.weights.W6;
    };
    expect(unitsFor(0)).toBe(18); // O is rated 1: 3 x 6
    expect(unitsFor(1)).toBe(0); // O is rated 5
    expect(unitsFor(2)).toBeCloseTo(4.8, 12); // no ratings: |3 - 0.6| + 4 x 0.6
  });
});
