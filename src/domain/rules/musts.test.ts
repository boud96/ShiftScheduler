import { describe, it, expect } from 'vitest';
import { ctxFor, noWishes, rowsOf, run, rules } from '../../test/rulekit';
import type { PersonPatch } from '../../test/rulekit';
import { buildMonthGrid } from '../context';
import type { MonthContext } from '../context';
import { defaultSettings, newAppData } from '../defaults';
import type { CodeName, Settings } from '../types';
import { evaluateMonth } from './evaluate';
import { BELOW_FPD, GAP, HARD, STRONG, WEEKEND_SHORT } from './weights';
const c = ctxFor('2027-02', 1);
const n = (strip: string, id: Parameters<typeof rules>[1], tail?: string) =>
  rules(run(c, rowsOf(c, [strip], tail ? [tail] : [])), id).length;

describe('musts', () => {
  it.each([['O R1', 1], ['O R2', 1], ['O20 R1', 1], ['O20 R2', 0], ['N R1', 1], ['N N', 0], ['R1 R1', 0]])
    ('M2 %s → %i', (s, k) => expect(n(s as string, 'M2')).toBe(k));
  it('M2 around weekends', () => {
    expect(n('- - - - O20 R12', 'M2')).toBe(1);
    expect(n('- - - - - - R12 R1', 'M2')).toBe(0);
    expect(n('- - - - - N12 R12', 'M2')).toBe(1);
    expect(n('- - - - N N12 N12 N', 'M2')).toBe(0);
  });
  it('M2 sees the previous month', () => {
    const j = ctxFor('2027-01', 1);
    expect(rules(run(j, rowsOf(j, ['R12'], ['- - - - - - N'])), 'M2')).toHaveLength(1);
  });
  it('M2 message', () => {
    expect(rules(run(c, rowsOf(c, ['O R1'])), 'M2')[0].message).toBe('R1 hned po O: jen 8 h odpočinku (min. 12 h)');
  });
  it('M4: x or absence blocks the night ending that morning', () => {
    expect(n('N x', 'M4')).toBe(1); expect(n('N DOV', 'M4')).toBe(1); expect(n('O x', 'M4')).toBe(0);
  });
  it('M5: at most 3 twelve-hour shifts', () => {
    expect(n('- - - - - R12 R12 | - - - - - R12 R12', 'M5')).toBe(1);
  });
  it('M6: below FPD is a must, with the shortfall in the message', () => {
    const f = rules(run(c, rowsOf(c, ['R1 R1 R1'])), 'M6');
    expect(f).toHaveLength(1);
    expect(f[0].message).toBe('22,5 h z 150 h: chybí 127,5 h do FPD');
  });
  it('S1: never nights', () => {
    const v = ctxFor('2027-02', [{ prefs: { nights: 'never' } }]);
    expect(rules(run(v, rowsOf(v, ['N N - - - N12'])), 'S1')).toHaveLength(3);
  });
  it('M8: day type', () => { expect(n('R12 - - - - R1', 'M8')).toBe(2); });
  it('M3: outside the active period', () => {
    const v = ctxFor('2027-02', [{ activeFrom: '2027-02-08' }]);
    expect(rules(run(v, rowsOf(v, ['R1'])), 'M3')).toHaveLength(1);
  });
  it('M1: coverage on a weekday', () => {
    const t = ctxFor('2027-02', 6);
    const mon = (ev: ReturnType<typeof run>) => rules(ev, 'M1').filter((f) => f.days.includes(t.first)).map((f) => f.message);
    expect(mon(run(t, rowsOf(t, ['R1', 'R2', 'O20', 'O', 'N', 'R2'])))).toEqual([]);
    expect(mon(run(t, rowsOf(t, ['R1', 'R1', 'O20', 'O', '-', 'R2'])))).toEqual(expect.arrayContaining(['chybí N', 'R1 2×']));
  });
  it('M1: coverage on a 12-hour day', () => {
    const t = ctxFor('2027-02', 2);
    const sat = rules(run(t, rowsOf(t, ['- - - - - R12', '- - - - - R12'])), 'M1').filter((f) => f.days.includes(t.first + 5));
    expect(sat.map((f) => f.message).sort()).toEqual(['R12 2×', 'chybí N12']);
  });
  it('scores hard violations above everything else', () => {
    expect(run(c, rowsOf(c, ['O R1'])).score).toBeGreaterThanOrEqual(HARD);
  });
});

// Beyond the brief: what its tests leave open (finding shape, settings, the previous month's tail,
// units and scores).

/** `code` on day index `i` of the month, every other day empty. */
const at = (i: number, code: string) => [...Array(i).fill('-'), code].join(' ');
/** Coverage that asks for nobody, so that only the rules of a person show up in a score. */
const open = { min: 0, max: null };
const noCoverage = { R1: open, R2: open, O20: open, O: open, N: open, R12: open, N12: open };
/** Sat 6, Sun 7, Sat 13, Sun 14 and Sat 20 Feb 2027: five 12-hour shifts. */
const five = '- - - - - R12 R12 | - - - - - R12 R12 | - - - - - R12';

