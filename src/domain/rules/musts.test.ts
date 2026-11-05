import { describe, it, expect } from 'vitest';
import { ctxFor, noWishes, rowsOf, run, rules } from '../../test/rulekit';
import { defaultSettings } from '../defaults';
import { BELOW_FPD, GAP, HARD } from './weights';
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
  it('M7: never nights', () => {
    const v = ctxFor('2027-02', [{ prefs: { nights: 'never' } }]);
    expect(rules(run(v, rowsOf(v, ['N N - - - N12'])), 'M7')).toHaveLength(3);
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
  it('has nothing to say about the last night of the month, whose morning is next month', () => {
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

describe('M7 in detail', () => {
  const never = ctxFor('2027-02', [{ prefs: { nights: 'never' } }]);
  it('is one finding per night shift, on its cell', () => {
    const f = rules(run(never, rowsOf(never, ['N - - - - N12 N12'])), 'M7');
    expect(f.map((x) => x.days)).toEqual([[never.first], [never.first + 5], [never.first + 6]]);
    expect(f[0]).toEqual({
      rule: 'M7', severity: 'must', person: 0, days: [never.first],
      message: 'noční směna, ale noční nechce', penalty: HARD,
    });
  });
  it.each(['normal', 'ifNeeded', 'extra'] as const)('allows nights for %s', (nights) => {
    const k = ctxFor('2027-02', [{ prefs: { nights } }]);
    expect(rules(run(k, rowsOf(k, ['N'])), 'M7')).toHaveLength(0);
  });
  it('ignores a night in the previous month', () => {
    expect(rules(run(never, rowsOf(never, [], ['- - - - - - N'])), 'M7')).toHaveLength(0);
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
// a wish adds its own penalty, and the global wishes add a term of their own.
describe('must units and scores', () => {
  const k = ctxFor('2027-02', 1, { coverage: noCoverage, wishLevels: noWishes() });
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
    const bare = ctxFor('2027-02', 1, { wishLevels: noWishes() });
    const ev = run(bare, rowsOf(bare, []));
    expect(ev.mustUnits).toBe(20 * 5 + 8 * 2 + 1);
    expect(ev.score).toBe((20 * 5 + 8 * 2) * GAP + BELOW_FPD * 150);
  });
});
