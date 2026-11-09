import { CODE_NAMES, Code } from '../domain/codes';
import type { CodeInt } from '../domain/codes';
import { isBelowFpd } from '../domain/rules/personMusts';
import { HARD } from '../domain/rules/weights';
import type { ShiftName } from '../domain/types';
import type { Move } from './moves';
import type { SearchState } from './state';

/** The order in which the shifts of a day are filled: on a weekday, and on a 12-hour day. */
const WEEKDAY_SLOTS: readonly CodeInt[] = [Code.R1, Code.O20, Code.O, Code.N, Code.R2];
const TWELVE_SLOTS: readonly CodeInt[] = [Code.R12, Code.N12];
/** A move whose delta is this or more breaks a must (each costs HARD): it is never made. */
const BREAKS_A_MUST = HARD / 2;
/**
 * Deltas closer than this, relative to the size of the score, are a tie: what tells them apart is
 * the rounding of the sums they come from.
 */
const TIE = 1e-12;

/**
 * Tries each move and makes the one that lowers the score the most, a random one of those that
 * tie. A move that breaks a must is never made. Returns whether a move was made.
 */
function makeBest(st: SearchState, rnd: () => number, moves: Move[]): boolean {
  const deltas = moves.map((move) => {
    const delta = st.tryMove(move);
    st.revert();
    return delta;
  });
  let min = Infinity;
  for (const delta of deltas) if (delta < BREAKS_A_MUST && delta < min) min = delta;
  if (min === Infinity) return false;

  const tie = TIE * Math.max(1, Math.abs(st.score));
  const best = moves.filter((_, k) => deltas[k] < BREAKS_A_MUST && deltas[k] <= min + tie);
  st.tryMove(best.length === 1 ? best[0] : best[Math.floor(rnd() * best.length)]);
  st.commit();
  return true;
}

/**
 * The shift that the coverage asks for on a day of the month and that just one person can take
 * without breaking a must, the earliest such day first; null if there is none. A shift that no
 * one can take is passed over.
 */
function forcedShift(st: SearchState): Move | null {
  const { ctx, rows, fixed } = st;
  for (let d = ctx.first; d < ctx.days.length; d++) {
    const slots = st.weekdayType[d] === 1 ? WEEKDAY_SLOTS : TWELVE_SLOTS;
    for (const code of slots) {
      const { min } = ctx.settings.coverage[CODE_NAMES[code] as ShiftName];
      let count = 0;
      for (const row of rows) if (row[d] === code) count++;
      if (count >= min) continue;
      let only: Move | null = null;
      let takers = 0;
      for (let p = 0; p < rows.length && takers < 2; p++) {
        if (fixed[p][d] !== 0 || rows[p][d] !== Code.EMPTY) continue;
        const move: Move = { kind: 'set', p, d, code };
        const delta = st.tryMove(move);
        st.revert();
        if (delta < BREAKS_A_MUST) {
          takers++;
          only = move;
        }
      }
      if (takers === 1) return only;
    }
  }
  return null;
}

/**
 * While some shift that a day lacks can be taken by one person only, that person takes it. Such a
 * shift is left uncovered if anyone else takes the cells it needs first: on a weekend that only one
 * person may work, a night on the Friday before it ends on the Saturday morning, so if that person
 * took the Saturday's day shift, the night would stay uncovered.
 */
function coverForced(st: SearchState): void {
  for (let move = forcedShift(st); move !== null; move = forcedShift(st)) {
    st.tryMove(move);
    st.commit();
  }
}

/**
 * Each day of the month in order: every shift that the coverage asks for and the day lacks, from
 * the people whose cell is free and empty. A shift no one can take is left uncovered.
 */
function coverDays(st: SearchState, rnd: () => number): void {
  const { ctx, rows, fixed } = st;
  for (let d = ctx.first; d < ctx.days.length; d++) {
    const slots = st.weekdayType[d] === 1 ? WEEKDAY_SLOTS : TWELVE_SLOTS;
    for (const code of slots) {
      const { min } = ctx.settings.coverage[CODE_NAMES[code] as ShiftName];
      let count = 0;
      for (const row of rows) if (row[d] === code) count++;
      for (; count < min; count++) {
        const moves: Move[] = [];
        for (let p = 0; p < rows.length; p++) {
          if (fixed[p][d] === 0 && rows[p][d] === Code.EMPTY) {
            moves.push({ kind: 'set', p, d, code });
          }
        }
        if (!makeBest(st, rnd, moves)) break;
      }
    }
  }
}

/**
 * While someone is below their FPD: an R2 for one of them on a weekday whose cell is free and
 * empty, wherever it lowers the score the most. Someone no R2 can be given stays below.
 */
function reachFpd(st: SearchState, rnd: () => number): void {
  const { ctx, rows, fixed } = st;
  for (;;) {
    const moves: Move[] = [];
    for (let p = 0; p < rows.length; p++) {
      if (!isBelowFpd(ctx.people[p], st.statsOf(p).hours)) continue;
      for (let d = ctx.first; d < ctx.days.length; d++) {
        if (st.weekdayType[d] === 1 && fixed[p][d] === 0 && rows[p][d] === Code.EMPTY) {
          moves.push({ kind: 'set', p, d, code: Code.R2 });
        }
      }
    }
    if (!makeBest(st, rnd, moves)) return;
  }
}

/**
 * Builds the first draft of a month greedily, as the start of the search.
 *
 * 1. While some shift that the coverage asks for can be taken by one person only, without
 *    breaking a must, that person takes it, the earliest such day first.
 * 2. Each day of the month in order, it fills every shift the coverage asks for and the day does
 *    not have yet: R1, O20, O, N and R2 on a weekday, R12 and N12 on a 12-hour day. Each time it
 *    takes, of the people whose cell is free and empty, the one whose shift lowers the score the
 *    most; `rnd` breaks a tie.
 * 3. While someone is below their FPD, it adds an R2 on a free and empty weekday, where it lowers
 *    the score the most.
 *
 * It never makes a move that breaks a must (that costs HARD): a shift that no one can take
 * without breaking one is left uncovered, and someone who can be given no R2 stays below FPD.
 */
export function construct(st: SearchState, rnd: () => number): void {
  coverForced(st);
  coverDays(st, rnd);
  reachFpd(st, rnd);
}