describe('M2 in detail', () => {
  it('is one finding on both cells, worth HARD', () => {
    expect(rules(run(c, rowsOf(c, ['O R1'])), 'M2')).toEqual([{
      rule: 'M2', severity: 'must', person: 0, days: [c.first, c.first + 1],
      message: 'R1 hned po O: jen 8 h odpočinku (min. 12 h)', penalty: HARD,
    }]);
  });
  it('compares with the minimum in the settings and quotes it', () => {
    const exact = ctxFor('2027-02', 1, { minRestHours: 8 });
    expect(rules(run(exact, rowsOf(exact, ['O R1'])), 'M2')).toHaveLength(0);
    const more = ctxFor('2027-02', 1, { minRestHours: 8.5 });
    expect(rules(run(more, rowsOf(more, ['O R1'])), 'M2')[0].message)
      .toBe('R1 hned po O: jen 8 h odpočinku (min. 8,5 h)');
  });
  it('takes the rest from the shift times in the settings, shown with a decimal comma', () => {
    const shifts = { ...defaultSettings().shifts, R1: { start: 390, end: 870, hours: 7.5 } };
    const k = ctxFor('2027-02', 1, { shifts });
    expect(rules(run(k, rowsOf(k, ['O R1'])), 'M2')[0].message)
      .toBe('R1 hned po O: jen 8,5 h odpočinku (min. 12 h)');
  });
  it('needs a shift on both of two consecutive days', () => {
    expect(n('O - R1', 'M2')).toBe(0);
    expect(n('O DOV R1', 'M2')).toBe(0);
    expect(n('O x R1', 'M2')).toBe(0);
    expect(n('O R1 R1', 'M2')).toBe(1);
  });
  it('quotes no rest at all after a night', () => {
    expect(rules(run(c, rowsOf(c, ['N R1'])), 'M2')[0].message)
      .toBe('R1 hned po N: jen 0 h odpočinku (min. 12 h)');
  });
  it('reports a pair across the month boundary, with the tail day in it, and none inside', () => {
    const f = rules(run(c, rowsOf(c, ['R1'], ['- - - - - - O'])), 'M2');
    expect(f.map((x) => x.days)).toEqual([[c.first - 1, c.first]]);
    expect(n('', 'M2', '- - - - - O R1')).toBe(0);
  });
});

describe('M3 in detail', () => {
  const v = ctxFor('2027-02', [{ activeFrom: '2027-02-08' }]);
  it('is one finding on the cell, with the code in the message', () => {
    expect(rules(run(v, rowsOf(v, ['R1'])), 'M3')).toEqual([{
      rule: 'M3', severity: 'must', person: 0, days: [v.first],
      message: 'R1 mimo období, kdy je v týmu', penalty: HARD,
    }]);
  });
  it('is about shifts: a request or an absence on such a day is not reported', () => {
    expect(rules(run(v, rowsOf(v, ['x DOV MD OP NEM'])), 'M3')).toHaveLength(0);
  });
  it('holds after the last active day as well', () => {
    const k = ctxFor('2027-02', [{ activeTo: '2027-02-20' }]);
    expect(rules(run(k, rowsOf(k, [at(19, 'R1')])), 'M3')).toHaveLength(0); // Sat 20, the last day
    expect(rules(run(k, rowsOf(k, [at(20, 'R1')])), 'M3')).toHaveLength(1); // Sun 21
  });
  it('leaves the previous month alone', () => {
    expect(rules(run(v, rowsOf(v, [], ['R1 R1 R1 R1 R1 R1 R1'])), 'M3')).toHaveLength(0);
  });
});

describe('M4 in detail', () => {
  it('is one finding on the night and the next day', () => {
    expect(rules(run(c, rowsOf(c, ['N x'])), 'M4')).toEqual([{
      rule: 'M4', severity: 'must', person: 0, days: [c.first, c.first + 1],
      message: 'noční N končí ráno v den, kdy je x', penalty: HARD,
    }]);
    expect(rules(run(c, rowsOf(c, ['- - - - - N12 DOV'])), 'M4')[0].message)
      .toBe('noční N12 končí ráno v den, kdy je DOV');
  });
  it.each(['x', 'DOV', 'MD', 'OP', 'NEM'])('a night before %s breaks it', (code) => {
    expect(n(`N ${code}`, 'M4')).toBe(1);
  });
  it('lets a night end on a free day or on a shift', () => {
    expect(n('N -', 'M4')).toBe(0);
    expect(n('N N', 'M4')).toBe(0);
  });
  it('sees a night on the last day of the previous month, but not one inside the tail', () => {
    const f = rules(run(c, rowsOf(c, ['x'], ['- - - - - - N'])), 'M4');
    expect(f.map((x) => [x.days, x.message]))
      .toEqual([[[c.first - 1, c.first], 'noční N končí ráno v den, kdy je x']]);
    expect(n('', 'M4', '- - - - - N x')).toBe(0);
  });
  it('has nothing to say about the last night of the month when nothing is stored for its morning', () => {
    expect(n(at(27, 'N'), 'M4')).toBe(0);
  });
});

describe('M5 in detail', () => {
  it('is one finding for the person, worth HARD per shift over the maximum', () => {
    expect(rules(run(c, rowsOf(c, [five])), 'M5')).toEqual([{
      rule: 'M5', severity: 'must', person: 0, days: [12, 13, 19, 20, 26],
      message: '5 dvanáctihodinových směn (max. 3)', penalty: 2 * HARD,
    }]);
  });
  it('allows exactly the maximum, and counts the month only', () => {
    expect(n('- - - - - R12 R12 | - - - - - R12', 'M5', '- - - - - R12 R12')).toBe(0);
  });
  it('follows the maximum in the settings and quotes it', () => {
    const k = ctxFor('2027-02', 1, { maxTwelvePerMonth: 5 });
    expect(rules(run(k, rowsOf(k, [five])), 'M5')).toHaveLength(0);
    const z = ctxFor('2027-02', 1, { maxTwelvePerMonth: 4 });
    expect(rules(run(z, rowsOf(z, [five])), 'M5')[0].message)
      .toBe('5 dvanáctihodinových směn (max. 4)');
  });
  it('puts the count in the Czech form: 1, 2 to 4, and 5 or more', () => {
    // a maximum of 0, so that every count is over it; the month has 8 weekend days
    const none = ctxFor('2027-02', 1, { maxTwelvePerMonth: 0 });
    const message = (count: number) => {
      const weekend = [5, 6, 12, 13, 19, 20, 26, 27].slice(0, count);
      const strip = Array.from({ length: 28 }, (_, d) => (weekend.includes(d) ? 'R12' : '-'));
      return rules(run(none, rowsOf(none, [strip.join(' ')])), 'M5')[0].message;
    };
    expect([1, 2, 3, 4, 5, 8].map(message)).toEqual([
      '1 dvanáctihodinová směna (max. 0)',
      '2 dvanáctihodinové směny (max. 0)',
      '3 dvanáctihodinové směny (max. 0)',
      '4 dvanáctihodinové směny (max. 0)',
      '5 dvanáctihodinových směn (max. 0)',
      '8 dvanáctihodinových směn (max. 0)',
    ]);
  });
});

