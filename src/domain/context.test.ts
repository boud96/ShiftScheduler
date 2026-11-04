import { describe, it, expect } from 'vitest';
import { newAppData } from './defaults';
import { buildMonthGrid, applyRows } from './context';
import { Code } from './codes';
import { fpdForMonth } from './calendar';
import { BASE_WEIGHTS, effectiveWeights } from './rules/weights';
import type { StoredCell } from './types';
import { ctxFor, rowsOf } from '../test/rulekit';

describe('buildMonthGrid', () => {
  it('puts the tail first and marks fixed cells', () => {
    const data = newAppData(); const [a, b] = data.people;
    data.cells['2026-12-31'] = { [a.id]: { code: 'N' } };
    data.cells['2027-01-02'] = { [a.id]: { code: 'x' }, [b.id]: { code: 'R12', pinned: true } };
    data.cells['2027-01-04'] = { [b.id]: { code: 'R1' } };
    const g = buildMonthGrid(data, '2027-01');
    expect(g.ctx.first).toBe(7);
    expect(g.rows[0][6]).toBe(Code.N);
    expect(g.rows[0][8]).toBe(Code.X);
    expect([g.fixed[0][6], g.fixed[0][8], g.fixed[1][8], g.fixed[1][10]]).toEqual([1, 1, 1, 0]);
  });
  it('prorates FPD, applies the hours adjustment, fixes inactive days', () => {
    const data = newAppData();
    data.people[0].activeFrom = '2027-01-18';
    data.months['2027-01'] = { status: 'draft', hoursAdjust: { [data.people[1].id]: -4.5 } };
    const g = buildMonthGrid(data, '2027-01');
    expect(g.ctx.people[0].fpd).toBe(75);
    expect(g.ctx.people[1].fpd).toBe(153);
    expect(g.fixed[0][7 + 16]).toBe(1);
  });
  it('skips people not active in the month', () => {
    const data = newAppData(); data.people[7].activeTo = '2026-12-31';
    expect(buildMonthGrid(data, '2027-01').personIds).toHaveLength(7);
  });
});

describe('applyRows', () => {
  it('writes only free month cells', () => {
    const data = newAppData(); const id = data.people[0].id;
    data.cells['2027-01-05'] = { [id]: { code: 'DOV' } };
    data.cells['2027-01-06'] = { [id]: { code: 'R2' } };
    const g = buildMonthGrid(data, '2027-01');
    g.rows[0][7 + 3] = Code.R1; g.rows[0][7 + 4] = Code.R1; g.rows[0][7 + 5] = Code.EMPTY;
    const out = applyRows(data, '2027-01', g.rows, g.fixed);
    expect(out.cells['2027-01-04'][id]).toEqual({ code: 'R1' });
    expect(out.cells['2027-01-05'][id]).toEqual({ code: 'DOV' });
    expect(out.cells['2027-01-06']?.[id]).toBeUndefined();
    expect(data.cells['2027-01-06'][id]).toEqual({ code: 'R2' }); // input not mutated
  });
});

describe('rulekit.rowsOf', () => {
  it('parses strips with tail, gaps and separators', () => {
    const c = ctxFor('2027-02', 1);
    const [r] = rowsOf(c, ['R1 - | O20'], ['- - - - - - N']);
    expect([r[6], r[7], r[8], r[9], r[10]]).toEqual([Code.N, Code.R1, Code.EMPTY, Code.O20, Code.EMPTY]);
  });
});

