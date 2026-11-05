import { Code, TWELVE_CODES, WEEKDAY_CODES, isTwelveShift, isWeekdayShift } from '../domain/codes';
import type { CodeInt } from '../domain/codes';
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

function swapDay(st: SearchState, rnd: () => number): Move | null {
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
    return { kind: 'swapDay', d, p, q };
  }
  return null;
}

function setCell(st: SearchState, rnd: () => number): Move | null {
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
    return { kind: 'set', p, d, code: choices[k] };
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

function swapRange(st: SearchState, rnd: () => number): Move | null {
  const { first } = st.ctx;
  const days = st.ctx.days.length - first;
  const people = st.rows.length;
  if (people < 2 || days < RANGE_MIN) return null;
  for (let t = 0; t < ATTEMPTS; t++) {
    const len = Math.min(days, RANGE_MIN + below(rnd, RANGE_MAX - RANGE_MIN + 1));
    const d = first + below(rnd, days - len + 1);
    const p = below(rnd, people);
    const q = other(rnd, p, people);
    if (swappable(st, p, q, d, len)) return { kind: 'swapRange', p, q, d, len };
  }
  return null;
}

function shiftMove(st: SearchState, rnd: () => number): Move | null {
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
    return { kind: 'shiftMove', p, from, to };
  }
  return null;
}

/**
 * A random move for the month in `st`, or null if none was found. It picks the kind by
 * `PROBABILITY`, then the people and the days at random. Every move it gives changes at least one
 * cell, writes only cells that are free (not fixed) and in the month, and writes only codes that
 * fit the day: EMPTY, R1, R2, O20, O or N on a weekday, EMPTY, R12 or N12 on a 12-hour day. So it
 * never moves a code that does not fit its day; only `set` can replace one.
 */
export function proposeMove(st: SearchState, rnd: () => number): Move | null {
  if (st.rows.length === 0) return null; // nobody in the team this month
  const r = rnd();
  if (r < SWAP_DAY_BELOW) return swapDay(st, rnd);
  if (r < SET_BELOW) return setCell(st, rnd);
  if (r < SWAP_RANGE_BELOW) return swapRange(st, rnd);
  return shiftMove(st, rnd);
}
