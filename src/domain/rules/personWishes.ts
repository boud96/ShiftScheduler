import { CODE_NAMES, Code, isNight, isShift } from '../codes';
import type { MonthContext } from '../context';
import { days as fmtDays, fmtH } from '../format';
import type { WishId } from '../types';
import type { Finding, PersonStats, Sink } from './types';

/**
 * Overtime this small (in hours) is rounding noise in the sum of the hours, not overtime. M6 has
 * the same tolerance for a shortfall.
 */
const OVERTIME_TOLERANCE = 1e-9;
/** W2: a block of one weekday shift should last this many days at least. */
const MIN_BLOCK = 4;
/** W3: a stretch of work longer than this many days is too long. */
const MAX_STRETCH = 6;
/** W3: after a stretch of this many days or more, one day off is too few. */
const TIRING_STRETCH = 5;
/** W3: one day off between stretches that make this many days of work or more is too few. */
const LONG_WORK = 12;
/** W4a: a run of nights should last this many days at least. */
const MIN_NIGHT_RUN = 3;
/** W4a: with more nights than this in a month, they should come in runs of about this many. */
const NIGHT_RUN = 5;

/**
 * Hands a finding of a wish to the sink. Call it only when there is a sink. A `quiet` finding is
 * marked as such; any other has no `quiet` field at all.
 */
function report(
  sink: Sink,
  rule: WishId,
  person: number,
  days: number[],
  message: string,
  penalty: number,
  quiet = false,
): void {
  const finding: Finding = { rule, severity: 'wish', person, days, message, penalty };
  if (quiet) finding.quiet = true;
  sink(finding);
}

// The three helpers below build the `days` of a finding: call them only when there is a sink.

/** The indices from `from` to `to`, both included. */
function span(from: number, to: number): number[] {
  const found: number[] = [];
  for (let i = from; i <= to; i++) found.push(i);
  return found;
}

/** The indices from `from` to `to` that hold `code`. */
function cellsWith(row: Uint8Array, from: number, to: number, code: number): number[] {
  const found: number[] = [];
  for (let i = from; i <= to; i++) if (row[i] === code) found.push(i);
  return found;
}

/** The night shifts of the month. */
function monthNights(ctx: MonthContext, row: Uint8Array): number[] {
  const found: number[] = [];
  for (let i = ctx.first; i < ctx.days.length; i++) if (isNight(row[i])) found.push(i);
  return found;
}

/** W1: the hours above the person's FPD. */
function overtime(ctx: MonthContext, p: number, stats: PersonStats, sink?: Sink): number {
  const over = stats.hours - ctx.people[p].fpd;
  if (over <= OVERTIME_TOLERANCE) return 0;
  const penalty = over * ctx.weights.W1;
  if (sink !== undefined && penalty > 0) {
    report(sink, 'W1', p, [], `přesčas ${fmtH(over)} h`, penalty);
  }
  return penalty;
}

/**
 * W2: the penalty of a block of `length` days of `code`, from day `begin` to day `end`, if it is
 * too short. A block that ended before the month is last month's. An `open` block, the last of a
 * stretch that reaches the last day of the month, may go on in the next month.
 */
function shortBlock(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  code: number,
  length: number,
  begin: number,
  end: number,
  open: boolean,
  sink?: Sink,
): number {
  if (length >= MIN_BLOCK || end < ctx.first || open) return 0;
  const penalty = (MIN_BLOCK - length) * ctx.weights.W2;
  if (sink !== undefined && penalty > 0) {
    const message = `krátký blok ${CODE_NAMES[code]} (jen ${fmtDays(length)})`;
    report(sink, 'W2', p, cellsWith(row, begin, end, code), message, penalty);
  }
  return penalty;
}

/**
 * W2 for the stretch of work from day `s` to day `e`: its R1, R2, O20 and O, in order, form blocks
 * of one shift each. N, R12 and N12 are no part of a block: they neither change it nor break it.
 * If the stretch reaches the last day of the month, its last block may go on in the next month,
 * whatever the stretch ends with.
 */
