import { CODE_NAMES, isShift } from '../codes';
import type { MonthContext } from '../context';
import { days as fmtDays, fmtH } from '../format';
import type { ShiftName } from '../types';
import type { MustId, PersonStats, Sink } from './types';
import { HARD } from './weights';

const MINUTES_PER_DAY = 1440;
/** M10: after a run of this many working days or more, one day off is too few. */
const LONG_RUN = 6;
/** M11: the days of a window, in which a weekly rest must lie. */
const WEEK = 7;

// Both rules read the row as the tail, the month and then the day after the month: index
// `ctx.days.length` stands for that day, whose code is `EnginePerson.nextDay`. It is no cell of
// the row, so no finding names it, and a cell of a longer row there is never read.

/** Hands a finding of a must to the sink. Call it only when there is a sink. */
function report(
  sink: Sink,
  rule: MustId,
  person: number,
  days: number[],
  message: string,
  penalty: number,
): void {
  sink({ rule, severity: 'must', person, days, message, penalty });
}

/** The indices from `from` to `to`, both included. Call it only when there is a sink. */
function span(from: number, to: number): number[] {
  const found: number[] = [];
  for (let i = from; i <= to; i++) found.push(i);
  return found;
}

/** The code of day `i` of `row`, or `next` for the day after the month, day `n`. */
function codeOn(row: Uint8Array, n: number, next: number, i: number): number {
  return i < n ? row[i] : next;
}

/**
 * The start and the end of each shift code in the settings of a month context, in minutes from
 * midnight of the day the shift starts: entry `2 * code` is the start, `2 * code + 1` the end.
 * Read from a table, they cost the rules no lookup by name. They are worked out once per context,
 * which, like the rest table of the moves, must not be edited.
 */
const SHIFT_TIMES = new WeakMap<MonthContext, Float64Array>();

function shiftTimes(ctx: MonthContext): Float64Array {
  let times = SHIFT_TIMES.get(ctx);
  if (times === undefined) {
    times = new Float64Array(2 * CODE_NAMES.length);
    for (let code = 0; code < CODE_NAMES.length; code++) {
      if (!isShift(code)) continue;
      const { start, end } = ctx.settings.shifts[CODE_NAMES[code] as ShiftName];
      times[2 * code] = start;
      times[2 * code + 1] = end;
    }
    SHIFT_TIMES.set(ctx, times);
  }
  return times;
}

/**
 * M9 and M10 for person `p`: the runs of working days. Adds the person's units to
 * `stats.mustUnits` and returns their score.
 *
 * A working day is a day on which a shift starts. A night counts on the day it starts: the morning
 * it ends is free, unless another shift starts then. Every other day (empty, x, an absence) is a
 * day off, and ends a run.
 *
 * - M9: a run longer than `settings.maxDaysInRow` costs HARD, and a unit, for each day over.
 * - M10: a run of LONG_RUN days or more, then exactly one day off, then work, costs HARD and a
 *   unit. LONG_RUN is fixed: it does not follow the maximum of M9.
 *
 * The runs are read over the tail, the month and the day after it, and are counted whole. A
 * finding counts if one of its days is a day of the month (M10's last day is the first day of work
 * after the day off): what lies in the previous month alone was judged with that month.
 *
 * Without a `sink` no array, string or closure is created.
 */
export function runMusts(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  stats: PersonStats,
  sink?: Sink,
): number {
  const { first } = ctx;
  const n = ctx.days.length;
  const last = n - 1;
  const next = ctx.people[p].nextDay;
  const max = ctx.settings.maxDaysInRow;
  let score = 0;
  let units = 0;
  let prevStart = 0; // the run before the one in hand
  let prevEnd = -3; // none yet: a run starts at day 0 or later, so `s - 2` never equals this

  let s = 0;
  while (s <= n) {
    if (!isShift(codeOn(row, n, next, s))) {
      s++;
      continue;
    }
    let e = s;
    while (e < n && isShift(codeOn(row, n, next, e + 1))) e++;
    const length = e - s + 1;

    // M9: more days in a row than the maximum, for a run with a day of the month
    if (length > max && e >= first && s <= last) {
      const over = length - max;
      score += HARD * over;
      units += over;
      if (sink !== undefined) {
        const message = `${fmtDays(length)} v kuse (max. ${max})`;
        report(sink, 'M9', p, span(s, Math.min(e, last)), message, HARD * over);
      }
    }

    // M10: the run before this one ends 2 days before it starts, so one day off lies between
    const before = prevEnd - prevStart + 1;
    if (prevEnd === s - 2 && before >= LONG_RUN && s >= first) {
      score += HARD;
      units++;
      if (sink !== undefined) {
        const message = `po ${before} dnech práce jen 1 den volna (min. 2 dny)`;
        report(sink, 'M10', p, span(prevStart, Math.min(s, last)), message, HARD);
      }
    }

    prevStart = s;
    prevEnd = e;
    s = e + 1;
  }

  stats.mustUnits += units;
  return score;
}

