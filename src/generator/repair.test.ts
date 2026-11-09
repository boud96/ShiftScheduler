import { describe, expect, it } from 'vitest';
import { addDays } from '../domain/calendar';
import { Code, TWELVE_CODES, WEEKDAY_CODES, isShift } from '../domain/codes';
import { buildMonthGrid } from '../domain/context';
import type { MonthGrid } from '../domain/context';
import { newAppData, newPerson } from '../domain/defaults';
import { evaluateMonth } from '../domain/rules/evaluate';
import { isBelowFpd } from '../domain/rules/personMusts';
import { HARD } from '../domain/rules/weights';
import type { CodeName, ISODate } from '../domain/types';
import { shortFebruary } from '../test/shortFebruary';
import { breaksHardMust } from './moves';
import { repairHours } from './repair';
import { SearchState } from './state';

/** Monday 18 January 2027, the first day of most of the test months below. */
const MONDAY: ISODate = '2027-01-18';

/** A person of a test month: their codes, from the first of the days they are in the team. */
interface Member {
  /** Codes separated by spaces, `-` for an empty cell; a shift with `!` after it is pinned. */
  strip: string;
  /** The first day of the strip; the person is in the team from it to its last day. */
  from?: ISODate;
}

/**
 * January 2027 for a team of `members`, each in the team on the days of their strip only, so that
 * their FPD is 7,5 h for each weekday of it. The coverage asks for nobody (its maxima stay), and
 * no weekend shift is asked of anyone: of the musts below HARD, a test month breaks M6 alone.
 */
function month(members: Member[]): MonthGrid {
  const data = newAppData();
  data.settings.minWeekendShifts = 0;
  for (const shift of Object.values(data.settings.coverage)) shift.min = 0;
  data.people = members.map(({ strip, from = MONDAY }, k) => {
    const person = newPerson(`p${k + 1}`, `Operátor ${k + 1}`);
    const codes = strip.split(/\s+/).filter(Boolean);
    person.activeFrom = from;
    person.activeTo = addDays(from, codes.length - 1);
    codes.forEach((token, i) => {
      if (token === '-') return;
      const pinned = token.endsWith('!');
      const code = (pinned ? token.slice(0, -1) : token) as CodeName;
      (data.cells[addDays(from, i)] ??= {})[person.id] = pinned ? { code, pinned } : { code };
    });
    return person;
  });
  return buildMonthGrid(data, '2027-01');
}

/** Tuesday 19 January 2027. */
const TUESDAY: ISODate = '2027-01-19';

/** p1 works R2 from Monday to Thursday, pinned, and Friday is free: 30 h of 37,5 h. */
const freeSlot = () => month([{ strip: 'R2! R2! R2! R2! -' }]);

/**
 * p1 works O, pinned, on Monday and from Wednesday to Friday: 30 h of 37,5 h. On Tuesday, R1 and R2
 * would leave too little rest after Monday's O, and N before Wednesday's, and p2 and p3 hold the
 * day's O and O20, which have room for one each. p2 (Tuesday to Sunday, 30 h) and p3 (Tuesday,
 * 7,5 h) are at their FPD, so the shift p1 takes from one of them must be made up.
 */
const chain = () =>
  month([
    { strip: 'O! - O! O! O!' },
    { strip: 'O O20 O20 O20 - -', from: TUESDAY },
    { strip: 'O20', from: TUESDAY },
  ]);

/**
 * p1 works N on Monday and O from Wednesday to Friday: 30 h of 37,5 h. After the night only a
 * night leaves 12 h of rest on Tuesday, and a night there leaves too little before Wednesday's O:
 * no shift fits p1's free day, and nobody else works it. p2, in the team on Monday only, works R2
 * that day. Once p1 and p2 swap their Monday shifts, p1's R2 ends at 16:00, and Tuesday has room
 * for a shift. `p1` and `p2` are their strips, for the same month with a shift pinned.
 */
const trade = (p1 = 'N - O O O', p2 = 'R2') => month([{ strip: p1 }, { strip: p2 }]);

/**
 * p1 has asked for Monday, Wednesday and Friday off, and works Tuesday and Thursday: 15 h of
 * 37,5 h, all that p1 can have. p2 and p3 work every day, so p1 can trade shifts with them, but no
 * trade frees a day for p1.
 */
const forced = () =>
  month([{ strip: 'x R2 x R2 x' }, { strip: 'R1 R1 R1 R1 R1' }, { strip: 'O O O O O' }]);

/** The months of the tests below, each with someone below FPD. */
const MONTHS: Array<[string, () => MonthGrid]> = [
  ['a free slot', freeSlot],
  ['a chain', chain],
  ['a trade', () => trade()],
  ['a forced shortfall', forced],
  ['February 2027, one shift short', shortFebruary],
];