function stretchBlocks(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  s: number,
  e: number,
  sink?: Sink,
): number {
  const open = e === ctx.days.length - 1; // the last block may go on in the next month
  let score = 0;
  let code = 0; // the shift of the block so far, 0 before the first block
  let length = 0;
  let begin = 0;
  let end = 0; // the last day of the block so far

  for (let j = s; j <= e; j++) {
    const c = row[j];
    if (c > Code.O) continue; // a stretch holds only shifts; this one is N, R12 or N12
    if (c === code) {
      length++;
      end = j;
      continue;
    }
    if (code !== 0) {
      // the shift changes from `code` on day `end` to `c` on day `j`; a change is judged by the
      // later day, so one inside the previous month is last month's
      if (j >= ctx.first) {
        const penalty = ctx.weights.W2;
        score += penalty;
        if (sink !== undefined && penalty > 0) {
          const message = `změna směny uprostřed bloku (${CODE_NAMES[code]} → ${CODE_NAMES[c]})`;
          report(sink, 'W2', p, [end, j], message, penalty);
        }
      }
      score += shortBlock(ctx, p, row, code, length, begin, end, false, sink);
    }
    code = c;
    length = 1;
    begin = j;
    end = j;
  }
  if (code !== 0) score += shortBlock(ctx, p, row, code, length, begin, end, open, sink);
  return score;
}

/**
 * W2 and W3 for every stretch of work (days with a shift, between days off) that reaches into the
 * month. A stretch that ended before the month was judged with the month it belongs to.
 */
function rhythm(ctx: MonthContext, p: number, row: Uint8Array, sink?: Sink): number {
  const { first } = ctx;
  const W3 = ctx.weights.W3;
  const last = ctx.days.length - 1;
  let score = 0;
  let prevStart = 0; // the stretch before the one in hand
  let prevEnd = -3; // none yet: a stretch starts at day 0 or later, so `s - 2` never equals this

  let s = 0;
  while (s <= last) {
    if (!isShift(row[s])) {
      s++;
      continue;
    }
    let e = s;
    while (e < last && isShift(row[e + 1])) e++;

    if (e >= first) {
      const length = e - s + 1;

      // W3: more than 6 days in a row
      if (length > MAX_STRETCH) {
        const penalty = (length - MAX_STRETCH) * W3;
        score += penalty;
        if (sink !== undefined && penalty > 0) {
          report(sink, 'W3', p, span(s, e), `${fmtDays(length)} v kuse`, penalty);
        }
      }

      // W3: the stretch before this one ends 2 days before it starts, so one day off lies between
      if (prevEnd === s - 2) {
        const before = prevEnd - prevStart + 1;

        // after 5 days or more, one day off is too few; it counts when the work after it is in the
        // month
        if (before >= TIRING_STRETCH && s >= first) {
          const penalty = W3;
          score += penalty;
          if (sink !== undefined && penalty > 0) {
            const message = `po ${fmtDays(before)} práce jen 1 den volna`;
            report(sink, 'W3', p, span(prevStart, s), message, penalty);
          }
        }

        // 12 days or more of work with one day off in the middle
        if (before + length >= LONG_WORK) {
          const penalty = 3 * W3;
          score += penalty;
          if (sink !== undefined && penalty > 0) {
            const message = `${before + length} pracovních dní jen s jedním dnem volna`;
            report(sink, 'W3', p, span(prevStart, e), message, penalty);
          }
        }
      }

      score += stretchBlocks(ctx, p, row, s, e, sink);
    }

    prevStart = s;
    prevEnd = e;
    s = e + 1;
  }
  return score;
}

/** W4b: the shifts that suit the day before the day off before nights. */
function suitsBeforeNights(code: number): boolean {
  return code === Code.R2 || code === Code.O20 || code === Code.O;
}

/** Whether `code` may follow the one day off after nights: O20, O, or a shift the person chose. */
function mayFollowNights(code: number, afterNights: readonly string[]): boolean {
  if (code === Code.O20 || code === Code.O) return true;
  const name = CODE_NAMES[code];
  for (let k = 0; k < afterNights.length; k++) {
    if (afterNights[k] === name) return true;
  }
  return false;
}

/**
 * W4a, W4b and W4c for every run of nights (N and N12, one after the other). A run that began in
 * the previous month counts its days there. W4a judges a run that reaches into the month, W4b one
 * that starts in the month, W4c one by the shift after it, if that is a day of the month. W4b reads
 * two days back from the start of a run, which the tail of the previous month always has.
 */
