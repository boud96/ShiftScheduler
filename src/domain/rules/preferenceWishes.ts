import { Code } from '../codes';
import type { MonthContext } from '../context';
import type { Preferences, Rating, WeekdayShift } from '../types';
import { cellsWith, report } from './personWishes';
import type { PersonStats, Sink } from './types';

/** The weekday shifts, in the order of `PersonStats.perShift`. */
const SHIFTS: readonly WeekdayShift[] = ['R1', 'R2', 'O20', 'O', 'N'];
/** W6: the units of one shift by its rating, indexed by the rating (there is no rating 0). */
const RATING_UNITS: readonly number[] = [0, 6, 4, 2, 1, 0];
/** W6: a shift the person has not rated counts as this rating. */
const UNRATED: Rating = 3;
/** W6: a shift rated this low or lower is one the person dislikes. */
const DISLIKED: Rating = 2;

/** Whether the person has rated at least one of the weekday shifts. */
function hasRatings(ratings: Preferences['ratings']): boolean {
  return (
    ratings.R1 !== undefined ||
    ratings.R2 !== undefined ||
    ratings.O20 !== undefined ||
    ratings.O !== undefined ||
    ratings.N !== undefined
  );
}

/**
 * W6, for someone who has rated some shifts: each weekday shift of the month costs by the rating
 * of its kind, 0 for a 5 up to 6 for a 1. A shift the person has not rated counts as a 3.
 *
 * The shifts of a kind the person dislikes (1 or 2) are the ones to tell the team lead; the rest
 * is reported as `quiet` findings, for the score alone.
 */
function byRating(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  stats: PersonStats,
  sink?: Sink,
): number {
  const { ratings } = ctx.people[p].prefs;
  const weight = ctx.weights.W6;
  let score = 0;

  for (let k = 0; k < SHIFTS.length; k++) {
    const count = stats.perShift[k];
    if (count === 0) continue;
    const rating = ratings[SHIFTS[k]];
    const penalty = count * RATING_UNITS[rating ?? UNRATED] * weight;
    score += penalty;
    if (sink !== undefined && penalty > 0) {
      const name = SHIFTS[k];
      const disliked = rating !== undefined && rating <= DISLIKED;
      const how = rating === undefined ? 'bez hodnocení' : `hodnocení ${rating}`;
      const message = disliked
        ? `${count}× ${name}, kterou má nerad(a)`
        : `${count}× ${name} (${how})`;
      const days = cellsWith(row, ctx.first, ctx.days.length - 1, Code.R1 + k);
      report(sink, 'W6', p, days, message, penalty, !disliked);
    }
  }
  return score;
}

/**
 * W6, for someone who has rated none: the five weekday shifts should come about as often as one
 * another, so each kind costs its distance from the mean. There is no one shift to point at: the
 * finding is `quiet` and names no day, like the overtime of W1.
 */
function evenSpread(ctx: MonthContext, p: number, stats: PersonStats, sink?: Sink): number {
  const { perShift } = stats;
  const total = perShift[0] + perShift[1] + perShift[2] + perShift[3] + perShift[4];
  const mean = total / SHIFTS.length;
  let spread = 0;
  for (let k = 0; k < SHIFTS.length; k++) spread += Math.abs(perShift[k] - mean);

  const penalty = spread * ctx.weights.W6;
  if (sink !== undefined && penalty > 0) {
    report(sink, 'W6', p, [], 'nerovnoměrné rozdělení směn R1, R2, O20, O a N', penalty, true);
  }
  return penalty;
}

/**
 * Wish W6 for person `p`, whose month has been counted into `stats` already (it reads `perShift`,
 * the weekday shifts of the month). A unit costs the weight of W6 in `ctx.weights`. Returns the
 * person's score.
 *
 * Without a `sink` no array, string or closure is created: every one in this file sits inside an
 * `if (sink !== undefined ...)`. A wish whose penalty is 0 (switched off) is not reported. Every
 * other penalty is carried by a finding, so that the findings add up to the score: those of
 * shifts the person dislikes are shown, all others are `quiet`.
 */
export function preferenceWishes(
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  stats: PersonStats,
  sink?: Sink,
): number {
  return hasRatings(ctx.people[p].prefs.ratings)
    ? byRating(ctx, p, row, stats, sink)
    : evenSpread(ctx, p, stats, sink);
}