const stateOf = (g: MonthGrid) => new SearchState(g.ctx, g.rows, g.fixed);
/** The index in `ctx.days` of a date. */
const dayOf = (g: MonthGrid, date: ISODate) => g.ctx.days.findIndex((day) => day.date === date);
/** Whether person `p` is below FPD, as M6 judges it. */
const short = (st: SearchState, p: number) => isBelowFpd(st.ctx.people[p], st.statsOf(p).hours);
/** The broken musts that cost HARD, one line each. */
const hard = (g: MonthGrid, rows: Uint8Array[]) =>
  evaluateMonth(g.ctx, rows, true)
    .findings.filter((f) => f.severity === 'must' && f.penalty >= HARD)
    .map((f) => `${f.rule} ${f.person === null ? '' : g.personIds[f.person]} ${f.message}`);
/** The cells, as [person, day], that differ between two sets of rows. */
function changed(before: Uint8Array[], after: Uint8Array[]): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  before.forEach((row, p) => row.forEach((code, i) => code !== after[p][i] && cells.push([p, i])));
  return cells;
}
/** A move in hand would make commit and revert work: neither may. */
function expectNoMoveInHand(st: SearchState): void {
  expect(() => st.commit()).toThrow('no move');
  expect(() => st.revert()).toThrow('no move');
}

