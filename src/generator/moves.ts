import {
  CODE_NAMES,
  Code,
  TWELVE_CODES,
  WEEKDAY_CODES,
  isAbsence,
  isNight,
  isShift,
  isTwelveShift,
  isWeekdayShift,
} from '../domain/codes';
import type { CodeInt } from '../domain/codes';
import type { MonthContext } from '../domain/context';
import { runMusts, weeklyRest } from '../domain/rules/restMusts';
import type { PersonStats } from '../domain/rules/types';
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
 * - `exchange`: people p and q swap their cells of the `len` days from day d on, and of the `len`
 *   days from day e on. The two ranges neither overlap nor touch: at least one day lies between
 *   them.
 */
export type Move =
  | { kind: 'swapDay'; d: number; p: number; q: number }
  | { kind: 'set'; p: number; d: number; code: CodeInt }
  | { kind: 'swapRange'; p: number; q: number; d: number; len: number }
  | { kind: 'shiftMove'; p: number; from: number; to: number }
  | { kind: 'exchange'; p: number; q: number; d: number; e: number; len: number };

/** How often each kind of move is proposed, as shares of all the moves. */
const PROBABILITY = { swapDay: 0.3, set: 0.1, swapRange: 0.2, shiftMove: 0.1, exchange: 0.3 };
/** The fewest and the most days a `swapRange` covers. */
const RANGE_MIN = 2;
const RANGE_MAX = 7;
/** The share of exchanges whose two ranges are 2 days long; the others are 1 day long. */
const EXCHANGE_LONG = 0.3;
/** How many random picks a proposal makes before it gives up. */
const ATTEMPTS = 50;

// Where each kind's share of [0, 1) ends, exchange's being the last. Shares that do not add up to
// 1 are scaled so that they do.
const ALL =
  PROBABILITY.swapDay +
  PROBABILITY.set +
  PROBABILITY.swapRange +
  PROBABILITY.shiftMove +
  PROBABILITY.exchange;
const SWAP_DAY_BELOW = PROBABILITY.swapDay / ALL;
const SET_BELOW = SWAP_DAY_BELOW + PROBABILITY.set / ALL;
const SWAP_RANGE_BELOW = SET_BELOW + PROBABILITY.swapRange / ALL;
const SHIFT_MOVE_BELOW = SWAP_RANGE_BELOW + PROBABILITY.shiftMove / ALL;

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

/**
 * The code on the day after day `d` of `row`. After the last day of the month it is `next`, what
 * the person has stored for day 1 of the next month (`EnginePerson.nextDay`), which is no cell of
 * the row.
 */
function dayAfter(row: Uint8Array, d: number, next: number): number {
  return d + 1 < row.length ? row[d + 1] : next;
}

/**
 * Whether `code` on day `d` of `row` leaves too little rest after day d - 1 or before d + 1. The
 * person's `next` follows the last day.
 */
function tooLittleRestAround(
  table: Uint8Array,
  row: Uint8Array,
  d: number,
  code: number,
  next: number,
): boolean {
  return (
    tooLittleRest(table, row[d - 1], code) || tooLittleRest(table, code, dayAfter(row, d, next))
  );
}

/**
 * Whether p and q swapping their cells of the `len` days from day `d` on leaves too little rest.
 * Within the range each person gets the other's days whole, pairs of days included: the pairs the
 * swap makes are the two at its ends. After the last day of the month, the pair is with what the
 * person has stored for the next one.
 */
function rangeBreaksRest(
  table: Uint8Array,
  st: SearchState,
  p: number,
  q: number,
  d: number,
  len: number,
): boolean {
  const { rows } = st;
  const { people } = st.ctx;
  const e = d + len - 1;
  return (
    tooLittleRest(table, rows[p][d - 1], rows[q][d]) ||
    tooLittleRest(table, rows[q][d - 1], rows[p][d]) ||
    tooLittleRest(table, rows[q][e], dayAfter(rows[p], e, people[p].nextDay)) ||
    tooLittleRest(table, rows[p][e], dayAfter(rows[q], e, people[q].nextDay))
  );
}