describe('buildMonthGrid in detail', () => {
  it('lays out the context: tail, then month, with weights, history and one row per person', () => {
    const data = newAppData();
    data.people[2].startingCounts = { twelve: 2, nights: 1, holidayTwelve: 0, festive: 1 };
    data.settings.wishLevels.W6 = 5;
    const before = structuredClone(data);
    const g = buildMonthGrid(data, '2027-01');
    const { ctx } = g;
    expect(ctx.month).toBe('2027-01');
    expect(ctx.days).toHaveLength(7 + 31);
    expect([0, 6, 7, 37].map((i) => ctx.days[i].date))
      .toEqual(['2026-12-25', '2026-12-31', '2027-01-01', '2027-01-31']);
    expect(ctx.days.map((d) => d.inMonth)).toEqual([...Array(7).fill(false), ...Array(31).fill(true)]);
    expect(ctx.settings).toBe(data.settings);
    expect(ctx.weights).toEqual(effectiveWeights(data.settings.wishLevels));
    expect(ctx.weights.W6).toBe(BASE_WEIGHTS.W6 * 4); // level 5 counts four times
    expect(g.personIds).toEqual(data.people.map((p) => p.id));
    expect(ctx.people.map((p) => p.id)).toEqual(g.personIds);
    expect(ctx.people[2].history).toEqual({ twelve: 2, nights: 1, holidayTwelve: 0, festive: 1 });
    expect(ctx.people[2].prefs).toEqual(data.people[2].prefs);
    expect(g.rows).toHaveLength(8);
    expect(g.fixed).toHaveLength(8);
    expect([...g.rows, ...g.fixed].every((r) => r.length === 38)).toBe(true);
    expect(data).toEqual(before); // the data is only read
  });
  it('marks the days a person is in the team, the first and the last day included', () => {
    const data = newAppData();
    data.people[0].activeFrom = '2027-01-10';
    data.people[0].activeTo = '2027-01-12';
    data.people[1].activeTo = '2027-01-10';
    const [from10to12, until10, everyday] = buildMonthGrid(data, '2027-01').ctx.people.map((p) => p.active);
    const on = (a: Uint8Array) => Array.from(a).flatMap((v, i) => (v === 1 ? [i] : []));
    expect(from10to12.length).toBe(38);
    expect(on(from10to12)).toEqual([16, 17, 18]); // Jan 10, 11, 12 = index 7 + 9, 10, 11
    expect(on(until10)).toEqual(Array.from({ length: 17 }, (_, i) => i)); // the tail and Jan 1-10
    expect(on(everyday)).toHaveLength(38);
  });
  it.each([
    ['leaves on day 1 of the month', { activeTo: '2027-01-01' }, true],
    ['left on the day before the month', { activeTo: '2026-12-31' }, false],
    ['joins on the last day of the month', { activeFrom: '2027-01-31' }, true],
    ['joins on day 1 of the next month', { activeFrom: '2027-02-01' }, false],
    ['joins after they leave', { activeFrom: '2027-01-20', activeTo: '2027-01-10' }, false],
  ])('includes the person only when active on a day of the month: %s', (_, patch, included) => {
    const data = newAppData();
    Object.assign(data.people[0], patch);
    expect(buildMonthGrid(data, '2027-01').personIds.includes('p1')).toBe(included);
  });
  it('counts the active Mon–Fri days for FPD, public holidays included', () => {
    const data = newAppData();
    const [fromMon20, untilThu2, weekendOnly, , adjusted] = data.people;
    fromMon20.activeFrom = '2027-12-20'; // Mon 20 - Fri 24 (24 Dec is a holiday), Mon 27 - Fri 31
    untilThu2.activeTo = '2027-12-02'; // Wed 1 and Thu 2
    weekendOnly.activeFrom = '2027-12-04'; // Saturday and Sunday only
    weekendOnly.activeTo = '2027-12-05';
    data.months['2027-12'] = { status: 'draft', hoursAdjust: { [adjusted.id]: 4 } };
    const fpd = buildMonthGrid(data, '2027-12').ctx.people.map((p) => p.fpd);
    expect(fpd.slice(0, 3)).toEqual([75, 15, 0]);
    expect(fpd[3]).toBe(fpdForMonth('2027-12', data.settings)); // the whole month: 23 days
    expect(fpd[4]).toBe(fpdForMonth('2027-12', data.settings) + 4);
    data.settings.fpdHoursPerWeekday = 8;
    expect(buildMonthGrid(data, '2027-12').ctx.people[3].fpd).toBe(23 * 8);
  });
  it('fixes requests, absences and pinned shifts, and leaves the other cells free', () => {
    const data = newAppData(); const id = data.people[0].id;
    const stored: Array<[string, StoredCell]> = [
      ['2027-01-04', { code: 'DOV' }],
      ['2027-01-05', { code: 'MD' }],
      ['2027-01-06', { code: 'OP' }],
      ['2027-01-07', { code: 'NEM' }],
      ['2027-01-08', { code: 'x' }],
      ['2027-01-09', { code: 'R12' }],
      ['2027-01-10', { code: 'N12', pinned: true }],
      ['2027-01-11', { code: 'R1', pinned: false }],
      ['2027-01-12', { code: 'R2', pinned: true }],
    ];
    for (const [date, cell] of stored) data.cells[date] = { [id]: cell };
    const g = buildMonthGrid(data, '2027-01');
    const jan4to13 = (a: Uint8Array) => Array.from(a.subarray(7 + 3, 7 + 13));
    expect(jan4to13(g.rows[0])).toEqual([
      Code.DOV, Code.MD, Code.OP, Code.NEM, Code.X, Code.R12, Code.N12, Code.R1, Code.R2, Code.EMPTY,
    ]);
    expect(jan4to13(g.fixed[0])).toEqual([1, 1, 1, 1, 1, 0, 1, 0, 1, 0]);
  });
  it('fixes the whole tail, whatever it holds', () => {
    const data = newAppData();
    data.cells['2026-12-27'] = { p1: { code: 'R1' } };
    const g = buildMonthGrid(data, '2027-01');
    expect(Array.from(g.fixed[0].subarray(0, 7))).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(g.rows[0][2]).toBe(Code.R1);
  });
  it('keeps a shift stored on a day outside the time in the team, and fixes the cell', () => {
    const data = newAppData(); const id = data.people[0].id;
    data.people[0].activeFrom = '2027-01-18';
    data.cells['2027-01-05'] = { [id]: { code: 'R1' } };
    const g = buildMonthGrid(data, '2027-01');
    expect([g.rows[0][7 + 4], g.fixed[0][7 + 4]]).toEqual([Code.R1, 1]); // Jan 5: stored, not wiped
    expect([g.rows[0][7 + 5], g.fixed[0][7 + 5]]).toEqual([Code.EMPTY, 1]); // Jan 6: nothing stored
    expect([g.rows[0][7 + 17], g.fixed[0][7 + 17]]).toEqual([Code.EMPTY, 0]); // Jan 18: first active day
    expect(applyRows(data, '2027-01', g.rows, g.fixed).cells['2027-01-05']).toEqual({ [id]: { code: 'R1' } });
  });
});