/**
 * The longest rest of person `p` that overlaps the window of the 7 days from day `w`, in minutes;
 * 0 if there is none. Only for the message of M11: call it only when there is a sink. The rests
 * counted are those between two shifts, the last shift before the tail (`restBefore`) included.
 * The unknown time before the first shift and after the last one is left out: it overlaps no
 * window that fails.
 */
function longestRest(ctx: MonthContext, p: number, row: Uint8Array, w: number): number {
  const times = shiftTimes(ctx);
  const n = ctx.days.length;
  const { nextDay, restBefore } = ctx.people[p];
  const from = w * MINUTES_PER_DAY;
  const to = (w + WEEK) * MINUTES_PER_DAY;
  let longest = 0;
  let free = restBefore ?? -Infinity; // when the shifts so far have ended, if that is known
  for (let i = 0; i <= n; i++) {
    const code = codeOn(row, n, nextDay, i);
    if (!isShift(code)) continue;
    const start = i * MINUTES_PER_DAY + times[2 * code];
    if (free > -Infinity && start >= free && free < to && start > from) {
      longest = Math.max(longest, start - free);
    }
    free = Math.max(free, i * MINUTES_PER_DAY + times[2 * code + 1]);
  }
  return longest;
}

/**
 * Windows `from` to `to` of M11 fail, `from <= to`. Reports them as one finding, if there is a
 * sink, and returns how many there are.
 */
function failing(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  from: number,
  to: number,
  sink?: Sink,
): number {
  const count = to - from + 1;
  if (sink !== undefined) {
    const longest = longestRest(ctx, p, row, from) / 60;
    const message =
      `jen ${fmtH(longest)} h volna v kuse za 7 dní ` +
      `(min. ${fmtH(ctx.settings.weeklyRestHours)} h)`;
    const days = span(Math.max(ctx.first, from), Math.min(ctx.days.length - 1, to + WEEK - 1));
    report(sink, 'M11', p, days, message, HARD * count);
  }
  return count;
}

/**
 * M11 for person `p`: in every 7 days in a row, a rest of at least `settings.weeklyRestHours`
 * hours. Adds the person's units to `stats.mustUnits` and returns their score.
 *
 * It counts in minutes from midnight of the first day of the row. Each shift lasts from its start
 * to its end in the settings, from the tail to the day after the month. A rest is the time between
 * the end of one shift and the start of the next. The rest before the first of these shifts starts
 * when the person's last shift of the week before the tail ended (`EnginePerson.restBefore`):
 * else a short rest that began before the tail could hide there, and this month could break the
 * rule where only the month before shows it. Only when no shift is stored in that week, and after
 * the last shift, is the time unknown, so it counts as rest: no alarm.
 *
 * Window w is the 7 days from day w, and it passes if a rest of the minimum overlaps it. Such a
 * rest counts whole, even if it begins before the window or ends after it: else an ordinary week
 * of R1 from Monday to Friday would fail from Sunday to Saturday, with its weekends split into
 * 30 h and 34 h. The windows checked are those with a day of the month that end by the end of the
 * day after the month; later ones are checked when the next month is planned.
 *
 * Each failing window costs HARD and a unit. Each stretch of failing windows in a row is one
 * finding, on the days of the month of those windows, quoting the longest rest that overlaps the
 * first of them.
 *
 * It runs once over the days: a rest of the minimum from the end of one shift at time a to the
 * start of the next at time b overlaps windows floor(a / day) - 6 to ceil(b / day) - 1, and the
 * windows between two such rests fail. Without a `sink` no array, string or closure is created.
 */
export function weeklyRest(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  stats: PersonStats,
  sink?: Sink,
): number {
  const { first } = ctx;
  const times = shiftTimes(ctx);
  const n = ctx.days.length;
  const { nextDay, restBefore } = ctx.people[p];
  const min = ctx.settings.weeklyRestHours * 60;
  const lastWindow = n + 1 - WEEK; // the last one, which ends with the day after the month
  // the first window not yet judged: at the start, the first one with a day of the month
  let open = Math.max(0, first + 1 - WEEK);
  let units = 0;
  // When the shifts so far have ended. -Infinity while none is known: the time before the first
  // shift then counts as a rest that began forever ago, long enough, and missing no window.
  let free = restBefore ?? -Infinity;

  for (let i = 0; i <= n; i++) {
    const code = codeOn(row, n, nextDay, i);
    if (!isShift(code)) continue;
    const start = i * MINUTES_PER_DAY + times[2 * code];
    if (start - free >= min) {
      // a rest of the minimum ends here: the windows from `open` up to the last one it misses
      // fail, and those it overlaps pass
      const missed = Math.min(Math.floor(free / MINUTES_PER_DAY) - WEEK, lastWindow);
      if (missed >= open) units += failing(ctx, p, row, open, missed, sink);
      open = Math.max(open, Math.ceil(start / MINUTES_PER_DAY));
    }
    free = Math.max(free, i * MINUTES_PER_DAY + times[2 * code + 1]);
  }
  // the time after the last shift: it overlaps every window from the day it begins less 6 on
  const missed = Math.min(Math.floor(free / MINUTES_PER_DAY) - WEEK, lastWindow);
  if (missed >= open) units += failing(ctx, p, row, open, missed, sink);

  stats.mustUnits += units;
  return HARD * units;
}