/** `leavesTooLittleRest` with the rest table of the month in hand. */
function breaksRest(table: Uint8Array, st: SearchState, m: Move): boolean {
  const { rows } = st;
  const { people } = st.ctx;
  switch (m.kind) {
    case 'swapDay':
      return (
        tooLittleRestAround(table, rows[m.p], m.d, rows[m.q][m.d], people[m.p].nextDay) ||
        tooLittleRestAround(table, rows[m.q], m.d, rows[m.p][m.d], people[m.q].nextDay)
      );
    case 'set':
      return tooLittleRestAround(table, rows[m.p], m.d, m.code, people[m.p].nextDay);
    case 'swapRange':
      return rangeBreaksRest(table, st, m.p, m.q, m.d, m.len);
    case 'shiftMove': {
      // the day the shift leaves is empty afterwards, and may be next to the day it goes to
      const row = rows[m.p];
      const code = row[m.from];
      const before = m.to - 1 === m.from ? Code.EMPTY : row[m.to - 1];
      const after = m.to + 1 === m.from ? Code.EMPTY : dayAfter(row, m.to, people[m.p].nextDay);
      return tooLittleRest(table, before, code) || tooLittleRest(table, code, after);
    }
    case 'exchange':
      // the two ranges do not touch, so the pairs at the ends of one are no part of the other
      return (
        rangeBreaksRest(table, st, m.p, m.q, m.d, m.len) ||
        rangeBreaksRest(table, st, m.p, m.q, m.e, m.len)
      );
  }
}

/**
 * Whether move `m` would put two shifts on days next to each other with less rest between them
 * than the settings ask for (rule M2), in a pair of days that the move makes. A pair it leaves
 * as it was, or moves whole to another person (inside a `swapRange` or an `exchange`), is not
 * looked at. Day 1 is paired with the last day of the previous month, and the last day with the
 * shift that the person has stored for day 1 of the next month, as M2 does.
 *
 * So, on a month that breaks M2 nowhere, it tells exactly the moves after which M2 finds a
 * shift with too little rest.
 */
export function leavesTooLittleRest(st: SearchState, m: Move): boolean {
  return breaksRest(restTable(st.ctx), st, m);
}

/**
 * What the pre-filter of the moves keeps for one month context: the rest table, two rows to write
 * the cells of a person as a move would leave them, and stats for the rules to count into, which
 * are thrown away.
 */
interface Guard {
  rest: Uint8Array;
  after: [Uint8Array, Uint8Array];
  stats: PersonStats;
}

const GUARDS = new WeakMap<MonthContext, Guard>();

function guardOf(ctx: MonthContext): Guard {
  let guard = GUARDS.get(ctx);
  if (guard === undefined) {
    const n = ctx.days.length;
    guard = {
      rest: restTable(ctx),
      after: [new Uint8Array(n), new Uint8Array(n)],
      stats: {
        hours: 0,
        twelve: 0,
        claimedTwelve: 0,
        nights: 0,
        holidayTwelve: 0,
        festive: 0,
        perShift: [0, 0, 0, 0, 0],
        mustUnits: 0,
      },
    };
    GUARDS.set(ctx, guard);
  }
  return guard;
}

// What a move does to the row of a person, as `rowAfter` tells it: it changes which days they work,
// which may change their runs of days in a row (M9, M10), or it gives them a shift on a day that
// held another code or none, which may shorten their rest (M11) and add a night or a 12-hour shift
// (M4, M5, M13). A move that only takes shifts away does neither of the latter.
const CHANGES_RUNS = 1;
const ADDS_SHIFT = 2;

/** What writing `code` over `old` does to a row: no flag, or some of the two above. */
function change(old: number, code: number): number {
  if (old === code) return 0;
  return (isShift(old) !== isShift(code) ? CHANGES_RUNS : 0) | (isShift(code) ? ADDS_SHIFT : 0);
}

/** Copies cells `from` to `from + len - 1` of `source` into `out`, and tells what that does. */
function copyCells(out: Uint8Array, source: Uint8Array, from: number, len: number): number {
  let flags = 0;
  for (let i = from; i < from + len; i++) {
    flags |= change(out[i], source[i]);
    out[i] = source[i];
  }
  return flags;
}

/**
 * Writes into `out` the row of person `p`, one of the people move `m` changes, as the move would
 * leave it, and tells what the move does to it (`CHANGES_RUNS`, `ADDS_SHIFT`).
 */
