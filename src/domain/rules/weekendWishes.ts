import { CODE_NAMES, Code, isShift } from '../codes';
import type { MonthContext } from '../context';
import { fmtH, twelveShifts as fmtTwelveShifts } from '../format';
import { twelveDays } from './personMusts';
import { report } from './personWishes';
import type { PersonStats, Sink } from './types';

/** `DayInfo.weekday` of a Saturday (0 is Monday). */
const SATURDAY = 5;

/** W5d: of the weekday shifts only R1 and R2 suit next to an R12; these three do not. */
function unsuitedNextToR12(code: number): boolean {
  return code >= Code.O20 && code <= Code.N;
}

/** W5a: the squared distance of the person's 12-hour shifts from the target of the month. */
function twelveShifts(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  stats: PersonStats,
  sink?: Sink,
): number {
  const { twelveTarget } = ctx.settings;
  const gap = stats.twelve - twelveTarget;
  const penalty = gap * gap * ctx.weights.W5a;
  if (sink !== undefined && penalty > 0) {
    const message = `${fmtTwelveShifts(stats.twelve)} (cíl ${fmtH(twelveTarget)})`;
    report(sink, 'W5a', p, twelveDays(ctx, row), message, penalty);
  }
  return penalty;
}

/**
 * W5b and W5c for every weekend of the month: a Saturday and the Sunday after it, both days of the
 * month and both 12-hour days. A holiday is a day of its own, never one half of a weekend. A
 * weekend that is cut by the turn of the month, or whose Saturday or Sunday is a weekday by the
 * settings, is none.
 */
function weekends(ctx: MonthContext, p: number, row: Uint8Array, sink?: Sink): number {
  const { days, first } = ctx;
  const { weekendStyle, afterWeekend } = ctx.people[p].prefs;
  if (weekendStyle === 'any' && afterWeekend === 'any') return 0;
  const { W5b, W5c } = ctx.weights;
  const n = days.length;
  let score = 0;

  // the first Saturday of the month, then every 7th day after it
  const firstSaturday = first + ((SATURDAY - days[first].weekday + 7) % 7);
  for (let sat = firstSaturday; sat + 1 < n; sat += 7) {
    if (days[sat].dayType !== 'twelve' || days[sat + 1].dayType !== 'twelve') continue;
    const a = row[sat];
    const b = row[sat + 1];
    const onA = isShift(a);
    const onB = isShift(b);

    // W5b: whole weekends are both days with one shift (or neither); single days, never both
    if (weekendStyle === 'whole' && (onA !== onB || (onA && a !== b))) {
      score += W5b;
      if (sink !== undefined && W5b > 0) {
        const message =
          onA !== onB ? 'rozdělený víkend' : `víkend ${CODE_NAMES[a]} + ${CODE_NAMES[b]}`;
        report(sink, 'W5b', p, [sat, sat + 1], message, W5b);
      }
    } else if (weekendStyle === 'single' && onA && onB) {
      score += W5b;
      if (sink !== undefined && W5b > 0) {
        const message = 'celý víkend, i když chce jednotlivé dny';
        report(sink, 'W5b', p, [sat, sat + 1], message, W5b);
      }
    }

    // W5c: after R12 on both days, the Monday should hold no shift for someone who wants days off
    // after a weekend. Someone who does not want days off handed out should not have an empty
    // Monday; an x or an absence there is their own day off, not one the plan hands out.
    if (afterWeekend !== 'any' && a === Code.R12 && b === Code.R12) {
      const monday = sat + 2;
      if (monday < n && days[monday].dayType === 'weekday') {
        const cell = row[monday];
        const works = isShift(cell);
        if (afterWeekend === 'want' ? works : cell === Code.EMPTY) {
          score += W5c;
          if (sink !== undefined && W5c > 0) {
            const message = works ? 'po víkendu nemá volno' : 'po víkendu volno, i když ho nechce';
            report(sink, 'W5c', p, [sat, sat + 1, monday], message, W5c);
          }
        }
      }
    }
  }
  return score;
}

/** W5d: reports the pair of days `from` and `to`: an R12 next to a day that holds `code`. */
function reportNeighbour(
  sink: Sink,
  p: number,
  from: number,
  to: number,
  code: number,
  penalty: number,
): void {
  const message = `vedle R12 je ${CODE_NAMES[code]} (lépe R1 nebo R2)`;
  report(sink, 'W5d', p, [from, to], message, penalty);
}

/**
 * W5d: a unit for each R12 and each neighbouring day that holds O20, O or N. A pair of days belongs
 * to the month of its later day, so the last day of the previous month counts as the neighbour of
 * day 1, in either order, and the next month judges the pair across its own turn.
 */
function nextToR12(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  stats: PersonStats,
  sink?: Sink,
): number {
  const { first } = ctx;
  // no R12 in the month, and none on the last day of the previous month: no pair to look at
  if (stats.twelve === 0 && row[first - 1] !== Code.R12) return 0;
  const W5d = ctx.weights.W5d;
  const n = ctx.days.length;
  let score = 0;

  for (let i = first - 1; i < n; i++) {
    if (row[i] !== Code.R12) continue;
    // the day before: the pair is the month's only if the R12 is a day of the month
    if (i >= first && unsuitedNextToR12(row[i - 1])) {
      score += W5d;
      if (sink !== undefined && W5d > 0) reportNeighbour(sink, p, i - 1, i, row[i - 1], W5d);
    }
    // the day after: the pair is the month's if that day is in it
    if (i + 1 < n && unsuitedNextToR12(row[i + 1])) {
      score += W5d;
      if (sink !== undefined && W5d > 0) reportNeighbour(sink, p, i, i + 1, row[i + 1], W5d);
    }
  }
  return score;
}

/**
 * Wishes W5a to W5d for person `p`, whose month `row` has been counted into `stats` already (W5a
 * reads `twelve`, W5d uses it to skip a month with no R12). Each unit costs the weight of its wish
 * in `ctx.weights`. Returns the person's score.
 *
 * Weekends count only if both days are in the month, so the previous month's tail never takes
 * part in W5a, W5b or W5c. W5d reads the last day of the tail, for the pair it makes with day 1.
 *
 * Without a `sink` no array, string or closure is created: every one in this file sits inside an
 * `if (sink !== undefined ...)`. A wish whose penalty is 0 (switched off) is not reported. Every
 * other penalty is carried by a finding, and none of these findings is quiet.
 */
export function weekendWishes(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  stats: PersonStats,
  sink?: Sink,
): number {
  return (
    twelveShifts(ctx, p, row, stats, sink) +
    weekends(ctx, p, row, sink) +
    nextToR12(ctx, p, row, stats, sink)
  );
}
