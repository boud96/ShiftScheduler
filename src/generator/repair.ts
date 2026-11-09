import {
  Code,
  TWELVE_CODES,
  WEEKDAY_CODES,
  isShift,
  isTwelveShift,
  isWeekdayShift,
} from '../domain/codes';
import type { CodeInt } from '../domain/codes';
import { FPD_TOLERANCE } from '../domain/rules/personMusts';
import { RANGE_MAX, RANGE_MIN, breaksHardMust } from './moves';
import type { Move } from './moves';
import type { SearchState } from './state';

type SetMove = Extract<Move, { kind: 'set' }>;
type SwapDayMove = Extract<Move, { kind: 'swapDay' }>;
type SwapRangeMove = Extract<Move, { kind: 'swapRange' }>;
type ExchangeMove = Extract<Move, { kind: 'exchange' }>;
type ShiftMoveMove = Extract<Move, { kind: 'shiftMove' }>;

/** The longest ranges of an exchange that a trade makes: 1 or 2 days, as the proposals make. */
const EXCHANGE_MAX = 2;

/**
 * A change is a gain only if it lowers the score by more than this share of the score (of 1, for
 * a score below 1). The score is a sum of parts that binary floating point does not all hold
 * exactly: W7 and W9 divide by the number of people or of weekdays, and the hours and the FPD
 * come from the settings. So months of the same score can come out apart in the last places of
 * their sums, by some 1e-14 of the score at most, and a change that gains less than this gains
 * only rounding. Any gain the rules can make, in hours below FPD or in units of a wish, is many
 * orders larger.
 */
const GAIN = 1e-12;

/** Whether `code` is a shift that fits day `d`: a weekday shift on a weekday, R12 or N12 else. */
function shiftFits(st: SearchState, code: number, d: number): boolean {
  return st.weekdayType[d] === 1 ? isWeekdayShift(code) : isTwelveShift(code);
}

/** The shifts that may stand on day `d`. */
function shiftsOf(st: SearchState, d: number): readonly CodeInt[] {
  return st.weekdayType[d] === 1 ? WEEKDAY_CODES : TWELVE_CODES;
}

/**
 * One pass of the repair: every change it looks at for each person below FPD, each tried on the
 * state and undone, and the moves of the one that gains the most. The moves it tries are kept and
 * changed in place, so that trying one allocates nothing; only a better change found is copied.
 */
class Pass {
  /** The moves of the best change found, in the order they are made; none while none gains. */
  plan: Move[] = [];
  /** True once `stop` has said so: the pass has ended, with every move it tried undone. */
  stopped = false;
  /** The delta a change must beat: at first a gain beyond rounding, then the best change's. */
  private bar: number;
  /** The trade in hand while the moves after it are tried, or null. */
  private trade: Move | null = null;
  private readonly own: SetMove = { kind: 'set', p: 0, d: 0, code: Code.R2 };
  private readonly take: SwapDayMove = { kind: 'swapDay', d: 0, p: 0, q: 0 };
  private readonly then: SetMove = { kind: 'set', p: 0, d: 0, code: Code.R2 };
  private readonly swapDay: SwapDayMove = { kind: 'swapDay', d: 0, p: 0, q: 0 };
  private readonly swapRange: SwapRangeMove = { kind: 'swapRange', p: 0, q: 0, d: 0, len: 2 };
  private readonly exchange: ExchangeMove = { kind: 'exchange', p: 0, q: 0, d: 0, e: 0, len: 1 };
  private readonly shiftMove: ShiftMoveMove = { kind: 'shiftMove', p: 0, from: 0, to: 0 };
  private readonly back: ShiftMoveMove = { kind: 'shiftMove', p: 0, from: 0, to: 0 };

  constructor(
    private readonly st: SearchState,
    private readonly stop: (() => boolean) | undefined,
  ) {
    this.bar = -GAIN * Math.max(1, Math.abs(st.score));
  }

  /** The changes for person `a`, who is below FPD: first without a trade, then after each. */
  person(a: number): void {
    this.finish(a, 0);
    this.trades(a);
  }

  /** Keeps `moves`, after the trade in hand if there is one, as the best change so far. */
  private keep(delta: number, ...moves: Move[]): void {
    this.bar = delta;
    const all = this.trade === null ? moves : [this.trade, ...moves];
    this.plan = all.map((m) => ({ ...m }));
  }

