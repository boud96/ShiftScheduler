import { describe, it, expect } from 'vitest';
import { newAppData } from './defaults';
import { buildMonthGrid, applyRows } from './context';
import { Code } from './codes';
import { fpdForMonth } from './calendar';
import { BASE_WEIGHTS, effectiveWeights } from './rules/weights';
import type { AppData, StoredCell } from './types';
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

describe('the day after the month', () => {
  // The code stored for a person on day 1 of the next month goes to `nextDay`, outside the rows.
  const nextDays = (data: ReturnType<typeof newAppData>, month: string) =>
    buildMonthGrid(data, month).ctx.people.map((p) => p.nextDay);

  it('is the code stored for each person on day 1 of the next month, and EMPTY for the rest', () => {
    const data = newAppData();
    data.cells['2027-02-01'] = {
      p1: { code: 'x' },
      p2: { code: 'DOV' },
      p3: { code: 'R1', pinned: true },
      p4: { code: 'N12' },
    };
    expect(nextDays(data, '2027-01')).toEqual([
      Code.X, Code.DOV, Code.R1, Code.N12, Code.EMPTY, Code.EMPTY, Code.EMPTY, Code.EMPTY,
    ]);
  });
  it('is EMPTY for everyone when nothing is stored there', () => {
    const data = newAppData();
    data.cells['2027-01-31'] = { p1: { code: 'N' } };
    data.cells['2027-02-02'] = { p1: { code: 'x' } }; // day 2, not day 1
    data.cells['2026-12-31'] = { p2: { code: 'x' } }; // the day before the month
    expect(nextDays(data, '2027-01')).toEqual(Array(8).fill(Code.EMPTY));
    expect(nextDays(newAppData(), '2027-01')).toEqual(Array(8).fill(Code.EMPTY));
  });
  it('is the day after the last day of the month, whatever its length', () => {
    const data = newAppData();
    data.cells['2027-03-01'] = { p1: { code: 'x' } };
    data.cells['2028-02-29'] = { p1: { code: 'NEM' } }; // the last day of a leap February
    data.cells['2028-03-01'] = { p1: { code: 'OP' } };
    expect(nextDays(data, '2027-02')[0]).toBe(Code.X); // February 2027 has 28 days
    expect(nextDays(data, '2028-02')[0]).toBe(Code.OP); // February 2028 has 29, the 29th is no next day
    expect(buildMonthGrid(data, '2028-02').rows[0][7 + 28]).toBe(Code.NEM);
  });
  it('is in the next year for a December', () => {
    const data = newAppData();
    data.cells['2028-01-01'] = { p1: { code: 'x' } };
    data.cells['2027-01-01'] = { p2: { code: 'x' } }; // the January of the same year is not it
    expect(nextDays(data, '2027-12').slice(0, 2)).toEqual([Code.X, Code.EMPTY]);
  });
  it('is EMPTY for a person who is not in the team on that day', () => {
    const data = newAppData();
    for (const person of data.people.slice(0, 3)) {
      data.cells['2027-02-01'] = { ...data.cells['2027-02-01'], [person.id]: { code: 'x' } };
    }
    data.people[0].activeTo = '2027-01-31'; // leaves with the month
    data.people[1].activeTo = '2027-02-01'; // leaves on that day, which still counts
    expect(nextDays(data, '2027-01').slice(0, 3)).toEqual([Code.EMPTY, Code.X, Code.X]);
  });
  it('is the code of a person who joins the team on that day or is there from before', () => {
    const data = newAppData();
    data.cells['2027-02-01'] = { p1: { code: 'DOV' }, p2: { code: 'DOV' } };
    data.people[0].activeFrom = '2027-01-31'; // joins on the last day: in the month, in the team
    data.people[1].activeFrom = '2027-02-01'; // joins the day after: not in January at all
    const g = buildMonthGrid(data, '2027-01');
    expect(g.personIds).not.toContain('p2');
    expect(g.ctx.people[0].nextDay).toBe(Code.DOV);
  });
  it('is no cell of the rows, and the data is only read', () => {
    const data = newAppData();
    data.cells['2027-02-01'] = { p1: { code: 'x' } };
    const before = structuredClone(data);
    const g = buildMonthGrid(data, '2027-01');
    expect(g.rows.every((row) => row.length === 7 + 31)).toBe(true);
    expect(g.fixed.every((row) => row.length === 7 + 31)).toBe(true);
    expect(data).toEqual(before);
    // writing the rows back leaves what is stored for the next month alone
    expect(applyRows(data, '2027-01', g.rows, g.fixed).cells['2027-02-01']).toEqual({
      p1: { code: 'x' },
    });
  });
  it('does not make a person a member of the month, nor change the FPD', () => {
    const data = newAppData();
    const without = buildMonthGrid(data, '2027-01').ctx.people.map((p) => p.fpd);
    data.cells['2027-02-01'] = { p1: { code: 'DOV' } };
    expect(buildMonthGrid(data, '2027-01').ctx.people.map((p) => p.fpd)).toEqual(without);
  });
});