describe('M6 in detail', () => {
  it('is one finding for the person, worth BELOW_FPD per missing hour', () => {
    expect(rules(run(c, rowsOf(c, ['R1 R1 R1'])), 'M6')).toEqual([{
      rule: 'M6', severity: 'must', person: 0, days: [],
      message: '22,5 h z 150 h: chybí 127,5 h do FPD', penalty: BELOW_FPD * 127.5,
    }]);
  });
  it('counts the absences, and nothing for a request', () => {
    expect(n(Array(20).fill('DOV').join(' '), 'M6')).toBe(0); // 20 x 7.5 h = FPD exactly
    expect(rules(run(c, rowsOf(c, [[...Array(19).fill('DOV'), 'x'].join(' ')])), 'M6')[0].message)
      .toBe('142,5 h z 150 h: chybí 7,5 h do FPD');
  });
  it('measures against the FPD of the person, not of the month', () => {
    const v = ctxFor('2027-02', [{ activeFrom: '2027-02-15' }]); // 10 working days from Mon 15
    const from15 = (count: number) =>
      [...Array(14).fill('-'), ...Array(count).fill('R1')].join(' ');
    expect(rules(run(v, rowsOf(v, [from15(10)])), 'M6')).toHaveLength(0);
    expect(rules(run(v, rowsOf(v, [from15(9)])), 'M6')[0].message)
      .toBe('67,5 h z 75 h: chybí 7,5 h do FPD');
  });
  it('does not take float noise for a shortfall', () => {
    // 20 shifts of 7.1 h add up to 141.99999999999994, while the fund is 20 * 7.1 = 142.
    const shifts = { ...defaultSettings().shifts, R1: { start: 360, end: 840, hours: 7.1 } };
    const k = ctxFor('2027-02', 1, { shifts, fpdHoursPerWeekday: 7.1 });
    const ev = run(k, rowsOf(k, [Array(20).fill('R1').join(' ')]));
    expect(ev.persons[0].hours).toBeLessThan(142);
    expect(rules(ev, 'M6')).toHaveLength(0);
  });
});

describe('S1 in detail', () => {
  const never = ctxFor('2027-02', [{ prefs: { nights: 'never' } }]);
  it('is one finding per night shift, on its cell, worth STRONG', () => {
    const f = rules(run(never, rowsOf(never, ['N - - - - N12 N12'])), 'S1');
    expect(f.map((x) => x.days)).toEqual([[never.first], [never.first + 5], [never.first + 6]]);
    expect(f[0]).toEqual({
      rule: 'S1', severity: 'wish', strong: true, person: 0, days: [never.first],
      message: 'noční směna, ale noční nechce', penalty: STRONG,
    });
  });
  it.each(['normal', 'ifNeeded', 'extra'] as const)('allows nights for %s', (nights) => {
    const k = ctxFor('2027-02', [{ prefs: { nights } }]);
    expect(rules(run(k, rowsOf(k, ['N'])), 'S1')).toHaveLength(0);
  });
  it('ignores a night in the previous month', () => {
    expect(rules(run(never, rowsOf(never, [], ['- - - - - - N'])), 'S1')).toHaveLength(0);
  });
  it('carries no strong mark on any other finding', () => {
    const ev = run(never, rowsOf(never, ['N R12 O R1 O20 R12']));
    const others = ev.findings.filter((f) => f.rule !== 'S1');
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((f) => !('strong' in f))).toBe(true);
  });
});

describe('M8 in detail', () => {
  it('says which way round it is', () => {
    expect(rules(run(c, rowsOf(c, ['R12 - - - - R1'])), 'M8').map((f) => f.message))
      .toEqual(['R12 nepatří na všední den', 'R1 nepatří na víkend ani svátek']);
    expect(rules(run(c, rowsOf(c, ['N12'])), 'M8')[0]).toEqual({
      rule: 'M8', severity: 'must', person: 0, days: [c.first],
      message: 'N12 nepatří na všední den', penalty: HARD,
    });
  });
  it('goes by the day type: a holiday is a 12-hour day, and a setting can override a day', () => {
    const j = ctxFor('2027-01', 1); // Fri 1 Jan 2027 is a public holiday
    expect(rules(run(j, rowsOf(j, ['R1'])), 'M8')).toHaveLength(1);
    expect(rules(run(j, rowsOf(j, ['R12'])), 'M8')).toHaveLength(0);
    const o = ctxFor('2027-02', 1, { dayTypeOverrides: { '2027-02-01': 'twelve' } });
    expect(rules(run(o, rowsOf(o, ['R12'])), 'M8')).toHaveLength(0);
    expect(rules(run(o, rowsOf(o, ['R1'])), 'M8')).toHaveLength(1);
  });
  it('is about shifts: requests and absences go on any day', () => {
    expect(n('DOV x - - - DOV NEM', 'M8')).toBe(0);
  });
  it('leaves the previous month alone', () => {
    expect(n('', 'M8', 'R12 - - - - R1 -')).toBe(0);
  });
});

describe('M1 in detail', () => {
  const t = ctxFor('2027-02', 7);
  const onMonday = (ev: ReturnType<typeof run>) =>
    rules(ev, 'M1').filter((f) => f.days.includes(t.first));
  it('is a GAP for a missing person and HARD per extra person, for that day alone', () => {
    expect(onMonday(run(t, rowsOf(t, ['R1', 'R2', 'O20', 'O'])))).toEqual([{
      rule: 'M1', severity: 'must', person: null, days: [t.first],
      message: 'chybí N', penalty: GAP,
    }]);
    expect(onMonday(run(t, rowsOf(t, ['R1', 'R1', 'R1', 'O20', 'O', 'N', 'R2'])))).toEqual([{
      rule: 'M1', severity: 'must', person: null, days: [t.first],
      message: 'R1 3×', penalty: 2 * HARD,
    }]);
  });
  it('asks for the weekday shifts on a weekday, and for R12 and N12 on a 12-hour day', () => {
    const k = ctxFor('2027-02', 1);
    const m1 = rules(run(k, rowsOf(k, [])), 'M1');
    const on = (d: number) => m1.filter((f) => f.days.includes(d)).map((f) => f.message).sort();
    expect(on(k.first)).toEqual(['chybí N', 'chybí O', 'chybí O20', 'chybí R1', 'chybí R2']);
    expect(on(k.first + 5)).toEqual(['chybí N12', 'chybí R12']);
    expect(m1).toHaveLength(20 * 5 + 8 * 2);
  });
  it('follows the coverage in the settings', () => {
    const coverage = {
      ...defaultSettings().coverage,
      R1: { min: 2, max: 3 },
      R2: { min: 0, max: 0 },
      O20: open,
      O: open,
      N: open,
    };
    const k = ctxFor('2027-02', 5, { coverage });
    const monday = (strips: string[]) => rules(run(k, rowsOf(k, strips)), 'M1')
      .filter((f) => f.days.includes(k.first)).map((f) => [f.message, f.penalty]);
    expect(monday([])).toEqual([['chybí R1', 2 * GAP]]);
    expect(monday(['R1', 'R1', 'R2'])).toEqual([['R2 1×', HARD]]);
    expect(monday(['R1', 'R1', 'R1', 'R1', 'R2']).sort())
      .toEqual([['R1 4×', HARD], ['R2 1×', HARD]]);
  });
});

