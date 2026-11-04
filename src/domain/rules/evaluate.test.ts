import { describe, it, expect, vi } from 'vitest';
import { ctxFor, rowsOf } from '../../test/rulekit';
import { evaluateMonth } from './evaluate';

// No wish exists yet, so evaluateDay is replaced by one that reports a wish on day 1 of the month
// (and nothing else): the order of the findings can then be seen with both severities in it.
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
    const c = ctxFor('2027-02', 2);
    // O R1 breaks M2 on day 1-2, and both people are below FPD (M6, which has no day)
    const ev = evaluateMonth(c, rowsOf(c, ['O R1', '-']), true);
    expect(ev.findings.map((f) => f.rule)).toEqual(['M2', 'M6', 'M6', 'W9']);
    expect(ev.findings.map((f) => f.severity)).toEqual(['must', 'must', 'must', 'wish']);
  });
});