  /**
   * The changes that give person `a` one more shift on the state as it is, `sofar` being the
   * delta of the trade in hand (0 with none): a shift of `a`'s own on a day `a` is free and empty,
   * in each code that fits the day; and the shift of another person on such a day, which they
   * give `a` and make up with a shift of their own on a day they are free and empty.
   */
  private finish(a: number, sofar: number): void {
    const { st, own, take, then } = this;
    const { rows, fixed } = st;
    const n = st.ctx.days.length;
    for (let d = st.ctx.first; d < n; d++) {
      if (fixed[a][d] !== 0 || rows[a][d] !== Code.EMPTY) continue;
      own.p = a;
      own.d = d;
      const codes = shiftsOf(st, d);
      for (let k = 0; k < codes.length; k++) {
        own.code = codes[k];
        if (breaksHardMust(st, own)) continue;
        const delta = sofar + st.tryMove(own);
        st.revert();
        if (delta < this.bar) this.keep(delta, own);
      }
      for (let b = 0; b < rows.length; b++) {
        if (b === a || fixed[b][d] !== 0 || !shiftFits(st, rows[b][d], d)) continue;
        take.d = d;
        take.p = a;
        take.q = b;
        if (breaksHardMust(st, take)) continue;
        const given = sofar + st.tryMove(take);
        st.commit();
        then.p = b;
        for (let e = st.ctx.first; e < n; e++) {
          if (fixed[b][e] !== 0 || rows[b][e] !== Code.EMPTY) continue;
          then.d = e;
          const theirs = shiftsOf(st, e);
          for (let k = 0; k < theirs.length; k++) {
            then.code = theirs[k];
            if (breaksHardMust(st, then)) continue;
            const delta = given + st.tryMove(then);
            st.revert();
            if (delta < this.bar) this.keep(delta, take, then);
          }
        }
        st.tryMove(take); // the same swap undoes it
        st.commit();
      }
    }
  }

  /**
   * How many more shifts `a` than `b` holds in the `len` days from `d` on: what `a` hands `b` if
   * they swap them. Null if they may not swap them (a fixed cell, a code that does not fit its
   * day), or if the swap would change no cell.
   */
  private handed(a: number, b: number, d: number, len: number): number | null {
    const { st } = this;
    const { rows, fixed } = st;
    let give = 0;
    let change = false;
    for (let i = d; i < d + len; i++) {
      if (fixed[a][i] !== 0 || fixed[b][i] !== 0) return null;
      const x = rows[a][i];
      const y = rows[b][i];
      if (x === y) continue;
      if (x !== Code.EMPTY && !shiftFits(st, x, i)) return null;
      if (y !== Code.EMPTY && !shiftFits(st, y, i)) return null;
      change = true;
      if (isShift(x)) give++;
      if (isShift(y)) give--;
    }
    return change ? give : null;
  }

  /**
   * The trades of person `a` that keep `a`'s number of shifts, each followed by the changes of
   * `finish`: a swapDay with another person on a day both work other shifts, a swapRange with
   * them that hands back as many shifts as it hands over, an exchange with them, and a shiftMove
   * of one of `a`'s shifts to an empty day of the same type. Stops at once when told to.
   */
  private trades(a: number): void {
    const { st, swapDay, swapRange, exchange, shiftMove, back } = this;
    const { rows, fixed, weekdayType } = st;
    const first = st.ctx.first;
    const n = st.ctx.days.length;
    for (let b = 0; b < rows.length; b++) {
      if (b === a) continue;
      for (let d = first; d < n; d++) {
        if (fixed[a][d] !== 0 || fixed[b][d] !== 0) continue;
        const x = rows[a][d];
        const y = rows[b][d];
        if (x === y || !shiftFits(st, x, d) || !shiftFits(st, y, d)) continue;
        swapDay.d = d;
        swapDay.p = a;
        swapDay.q = b;
        if (!this.tryTrade(a, swapDay, swapDay)) return;
      }
      for (let len = RANGE_MIN; len <= RANGE_MAX; len++) {
        for (let d = first; d + len <= n; d++) {
          if (this.handed(a, b, d, len) !== 0) continue;
          swapRange.p = a;
          swapRange.q = b;
          swapRange.d = d;
          swapRange.len = len;
          if (!this.tryTrade(a, swapRange, swapRange)) return;
        }
      }
      for (let len = 1; len <= EXCHANGE_MAX; len++) {
        for (let d = first; d + len <= n; d++) {
          const give = this.handed(a, b, d, len);
          if (give === null || give === 0) continue;
          // each pair of ranges once: the second after the first, with a day between them
          for (let e = d + len + 1; e + len <= n; e++) {
            if (this.handed(a, b, e, len) !== -give) continue;
            exchange.p = a;
            exchange.q = b;
            exchange.d = d;
            exchange.e = e;
            exchange.len = len;
            if (!this.tryTrade(a, exchange, exchange)) return;
          }
        }
      }
    }
    for (let from = first; from < n; from++) {
      if (fixed[a][from] !== 0 || !shiftFits(st, rows[a][from], from)) continue;
      for (let to = first; to < n; to++) {
        if (to === from || fixed[a][to] !== 0 || rows[a][to] !== Code.EMPTY) continue;
        if (weekdayType[to] !== weekdayType[from]) continue;
        shiftMove.p = back.p = a;
        shiftMove.from = back.to = from;
        shiftMove.to = back.from = to;
        if (!this.tryTrade(a, shiftMove, back)) return;
      }
    }
  }

