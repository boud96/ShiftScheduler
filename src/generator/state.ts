import { Code } from '../domain/codes';
import type { MonthContext } from '../domain/context';
import { evaluateDay } from '../domain/rules/day';
import { evaluateGlobal } from '../domain/rules/global';
import { evaluatePerson } from '../domain/rules/person';
import type { DayStats, PersonStats } from '../domain/rules/types';
import type { Move } from './moves';

/**
 * A month being searched: its rows, and the score and the must units that `evaluateMonth` gives
 * them, kept up to date move by move.
 *
 * It caches the score and the stats of each person and of each day of the month, and the score of
 * the global wishes. `tryMove` writes the cells of a move, evaluates again only the people and the
 * days whose cells it changed, and then the global wishes, which compare everyone's stats. After
 * it, `commit` keeps the move or `revert` undoes it. The score is never accumulated from deltas:
 * it is the sum of the cached parts, added up in the order in which `evaluateMonth` adds them, so
 * it equals a full evaluation of the rows however many moves have been made.
 *
 * A move is checked before anything is written: one that would change a fixed cell or a day of
 * the previous month throws, and the month stays as it was.
 */
export class SearchState {
  readonly ctx: MonthContext;
  /** One row per person of `ctx.people`. Read them freely; only moves and `reset` change them. */
  readonly rows: Uint8Array[];
  /** 1 on each cell that no move may change, as in `buildMonthGrid`. */
  readonly fixed: Uint8Array[];
  /** 1 on each day of `ctx.days` whose type is weekday, 0 on each 12-hour day. */
  readonly weekdayType: Uint8Array;

  private readonly first: number;
  private readonly people: number;
  private readonly monthDays: number;

  // The cached parts of the score. A day's index here counts from day 1 of the month.
  private readonly personScores: Float64Array;
  private readonly personStats: PersonStats[];
  private readonly dayScores: Float64Array;
  private readonly dayStats: DayStats[];
  private globalScore = 0;
  private total = 0;
  private units = 0;

  // The move in hand: the cells it wrote, with their old codes, and the cached parts it replaced.
  private pending = false;
  private changes = 0;
  private readonly changedPerson: Int32Array;
  private readonly changedDay: Int32Array;
  private readonly oldCode: Uint8Array;
  private touchedPersons = 0;
  private readonly touchedPerson: Int32Array;
  private readonly oldPersonScore: Float64Array;
  private readonly oldPersonStats: PersonStats[];
  private touchedDays = 0;
  private readonly touchedDay: Int32Array;
  private readonly oldDayScore: Float64Array;
  private readonly oldDayStats: DayStats[];
  private oldGlobalScore = 0;

  /** Copies `rows`. `fixed` is kept as it is, and must not change while the state is in use. */
  constructor(ctx: MonthContext, rows: Uint8Array[], fixed: Uint8Array[]) {
    const n = ctx.days.length;
    if (
      rows.length !== ctx.people.length ||
      fixed.length !== rows.length ||
      rows.some((row) => row.length !== n) ||
      fixed.some((row) => row.length !== n)
    ) {
      throw new Error('SearchState: rows and fixed need a row per person and a cell per day');
    }
    this.ctx = ctx;
    this.rows = rows.map((row) => row.slice());
    this.fixed = fixed;
    this.weekdayType = Uint8Array.from(ctx.days, (day) => (day.dayType === 'weekday' ? 1 : 0));
    this.first = ctx.first;
    this.people = rows.length;
    this.monthDays = n - ctx.first;

    this.personScores = new Float64Array(this.people);
    this.personStats = new Array<PersonStats>(this.people);
    this.dayScores = new Float64Array(this.monthDays);
    this.dayStats = new Array<DayStats>(this.monthDays);

    // A swap of two rows over the whole month writes the most cells: two for each day.
    this.changedPerson = new Int32Array(2 * n);
    this.changedDay = new Int32Array(2 * n);
    this.oldCode = new Uint8Array(2 * n);
    this.touchedPerson = new Int32Array(this.people);
    this.oldPersonScore = new Float64Array(this.people);
    this.oldPersonStats = new Array<PersonStats>(this.people);
    this.touchedDay = new Int32Array(this.monthDays);
    this.oldDayScore = new Float64Array(this.monthDays);
    this.oldDayStats = new Array<DayStats>(this.monthDays);

    this.evaluateAll();
  }

