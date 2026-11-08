import { describe, it, expect } from 'vitest';
import { Code } from '../domain/codes';
import { defaultSettings, newPerson } from '../domain/defaults';
import { evaluateMonth } from '../domain/rules/evaluate';
import type { Finding } from '../domain/rules/types';
import { BASE_WEIGHTS } from '../domain/rules/weights';
import { ctxFor, noWishes, rowsOf, rules, run, units } from './rulekit';

/** The non-empty cells of a row as [index, code] pairs. */
const used = (row: Uint8Array) => Array.from(row).flatMap((v, i) => (v === Code.EMPTY ? [] : [[i, v]]));

describe('ctxFor', () => {
  it('makes the given number of default people, p1, p2, ...', () => {
    const c = ctxFor('2027-02', 3);
    expect(c.month).toBe('2027-02');
    expect(c.first).toBe(7);
    expect(c.days).toHaveLength(7 + 28);
    expect(c.people.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(c.people.map((p) => p.fpd)).toEqual([150, 150, 150]);
    expect(c.people.every((p) => p.active.every((a) => a === 1))).toBe(true);
    expect(c.people[0].prefs).toEqual(newPerson('x', 'x').prefs);
  });
  it('lays each patch over a default person', () => {
    const c = ctxFor('2027-02', [
      { prefs: { nights: 'never' }, startingCounts: { twelve: 5 } },
      { activeFrom: '2027-02-15', activeTo: '2027-02-21' }, // Mon 15 - Sun 21
      {},
    ]);
    expect(c.people[0].prefs).toEqual({ ...newPerson('x', 'x').prefs, nights: 'never' });
    expect(c.people[0].history).toEqual({ twelve: 5, nights: 0, holidayTwelve: 0, festive: 0 });
    expect(c.people[1].fpd).toBe(5 * 7.5);
    expect(c.people[2].prefs.nights).toBe('normal');
    expect(c.people[2].history).toEqual({ twelve: 0, nights: 0, holidayTwelve: 0, festive: 0 });
  });
  it('resolves the limits of a patch, and takes none to be the general ones', () => {
    const c = ctxFor('2027-02', [{ maxTwelve: 4, maxNights: 0 }, { maxTwelve: null }, {}]);
    expect(c.people.map((p) => p.maxTwelve)).toEqual([4, 3, 3]);
    expect(c.people.map((p) => p.maxNights)).toEqual([0, null, null]);
    const own = ctxFor('2027-02', [{ maxTwelve: 1 }], { maxTwelvePerMonth: 5 });
    expect(own.people[0].maxTwelve).toBe(1);
    expect(ctxFor('2027-02', [{}], { maxTwelvePerMonth: 5 }).people[0].maxTwelve).toBe(5);
  });
  it('pins the shifts of a patch, and a pinned 12-hour shift on a holiday is claimed', () => {
    // Fri 1 Jan 2027 is a public holiday, Sat 2 Jan is not
    const c = ctxFor('2027-01', [
      { pinned: { '2027-01-01': 'R12', '2027-01-02': 'R12', '2027-01-04': 'R1' } },
      {},
    ]);
    expect(Array.from(c.people[0].claimed.subarray(c.first, c.first + 5))).toEqual([1, 0, 0, 0, 0]);
    expect(c.people[1].claimed.every((x) => x === 0)).toBe(true);
  });
  it('stores the code of a patch on day 1 of the next month, also past the end of a year', () => {
    const c = ctxFor('2027-02', [{ nextDay: 'x' }, {}, { nextDay: 'R1' }]);
    expect(c.people.map((p) => p.nextDay)).toEqual([Code.X, Code.EMPTY, Code.R1]);
    const december = ctxFor('2027-12', [{ nextDay: 'DOV' }]);
    expect(december.people[0].nextDay).toBe(Code.DOV);
  });
  it('stores the codes of a patch on the 7 days before the tail, which are no cells of the rows', () => {
    // February's tail starts on Mon 25 January: a night on Sun 24 ends at 06:00 that day, and an
    // R1 on Mon 18, the first of the 7 days, at 14:00 a week before
    const c = ctxFor('2027-02', [{ before: '- - - - - - N' }, {}, { before: 'R1 | x' }]);
    expect(c.people.map((p) => p.restBefore)).toEqual([360, null, -7 * 1440 + 840]);
    expect(ctxFor('2027-01', [{ before: '- - - - - - N12' }]).people[0].restBefore).toBe(360);
    expect(() => ctxFor('2027-02', [{ before: 'R1 R1 R1 R1 R1 R1 R1 R1' }])).toThrow('room for 7');
    expect(() => ctxFor('2027-02', [{ before: 'R3' }])).toThrow('Unknown code "R3"');
  });
  it('lays the settings over the defaults', () => {
    const wishLevels = { ...defaultSettings().wishLevels, W6: 5 as const };
    const c = ctxFor('2027-02', 1, { minRestHours: 10, wishLevels });
    expect(c.settings.minRestHours).toBe(10);
    expect(c.settings.maxTwelvePerMonth).toBe(3);
    expect(c.weights.W6).toBe(BASE_WEIGHTS.W6 * 4);
  });
});

describe('rowsOf', () => {
  const c = ctxFor('2027-02', 3);

  it('gives an empty row per person, as long as the context, when there are no strips', () => {
    const rows = rowsOf(c, []);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.length)).toEqual([35, 35, 35]);
    expect(rows.map(used)).toEqual([[], [], []]);
  });
  it('reads a month strip and a tail strip per person, and leaves the rest empty', () => {
    const rows = rowsOf(c, ['R1 R2', '- O'], ['N', '- - - - - - N12']);
    expect(rows.map(used)).toEqual([
      [[0, Code.N], [7, Code.R1], [8, Code.R2]],
      [[6, Code.N12], [8, Code.O]],
      [],
    ]);
  });
  it('reads codes in any case, and the requests and absences', () => {
    const [row] = rowsOf(c, ['x X dov Nem']);
    expect(used(row)).toEqual([[7, Code.X], [8, Code.X], [9, Code.DOV], [10, Code.NEM]]);
  });
  it('ignores | whether or not spaces surround it', () => {
    const [row] = rowsOf(c, ['R1 R2|R1 | R2']);
    expect(used(row)).toEqual([[7, Code.R1], [8, Code.R2], [9, Code.R1], [10, Code.R2]]);
  });
  it('fills a whole month or tail exactly', () => {
    const [row] = rowsOf(c, [Array(28).fill('R1').join(' ')], [Array(7).fill('N').join(' ')]);
    expect(used(row)).toHaveLength(35);
  });
  it('rejects what it cannot place instead of dropping it', () => {
    expect(() => rowsOf(c, ['R1 R3'])).toThrow('Unknown code "R3"');
    expect(() => rowsOf(c, [Array(29).fill('R1').join(' ')])).toThrow('room for 28');
    expect(() => rowsOf(c, [], [Array(8).fill('N').join(' ')])).toThrow('room for 7');
    expect(() => rowsOf(c, ['R1', 'R1', 'R1', 'R1'])).toThrow('More strips than the 3 people');
  });
});