  /**
   * Asks `stop` first, and returns false once it says so. Else, unless it breaks a must that
   * costs HARD, makes trade `m` of person `a`, tries the changes of `finish` after it and undoes
   * it with `inverse`.
   */
  private tryTrade(a: number, m: Move, inverse: Move): boolean {
    if (this.stop !== undefined && this.stop()) {
      this.stopped = true;
      return false;
    }
    const { st } = this;
    if (breaksHardMust(st, m)) return true;
    const delta = st.tryMove(m);
    st.commit();
    this.trade = m;
    this.finish(a, delta);
    this.trade = null;
    st.tryMove(inverse);
    st.commit();
    return true;
  }
}

/**
 * Repairs the hours that the annealing leaves short. For each person below their FPD, as M6
 * judges it, it looks for a change that gives them one more shift and lowers the score, makes the
 * best one, and looks again, until no change gains. It returns how many changes it made, and
 * leaves no move in hand.
 *
 * The annealing finds a free shift for someone below FPD by itself. What it misses is the shift
 * behind a valley: in a tight month every free day of the person may be blocked by a must that
 * costs HARD (a run of days, the days off after one, the rest between shifts, the 12-hour
 * maximum), and only a trade that keeps their number of shifts unblocks one. Each step of it
 * costs far more than any wish, so the annealing never crosses. For person A, the changes are:
 *
 * - a shift of A's own on a day A is free and empty (`set`), in each code that fits the day;
 * - the shift of another person B on such a day, which B gives A (`swapDay`) and makes up with a
 *   shift of B's own on a day B is free and empty (`set`);
 * - either of these after a trade that keeps A's number of shifts: a `swapDay` with B on a day
 *   both work other shifts, a `swapRange` with B (2 to 7 days) that hands back as many shifts as
 *   it hands over, an `exchange` with B (1 or 2 days), or a `shiftMove` of one of A's shifts to an
 *   empty day of the same type.
 *
 * Like the proposals, each move changes only free cells of the month, in codes that fit the day,
 * and a move that `breaksHardMust` is skipped. Each is tried with `tryMove`; one made to try the
 * moves after it is undone by its inverse, the same swap or the shift moved back, which leaves the
 * state as it was to the last bit of its score. A shift for someone below FPD gains up to 1e5 for
 * each hour of it, but a change is made only if, with all it costs elsewhere (wishes, and the
 * musts below HARD of the others), it lowers the score by more than rounding can (GAIN).
 *
 * `stop`, if given, is asked before each trade. Once it says so, the repair ends at once: the
 * change of the pass in hand is not made, and the state keeps the changes made before. The repair
 * itself reads no clock and draws no random numbers: without `stop`, its result follows from the
 * state alone.
 */
export function repairHours(st: SearchState, stop?: () => boolean): number {
  // Each change made gives the month one more shift: a trade keeps every person's shifts, a set
  // adds one, and a chain moves one and adds one. So no more changes are made than the month has
  // free empty cells, and the pass after the last change finds none: the loop ends.
  let made = 0;
  for (;;) {
    const pass = new Pass(st, stop);
    for (let a = 0; a < st.rows.length && !pass.stopped; a++) {
      if (st.ctx.people[a].fpd - st.statsOf(a).hours > FPD_TOLERANCE) pass.person(a);
    }
    if (pass.stopped || pass.plan.length === 0) return made;
    for (const m of pass.plan) {
      st.tryMove(m);
      st.commit();
    }
    made++;
  }
}
