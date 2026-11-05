import type { MonthContext } from '../context';
import { shortDate } from '../format';
import type { FairnessCounts, Preferences, Rating, WeekdayShift } from '../types';
import { report } from './personWishes';
import { DISLIKED, SHIFTS } from './preferenceWishes';
import type { DayStats, PersonStats, Sink } from './types';

// The generator calls evaluateGlobal after every move, so it is written for speed. A property is
// read by name inside a switch: a keyed read such as `history[count]` or `ratings[name]` sees
// several names (and `ratings` objects of many shapes) at one place, and is much slower.

/** The counts W7 balances, in the order they are scored. */
const COUNTS: readonly (keyof FairnessCounts)[] = ['twelve', 'nights', 'holidayTwelve', 'festive'];
/** W7: the words that complete "víc … než ostatní" for each count. */
const LABELS: Record<keyof FairnessCounts, string> = {
  twelve: 'dvanáctihodinových směn',
  nights: 'nočních',
  holidayTwelve: 'směn o svátcích',
  festive: 'směn o Vánocích a Silvestru',
};
/** W7: someone this far above the mean of a count or more is one to tell the team lead about. */
const SHOWN_FROM = 1;
/** W9: a weekday whose R2 is this far from the mean or more is one to name. */
const FAR_FROM_MEAN = 2;

/**
 * The sum of the squared distances from their mean of `people` whole numbers, whose sum is `sum`
 * and whose squares add up to `squares`: Σ (x − mean)² = (people · Σ x² − (Σ x)²) / people. Both
 * products are exact for whole numbers, so numbers that are all the same give exactly 0.
 */
function spread(people: number, sum: number, squares: number): number {
  return (people * squares - sum * sum) / people;
}

/** The total of `count` for person `p`: the history plus the month. */
function totalOf(
  ctx: MonthContext,
  persons: PersonStats[],
  p: number,
  count: keyof FairnessCounts,
): number {
  const history = ctx.people[p].history;
  const stats = persons[p];
  switch (count) {
    case 'twelve':
      return history.twelve + stats.twelve;
    case 'nights':
      return history.nights + stats.nights;
    case 'holidayTwelve':
      return history.holidayTwelve + stats.holidayTwelve;
    case 'festive':
      return history.festive + stats.festive;
  }
}

/** Whether W7 compares person `p` in `count`: all do, but in nights only "if needed" people. */
function compared(ctx: MonthContext, p: number, count: keyof FairnessCounts): boolean {
  return count !== 'nights' || ctx.people[p].prefs.nights === 'ifNeeded';
}

/**
 * W7 for one count: the squared distance of everyone's total from the mean of the totals of those
 * who are compared, for any count that two people or more have. Someone above the mean costs as
 * much as someone the same distance below it, so the extra shifts go to those with the fewest. The
 * finding of someone at least `SHOWN_FROM` above the mean is shown; the others are quiet, for the
 * score alone.
 */
function fairness(
  ctx: MonthContext,
  persons: PersonStats[],
  count: keyof FairnessCounts,
  sink?: Sink,
): number {
  const weight = ctx.weights.W7;
  let people = 0;
  let sum = 0;
  for (let p = 0; p < persons.length; p++) {
    if (!compared(ctx, p, count)) continue;
    people++;
    sum += totalOf(ctx, persons, p, count);
  }
  if (people < 2) return 0;

  const mean = sum / people;
  let score = 0;
  for (let p = 0; p < persons.length; p++) {
    if (!compared(ctx, p, count)) continue;
    const offset = totalOf(ctx, persons, p, count) - mean;
    const penalty = offset * offset * weight;
    score += penalty;
    if (sink !== undefined && penalty > 0) {
      const message = `${offset > 0 ? 'víc' : 'méně'} ${LABELS[count]} než ostatní`;
      report(sink, 'W7', p, [], message, penalty, offset < SHOWN_FROM);
    }
  }
  return score;
}

/** The rating given to the weekday shift `name` in `ratings`, if any. */
function ratingOf(ratings: Preferences['ratings'], name: WeekdayShift): Rating | undefined {
  switch (name) {
    case 'R1':
      return ratings.R1;
    case 'R2':
      return ratings.R2;
    case 'O20':
      return ratings.O20;
    case 'O':
      return ratings.O;
    case 'N':
      return ratings.N;
  }
}