describe('run, rules, units and noWishes', () => {
  const c = ctxFor('2027-02', 1);
  const wish = (penalty: number): Finding =>
    ({ rule: 'W1', severity: 'wish', person: 0, days: [], message: 'přesčas', penalty });

  it('run evaluates the month with the explanations on', () => {
    const rows = rowsOf(c, ['O R1']);
    expect(run(c, rows)).toEqual(evaluateMonth(c, rows, true));
    expect(run(c, rows).findings.length).toBeGreaterThan(0);
  });
  it('rules picks the findings of one rule, and gives none for a rule that found nothing', () => {
    const ev = run(c, rowsOf(c, ['O R1']));
    expect(rules(ev, 'M2').map((f) => f.rule)).toEqual(['M2']);
    expect(rules(ev, 'M6')).toHaveLength(1);
    expect(rules(ev, 'M13')).toEqual([]);
  });
  it('units counts the findings of a must, whatever their penalty', () => {
    const ev = run(c, rowsOf(c, ['- - - - - R12 R12 | - - - - - R12 R12 | - - - - - R12']));
    expect(rules(ev, 'M5')[0].penalty).toBe(2e9); // two shifts over the maximum, in one finding
    expect(units(ev, c, 'M5')).toBe(1);
    expect(units(ev, c, 'M13')).toBe(0);
  });
  it('units counts the findings of the strong wish S1 too, not penalties over a weight', () => {
    const never = ctxFor('2027-02', [{ prefs: { nights: 'never' } }]);
    const ev = run(never, rowsOf(never, ['N N - - - N12']));
    expect(units(ev, never, 'S1')).toBe(3);
    expect(units(run(c, rowsOf(c, ['N'])), c, 'S1')).toBe(0);
  });
  it('units divides the penalties of a wish by its weight', () => {
    const ev = { ...run(c, rowsOf(c, [])), findings: [wish(30), wish(15)] };
    expect(units(ev, c, 'W1')).toBe(45 / BASE_WEIGHTS.W1);
    expect(units(ev, c, 'W2')).toBe(0);
    const strong = ctxFor('2027-02', 1, { wishLevels: { ...defaultSettings().wishLevels, W1: 5 } });
    expect(units(ev, strong, 'W1')).toBe(45 / (BASE_WEIGHTS.W1 * 4));
  });
  it('units of a wish that is switched off is 0, not NaN', () => {
    const off = ctxFor('2027-02', 1, { wishLevels: noWishes() });
    const ev = { ...run(off, rowsOf(off, [])), findings: [wish(0)] };
    expect(units(ev, off, 'W1')).toBe(0);
  });
  it('noWishes gives fresh levels with every wish off, so that every weight is 0', () => {
    const levels = noWishes();
    expect(Object.keys(levels).sort()).toEqual(Object.keys(defaultSettings().wishLevels).sort());
    expect(Object.values(levels).every((level) => level === 0)).toBe(true);
    expect(noWishes()).not.toBe(levels);
    const off = ctxFor('2027-02', 1, { wishLevels: noWishes() });
    expect(Object.values(off.weights).every((weight) => weight === 0)).toBe(true);
  });
});
