import { addDays } from '../calendar';
import {
  CODE_NAMES,
  Code,
  isAbsence,
  isNight,
  isShift,
  isTwelveShift,
  isWeekdayShift,
} from '../codes';
import type { MonthContext } from '../context';
import { fmtH, shortDate, twelveShifts } from '../format';
import type { Settings, ShiftName } from '../types';
import type { MustId, PersonStats, Sink } from './types';
import { BELOW_FPD, HARD } from './weights';

const MINUTES_PER_DAY = 1440;
/** A shortfall this small (in hours) is rounding noise in the sum of the hours, not a shortfall. */
export const FPD_TOLERANCE = 1e-9;

/** The minutes of rest between shift `a` and shift `b` on the day after it. */
function restBetween(shifts: Settings['shifts'], a: number, b: number): number {
  const start = shifts[CODE_NAMES[b] as ShiftName].start;
  const end = shifts[CODE_NAMES[a] as ShiftName].end;
  return MINUTES_PER_DAY + start - end;
}

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

/** The 12-hour shifts of the month, for the cells M5 (and W5a) point at. */
export function twelveDays(ctx: MonthContext, row: Uint8Array): number[] {
  const found: number[] = [];
  for (let i = ctx.first; i < ctx.days.length; i++) {
    if (isTwelveShift(row[i])) found.push(i);
  }
  return found;
}

/**
 * Rules M2 to M8 for person `p`, whose month `row` has been counted into `stats` already (M5 and M6
 * read `twelve` and `hours`). Adds the person's must units to `stats.mustUnits` and returns their
 * score.
 *
 * Rules that look at two days read the last tail day for day 1, but only a finding that touches a
 * day of the month counts. They read the day after the month too, for the pair that its last day
 * makes: what is stored for the person on day 1 of the next month (`EnginePerson.nextDay`). That
 * day is outside the row, so such a finding is on the last day alone. Without a `sink` no array,
 * string or closure is created: every one below sits inside an `if (sink !== undefined)`.
 */
export function personMusts(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  stats: PersonStats,
  sink?: Sink,
): number {
  const { days, first, settings } = ctx;
  const { shifts } = settings;
  const person = ctx.people[p];
  const minRest = settings.minRestHours * 60;
  const neverNights = person.prefs.nights === 'never';
  let score = 0;
  let units = 0;

  for (let i = first; i < days.length; i++) {
    const b = row[i];
    const a = row[i - 1];

    if (isShift(b)) {
      // M3: no shift on a day outside the person's time in the team.
      if (person.active[i] === 0) {
        score += HARD;
        units++;
        if (sink !== undefined) {
          report(sink, 'M3', p, [i], `${CODE_NAMES[b]} mimo období, kdy je v týmu`, HARD);
        }
      }

      // M7: no night shift for someone who never works nights.
      if (neverNights && isNight(b)) {
        score += HARD;
        units++;
        if (sink !== undefined) {
          report(sink, 'M7', p, [i], 'noční směna, ale noční nechce', HARD);
        }
      }

      // M8: weekday shifts on weekdays, R12 and N12 on 12-hour days.
      const weekday = days[i].dayType === 'weekday';
      if (weekday ? isTwelveShift(b) : isWeekdayShift(b)) {
        score += HARD;
        units++;
        if (sink !== undefined) {
          const where = weekday ? 'všední den' : 'víkend ani svátek';
          report(sink, 'M8', p, [i], `${CODE_NAMES[b]} nepatří na ${where}`, HARD);
        }
      }

      // M2: rest between a shift and the shift of the next day.
      if (isShift(a)) {
        const rest = restBetween(shifts, a, b);
        if (rest < minRest) {
          score += HARD;
          units++;
          if (sink !== undefined) {
            const message =
              `${CODE_NAMES[b]} hned po ${CODE_NAMES[a]}: ` +
              `jen ${fmtH(rest / 60)} h odpočinku (min. ${fmtH(settings.minRestHours)} h)`;
            report(sink, 'M2', p, [i - 1, i], message, HARD);
          }
        }
      }
    } else if (isNight(a) && (b === Code.X || isAbsence(b))) {
      // M4: a night ends in the morning of the next day, which must not be a request or an absence.
      score += HARD;
      units++;
      if (sink !== undefined) {
        const message = `noční ${CODE_NAMES[a]} končí ráno v den, kdy je ${CODE_NAMES[b]}`;
        report(sink, 'M4', p, [i - 1, i], message, HARD);
      }
    }
  }

  // The last day and the day after the month, which is no cell of the row: the same two rules as
  // above. Most often nothing is stored there, and it costs one comparison.
  const last = days.length - 1;
  const end = row[last];
  const next = person.nextDay;
  if (isShift(next)) {
    // M2, as above: a shift on the last day, a shift stored for the day after.
    if (isShift(end)) {
      const rest = restBetween(shifts, end, next);
      if (rest < minRest) {
        score += HARD;
        units++;
        if (sink !== undefined) {
          const message =
            `${CODE_NAMES[next]} ${shortDate(addDays(days[last].date, 1))} ` +
            `hned po ${CODE_NAMES[end]}: ` +
            `jen ${fmtH(rest / 60)} h odpočinku (min. ${fmtH(settings.minRestHours)} h)`;
          report(sink, 'M2', p, [last], message, HARD);
        }
      }
    }
  } else if (isNight(end) && (next === Code.X || isAbsence(next))) {
    // M4, as above: the night of the last day ends on the morning of a request or an absence.
    score += HARD;
    units++;
    if (sink !== undefined) {
      const message =
        `noční ${CODE_NAMES[end]} končí ráno ${shortDate(addDays(days[last].date, 1))}, ` +
        `kdy je ${CODE_NAMES[next]}`;
      report(sink, 'M4', p, [last], message, HARD);
    }
  }

  // M5: at most `maxTwelvePerMonth` 12-hour shifts, HARD for each one over.
  const maxTwelve = settings.maxTwelvePerMonth;
  const excess = stats.twelve - maxTwelve;
  if (excess > 0) {
    score += HARD * excess;
    units += excess;
    if (sink !== undefined) {
      const message = `${twelveShifts(stats.twelve)} (max. ${maxTwelve})`;
      report(sink, 'M5', p, twelveDays(ctx, row), message, HARD * excess);
    }
  }

  // M6: hours at least the person's FPD, BELOW_FPD for each hour short.
  const short = person.fpd - stats.hours;
  if (short > FPD_TOLERANCE) {
    score += BELOW_FPD * short;
    units++;
    if (sink !== undefined) {
      const had = `${fmtH(stats.hours)} h z ${fmtH(person.fpd)} h`;
      report(sink, 'M6', p, [], `${had}: chybí ${fmtH(short)} h do FPD`, BELOW_FPD * short);
    }
  }

  stats.mustUnits += units;
  return score;
}