describe('the last shift before the tail', () => {
  // February 2027's tail is Mon 25 to Sun 31 January, and `restBefore` looks at the week before it,
  // Mon 18 to Sun 24, in minutes from midnight of Mon 25.
  const restBefores = (data: AppData, month = '2027-02') =>
    buildMonthGrid(data, month).ctx.people.map((p) => p.restBefore);

  it('is when the latest shift of the 7 days before the tail ends', () => {
    const data = newAppData();
    data.cells['2027-01-24'] = { p1: { code: 'R1' }, p2: { code: 'N' }, p3: { code: 'N12' } };
    data.cells['2027-01-18'] = { p4: { code: 'O' } };
    data.cells['2027-01-20'] = { p5: { code: 'N' } };
    data.cells['2027-01-22'] = { p5: { code: 'R1' } };
    expect(restBefores(data)).toEqual([
      -1440 + 840, // R1 on Sun 24 ends at 14:00, the day before the tail
      360, // a night on Sun 24 ends at 06:00 on Mon 25, the first day of the tail
      360,
      -7 * 1440 + 1320, // O on Mon 18, a week before the tail, ends at 22:00
      -3 * 1440 + 840, // p5's R1 on Fri 22 ends after the night of Wed 20
      null,
      null,
      null,
    ]);
  });
  it('is null without a shift in those 7 days: one before them or in the tail does not count', () => {
    const data = newAppData();
    data.cells['2027-01-17'] = { p1: { code: 'N' } }; // 8 days before the tail
    data.cells['2027-01-25'] = { p2: { code: 'R1' } }; // the first day of the tail
    data.cells['2027-01-21'] = { p3: { code: 'x' }, p4: { code: 'DOV' } }; // no shift
    expect(restBefores(data)).toEqual(Array(8).fill(null));
    expect(restBefores(newAppData())).toEqual(Array(8).fill(null));
  });
  it('takes the end of the shift from the settings', () => {
    const data = newAppData();
    data.settings.shifts = { ...data.settings.shifts, N: { start: 1320, end: 1860, hours: 8.5 } };
    data.cells['2027-01-24'] = { p1: { code: 'N' } }; // now until 07:00
    expect(restBefores(data)[0]).toBe(420);
  });
  it('looks back across the turn of a year, and puts nothing in the rows', () => {
    const data = newAppData();
    data.cells['2026-12-24'] = { p1: { code: 'N12' } }; // the day before January's tail
    const g = buildMonthGrid(data, '2027-01');
    expect(g.ctx.people[0].restBefore).toBe(360);
    expect(g.rows[0].every((code) => code === Code.EMPTY)).toBe(true);
  });
});

