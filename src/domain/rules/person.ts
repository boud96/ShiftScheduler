import { CODE_NAMES, Code, isAbsence, isNight, isShift, isTwelveShift } from '../codes';
import type { MonthContext } from '../context';
import type { ShiftName } from '../types';
import { personMusts } from './personMusts';
import { personWishes } from './personWishes';
import { preferenceWishes } from './preferenceWishes';
import type { PersonStats, Sink } from './types';
import { weekendWishes } from './weekendWishes';

/**
 * Counts the month days of `row` into `stats`. The previous month's tail is not counted. A shift
 * on a day outside the person's time in the team counts like any other: M3 is what reports it.
 */
function countMonth(ctx: MonthContext, row: Uint8Array, stats: PersonStats): void {
  const { days, first } = ctx;
  const { shifts, absenceHours } = ctx.settings;
  const { perShift } = stats;
  let hours = 0;
  let twelve = 0;
  let nights = 0;
  let holidayTwelve = 0;
  let festive = 0;

  for (let i = first; i < days.length; i++) {
    const code = row[i];
    if (isShift(code)) {
      hours += shifts[CODE_NAMES[code] as ShiftName].hours;
      if (days[i].festive) festive++;
      if (isNight(code)) nights++;
      if (isTwelveShift(code)) {
        twelve++;
        if (days[i].holiday) holidayTwelve++;
      } else {
        perShift[code - Code.R1]++;
      }
    } else if (isAbsence(code)) {
      hours += absenceHours;
    }
  }

  stats.hours = hours;
  stats.twelve = twelve;
  stats.nights = nights;
  stats.holidayTwelve = holidayTwelve;
  stats.festive = festive;
}

/**
 * The score and the stats of person `p`, whose cells are `row` (the 7 tail days, then the month).
 * Every finding goes to `sink`, if there is one. The generator calls this millions of times with
 * no sink: then nothing is created but the result, and no message text is built.
 */
export function evaluatePerson(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  sink?: Sink,
): { score: number; stats: PersonStats } {
  const stats: PersonStats = {
    hours: 0,
    twelve: 0,
    nights: 0,
    holidayTwelve: 0,
    festive: 0,
    perShift: [0, 0, 0, 0, 0],
    mustUnits: 0,
  };
  countMonth(ctx, row, stats);
  const score =
    personMusts(ctx, p, row, stats, sink) +
    personWishes(ctx, p, row, stats, sink) +
    weekendWishes(ctx, p, row, stats, sink) +
    preferenceWishes(ctx, p, row, stats, sink);
  return { score, stats };
}
