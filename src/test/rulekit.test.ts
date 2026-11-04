import { describe, it, expect } from 'vitest';
import { Code } from '../domain/codes';
import { defaultSettings, newPerson } from '../domain/defaults';
import { BASE_WEIGHTS } from '../domain/rules/weights';
import { ctxFor, rowsOf } from './rulekit';

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