// An exact score is the score of the musts alone only with the wishes off. At their default levels
// a wish adds its own penalty, and the global wishes add a term of their own. The weekend minimum
// (M12) is switched off in these contexts too: it is tested apart, and would add a unit and a score
// for the weekend shifts that a person has not got.
describe('must units and scores', () => {
  const k = ctxFor('2027-02', 1, {
    coverage: noCoverage, wishLevels: noWishes(), minWeekendShifts: 0,
  });
  it('count a unit per broken rule or shift over the limit, and one for being below FPD', () => {
    const rest = run(k, rowsOf(k, ['O R1']));
    expect(rest.persons[0].mustUnits).toBe(2); // M2 and M6
    expect(rest.days.every((d) => d.mustUnits === 0)).toBe(true);
    expect(rest.mustUnits).toBe(2);
    expect(rest.score).toBe(HARD + BELOW_FPD * (150 - 15));
    const twelve = run(k, rowsOf(k, [five]));
    expect(twelve.persons[0].mustUnits).toBe(3); // two shifts over the maximum, and M6
    expect(twelve.score).toBe(2 * HARD + BELOW_FPD * (150 - 57.5));
  });
  it('count a missing person for each gap, and a person below FPD', () => {
    const bare = ctxFor('2027-02', 1, { wishLevels: noWishes(), minWeekendShifts: 0 });
    const ev = run(bare, rowsOf(bare, []));
    expect(ev.mustUnits).toBe(20 * 5 + 8 * 2 + 1);
    expect(ev.score).toBe((20 * 5 + 8 * 2) * GAP + BELOW_FPD * 150);
  });
});