function nightRuns(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  stats: PersonStats,
  sink?: Sink,
): number {
  const { first } = ctx;
  const { W4a, W4b, W4c } = ctx.weights;
  const afterNights = ctx.people[p].prefs.afterNights;
  const last = ctx.days.length - 1;
  let score = 0;
  let runs = 0; // the runs that reach into the month

  let s = 0;
  while (s <= last) {
    if (!isNight(row[s])) {
      s++;
      continue;
    }
    let e = s;
    while (e < last && isNight(row[e + 1])) e++;

    // W4a: fewer than 3 nights in a row, unless the run may go on in the next month
    if (e >= first) {
      runs++;
      const length = e - s + 1;
      if (length < MIN_NIGHT_RUN && e < last) {
        const penalty = (MIN_NIGHT_RUN - length) * W4a;
        score += penalty;
        if (sink !== undefined && penalty > 0) {
          const message = `krátký blok nočních (${fmtDays(length)})`;
          report(sink, 'W4a', p, span(s, e), message, penalty);
        }
      }
    }

    // W4b: the day before the nights should be off, and the shift before that R2, O20 or O
    if (s >= first) {
      const before = row[s - 2];
      if (isShift(row[s - 1])) {
        const penalty = 2 * W4b;
        score += penalty;
        if (sink !== undefined && penalty > 0) {
          report(sink, 'W4b', p, [s - 1, s], 'před nočními chybí den volna', penalty);
        }
      } else if (isShift(before) && !suitsBeforeNights(before)) {
        const penalty = W4b;
        score += penalty;
        if (sink !== undefined && penalty > 0) {
          const message = `před nočními ${CODE_NAMES[before]} (lépe R2, O20 nebo O)`;
          report(sink, 'W4b', p, [s - 2, s - 1, s], message, penalty);
        }
      }
    }

    // W4c: after the nights 2 days off are best; with only 1 day off the next shift should be mild.
    // A shift right after the nights is M2's business, and with no shift in the row there is
    // nothing to judge.
    const next = e + 2;
    if (next >= first && next <= last && !isShift(row[e + 1]) && isShift(row[next])) {
      const mild = mayFollowNights(row[next], afterNights);
      const penalty = (mild ? 1 : 2) * W4c;
      score += penalty;
      if (sink !== undefined && penalty > 0) {
        const message = mild
          ? 'po nočních jen 1 den volna'
          : `po nočních jen 1 den volna a pak ${CODE_NAMES[row[next]]}`;
        report(sink, 'W4c', p, [e, e + 1, next], message, penalty);
      }
    }

    s = e + 1;
  }

  // W4a: with more than 5 nights in the month, one run of about 5 is better than several
  if (stats.nights > NIGHT_RUN) {
    const extra = runs - Math.ceil(stats.nights / NIGHT_RUN);
    if (extra > 0) {
      const penalty = extra * W4a;
      score += penalty;
      if (sink !== undefined && penalty > 0) {
        const message = `noční rozdělené do ${runs} bloků`;
        report(sink, 'W4a', p, monthNights(ctx, row), message, penalty);
      }
    }
  }
  return score;
}

/**
 * W4d: a night costs 0 for someone who takes them gladly (`extra`), 1 for `normal` and 4 for
 * `ifNeeded`. Someone who never takes them has M7 instead.
 *
 * Only a night of an `ifNeeded` person is something to tell the team lead. The 1 per night of a
 * `normal` person is still reported, so that the findings add up to the score, but as a `quiet`
 * finding: it is for the score alone and does not belong in a list of checks.
 */
function willingness(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  stats: PersonStats,
  sink?: Sink,
): number {
  const pref = ctx.people[p].prefs.nights;
  const cost = pref === 'ifNeeded' ? 4 : pref === 'normal' ? 1 : 0;
  if (cost === 0 || stats.nights === 0) return 0;
  const penalty = cost * stats.nights * ctx.weights.W4d;
  if (sink !== undefined && penalty > 0) {
    const needed = pref === 'ifNeeded';
    const message = needed
      ? `${stats.nights}× noční, i když je bere jen v nouzi`
      : `${stats.nights}× noční`;
    report(sink, 'W4d', p, monthNights(ctx, row), message, penalty, !needed);
  }
  return penalty;
}

/**
 * Wishes W1 to W4 for person `p`, whose month `row` has been counted into `stats` already (W1 and
 * W4d read `hours` and `nights`). Each unit costs the weight of its wish in `ctx.weights`. Returns
 * the person's score; the must units in `stats` are left alone.
 *
 * Rules that look at several days read the 7 days before the month, so that a stretch or a run that
 * began there counts its days there. A finding is scored and reported only if its last day is a day
 * of the month: what lies wholly in the previous month was judged with that month. "The last day of
 * the month" is the last index of `ctx.days`; a row is as long.
 *
 * Without a `sink` no array, string or closure is created: every one in this file sits inside an
 * `if (sink !== undefined ...)`. A wish whose penalty is 0 (switched off) is not reported. Every
 * other penalty is carried by a finding, so that the findings add up to the score; the few that
 * the checks list is not to show are `quiet`.
 */
export function personWishes(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  stats: PersonStats,
  sink?: Sink,
): number {
  return (
    overtime(ctx, p, stats, sink) +
    rhythm(ctx, p, row, sink) +
    nightRuns(ctx, p, row, stats, sink) +
    willingness(ctx, p, row, stats, sink)
  );
}
