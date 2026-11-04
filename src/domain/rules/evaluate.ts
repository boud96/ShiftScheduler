import type { MonthContext } from '../context';
import { evaluateDay } from './day';
import { evaluatePerson } from './person';
import type { DayStats, Finding, PersonStats, Sink } from './types';

export interface MonthEval {
  /** The sum of the scores of every person, every day and the global wishes (W7 to W9). */
  score: number;
  /** Units of the musts of every person and every day. */
  mustUnits: number;
  /** Empty unless explained. Musts first, then by first day; findings without a day come last. */
  findings: Finding[];
  /** One per person of `ctx.people`. */
  persons: PersonStats[];
  /** One per day of the month, from day 1. */
  days: DayStats[];
}

function firstDay(f: Finding): number {
  return f.days.length > 0 ? Math.min(...f.days) : Infinity;
}

function mustsFirstThenByDay(a: Finding, b: Finding): number {
  if (a.severity !== b.severity) return a.severity === 'must' ? -1 : 1;
  const x = firstDay(a);
  const y = firstDay(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Scores a month: `rows` holds one row per person of `ctx.people`, in the same order. With
 * `explain` the findings are listed too; without, `findings` stays empty and no text is built.
 */
export function evaluateMonth(ctx: MonthContext, rows: Uint8Array[], explain = false): MonthEval {
  const findings: Finding[] = [];
  const sink: Sink | undefined = explain
    ? (f) => {
        findings.push(f);
      }
    : undefined;
  const persons: PersonStats[] = [];
  const days: DayStats[] = [];
  let score = 0;
  let mustUnits = 0;

  for (let p = 0; p < ctx.people.length; p++) {
    const result = evaluatePerson(ctx, p, rows[p], sink);
    persons.push(result.stats);
    score += result.score;
    mustUnits += result.stats.mustUnits;
  }
  for (let d = ctx.first; d < ctx.days.length; d++) {
    const result = evaluateDay(ctx, d, rows, sink);
    days.push(result.stats);
    score += result.score;
    mustUnits += result.stats.mustUnits;
  }
  // Task 7 replaces this with evaluateGlobal(ctx, persons, days, sink).
  const globalScore = 0;

  findings.sort(mustsFirstThenByDay);
  return { score: score + globalScore, mustUnits, findings, persons, days };
}