// The morning after the last night of the month, and the shift after the last one, are on day 1 of
// the next month. The engine reads what is stored there for each person (`nextDay`), as it reads
// the tail of the previous month, and judges the pairs of days that the end of the month makes.
describe('the day after the month', () => {
  // February 2027 ends on Sun 28 Feb, a 12-hour day, and March on Wed 31 Mar, a weekday.
  const feb = (nextDay?: CodeName, min = 12) =>
    ctxFor('2027-02', [{ nextDay }], { minRestHours: min });
  const mar = (nextDay?: CodeName, settings = {}) => ctxFor('2027-03', [{ nextDay }], settings);
  const lastOf = (k: ReturnType<typeof feb>) => k.days.length - 1;
  /** The findings of rule `id` when `code` is the last day of the month. */
  const found = (k: ReturnType<typeof feb>, code: string, id: Parameters<typeof rules>[1]) =>
    rules(run(k, rowsOf(k, [at(k.days.length - k.first - 1, code)])), id);

  describe('M4', () => {
    it.each(['x', 'DOV', 'MD', 'OP', 'NEM'] as const)(
      'is broken by a night on the last day and %s stored for the morning after',
      (next) => {
        const k = feb(next);
        expect(found(k, 'N12', 'M4')).toEqual([{
          rule: 'M4', severity: 'must', person: 0, days: [lastOf(k)],
          message: `noční N12 končí ráno 1. 3., kdy je ${next}`, penalty: HARD,
        }]);
      },
    );
    it('holds for N as well as N12', () => {
      const k = mar('x');
      expect(found(k, 'N', 'M4').map((f) => f.message)).toEqual(['noční N končí ráno 1. 4., kdy je x']);
    });
    it('has nothing to say when the morning after is free, or holds a shift', () => {
      expect(found(feb(), 'N12', 'M4')).toEqual([]);
      expect(found(mar('R1'), 'N', 'M4')).toEqual([]); // a shift: M2, not M4
      expect(found(mar('N'), 'N', 'M4')).toEqual([]);
    });
    it('is about nights: another shift before a request or an absence is fine', () => {
      expect(found(feb('x'), 'R12', 'M4')).toEqual([]);
      expect(found(mar('DOV'), 'O', 'M4')).toEqual([]);
      expect(found(feb('x'), '-', 'M4')).toEqual([]);
    });
    it('does not look at a person who is not in the team on day 1 of the next month', () => {
      const gone = ctxFor('2027-02', [{ nextDay: 'x', activeTo: '2027-02-28' }]);
      expect(gone.people[0].nextDay).toBe(0);
      expect(found(gone, 'N12', 'M4')).toEqual([]);
      const still = ctxFor('2027-02', [{ nextDay: 'x', activeTo: '2027-03-01' }]);
      expect(found(still, 'N12', 'M4')).toHaveLength(1);
    });
    it('looks past the end of a year: December into January', () => {
      const k = ctxFor('2027-12', [{ nextDay: 'x' }]); // Fri 31 Dec 2027, then Sat 1 Jan 2028
      expect(found(k, 'N', 'M4').map((f) => [f.days, f.message]))
        .toEqual([[[lastOf(k)], 'noční N končí ráno 1. 1., kdy je x']]);
    });
    it('reads the next day from the data that the context is built from', () => {
      const data = newAppData();
      data.cells['2028-01-01'] = { [data.people[0].id]: { code: 'DOV' } };
      const g = buildMonthGrid(data, '2027-12');
      g.rows[0][g.ctx.days.length - 1] = 5; // N on Fri 31 Dec
      const m4 = evaluateMonth(g.ctx, g.rows, true).findings.filter((f) => f.rule === 'M4');
      expect(m4.map((f) => f.message)).toEqual(['noční N končí ráno 1. 1., kdy je DOV']);
    });
  });

  describe('M2', () => {
    // The rest rule is the one of two days inside the month: the same pairs break it.
    it.each([['O', 'R1', 1], ['O', 'R2', 1], ['O20', 'R1', 1], ['O20', 'R2', 0], ['N', 'R1', 1],
      ['N', 'N', 0], ['R1', 'R1', 0]] as const)(
      '%s on the last day and %s stored for the day after → %i',
      (last, next, count) => expect(found(mar(next), last, 'M2')).toHaveLength(count),
    );
    it('is one finding on the last day, worth HARD, naming the date of the shift stored', () => {
      const k = mar('R1');
      expect(found(k, 'O', 'M2')).toEqual([{
        rule: 'M2', severity: 'must', person: 0, days: [lastOf(k)],
        message: 'R1 1. 4. hned po O: jen 8 h odpočinku (min. 12 h)', penalty: HARD,
      }]);
    });
    it('quotes no rest at all after a night that ends where the shift begins', () => {
      expect(found(mar('R1'), 'N', 'M2')[0].message)
        .toBe('R1 1. 4. hned po N: jen 0 h odpočinku (min. 12 h)');
      expect(found(mar('R2'), 'N', 'M2')[0].message)
        .toBe('R2 1. 4. hned po N: jen 2 h odpočinku (min. 12 h)');
    });
    it('needs a shift on both days', () => {
      expect(found(mar('x'), 'O', 'M2')).toEqual([]);
      expect(found(mar('DOV'), 'N', 'M2')).toEqual([]);
      expect(found(mar('R1'), '-', 'M2')).toEqual([]);
      expect(found(mar('R1'), 'x', 'M2')).toEqual([]);
    });
    it('compares with the minimum in the settings and quotes it', () => {
      expect(found(ctxFor('2027-03', [{ nextDay: 'R1' }], { minRestHours: 8 }), 'O', 'M2')).toEqual([]);
      expect(found(ctxFor('2027-03', [{ nextDay: 'R1' }], { minRestHours: 8.5 }), 'O', 'M2')[0].message)
        .toBe('R1 1. 4. hned po O: jen 8 h odpočinku (min. 8,5 h)');
    });
    it('takes the rest from the shift times in the settings', () => {
      const shifts = { ...defaultSettings().shifts, R1: { start: 390, end: 870, hours: 7.5 } };
      expect(found(mar('R1', { shifts }), 'O', 'M2')[0].message)
        .toBe('R1 1. 4. hned po O: jen 8,5 h odpočinku (min. 12 h)');
    });
    it('does not look at a person who is not in the team on day 1 of the next month', () => {
      const gone = ctxFor('2027-03', [{ nextDay: 'R1', activeTo: '2027-03-31' }]);
      expect(found(gone, 'O', 'M2')).toEqual([]);
    });
    it('looks past the end of a year: December into January', () => {
      const k = ctxFor('2027-12', [{ nextDay: 'R12' }]); // N, then R12 on Sat 1 Jan 2028
      expect(found(k, 'N', 'M2').map((f) => f.message))
        .toEqual(['R12 1. 1. hned po N: jen 0 h odpočinku (min. 12 h)']);
    });
  });

  describe('score and units', () => {
    const k = ctxFor('2027-02', [{ nextDay: 'x' }], {
      coverage: noCoverage, wishLevels: noWishes(), minWeekendShifts: 0,
    });
    it('count a unit and HARD for each, with a sink or without', () => {
      const ev = run(k, rowsOf(k, [at(27, 'N12')]));
      expect(ev.persons[0].mustUnits).toBe(2); // M4, and M6 for the hours short of FPD
      expect(ev.score).toBe(HARD + BELOW_FPD * (150 - 11.5));
      expect(evaluateMonth(k, rowsOf(k, [at(27, 'N12')]))).toMatchObject({ mustUnits: 2, score: ev.score });
    });
    it('are what they were when nothing is stored for the day after', () => {
      const bare = ctxFor('2027-02', 1, {
        coverage: noCoverage, wishLevels: noWishes(), minWeekendShifts: 0,
      });
      const ev = run(bare, rowsOf(bare, [at(27, 'N12')]));
      expect(ev.persons[0].mustUnits).toBe(1);
      expect(ev.score).toBe(BELOW_FPD * (150 - 11.5));
    });
    it('add the unit to the person of the last day only, and leave the others alone', () => {
      const two = ctxFor('2027-02', [{ nextDay: 'x' }, { nextDay: 'x' }],
        { coverage: noCoverage, wishLevels: noWishes(), minWeekendShifts: 0 });
      const ev = run(two, rowsOf(two, [at(27, 'N12'), at(27, 'R12')]));
      expect(ev.persons.map((s) => s.mustUnits)).toEqual([2, 1]);
    });
  });
});

// Phase 1.1: the strong wish S1, the weekend minimum (M12), the limits of a person (M5, M13) and
// the claimed holiday shifts, which are extra. February 2027 starts on a Monday, so its weekends
// are days 5-6, 12-13, 19-20 and 26-27 (counted from 0). January 2027 starts on Friday 1 Jan, a
// public holiday: day 0 is a holiday and its weekends are days 1-2, 8-9, 15-16, 22-23 and 29-30.

/** A strip with the codes of `shifts` (a day counted from 0, and its code), nothing elsewhere. */
const strip = (shifts: Record<number, string>): string => {
  const last = Math.max(...Object.keys(shifts).map(Number));
  return Array.from({ length: last + 1 }, (_, d) => shifts[d] ?? '-').join(' ');
};
/** A strip with R12 on the given days (counted from 0). */
const r12 = (...days: number[]): string => strip(Object.fromEntries(days.map((d) => [d, 'R12'])));
/** A month with nothing to score but the rules of the person: no coverage, no FPD, no wishes. */
const bare = (people: PersonPatch[], settings: Partial<Settings> = {}, month = '2027-02') =>
  ctxFor(month, people, {
    coverage: noCoverage, fpdHoursPerWeekday: 0, wishLevels: noWishes(), ...settings,
  });