function rowAfter(st: SearchState, m: Move, p: number, out: Uint8Array): number {
  const { rows } = st;
  out.set(rows[p]);
  switch (m.kind) {
    case 'swapDay':
      return copyCells(out, rows[p === m.p ? m.q : m.p], m.d, 1);
    case 'set': {
      const flags = change(out[m.d], m.code);
      out[m.d] = m.code;
      return flags;
    }
    case 'swapRange':
      return copyCells(out, rows[p === m.p ? m.q : m.p], m.d, m.len);
    case 'shiftMove':
      out[m.to] = out[m.from];
      out[m.from] = Code.EMPTY;
      return CHANGES_RUNS | ADDS_SHIFT;
    case 'exchange': {
      const other = rows[p === m.p ? m.q : m.p];
      return copyCells(out, other, m.d, m.len) | copyCells(out, other, m.e, m.len);
    }
  }
}

/**
 * Whether `row`, person `p`'s row as a move would leave it, breaks one of the musts of a person
 * that cost HARD and that a move can break, besides the rest between shifts (M2), which the rest
 * table tells: a night that ends on the morning of a request or an absence (M4), more 12-hour
 * shifts than the person may have (M5), more days in a row than allowed or too few days off after
 * a long run (M9, M10), too little weekly rest (M11), more nights than the person may have (M13).
 * A move writes only free cells of the month with codes that fit the day, so it cannot break M3
 * or M8. `flags` tells what the move does to the row (see `rowAfter`), so that only the rules it
 * may break are looked at. Called only on a month that breaks no such must, it tells whether the
 * move breaks one.
 */
function breaksPersonMust(
  st: SearchState,
  guard: Guard,
  p: number,
  row: Uint8Array,
  flags: number,
): boolean {
  const { ctx } = st;
  const person = ctx.people[p];
  const { stats } = guard;
  stats.mustUnits = 0;
  if ((flags & CHANGES_RUNS) !== 0 && runMusts(ctx, p, row, stats) > 0) return true; // M9, M10
  if ((flags & ADDS_SHIFT) === 0) return false;
  const n = ctx.days.length;
  let twelve = 0;
  let nights = 0;
  for (let i = ctx.first; i < n; i++) {
    const code = row[i];
    if (!isShift(code)) continue;
    if (isTwelveShift(code) && person.claimed[i] === 0) twelve++;
    if (isNight(code)) {
      nights++;
      const next = i + 1 < n ? row[i + 1] : person.nextDay;
      if (next === Code.X || isAbsence(next)) return true; // M4
    }
  }
  if (twelve > person.maxTwelve) return true; // M5
  if (person.maxNights !== null && nights > person.maxNights) return true; // M13
  return weeklyRest(ctx, p, row, stats) > 0; // M11
}

/** Whether one more `code` on day `d` is more people on that shift than coverage allows (M1). */
function overfills(st: SearchState, d: number, code: number): boolean {
  if (!isShift(code)) return false;
  const { max } = st.ctx.settings.coverage[CODE_NAMES[code] as ShiftName];
  if (max === null) return false;
  let count = 0;
  for (const row of st.rows) if (row[d] === code) count++;
  return count >= max;
}

/** `breaksHardMust` with the guard of the month in hand. */
function breaksHard(guard: Guard, st: SearchState, m: Move): boolean {
  if (breaksRest(guard.rest, st, m)) return true;
  // a set and a shift move change who is on a shift that day; the swaps leave each day as it was
  if (m.kind === 'set' && overfills(st, m.d, m.code)) return true;
  if (m.kind === 'shiftMove' && overfills(st, m.to, st.rows[m.p][m.from])) return true;
  const [first, second] = guard.after;
  if (breaksPersonMust(st, guard, m.p, first, rowAfter(st, m, m.p, first))) return true;
  if (m.kind === 'set' || m.kind === 'shiftMove') return false;
  return breaksPersonMust(st, guard, m.q, second, rowAfter(st, m, m.q, second));
}

/**
 * Whether move `m` would break a must that costs HARD, on a month that breaks none: too little
 * rest (M2, see `leavesTooLittleRest`), a night before a request or an absence (M4), more 12-hour
 * shifts or nights than the person may have (M5, M13), more days in a row than allowed or too few
 * days off after them (M9, M10), too little weekly rest (M11), or more people on a shift than the
 * coverage allows (M1). On such a month it tells exactly the moves that make the score worse by
 * HARD / 2 or more.
 */
export function breaksHardMust(st: SearchState, m: Move): boolean {
  return breaksHard(guardOf(st.ctx), st, m);
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

/** Whether a pick is to be skipped: with a guard, one that breaks a must that costs HARD. */
function skipped(guard: Guard | null, st: SearchState, m: Move): boolean {
  return guard !== null && breaksHard(guard, st, m);
}

function swapDay(st: SearchState, rnd: () => number, guard: Guard | null): Move | null {
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
    if (skipped(guard, st, move)) continue;
    return move;
  }
  return null;
}

