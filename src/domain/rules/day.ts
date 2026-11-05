import { CODE_NAMES, Code, TWELVE_CODES, WEEKDAY_CODES } from '../codes';
import type { MonthContext } from '../context';
import type { ShiftName } from '../types';
import type { DayStats, Sink } from './types';
import { GAP, HARD } from './weights';

/**
 * Rule M1 for day `d` (an index in `ctx.days`, at least `ctx.first`): every shift of the day's
 * type has between `coverage.min` and `coverage.max` people. The weekday shifts are asked for on a
 * weekday, R12 and N12 on a 12-hour day. A missing person scores GAP, an extra one HARD. Everyone
 * in `rows` counts, in the team that day or not: M3 is what reports a shift outside it.
 *
 * The result depends only on how many people hold each code that day, never on who: `SearchState`
 * relies on that when it skips evaluating the days again after a swap move.
 *
 * Without a `sink` this creates nothing but its result: no findings, no text.
 */
export function evaluateDay(
  ctx: MonthContext,
  d: number,
  rows: Uint8Array[],
  sink?: Sink,
): { score: number; stats: DayStats } {
  const weekday = ctx.days[d].dayType === 'weekday';
  const codes = weekday ? WEEKDAY_CODES : TWELVE_CODES;
  const { coverage } = ctx.settings;
  let score = 0;
  let units = 0;
  let r2 = 0;

  for (let k = 0; k < codes.length; k++) {
    const code = codes[k];
    let count = 0;
    for (let q = 0; q < rows.length; q++) if (rows[q][d] === code) count++;
    if (code === Code.R2) r2 = count;

    const { min, max } = coverage[CODE_NAMES[code] as ShiftName];
    if (count < min) {
      const missing = min - count;
      score += GAP * missing;
      units += missing;
      if (sink !== undefined) {
        sink({
          rule: 'M1',
          severity: 'must',
          person: null,
          days: [d],
          message: `chybí ${CODE_NAMES[code]}`,
          penalty: GAP * missing,
        });
      }
    } else if (max !== null && count > max) {
      const extra = count - max;
      score += HARD * extra;
      units += extra;
      if (sink !== undefined) {
        sink({
          rule: 'M1',
          severity: 'must',
          person: null,
          days: [d],
          message: `${CODE_NAMES[code]} ${count}×`,
          penalty: HARD * extra,
        });
      }
    }
  }

  return { score, stats: { r2, mustUnits: units } };
}