/** January 2027, with the R12 on Fri 1 Jan (a public holiday) pinned for the person: claimed. */
const claimedJan = ctxFor('2027-01', [{ pinned: { '2027-01-01': 'R12' } }]);
/** The same January, with nothing pinned. */
const plainJan = ctxFor('2027-01', 1);
/** The findings of rule `id` for the strips of a team. */
const found = (ctx: MonthContext, id: Parameters<typeof rules>[1], ...strips: string[]) =>
  rules(run(ctx, rowsOf(ctx, strips)), id);
/** The M13 findings of a February with a person whose maximum of nights is `maxNights`. */
const overNights = (maxNights: number | null, month: string, tail = '') => {
  const k = ctxFor('2027-02', [{ maxNights }]);
  return rules(run(k, rowsOf(k, [month], tail === '' ? [] : [tail])), 'M13');
};

describe('strong wish, weekend minimum, limits and claimed holidays', () => {
  it('a night for a never person is a strong wish, not a must', () => {
    const solo = bare([{ prefs: { nights: 'never' } }], { minWeekendShifts: 0 });
    const ev = run(solo, rowsOf(solo, ['N']));
    expect(rules(ev, 'S1')).toEqual([{
      rule: 'S1', severity: 'wish', strong: true, person: 0, days: [solo.first],
      message: 'noční směna, ale noční nechce', penalty: STRONG,
    }]);
    expect(ev.findings.filter((f) => f.severity === 'must')).toEqual([]);
    expect([ev.persons[0].mustUnits, ev.mustUnits, ev.score]).toEqual([0, 0, STRONG]);
  });
  it('a claimed holiday shift is extra', () => {
    // 1 Jan is claimed (a pinned R12 on a holiday); Sat 2, Sun 3 and Sat 9 Jan are 3 weekend shifts
    expect(found(claimedJan, 'M5', r12(0, 1, 2, 8))).toEqual([]);
    // the same shifts with no claim are 4 twelve-hour shifts, one too many
    expect(found(plainJan, 'M5', r12(0, 1, 2, 8))).toHaveLength(1);
    // a 4th shift that is not claimed breaks M5
    expect(found(claimedJan, 'M5', r12(0, 1, 2, 8, 9))).toHaveLength(1);
  });
  it('the weekend minimum', () => {
    expect(found(c, 'M12', r12(5))).toMatchObject([{ rule: 'M12', penalty: WEEKEND_SHORT }]);
    expect(found(c, 'M12', r12(5, 6))).toEqual([]);
    // a claimed holiday does not count: 1 Jan and Sat 2 Jan are one weekend shift
    expect(found(claimedJan, 'M12', r12(0, 1))).toMatchObject([{ penalty: WEEKEND_SHORT }]);
  });
  it("a person's own maximum replaces the general one", () => {
    const k = ctxFor('2027-02', [{ maxTwelve: 4 }, {}]);
    const ev = run(k, rowsOf(k, [r12(5, 6, 12, 13), r12(5, 6, 12, 13)]));
    expect(rules(ev, 'M5').map((f) => f.person)).toEqual([1]);
  });
  it('max nights', () => {
    expect(overNights(2, 'N N N')).toHaveLength(1);
    expect(overNights(0, 'N')).toHaveLength(1); // a maximum of 0 is no night at all
    expect(overNights(null, 'N N N N N N')).toEqual([]); // no limit
  });
});

describe('a claimed holiday shift is extra, in detail', () => {
  it('is read from a pinned R12 on a holiday', () => {
    expect(claimedJan.people[0].claimed[claimedJan.first]).toBe(1);
    expect(plainJan.people[0].claimed[plainJan.first]).toBe(0);
  });
  it('is counted in the stats apart from the 12-hour shifts that count', () => {
    const ev = run(claimedJan, rowsOf(claimedJan, [r12(0, 1, 2, 8)]));
    expect(ev.persons[0]).toMatchObject({ twelve: 4, claimedTwelve: 1 });
  });
  it('leaves a fourth shift that is not claimed to M5, and names the shifts that count', () => {
    expect(found(claimedJan, 'M5', r12(0, 1, 2, 8, 9))).toEqual([{
      rule: 'M5', severity: 'must', person: 0,
      days: [1, 2, 8, 9].map((d) => claimedJan.first + d),
      message: '4 dvanáctihodinové směny (max. 3)', penalty: HARD,
    }]);
  });
  it('is a must unit only for the shifts that count', () => {
    // five shifts, one claimed: one over the maximum of 3 (and no weekend minimum to meet)
    const k = bare([{ pinned: { '2027-01-01': 'R12' } }], { minWeekendShifts: 0 }, '2027-01');
    const ev = run(k, rowsOf(k, [r12(0, 1, 2, 8, 9)]));
    expect(ev.persons[0].mustUnits).toBe(1);
    expect(ev.score).toBe(HARD);
  });
});