describe('applyRows in detail', () => {
  it('gives the same cells back when the rows were not edited', () => {
    const data = newAppData();
    const [p1, p2, p3, , , , , p8] = data.people;
    p3.activeFrom = '2027-01-18';
    p8.activeTo = '2026-12-31';
    data.cells = {
      '2026-12-30': { [p1.id]: { code: 'N' } }, // the tail
      '2027-01-02': { [p1.id]: { code: 'x' }, [p2.id]: { code: 'R12', pinned: true } },
      '2027-01-04': { [p1.id]: { code: 'R1' }, [p2.id]: { code: 'DOV' } },
      '2027-01-05': { [p3.id]: { code: 'R2' } }, // before p3 joins
      '2027-01-06': { [p8.id]: { code: 'O' } }, // p8 has left and is not in the grid
      '2027-02-02': { [p1.id]: { code: 'R1' } }, // the next month
    };
    const before = structuredClone(data);
    const g = buildMonthGrid(data, '2027-01');
    expect(applyRows(data, '2027-01', g.rows, g.fixed).cells).toEqual(before.cells);
    expect(data).toEqual(before);
  });
  it('puts each row on its own person when someone is left out of the grid', () => {
    const data = newAppData();
    data.people[0].activeTo = '2026-12-31'; // p1 is not in January, so row 0 is p2
    const g = buildMonthGrid(data, '2027-01');
    expect(g.personIds[0]).toBe('p2');
    g.rows[0][7 + 3] = Code.R1;
    expect(applyRows(data, '2027-01', g.rows, g.fixed).cells['2027-01-04']).toEqual({ p2: { code: 'R1' } });
  });
  it('removes a date that is left without cells, and adds no empty ones', () => {
    const data = newAppData();
    data.cells['2027-01-06'] = { p1: { code: 'R2' } };
    const g = buildMonthGrid(data, '2027-01');
    g.rows[0][7 + 5] = Code.EMPTY;
    expect(applyRows(data, '2027-01', g.rows, g.fixed).cells).toEqual({});
  });
  it('stores a shift without a pin next to the other cells of the day, and keeps pinned shifts', () => {
    const data = newAppData();
    data.cells['2027-01-02'] = { p4: { code: 'R12', pinned: true } };
    data.cells['2027-01-04'] = { p1: { code: 'R2' }, p2: { code: 'DOV' } };
    const g = buildMonthGrid(data, '2027-01');
    g.rows[0][7 + 3] = Code.N; // p1: R2 becomes N
    g.rows[2][7 + 3] = Code.O20; // p3: a new shift
    g.rows[3][7 + 1] = Code.EMPTY; // p4: tries to clear a pinned shift
    const out = applyRows(data, '2027-01', g.rows, g.fixed);
    expect(out.cells['2027-01-04']).toEqual({ p1: { code: 'N' }, p2: { code: 'DOV' }, p3: { code: 'O20' } });
    expect(out.cells['2027-01-02']).toEqual({ p4: { code: 'R12', pinned: true } });
  });
  it('writes month cells only, even when the fixed mask does not cover the tail', () => {
    const data = newAppData();
    data.cells['2026-12-31'] = { p1: { code: 'N' } };
    const g = buildMonthGrid(data, '2027-01');
    g.rows[0][6] = Code.EMPTY; // the tail cell, edited
    g.rows[0][7] = Code.R1;
    const nothingFixed = g.rows.map((row) => new Uint8Array(row.length));
    const out = applyRows(data, '2027-01', g.rows, nothingFixed);
    expect(out.cells['2026-12-31']).toEqual({ p1: { code: 'N' } });
    expect(out.cells['2027-01-01']).toEqual({ p1: { code: 'R1' } });
  });
});
