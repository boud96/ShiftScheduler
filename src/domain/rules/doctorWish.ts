import { CODE_NAMES, isNight, isShift } from '../codes';
import type { MonthContext } from '../context';
import { clock } from '../format';
import type { ShiftName } from '../types';
import { report } from './personWishes';
import type { Sink } from './types';

const MINUTES_PER_DAY = 1440;
/** W10: the minutes that a shift should keep clear of a doctor's appointment, on either side. */
const MARGIN = 60;

/** Whether the times from `start` to `end` overlap those from `from` to `to`; touching is not. */
function overlaps(start: number, end: number, from: number, to: number): boolean {
  return start < to && end > from;
}

/**
 * Hands the sink the finding of one collision of shift `code` with the appointment from `from` to
 * `to`, a quiet one. Call it only when there is a sink.
 */
function reportCollision(
  sink: Sink,
  p: number,
  days: number[],
  code: number,
  from: number,
  to: number,
  penalty: number,
): void {
  const message = `${CODE_NAMES[code]} se kryje s lékařem ${clock(from)}–${clock(to)}`;
  report(sink, 'W10', p, days, message, penalty, true);
}

/**
 * W10 for person `p`: a shift should keep an hour clear of a doctor's appointment, or the day be
 * off. For each day of the month on which the person has an appointment (`EnginePerson.doctorFrom`
 * and `doctorTo`), the range to keep clear runs from an hour before the appointment starts to an
 * hour after it ends. Each shift whose time overlaps that range is a collision and costs
 * `ctx.weights.W10`; a shift that only touches the range is fine. Two shifts can collide with one
 * appointment, and then it costs twice. The shifts to look at are:
 *
 * - the shift of the same day, from its `start` to its `end`;
 * - the night of the day before, which ends on this day: its times less a day. Only the nights run
 *   past midnight.
 *
 * The day after is not looked at: its shift would have to start before 01:00 to come within an
 * hour of an appointment that ends by 24:00, and none of the shifts does.
 *
 * An appointment on a day of the tail is judged with its own month. A night from the last day of
 * the tail is read for an appointment on day 1.
 *
 * The finding of a collision is `quiet`: if no shift fits, nothing is broken, so the checks list
 * does not show it, and the penalty is for the score alone. It names the shift's cell, or the
 * night and the day of the appointment. A wish that is switched off (weight 0) reports nothing.
 *
 * Without a `sink` no array, string or closure is created: the cells and the text of a finding are
 * built only inside an `if (sink !== undefined)`.
 */
export function doctorWish(ctx: MonthContext, p: number, row: Uint8Array, sink?: Sink): number {
  const penalty = ctx.weights.W10;
  if (penalty === 0) return 0;
  const { doctorFrom, doctorTo } = ctx.people[p];
  const { shifts } = ctx.settings;
  const n = ctx.days.length;
  let score = 0;

  for (let i = ctx.first; i < n; i++) {
    const from = doctorFrom[i];
    if (from < 0) continue;
    const to = doctorTo[i];
    const clearFrom = from - MARGIN;
    const clearTo = to + MARGIN;

    const code = row[i];
    if (isShift(code)) {
      const { start, end } = shifts[CODE_NAMES[code] as ShiftName];
      if (overlaps(start, end, clearFrom, clearTo)) {
        score += penalty;
        if (sink !== undefined) reportCollision(sink, p, [i], code, from, to, penalty);
      }
    }

    // a night of the day before ends on this day, a day earlier on the clock of the shift times
    const before = row[i - 1];
    if (isNight(before)) {
      const { start, end } = shifts[CODE_NAMES[before] as ShiftName];
      if (overlaps(start - MINUTES_PER_DAY, end - MINUTES_PER_DAY, clearFrom, clearTo)) {
        score += penalty;
        if (sink !== undefined) reportCollision(sink, p, [i - 1, i], before, from, to, penalty);
      }
    }
  }
  return score;
}