  /** The score of the rows as they are now, the move in hand included. */
  get score(): number {
    return this.total;
  }

  /** The must units of the rows as they are now, the move in hand included. */
  get mustUnits(): number {
    return this.units;
  }

  /** The stats of person `p` for the rows as they are now. Read them only. */
  statsOf(p: number): Readonly<PersonStats> {
    return this.personStats[p];
  }

  /**
   * Makes move `m` and returns how much it changed the score (negative: better). The move stays
   * in hand until `commit` or `revert`; no other move can be tried before.
   */
  tryMove(m: Move): number {
    if (this.pending) throw new Error('SearchState: commit or revert the move in hand first');
    const before = this.total;

    // A swap leaves every day with the same codes, only held by other people, so the score of
    // the day (M1, which counts its codes) cannot change: only the people are evaluated again.
    switch (m.kind) {
      case 'swapDay':
        this.check(m.p, m.d);
        this.check(m.q, m.d);
        this.swap(m.p, m.q, m.d);
        this.touchPerson(m.p);
        this.touchPerson(m.q);
        break;
      case 'set':
        this.check(m.p, m.d);
        this.write(m.p, m.d, m.code);
        this.touchPerson(m.p);
        this.touchDay(m.d);
        break;
      case 'swapRange':
        for (let i = m.d; i < m.d + m.len; i++) {
          this.check(m.p, i);
          this.check(m.q, i);
        }
        for (let i = m.d; i < m.d + m.len; i++) this.swap(m.p, m.q, i);
        this.touchPerson(m.p);
        this.touchPerson(m.q);
        break;
      case 'shiftMove': {
        this.check(m.p, m.from);
        this.check(m.p, m.to);
        const code = this.rows[m.p][m.from];
        this.write(m.p, m.from, Code.EMPTY);
        this.write(m.p, m.to, code);
        this.touchPerson(m.p);
        this.touchDay(m.from);
        this.touchDay(m.to);
        break;
      }
    }

    this.pending = true;
    this.rescore();
    return this.total - before;
  }

  /** Keeps the move in hand. */
  commit(): void {
    if (!this.pending) throw new Error('SearchState: there is no move to commit');
    this.forget();
  }

  /** Undoes the move in hand: the cells and the score are as they were before it. */
  revert(): void {
    if (!this.pending) throw new Error('SearchState: there is no move to revert');
    // Backwards, so that a cell written twice gets the code it had first.
    for (let k = this.changes - 1; k >= 0; k--) {
      this.rows[this.changedPerson[k]][this.changedDay[k]] = this.oldCode[k];
    }
    for (let k = 0; k < this.touchedPersons; k++) {
      const p = this.touchedPerson[k];
      this.personScores[p] = this.oldPersonScore[k];
      this.personStats[p] = this.oldPersonStats[k];
    }
    for (let k = 0; k < this.touchedDays; k++) {
      const i = this.touchedDay[k];
      this.dayScores[i] = this.oldDayScore[k];
      this.dayStats[i] = this.oldDayStats[k];
    }
    this.globalScore = this.oldGlobalScore;
    this.forget();
    this.sum();
  }

  /** Copies `rows` (a snapshot of this month) over the rows, and evaluates them afresh. */
  reset(rows: Uint8Array[]): void {
    for (let p = 0; p < this.people; p++) this.rows[p].set(rows[p]);
    this.forget();
    this.evaluateAll();
  }