describe('M12 in detail', () => {
  it('is broken by one weekend shift: WEEKEND_SHORT, no days, the count in the text', () => {
    expect(found(c, 'M12', r12(5))).toEqual([{
      rule: 'M12', severity: 'must', person: 0, days: [],
      message: '1 víkendová směna (min. 2)', penalty: WEEKEND_SHORT,
    }]);
  });
  it('asks WEEKEND_SHORT for each shift short: none at all is two short', () => {
    expect(found(c, 'M12')).toEqual([{
      rule: 'M12', severity: 'must', person: 0, days: [],
      message: '0 víkendových směn (min. 2)', penalty: 2 * WEEKEND_SHORT,
    }]);
  });
  it('is met by two weekend shifts, R12 or N12, on any weekends, and by more', () => {
    expect(found(c, 'M12', r12(5, 6))).toEqual([]);
    expect(found(c, 'M12', r12(5, 19))).toEqual([]);
    expect(found(c, 'M12', strip({ 5: 'N12', 12: 'R12' }))).toEqual([]);
    expect(found(c, 'M12', r12(5, 6, 12, 13))).toEqual([]);
  });
  it('takes a weekday shift for no weekend shift', () => {
    expect(found(c, 'M12', 'R1 R1 R1 R1 R1')).toHaveLength(1);
  });
  it('counts a holiday on a weekday as a weekend shift, unless it is claimed', () => {
    // Fri 1 Jan is a public holiday: with Sat 2 Jan it makes two
    expect(found(plainJan, 'M12', r12(0, 1))).toEqual([]);
    // pinned, it is claimed and counts toward nothing: one weekend shift is left
    expect(found(claimedJan, 'M12', r12(0, 1))).toEqual([{
      rule: 'M12', severity: 'must', person: 0, days: [],
      message: '1 víkendová směna (min. 2)', penalty: WEEKEND_SHORT,
    }]);
    // and a claimed shift on top of two weekend shifts changes nothing
    expect(found(claimedJan, 'M12', r12(0, 1, 2))).toEqual([]);
  });
  it('follows the minimum in the settings and quotes it', () => {
    const three = ctxFor('2027-02', 1, { minWeekendShifts: 3 });
    expect(found(three, 'M12', r12(5, 6))).toEqual([{
      rule: 'M12', severity: 'must', person: 0, days: [],
      message: '2 víkendové směny (min. 3)', penalty: WEEKEND_SHORT,
    }]);
    expect(found(ctxFor('2027-02', 1, { minWeekendShifts: 0 }), 'M12')).toEqual([]);
  });
  it('is asked of everyone, also of someone who joins in the month', () => {
    const joiner = ctxFor('2027-02', [{ activeFrom: '2027-02-15' }]);
    expect(found(joiner, 'M12').map((f) => f.penalty)).toEqual([2 * WEEKEND_SHORT]);
  });
  it('is judged for each person on their own', () => {
    const two = ctxFor('2027-02', 2);
    expect(found(two, 'M12', r12(5, 6)).map((f) => [f.person, f.penalty]))
      .toEqual([[1, 2 * WEEKEND_SHORT]]);
  });
  it('counts the shifts of the month only', () => {
    const withTail = run(c, rowsOf(c, [r12(5)], ['R12 R12 R12 R12 R12 R12 R12']));
    expect(rules(withTail, 'M12')).toHaveLength(1);
  });
  it('is one must unit, however many shifts are short', () => {
    const k = bare([{}]);
    const none = run(k, rowsOf(k, []));
    expect([none.persons[0].mustUnits, none.mustUnits, none.score])
      .toEqual([1, 1, 2 * WEEKEND_SHORT]);
    const one = run(k, rowsOf(k, [r12(5)]));
    expect([one.persons[0].mustUnits, one.mustUnits, one.score]).toEqual([1, 1, WEEKEND_SHORT]);
    const met = run(k, rowsOf(k, [r12(5, 6)]));
    expect([met.persons[0].mustUnits, met.mustUnits, met.score]).toEqual([0, 0, 0]);
  });
});

describe("a person's own maximum of 12-hour shifts, in detail", () => {
  it('lets the person have more, and the others not', () => {
    const k = ctxFor('2027-02', [{ maxTwelve: 4 }, {}]);
    const ev = run(k, rowsOf(k, [r12(5, 6, 12, 13), r12(5, 6, 12, 13)]));
    expect(rules(ev, 'M5').map((f) => [f.person, f.message])).toEqual([
      [1, '4 dvanáctihodinové směny (max. 3)'],
    ]);
  });
  it('lets the person have fewer, and quotes it', () => {
    const k = ctxFor('2027-02', [{ maxTwelve: 1 }]);
    expect(found(k, 'M5', r12(5, 6))).toEqual([{
      rule: 'M5', severity: 'must', person: 0, days: [k.first + 5, k.first + 6],
      message: '2 dvanáctihodinové směny (max. 1)', penalty: HARD,
    }]);
  });
  it('is the maximum, whatever the general one is', () => {
    const k = ctxFor('2027-02', [{ maxTwelve: 2 }], { maxTwelvePerMonth: 5 });
    expect(found(k, 'M5', r12(5, 6, 12))[0].message).toBe('3 dvanáctihodinové směny (max. 2)');
  });
  it('leaves the claimed holiday shifts out of its count too', () => {
    const k = ctxFor('2027-01', [{ maxTwelve: 2, pinned: { '2027-01-01': 'R12' } }]);
    expect(found(k, 'M5', r12(0, 1, 2))).toEqual([]);
    expect(found(k, 'M5', r12(0, 1, 2, 8))[0].message).toBe('3 dvanáctihodinové směny (max. 2)');
  });
  it('is the general maximum when the person has none', () => {
    const k = ctxFor('2027-02', [{ maxTwelve: null }], { maxTwelvePerMonth: 2 });
    expect(found(k, 'M5', r12(5, 6, 12))[0].message).toBe('3 dvanáctihodinové směny (max. 2)');
  });
});