function setCell(st: SearchState, rnd: () => number, guard: Guard | null): Move | null {
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
    if (skipped(guard, st, move)) continue;
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

function swapRange(st: SearchState, rnd: () => number, guard: Guard | null): Move | null {
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
    if (skipped(guard, st, move)) continue;
    return move;
  }
  return null;
}

function shiftMove(st: SearchState, rnd: () => number, guard: Guard | null): Move | null {
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
    if (skipped(guard, st, move)) continue;
    return move;
  }
  return null;
}

/**
 * How many more shifts `a` holds than `b` in the `len` days from `d` on: what the person of row
 * `a` hands the person of row `b` if they swap those days.
 */
function handed(a: Uint8Array, b: Uint8Array, d: number, len: number): number {
  let count = 0;
  for (let i = d; i < d + len; i++) {
    if (isShift(a[i])) count++;
    if (isShift(b[i])) count--;
  }
  return count;
}

/** The starts of the second range of an exchange, one array per month context, to pick from. */
const STARTS = new WeakMap<MonthContext, Int32Array>();

function startsOf(ctx: MonthContext): Int32Array {
  let starts = STARTS.get(ctx);
  if (starts === undefined) {
    starts = new Int32Array(ctx.days.length);
    STARTS.set(ctx, starts);
  }
  return starts;
}

/**
 * An exchange: p hands q some shifts on one range of days, and q hands p as many back on another.
 * Each of them keeps their number of shifts, so a move like it can trade work between two people
 * without first taking one of them below their FPD or their minimum of weekend shifts. The second
 * range is picked at random among those that hand the shifts back; if the pre-filter skips it,
 * another of them, before the first range is given up.
 */
function exchange(st: SearchState, rnd: () => number, guard: Guard | null): Move | null {
  const { rows } = st;
  const { first } = st.ctx;
  const n = st.ctx.days.length;
  const days = n - first;
  const people = rows.length;
  if (people < 2) return null;
  const starts = startsOf(st.ctx);
  for (let t = 0; t < ATTEMPTS; t++) {
    const len = rnd() < EXCHANGE_LONG ? 2 : 1;
    if (days < 2 * len + 1) continue;
    const d = first + below(rnd, days - len + 1);
    const p = below(rnd, people);
    const q = other(rnd, p, people);
    if (!swappable(st, p, q, d, len)) continue;
    const give = handed(rows[p], rows[q], d, len);
    if (give === 0) continue; // a plain swap, which swapDay and swapRange make
    // the ranges apart from the first that hand as many shifts back
    let count = 0;
    for (let s = first; s + len <= n; s++) {
      if (s + len >= d && s <= d + len) continue; // it overlaps or touches the first range
      if (handed(rows[p], rows[q], s, len) === -give && swappable(st, p, q, s, len)) {
        starts[count++] = s;
      }
    }
    // each of them as likely as another, until one passes the pre-filter
    while (count > 0) {
      const k = below(rnd, count);
      const move: Move = { kind: 'exchange', p, q, d, e: starts[k], len };
      if (!skipped(guard, st, move)) return move;
      starts[k] = starts[--count];
    }
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
 * While the score is below HARD / 2, it skips any pick that would break a must that costs HARD
 * (`breaksHardMust`), and picks again. Such a score breaks no such must, so the move would add
 * HARD and could take off less than HARD / 2: it would make the score worse by more than HARD / 2,
 * and the search keeps such a move with probability exp(-HARD / 2 / T), which is 0 at every
 * temperature it uses (it starts each segment at 60). With a higher score a move might mend a
 * broken HARD must as it breaks another, so every pick is proposed.
 */
export function proposeMove(st: SearchState, rnd: () => number): Move | null {
  if (st.rows.length === 0) return null; // nobody in the team this month
  const guard = st.score < HARD / 2 ? guardOf(st.ctx) : null;
  const r = rnd();
  if (r < SWAP_DAY_BELOW) return swapDay(st, rnd, guard);
  if (r < SET_BELOW) return setCell(st, rnd, guard);
  if (r < SWAP_RANGE_BELOW) return swapRange(st, rnd, guard);
  if (r < SHIFT_MOVE_BELOW) return shiftMove(st, rnd, guard);
  return exchange(st, rnd, guard);
}