  /** A copy of the rows. Given `into`, it copies the rows into those arrays and returns them. */
  snapshot(into?: Uint8Array[]): Uint8Array[] {
    if (into === undefined) return this.rows.map((row) => row.slice());
    for (let p = 0; p < this.people; p++) into[p].set(this.rows[p]);
    return into;
  }

  /** Throws unless a move may change the cell of person `p` on day `d`. */
  private check(p: number, d: number): void {
    if (d < this.first || d >= this.rows[p].length || this.fixed[p][d] !== 0) {
      throw new Error(`SearchState: the cell of person ${p} on day ${d} may not change`);
    }
  }

  /** Writes `code` into a cell, and remembers the code it held. */
  private write(p: number, d: number, code: number): void {
    const k = this.changes++;
    this.changedPerson[k] = p;
    this.changedDay[k] = d;
    this.oldCode[k] = this.rows[p][d];
    this.rows[p][d] = code;
  }

  private swap(p: number, q: number, d: number): void {
    const a = this.rows[p][d];
    this.write(p, d, this.rows[q][d]);
    this.write(q, d, a);
  }

  /** Marks person `p` for evaluation, and remembers their cached score and stats. */
  private touchPerson(p: number): void {
    for (let k = 0; k < this.touchedPersons; k++) if (this.touchedPerson[k] === p) return;
    const k = this.touchedPersons++;
    this.touchedPerson[k] = p;
    this.oldPersonScore[k] = this.personScores[p];
    this.oldPersonStats[k] = this.personStats[p];
  }

  /** Marks day `d` (an index in `ctx.days`) for evaluation, and remembers its cached parts. */
  private touchDay(d: number): void {
    const i = d - this.first;
    for (let k = 0; k < this.touchedDays; k++) if (this.touchedDay[k] === i) return;
    const k = this.touchedDays++;
    this.touchedDay[k] = i;
    this.oldDayScore[k] = this.dayScores[i];
    this.oldDayStats[k] = this.dayStats[i];
  }

  /** Evaluates the touched people and days again, then the global wishes, and adds up. */
  private rescore(): void {
    const { ctx, rows } = this;
    for (let k = 0; k < this.touchedPersons; k++) {
      const p = this.touchedPerson[k];
      const result = evaluatePerson(ctx, p, rows[p]);
      this.personScores[p] = result.score;
      this.personStats[p] = result.stats;
    }
    for (let k = 0; k < this.touchedDays; k++) {
      const i = this.touchedDay[k];
      const result = evaluateDay(ctx, this.first + i, rows);
      this.dayScores[i] = result.score;
      this.dayStats[i] = result.stats;
    }
    this.oldGlobalScore = this.globalScore;
    this.globalScore = evaluateGlobal(ctx, this.personStats, this.dayStats);
    this.sum();
  }

  private evaluateAll(): void {
    const { ctx, rows } = this;
    for (let p = 0; p < this.people; p++) {
      const result = evaluatePerson(ctx, p, rows[p]);
      this.personScores[p] = result.score;
      this.personStats[p] = result.stats;
    }
    for (let i = 0; i < this.monthDays; i++) {
      const result = evaluateDay(ctx, this.first + i, rows);
      this.dayScores[i] = result.score;
      this.dayStats[i] = result.stats;
    }
    this.globalScore = evaluateGlobal(ctx, this.personStats, this.dayStats);
    this.sum();
  }

  /** Adds up the cached parts as `evaluateMonth` does: the people, then the days, then the rest. */
  private sum(): void {
    let score = 0;
    let units = 0;
    for (let p = 0; p < this.people; p++) {
      score += this.personScores[p];
      units += this.personStats[p].mustUnits;
    }
    for (let i = 0; i < this.monthDays; i++) {
      score += this.dayScores[i];
      units += this.dayStats[i].mustUnits;
    }
    this.total = score + this.globalScore;
    this.units = units;
  }

  /** Drops the record of the move in hand. */
  private forget(): void {
    this.pending = false;
    this.changes = 0;
    this.touchedPersons = 0;
    this.touchedDays = 0;
  }
}