// R31: the HARD maximum of 12-hour shifts wins over the minimum of weekend shifts, so a person is
// never asked for more weekend shifts than they may work 12-hour shifts. February 2027: its
// weekends are days 5-6, 12-13, 19-20 and 26-27 (counted from 0), and the minimum is 2.
describe("M12 against a person's own maximum of 12-hour shifts", () => {
  const m12 = (maxTwelve: number | null, ...strips: string[]) =>
    found(ctxFor('2027-02', [{ maxTwelve }]), 'M12', ...strips);

  it('asks nothing of a person whose maximum is 0, who has no weekend shift', () => {
    expect(m12(0)).toEqual([]);
  });
  it('asks nothing more than the maximum: 1 weekend shift meets a maximum of 1', () => {
    expect(m12(1, r12(5))).toEqual([]);
  });
  it('asks the maximum, and quotes it, when that is below the minimum', () => {
    expect(m12(1)).toEqual([{
      rule: 'M12', severity: 'must', person: 0, days: [],
      message: '0 víkendových směn (min. 1)', penalty: WEEKEND_SHORT,
    }]);
    expect(m12(1, 'R1')[0].penalty).toBe(WEEKEND_SHORT); // and a shift on a weekday is none
  });
  it('asks the minimum of a person whose maximum is above it', () => {
    expect(m12(3, r12(5))).toEqual([{
      rule: 'M12', severity: 'must', person: 0, days: [],
      message: '1 víkendová směna (min. 2)', penalty: WEEKEND_SHORT,
    }]);
    expect(m12(3, r12(5, 6))).toEqual([]);
    expect(m12(2, r12(5))[0].message).toBe('1 víkendová směna (min. 2)'); // a maximum of 2 too
  });
  it('asks the minimum when the person has no maximum of their own, and the general is above', () => {
    expect(m12(null, r12(5))[0].message).toBe('1 víkendová směna (min. 2)');
    expect(m12(null, r12(5, 6))).toEqual([]);
  });
  it('holds everyone to a general maximum below the minimum', () => {
    const k = ctxFor('2027-02', 3, { maxTwelvePerMonth: 1 }); // the minimum stays 2
    // the first has 1 weekend shift, the second none, the third is over the maximum with 2
    const ev = run(k, rowsOf(k, [r12(5), '', r12(5, 6)]));
    expect(rules(ev, 'M12').map((f) => [f.person, f.message])).toEqual([
      [1, '0 víkendových směn (min. 1)'],
    ]);
    expect(rules(ev, 'M5').map((f) => f.person)).toEqual([2]); // the maximum holds: M5 only
  });
  it("follows the person's own maximum, not the general one, when both are set", () => {
    const k = ctxFor('2027-02', [{ maxTwelve: 3 }, { maxTwelve: null }], { maxTwelvePerMonth: 1 });
    const ev = run(k, rowsOf(k, [r12(5), r12(5)]));
    // The first may work 3, so the minimum of 2 stands. The second is held to the general maximum
    // of 1, and has met it.
    expect(rules(ev, 'M12').map((f) => [f.person, f.message])).toEqual([
      [0, '1 víkendová směna (min. 2)'],
    ]);
  });
  it('is no unit and no score for a person who has met the lowered minimum', () => {
    const k = bare([{ maxTwelve: 1 }]);
    const met = run(k, rowsOf(k, [r12(5)]));
    expect([met.persons[0].mustUnits, met.mustUnits, met.score]).toEqual([0, 0, 0]);
    const none = run(k, rowsOf(k, []));
    expect([none.persons[0].mustUnits, none.mustUnits, none.score])
      .toEqual([1, 1, WEEKEND_SHORT]);
  });
});

describe('M13 in detail', () => {
  it('is broken by a night over the maximum: HARD, the nights as days, the count in text', () => {
    expect(overNights(2, 'N N N')).toEqual([{
      rule: 'M13', severity: 'must', person: 0, days: [c.first, c.first + 1, c.first + 2],
      message: '3 noční (max. 2)', penalty: HARD,
    }]);
  });
  it('holds for a maximum of 0: no night at all', () => {
    expect(overNights(0, 'N')).toEqual([{
      rule: 'M13', severity: 'must', person: 0, days: [c.first],
      message: '1 noční (max. 0)', penalty: HARD,
    }]);
    expect(overNights(0, 'R1 R2 O20 O')).toEqual([]);
  });
  it('is no limit for null', () => {
    expect(overNights(null, Array(10).fill('N').join(' '))).toEqual([]);
  });
  it('allows exactly the maximum', () => {
    expect(overNights(3, 'N N N')).toEqual([]);
  });
  it('counts N and N12 alike', () => {
    expect(overNights(1, strip({ 0: 'N', 5: 'N12' })).map((f) => [f.days, f.message])).toEqual([
      [[c.first, c.first + 5], '2 noční (max. 1)'],
    ]);
  });
  it('is HARD for each night over the maximum, and a must unit for each', () => {
    const k = bare([{ maxNights: 1 }], { minWeekendShifts: 0 });
    const ev = run(k, rowsOf(k, ['N N N N']));
    expect(rules(ev, 'M13')[0].penalty).toBe(3 * HARD);
    expect(ev.persons[0].mustUnits).toBe(3);
    expect(ev.score).toBe(3 * HARD);
  });
  it('counts the nights of the month only', () => {
    expect(overNights(1, 'N', '- - - - N N N')).toEqual([]);
  });
  it('puts the count in the Czech form: 1, 2 to 4, and 5 or more', () => {
    const message = (count: number) => overNights(0, Array(count).fill('N').join(' '))[0].message;
    expect([1, 2, 3, 4, 5].map(message)).toEqual([
      '1 noční (max. 0)', '2 noční (max. 0)', '3 noční (max. 0)', '4 noční (max. 0)',
      '5 nočních (max. 0)',
    ]);
  });
  it('counts a claimed N12 as a night, though a claimed shift is no 12-hour shift', () => {
    // Fri 1 Jan 2027 is a public holiday, and the N12 pinned on it is claimed: extra for M5 and
    // M12, but the night is worked all the same
    const k = ctxFor('2027-01', [{ maxNights: 0, maxTwelve: 0, pinned: { '2027-01-01': 'N12' } }]);
    const ev = run(k, rowsOf(k, ['N12']));
    expect(ev.persons[0]).toMatchObject({ twelve: 1, claimedTwelve: 1, nights: 1 });
    expect(rules(ev, 'M5')).toEqual([]);
    expect(rules(ev, 'M13')).toEqual([{
      rule: 'M13', severity: 'must', person: 0, days: [k.first],
      message: '1 noční (max. 0)', penalty: HARD,
    }]);
    // and it is one of the nights that a maximum of 1 allows: a second night is over it
    const one = ctxFor('2027-01', [{ maxNights: 1, pinned: { '2027-01-01': 'N12' } }]);
    expect(found(one, 'M13', 'N12')).toEqual([]);
    expect(found(one, 'M13', 'N12 - - N')).toEqual([{
      rule: 'M13', severity: 'must', person: 0, days: [one.first, one.first + 3],
      message: '2 noční (max. 1)', penalty: HARD,
    }]);
  });
  it('is a must of its own, besides the strong wish of a person who never takes nights', () => {
    const k = ctxFor('2027-02', [{ prefs: { nights: 'never' }, maxNights: 0 }]);
    const ev = run(k, rowsOf(k, ['N']));
    expect(rules(ev, 'M13')).toHaveLength(1);
    expect(rules(ev, 'S1')).toHaveLength(1);
  });
});
