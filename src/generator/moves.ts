import {
  CODE_NAMES,
  Code,
  TWELVE_CODES,
  WEEKDAY_CODES,
  isShift,
  isTwelveShift,
  isWeekdayShift,
} from '../domain/codes';
import type { CodeInt } from '../domain/codes';
import type { MonthContext } from '../domain/context';
import { HARD } from '../domain/rules/weights';
import type { ShiftName } from '../domain/types';
import type { SearchState } from './state';

/**
 * A change to the cells of the month. People are indices in `ctx.people`, days indices in
 * `ctx.days` of days of the month (at least `ctx.first`).
 *
 * - `swapDay`: people p and q swap their cells of day d.
 * - `set`: person p gets `code` on day d.
 * - `swapRange`: people p and q swap their cells of the `len` days from day d on.
 * - `shiftMove`: person p's shift on day `from` moves to day `to`, which was empty.
 */
export type Move =
  | { kind: 'swapDay'; d: number; p: number; q: number }
  | { kind: 'set'; p: number; d: number; code: CodeInt }
  | { kind: 'swapRange'; p: number; q: number; d: number; len: number }
  | { kind: 'shiftMove'; p: number; from: number; to: number };

/** How often each kind of move is proposed, as shares of all the moves. */
const PROBABILITY = { swapDay: 0.4, set: 0.2, swapRange: 0.2, shiftMove: 0.2 };
/** The fewest and the most days a `swapRange` covers. */
const RANGE_MIN = 2;
const RANGE_MAX = 7;
/** How many random picks a proposal makes before it gives up. */
const ATTEMPTS = 50;

// Where each kind's share of [0, 1) ends, shiftMove's being the last. Shares that do not add up
// to 1 are scaled so that they do.
const ALL = PROBABILITY.swapDay + PROBABILITY.set + PROBABILITY.swapRange + PROBABILITY.shiftMove;
const SWAP_DAY_BELOW = PROBABILITY.swapDay / ALL;
const SET_BELOW = SWAP_DAY_BELOW + PROBABILITY.set / ALL;
const SWAP_RANGE_BELOW = SET_BELOW + PROBABILITY.swapRange / ALL;

/** The codes a move may write on a weekday, and on a 12-hour day. */
const WEEKDAY_CHOICES: readonly CodeInt[] = [Code.EMPTY, ...WEEKDAY_CODES];
const TWELVE_CHOICES: readonly CodeInt[] = [Code.EMPTY, ...TWELVE_CODES];

/** How many codes there are: a pair of codes is the entry `before * CODES + after` of a table. */
const CODES = CODE_NAMES.length;
const MINUTES_PER_DAY = 1440;

/**
 * The rest rule (M2) of each month context, as a table over pairs of codes: 1 where a shift
 * `after` on the day after a shift `before` leaves less rest between them than the settings ask
 * for, 0 for every other pair. It is worked out from the shift times and `minRestHours` in the
 * same way as M2 does it, once per month context.
 */
const REST_TABLES = new WeakMap<MonthContext, Uint8Array>();

function restTable(ctx: MonthContext): Uint8Array {
  let table = REST_TABLES.get(ctx);
  if (table === undefined) {
    const { shifts, minRestHours } = ctx.settings;
    table = new Uint8Array(CODES * CODES);
    for (let before = 0; before < CODES; before++) {
      for (let after = 0; after < CODES; after++) {
        if (!isShift(before) || !isShift(after)) continue;
        const rest =
          MINUTES_PER_DAY +
          shifts[CODE_NAMES[after] as ShiftName].start -
          shifts[CODE_NAMES[before] as ShiftName].end;
        if (rest < minRestHours * 60) table[before * CODES + after] = 1;
      }
    }
    REST_TABLES.set(ctx, table);
  }
  return table;
}

/** Whether code `after` on the day after code `before` leaves too little rest. */
function tooLittleRest(table: Uint8Array, before: number, after: number): boolean {
  return table[before * CODES + after] === 1;
}

/** Whether `code` on day `d` of `row` leaves too little rest after day d - 1 or before d + 1. */
function tooLittleRestAround(table: Uint8Array, row: Uint8Array, d: number, code: number): boolean {
  return (
    tooLittleRest(table, row[d - 1], code) ||
    (d + 1 < row.length && tooLittleRest(table, code, row[d + 1]))
  );
}