describe('the limits, claimed holidays, notes and history of each person', () => {
  const peopleOf = (data: AppData, month = '2027-01') => buildMonthGrid(data, month).ctx.people;
  /** The indexes at which a mask holds 1. */
  const marked = (mask: Uint8Array) => Array.from(mask).flatMap((v, i) => (v === 1 ? [i] : []));
  /** The [index, minutes] pairs of the days that have a note: the others hold -1. */
  const notes = (minutes: Int16Array) =>
    Array.from(minutes).flatMap((v, i) => (v === -1 ? [] : [[i, v]]));

  it('resolves maxTwelve from the person, else the settings', () => {
    const data = newAppData();
    data.people[0].maxTwelve = 5;
    data.people[1].maxTwelve = 0; // a limit of its own: no 12-hour shifts at all
    expect(peopleOf(data).map((p) => p.maxTwelve)).toEqual([5, 0, 3, 3, 3, 3, 3, 3]);
    data.settings.maxTwelvePerMonth = 4;
    expect(peopleOf(data).map((p) => p.maxTwelve)).toEqual([5, 0, 4, 4, 4, 4, 4, 4]);
  });

  it('carries maxNights: the limit of the person, null for no limit', () => {
    const data = newAppData();
    data.people[0].maxNights = 2;
    data.people[1].maxNights = 0; // a limit of its own: no nights at all
    expect(peopleOf(data).slice(0, 3).map((p) => p.maxNights)).toEqual([2, 0, null]);
  });

  it('marks claimed holiday shifts', () => {
    const data = newAppData();
    data.cells['2027-01-01'] = {
      p1: { code: 'R12', pinned: true }, // a pinned R12 on a holiday: claimed
      p2: { code: 'R12' }, // not pinned
    };
    data.cells['2027-01-02'] = { p3: { code: 'R12', pinned: true } }; // a plain Saturday
    const [p1, p2, p3, p4] = peopleOf(data);
    expect(p1.claimed).toBeInstanceOf(Uint8Array);
    expect(p1.claimed).toHaveLength(7 + 31);
    expect(marked(p1.claimed)).toEqual([7]); // 1 January is the first day of the month
    expect(marked(p2.claimed)).toEqual([]);
    expect(marked(p3.claimed)).toEqual([]);
    expect(marked(p4.claimed)).toEqual([]);
  });

  it('marks a claimed holiday shift on the tail, and on a holiday that is a weekend day', () => {
    const data = newAppData();
    data.cells['2026-12-25'] = { p1: { code: 'N12', pinned: true } }; // in the tail of January
    expect(marked(peopleOf(data)[0].claimed)).toEqual([0]);
    data.cells['2027-05-08'] = { p1: { code: 'R12', pinned: true } }; // a holiday, and a Saturday
    expect(marked(peopleOf(data, '2027-05')[0].claimed)).toEqual([7 + 7]);
  });

  it("carries doctor's notes", () => {
    const data = newAppData();
    data.doctor['2027-01-05'] = { p1: { from: 480, to: 720 } }; // L 8-12
    data.cells['2027-01-05'] = { p1: { code: 'O' } }; // a note sits beside a shift
    const g = buildMonthGrid(data, '2027-01');
    const [p1, p2] = g.ctx.people;
    expect(p1.doctorFrom).toBeInstanceOf(Int16Array);
    expect(p1.doctorTo).toBeInstanceOf(Int16Array);
    expect(p1.doctorFrom).toHaveLength(7 + 31);
    expect(p1.doctorTo).toHaveLength(7 + 31);
    expect([p1.doctorFrom[7 + 4], p1.doctorTo[7 + 4]]).toEqual([480, 720]);
    expect(notes(p1.doctorFrom)).toEqual([[11, 480]]); // every other day holds -1
    expect(notes(p1.doctorTo)).toEqual([[11, 720]]);
    expect(notes(p2.doctorFrom)).toEqual([]);
    expect(notes(p2.doctorTo)).toEqual([]);
    expect(g.rows[0][7 + 4]).toBe(Code.O); // the shift is as it was
  });

  it("keeps each person's own notes, the tail's too, and a note from midnight is a note", () => {
    const data = newAppData();
    data.doctor['2026-12-30'] = { p1: { from: 0, to: 60 } }; // in the tail, 00:00-01:00
    data.doctor['2027-01-06'] = { p1: { from: 840, to: 1440 }, p2: { from: 600, to: 660 } };
    data.doctor['2027-02-02'] = { p1: { from: 480, to: 720 } }; // after the month
    const [p1, p2] = peopleOf(data);
    expect(notes(p1.doctorFrom)).toEqual([[5, 0], [12, 840]]);
    expect(notes(p1.doctorTo)).toEqual([[5, 60], [12, 1440]]);
    expect(notes(p2.doctorFrom)).toEqual([[12, 600]]);
    expect(notes(p2.doctorTo)).toEqual([[12, 660]]);
  });

  it('history adds starting counts and earlier months', () => {
    const data = newAppData();
    data.months['2027-01'] = { status: 'draft' };
    data.people[0].startingCounts = { twelve: 2, nights: 1, holidayTwelve: 1, festive: 3 };
    data.cells['2027-01-01'] = { p1: { code: 'R12', pinned: true } }; // claimed: no twelve
    data.cells['2027-01-02'] = { p1: { code: 'R12' } };
    data.cells['2027-01-05'] = { p1: { code: 'N' }, p2: { code: 'N' } };
    data.cells['2027-02-02'] = { p1: { code: 'N' } }; // the month that is built: no history
    const before = structuredClone(data);
    const [p1, p2, p3] = peopleOf(data, '2027-02');
    expect(p1.history).toEqual({ twelve: 3, nights: 2, holidayTwelve: 2, festive: 4 });
    expect(p2.history).toEqual({ twelve: 0, nights: 1, holidayTwelve: 0, festive: 0 });
    expect(p3.history).toEqual({ twelve: 0, nights: 0, holidayTwelve: 0, festive: 0 });
    expect(data).toEqual(before); // the starting counts are not added to in place
  });

  it('history is the starting counts alone when no earlier month was planned', () => {
    const data = newAppData();
    const starting = { twelve: 2, nights: 1, holidayTwelve: 1, festive: 3 };
    data.people[0].startingCounts = { ...starting };
    data.cells['2027-01-02'] = { p1: { code: 'R12' } }; // the month itself
    expect(peopleOf(data)[0].history).toEqual(starting);
  });

  it('history leaves out a December tail that has no record, and takes it in with one', () => {
    const data = newAppData();
    const starting = { twelve: 2, nights: 1, holidayTwelve: 1, festive: 3 };
    data.people[0].startingCounts = { ...starting };
    data.cells['2026-12-25'] = { p1: { code: 'R12' } }; // the tail, entered as context for January
    data.cells['2026-12-31'] = { p1: { code: 'N' } };
    data.cells['2027-01-02'] = { p1: { code: 'R12' } }; // the month itself
    expect(peopleOf(data)[0].history).toEqual(starting);
    data.months['2026-12'] = { status: 'draft' }; // planned after all: Christmas and New Year count
    expect(peopleOf(data)[0].history).toEqual({
      twelve: 3,
      nights: 2,
      holidayTwelve: 2,
      festive: 5,
    });
  });

  it('history follows the fairness window of the settings', () => {
    const data = newAppData();
    data.months['2027-01'] = { status: 'draft' };
    data.months['2027-02'] = { status: 'closed' };
    data.cells['2027-01-02'] = { p1: { code: 'R12' } };
    data.cells['2027-02-06'] = { p1: { code: 'R12' } };
    data.settings.fairnessWindowMonths = 1;
    expect(peopleOf(data, '2027-03')[0].history.twelve).toBe(1); // February only
    data.settings.fairnessWindowMonths = 2;
    expect(peopleOf(data, '2027-03')[0].history.twelve).toBe(2);
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