/**
 * W8: for each weekday shift that two people or more dislike, the squared distance of the number of
 * times each of them works it from the mean of them. One finding for the shift carries the whole
 * penalty: there is no one person or day to point at. Each rating is read once.
 */
function unloved(ctx: MonthContext, persons: PersonStats[], sink?: Sink): number {
  const weight = ctx.weights.W8;
  let score = 0;
  for (let k = 0; k < SHIFTS.length; k++) {
    const name = SHIFTS[k];
    let people = 0;
    let sum = 0;
    let squares = 0;
    for (let p = 0; p < persons.length; p++) {
      const rating = ratingOf(ctx.people[p].prefs.ratings, name);
      if (rating === undefined || rating > DISLIKED) continue;
      const count = persons[p].perShift[k];
      people++;
      sum += count;
      squares += count * count;
    }
    if (people < 2) continue;

    const penalty = spread(people, sum, squares) * weight;
    score += penalty;
    if (sink !== undefined && penalty > 0) {
      const message = `${name} rozdělené nerovnoměrně mezi ty, kdo ji nemají rádi`;
      report(sink, 'W8', null, [], message, penalty);
    }
  }
  return score;
}

/**
 * W9's finding. It is shown if some weekday is `FAR_FROM_MEAN` or more from the `mean` of R2, and
 * lists those days; if none is, the penalty is a sum of smaller distances and the finding is quiet.
 */
function reportR2(
  ctx: MonthContext,
  days: DayStats[],
  mean: number,
  penalty: number,
  sink: Sink,
): void {
  const far: number[] = [];
  const dates: string[] = [];
  for (let i = 0; i < days.length; i++) {
    const day = ctx.days[ctx.first + i];
    if (day.dayType !== 'weekday' || Math.abs(days[i].r2 - mean) < FAR_FROM_MEAN) continue;
    far.push(ctx.first + i);
    dates.push(shortDate(day.date));
  }
  if (far.length === 0) {
    report(sink, 'W9', null, far, 'počet R2 se mezi všedními dny liší', penalty, true);
  } else {
    report(sink, 'W9', null, far, `nevyrovnaný počet R2: ${dates.join(', ')}`, penalty);
  }
}

/**
 * W9: the squared distance of the number of people on R2 each weekday of the month from the mean of
 * them. A 12-hour day has no R2, and is left out. One finding carries the whole penalty.
 */
function evenR2(ctx: MonthContext, days: DayStats[], sink?: Sink): number {
  let weekdays = 0;
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < days.length; i++) {
    if (ctx.days[ctx.first + i].dayType !== 'weekday') continue;
    const r2 = days[i].r2;
    weekdays++;
    sum += r2;
    squares += r2 * r2;
  }
  if (weekdays < 2) return 0;

  const penalty = spread(weekdays, sum, squares) * ctx.weights.W9;
  if (sink !== undefined && penalty > 0) reportR2(ctx, days, sum / weekdays, penalty, sink);
  return penalty;
}

/**
 * The global wishes W7 to W9, which compare people or days with one another. `persons` and `days`
 * are the stats that `evaluatePerson` and `evaluateDay` gave, one `PersonStats` per person of
 * `ctx.people` and one `DayStats` per day of the month, from day 1 (as in `MonthEval`). A unit
 * costs the weight of its wish in `ctx.weights`. Returns the score.
 *
 * Without a `sink` it creates no array, string or closure: it is plain loops over the persons and
 * the days, and whatever builds a finding sits inside an `if (sink !== undefined ...)`. A wish
 * whose penalty is 0 (switched off) is not reported. Every other penalty is carried by a finding,
 * so that the findings add up to the score: W7 has one for each person and count off the mean
 * (quiet unless they are far above it) and names the person; W8 has one for each shift and W9 one,
 * and name no person. Only W9 names days, and only when some weekday is far from the mean.
 */
export function evaluateGlobal(
  ctx: MonthContext,
  persons: PersonStats[],
  days: DayStats[],
  sink?: Sink,
): number {
  let score = 0;
  if (ctx.weights.W7 > 0) {
    for (let k = 0; k < COUNTS.length; k++) score += fairness(ctx, persons, COUNTS[k], sink);
  }
  if (ctx.weights.W8 > 0) score += unloved(ctx, persons, sink);
  if (ctx.weights.W9 > 0) score += evenR2(ctx, days, sink);
  return score;
}