/** `leavesTooLittleRest` with the rest table of the month in hand. */
function breaksRest(table: Uint8Array, st: SearchState, m: Move): boolean {
  const { rows } = st;
  switch (m.kind) {
    case 'swapDay':
      return (
        tooLittleRestAround(table, rows[m.p], m.d, rows[m.q][m.d]) ||
        tooLittleRestAround(table, rows[m.q], m.d, rows[m.p][m.d])
      );
    case 'set':
      return tooLittleRestAround(table, rows[m.p], m.d, m.code);
    case 'swapRange': {
      // Within the range each person gets the other's days whole, pairs of days included: the
      // pairs the swap makes are the two at its ends.
      const { p, q, d } = m;
      const e = d + m.len - 1;
      const n = rows[p].length;
      return (
        tooLittleRest(table, rows[p][d - 1], rows[q][d]) ||
        tooLittleRest(table, rows[q][d - 1], rows[p][d]) ||
        (e + 1 < n &&
          (tooLittleRest(table, rows[q][e], rows[p][e + 1]) ||
            tooLittleRest(table, rows[p][e], rows[q][e + 1])))
      );
    }
    case 'shiftMove': {
      // the day the shift leaves is empty afterwards, and may be next to the day it goes to
      const row = rows[m.p];
      const code = row[m.from];
      const before = m.to - 1 === m.from ? Code.EMPTY : row[m.to - 1];
      const after = m.to + 1 === m.from || m.to + 1 >= row.length ? Code.EMPTY : row[m.to + 1];
      return tooLittleRest(table, before, code) || tooLittleRest(table, code, after);
    }
  }
}

/**
 * Whether move `m` would put two shifts on days next to each other with less rest between them
 * than the settings ask for (rule M2), in a pair of days that the move makes. A pair it leaves
 * as it was, or moves whole to another person (inside a `swapRange`), is not looked at. Day 1 is
 * paired with the last day of the previous month, as M2 does.
 *
 * So, on a month that breaks M2 nowhere, it tells exactly the moves after which M2 finds a
 * shift with too little rest.
 */
export function leavesTooLittleRest(st: SearchState, m: Move): boolean {
  return breaksRest(restTable(st.ctx), st, m);
}

/** A whole number from 0 to `n - 1`. */
function below(rnd: () => number, n: number): number {
  return Math.floor(rnd() * n);
}

/** A person other than `p`, of `people`. */
function other(rnd: () => number, p: number, people: number): number {
  const q = below(rnd, people - 1);
  return q >= p ? q + 1 : q;
}

/** Whether `code` may stand on a day of the given type: EMPTY, or a shift of that type. */
function fits(code: number, weekday: boolean): boolean {
  return code === Code.EMPTY || (weekday ? isWeekdayShift(code) : isTwelveShift(code));
}

/** Whether a pick is to be skipped: with a rest table, one that leaves too little rest. */
function skipped(rest: Uint8Array | null, st: SearchState, m: Move): boolean {
  return rest !== null && breaksRest(rest, st, m);
}

function swapDay(st: SearchState, rnd: () => number, rest: Uint8Array | null): Move | null {
  const { rows, fixed, weekdayType } = st;
  const { first } = st.ctx;
  const days = st.ctx.days.length - first;
  const people = rows.length;
  if (people < 2) return null;
  for (let t = 0; t < ATTEMPTS; t++) {
    const d = first + below(rnd, days);
    const p = below(rnd, people);
    const q = other(rnd, p, people);
    if (fixed[p][d] !== 0 || fixed[q][d] !== 0) continue;
    const a = rows[p][d];
    const b = rows[q][d];
    const weekday = weekdayType[d] === 1;
    if (a === b || !fits(a, weekday) || !fits(b, weekday)) continue;
    const move: Move = { kind: 'swapDay', d, p, q };
    if (skipped(rest, st, move)) continue;
    return move;
  }
  return null;
}

