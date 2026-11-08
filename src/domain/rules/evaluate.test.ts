import { describe, it, expect, vi } from 'vitest';
import { ctxFor, rowsOf } from '../../test/rulekit';
import { evaluateMonth } from './evaluate';
import type { Finding } from './types';

// evaluateDay is replaced by one that reports a wish, with the message 'wish', on day 1 of the
// month and nothing else. So there is a wish whose day comes before that of M6, which names none,
// and the order of the findings shows whether musts really come first. The persons are real:
// whatever wishes they report belong to the engine, so the test looks at the musts and at the
// grouping, never at the full list.
vi.mock('./day', () => ({
  evaluateDay: (
    ctx: { first: number },
    d: number,
    _rows: Uint8Array[],
    sink?: (f: unknown) => void,
  ) => {
    if (sink && d === ctx.first) {
      sink({ rule: 'W9', severity: 'wish', person: null, days: [d], message: 'wish', penalty: 1 });
    }
    return { score: 0, stats: { r2: 0, mustUnits: 0 } };
  },
}));

describe('evaluateMonth order of findings', () => {
  it('puts musts before wishes, whatever the day', () => {
    // no weekend minimum, so that the weekend shifts nobody has are no must here
    const c = ctxFor('2027-02', 2, { minWeekendShifts: 0 });
    // O R1 breaks M2 on day 1-2, and both people are below FPD (M6, which has no day)
    const ev = evaluateMonth(c, rowsOf(c, ['O R1', '-']), true);

    const musts = ev.findings.filter((f) => f.severity === 'must');
    expect(musts.map((f) => f.rule)).toEqual(['M2', 'M6', 'M6']);

    // every must comes before every wish
    const severities = ev.findings.map((f) => f.severity);
    expect(severities.slice(0, musts.length).every((s) => s === 'must')).toBe(true);
    expect(severities.slice(musts.length).every((s) => s === 'wish')).toBe(true);
    // and the wish of day 1 is one of those wishes, though its day is before M6, which has none
    const wishAt = ev.findings.findIndex((f) => f.message === 'wish');
    expect(wishAt).toBeGreaterThanOrEqual(musts.length);
  });

  it('lists musts, then strong wishes, then wishes', () => {
    // The mocked day reports a wish (W9) on day 1. Person 0 never takes nights and has one on
    // Thu 11 Feb, person 1 one on Thu 4 Feb: two strong wishes, both listed before that wish though
    // its day is earlier, and in the order of their days though person 0 comes first. Both people
    // are also short of the weekend minimum and of FPD, which are musts with no day.
    const c = ctxFor('2027-02', [{ prefs: { nights: 'never' } }, { prefs: { nights: 'never' } }]);
    const ev = evaluateMonth(c, rowsOf(c, ['- - - - - - - - - - N', '- - - N']), true);

    const tier = (f: Finding) => (f.severity === 'must' ? 0 : f.strong === true ? 1 : 2);
    const tiers = ev.findings.map(tier);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));

    const strong = ev.findings.filter((f) => f.strong === true);
    expect(strong.map((f) => [f.rule, f.severity, f.person, f.days])).toEqual([
      ['S1', 'wish', 1, [c.first + 3]],
      ['S1', 'wish', 0, [c.first + 10]],
    ]);

    // all three tiers are there, and the wish of day 1 comes after the strong ones
    expect(new Set(tiers)).toEqual(new Set([0, 1, 2]));
    const wishAt = ev.findings.findIndex((f) => f.message === 'wish');
    expect(wishAt).toBeGreaterThan(ev.findings.indexOf(strong[1]));
  });
});