describe('repairHours', () => {
  it('adds a shift where a person is short and a slot is free', () => {
    const g = freeSlot();
    const st = stateOf(g);
    const before = st.snapshot();
    expect(st.statsOf(0).hours).toBe(30);

    expect(repairHours(st)).toBe(1);
    expect(st.statsOf(0).hours).toBe(37.5);
    const friday = dayOf(g, '2027-01-22');
    expect(changed(before, st.rows)).toEqual([[0, friday]]);
    expect(isShift(st.rows[0][friday])).toBe(true);
  });

  it('moves a shift through a second person when only a chain reaches FPD', () => {
    const g = chain();
    const st = stateOf(g);
    const before = st.snapshot();
    const day = dayOf(g, TUESDAY);
    // no shift of p1's own fits, and with p1's other shifts pinned there is no trade to make
    for (const code of WEEKDAY_CODES) {
      expect(breaksHardMust(st, { kind: 'set', p: 0, d: day, code }), `${code}`).toBe(true);
    }
    let trades = 0;

    expect(
      repairHours(st, () => {
        trades++;
        return false;
      }),
    ).toBe(1);
    expect(trades).toBe(0);
    expect(st.statsOf(0).hours).toBe(37.5);
    // p1 has the Tuesday shift of the one who gave it, and that one made it up with a shift of
    // their own: everyone is at FPD, and nobody else changed
    const giver = [1, 2].find((q) => before[q][day] === st.rows[0][day]);
    expect(giver).toBeDefined();
    expect(st.rows[giver as number][day]).not.toBe(before[giver as number][day]);
    for (let p = 0; p < 3; p++) expect(short(st, p), `p${p + 1}`).toBe(false);
    expect(changed(before, st.rows).every(([p]) => p === 0 || p === giver)).toBe(true);
    expect(hard(g, st.rows)).toEqual([]);
  });

  it('trades a day first when every free day of the person is blocked', () => {
    const g = trade();
    const st = stateOf(g);
    const monday = dayOf(g, MONDAY);
    const tuesday = monday + 1;
    for (const code of WEEKDAY_CODES) {
      expect(breaksHardMust(st, { kind: 'set', p: 0, d: tuesday, code }), `${code}`).toBe(true);
    }

    expect(repairHours(st)).toBe(1);
    expect(st.statsOf(0).hours).toBe(37.5);
    expect([st.rows[0][monday], st.rows[1][monday]]).toEqual([Code.R2, Code.N]);
    expect(isShift(st.rows[0][tuesday])).toBe(true);
    expect(short(st, 1)).toBe(false);
    expect(hard(g, st.rows)).toEqual([]);
  });

  it('trades only what keeps the number of shifts of the person below FPD', () => {
    // p1 (R2 on Monday, Tuesday free) and p2 (R1 on both days) are in the team on Monday and
    // Tuesday only. The trades that keep p1's two days at one shift: the swap of their Monday
    // shifts, and p1's R2 moved to Tuesday. Swapping both days would give p1 two shifts, and
    // swapping Tuesday alone too. The stop is asked before each trade.
    const g = month([{ strip: 'R2 -' }, { strip: 'R1 R1' }]);
    const st = stateOf(g);
    let trades = 0;
    repairHours(st, () => {
      trades++;
      return false;
    });
    expect(trades).toBe(2);
  });

  it('changes nothing when the shortfall is forced', () => {
    const g = forced();
    const st = stateOf(g);
    const rows = st.snapshot();
    const score = st.score;
    let trades = 0;

    expect(
      repairHours(st, () => {
        trades++;
        return false;
      }),
    ).toBe(0);
    // the trades were made and undone again, to the last bit of the score
    expect(trades).toBeGreaterThan(0);
    expect(st.rows).toEqual(rows);
    expect(st.score === score).toBe(true);
    expectNoMoveInHand(st);
  });

  it('never changes a fixed cell', () => {
    // The month of the trade above, with p2's R2 pinned, and then with p1's night: the trade that
    // would bring p1 up to FPD would change a cell that is fixed.
    for (const [p1, p2] of [
      ['N - O O O', 'R2!'],
      ['N! - O O O', 'R2'],
    ]) {
      const g = trade(p1, p2);
      const st = stateOf(g);
      const rows = st.snapshot();
      const score = st.score;
      expect(repairHours(st), `${p1} / ${p2}`).toBe(0);
      expect(st.rows).toEqual(rows);
      expect(st.score === score).toBe(true);
    }
  });

  it('never breaks a must that costs HARD', () => {
    let made = 0;
    for (const [name, make] of MONTHS) {
      const g = make();
      const st = stateOf(g);
      expect(hard(g, st.rows), `${name}, before`).toEqual([]);
      made += repairHours(st);
      expect(hard(g, st.rows), `${name}, after`).toEqual([]);
      // and the state still scores its rows as the engine does
      const full = evaluateMonth(g.ctx, st.rows);
      expect(Math.abs(st.score - full.score) / Math.max(1, full.score), name).toBeLessThan(1e-9);
      expect(st.mustUnits, name).toBe(full.mustUnits);
    }
    // the repair had work to do on these months: one change for each but the forced shortfall
    expect(made).toBe(MONTHS.length - 1);
  });

  it('repairs the February that the search left one shift short', () => {
    // p8 is 7 h below FPD and every free day of p8's is blocked: only a trade reaches FPD
    const g = shortFebruary();
    const st = stateOf(g);
    const p8 = g.personIds.indexOf('p8');
    const musts = (rows: Uint8Array[]) =>
      evaluateMonth(g.ctx, rows, true).findings.filter((f) => f.severity === 'must');
    expect(musts(st.rows).map((f) => f.message)).toEqual(['143 h z 150 h: chybí 7 h do FPD']);
    for (let d = g.ctx.first; d < g.ctx.days.length; d++) {
      if (g.fixed[p8][d] !== 0 || st.rows[p8][d] !== Code.EMPTY) continue;
      for (const code of st.weekdayType[d] === 1 ? WEEKDAY_CODES : TWELVE_CODES) {
        expect(breaksHardMust(st, { kind: 'set', p: p8, d, code }), `${d} ${code}`).toBe(true);
      }
    }

    expect(repairHours(st)).toBe(1);
    expect(musts(st.rows)).toEqual([]);
  });

  it('is deterministic', () => {
    const a = stateOf(shortFebruary());
    const b = stateOf(shortFebruary());
    expect(repairHours(a)).toBe(1);
    expect(repairHours(b)).toBe(1);
    expect(b.rows).toEqual(a.rows);
    expect(b.score).toBe(a.score);
  });

  it('ends when told to stop, with no move in hand and only the changes made before', () => {
    // p1 has a free slot, which needs no trade, and p2 needs the trade of the month above, a week
    // earlier: the pass finds p1's shift before it asks whether to stop, at p2's first trade
    const both = month([
      { strip: 'R2! R2! R2! R2! -' },
      { strip: 'N - O O O', from: '2027-01-11' },
      { strip: 'R2', from: '2027-01-11' },
    ]);
    const now = stateOf(both);
    const rows = now.snapshot();
    const score = now.score;
    expect(repairHours(now, () => true)).toBe(0);
    expect(now.rows).toEqual(rows);
    expect(now.score === score).toBe(true);
    expectNoMoveInHand(now);

    // The month of the trade above twice, a week apart: two changes to make, each after a trade.
    const twice = month([
      { strip: 'N - O O O', from: '2027-01-11' },
      { strip: 'R2', from: '2027-01-11' },
      { strip: 'N - O O O' },
      { strip: 'R2' },
    ]);
    // without a stop: two changes, and the month after the first as the second pass has it when
    // it asks whether to stop before its first trade
    const free = stateOf(twice);
    const start = free.score;
    let afterOne: Uint8Array[] | null = null;
    expect(
      repairHours(free, () => {
        if (afterOne === null && free.score < start) afterOne = free.snapshot();
        return false;
      }),
    ).toBe(2);
    expect(afterOne).not.toBeNull();
    // told to stop once a change is made: it keeps that change, and nothing else
    const once = stateOf(twice);
    expect(repairHours(once, () => once.score < start)).toBe(1);
    expect(once.rows).toEqual(afterOne);
    expectNoMoveInHand(once);
  });
});