function setCell(st: SearchState, rnd: () => number, rest: Uint8Array | null): Move | null {
  const { rows, fixed, weekdayType } = st;
  const { first } = st.ctx;
  const days = st.ctx.days.length - first;
  for (let t = 0; t < ATTEMPTS; t++) {
    const p = below(rnd, rows.length);
    const d = first + below(rnd, days);
    if (fixed[p][d] !== 0) continue;
    const choices = weekdayType[d] === 1 ? WEEKDAY_CHOICES : TWELVE_CHOICES;
    // any of the choices but the code the cell holds, if that is one of them
    const at = choices.indexOf(rows[p][d] as CodeInt);
    let k = below(rnd, at < 0 ? choices.length : choices.length - 1);
    if (at >= 0 && k >= at) k++;
    const move: Move = { kind: 'set', p, d, code: choices[k] };
    if (skipped(rest, st, move)) continue;
    return move;
  }
  return null;
}

/** Whether p and q may swap their cells of the `len` days from `d` on, and that changes a cell. */
function swappable(st: SearchState, p: number, q: number, d: number, len: number): boolean {
  const { rows, fixed, weekdayType } = st;
  let changes = false;
  for (let i = d; i < d + len; i++) {
    if (fixed[p][i] !== 0 || fixed[q][i] !== 0) return false;
    const a = rows[p][i];
    const b = rows[q][i];
    if (a === b) continue;
    const weekday = weekdayType[i] === 1;
    if (!fits(a, weekday) || !fits(b, weekday)) return false;
    changes = true;
  }
  return changes;
}

function swapRange(st: SearchState, rnd: () => number, rest: Uint8Array | null): Move | null {
  const { first } = st.ctx;
  const days = st.ctx.days.length - first;
  const people = st.rows.length;
  if (people < 2 || days < RANGE_MIN) return null;
  for (let t = 0; t < ATTEMPTS; t++) {
    const len = Math.min(days, RANGE_MIN + below(rnd, RANGE_MAX - RANGE_MIN + 1));
    const d = first + below(rnd, days - len + 1);
    const p = below(rnd, people);
    const q = other(rnd, p, people);
    if (!swappable(st, p, q, d, len)) continue;
    const move: Move = { kind: 'swapRange', p, q, d, len };
    if (skipped(rest, st, move)) continue;
    return move;
  }
  return null;
}

function shiftMove(st: SearchState, rnd: () => number, rest: Uint8Array | null): Move | null {
  const { rows, fixed, weekdayType } = st;
  const { first } = st.ctx;
  const days = st.ctx.days.length - first;
  for (let t = 0; t < ATTEMPTS; t++) {
    const p = below(rnd, rows.length);
    const from = first + below(rnd, days);
    const to = first + below(rnd, days);
    if (from === to || fixed[p][from] !== 0 || fixed[p][to] !== 0) continue;
    const code = rows[p][from];
    if (code === Code.EMPTY || rows[p][to] !== Code.EMPTY) continue;
    // the shift fits the day it moves to only if that day is of the same type
    if (weekdayType[to] !== weekdayType[from] || !fits(code, weekdayType[from] === 1)) continue;
    const move: Move = { kind: 'shiftMove', p, from, to };
    if (skipped(rest, st, move)) continue;
    return move;
  }
  return null;
}

/**
 * A random move for the month in `st`, or null if none was found. It picks the kind by
 * `PROBABILITY`, then the people and the days at random. Every move it gives changes at least one
 * cell, writes only cells that are free (not fixed) and in the month, and writes only codes that
 * fit the day: EMPTY, R1, R2, O20, O or N on a weekday, EMPTY, R12 or N12 on a 12-hour day. So it
 * never moves a code that does not fit its day; only `set` can replace one.
 *
 * While the score is below HARD / 2, it skips any pick that would leave too little rest
 * (`leavesTooLittleRest`), and picks again. Such a score breaks no must that costs HARD, so the
 * move would add HARD for M2 and could take off less than HARD / 2: it would make the score worse
 * by more than HARD / 2, and the search keeps such a move with probability exp(-HARD / 2 / T),
 * which is 0 at every temperature it uses (it starts each segment at 60). With a higher score a
 * move might mend a broken HARD must as it breaks M2, so every pick is proposed.
 */
export function proposeMove(st: SearchState, rnd: () => number): Move | null {
  if (st.rows.length === 0) return null; // nobody in the team this month
  const rest = st.score < HARD / 2 ? restTable(st.ctx) : null;
  const r = rnd();
  if (r < SWAP_DAY_BELOW) return swapDay(st, rnd, rest);
  if (r < SET_BELOW) return setCell(st, rnd, rest);
  if (r < SWAP_RANGE_BELOW) return swapRange(st, rnd, rest);
  return shiftMove(st, rnd, rest);
}
