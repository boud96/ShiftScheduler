import type { MonthContext } from '../domain/context';
import { construct } from './construct';
import { proposeMove } from './moves';
import { mulberry32 } from './rng';
import { SearchState } from './state';

export interface SearchOptions {
  /**
   * The seed of the random numbers. Without a time budget, the same inputs, seed and
   * `maxIterations` give the same result.
   */
  seed: number;
  /**
   * The most iterations (one move tried each) to run, over all the segments together. Without a
   * time budget it sets the length of every segment. With one it is only a safety cap: give it
   * well above what the budget allows, or the search stops before its segments have cooled.
   */
  maxIterations: number;
  /**
   * The time the search may take, in milliseconds. With it the segments are timed: each gets its
   * share of the time and cools by the clock, and `maxIterations` only caps the run. Without it
   * they are counted in iterations.
   */
  timeBudgetMs?: number;
  /**
   * How many segments the search is split into (default 6); see `search`. A value that is not a
   * whole number of at least 1 once rounded down (0, NaN, Infinity) gives the default.
   */
  restarts?: number;
  /**
   * Iterations between two progress reports (default 2000). A value that is not a whole number of
   * at least 1 once rounded down (0, NaN, Infinity) gives the default.
   */
  progressEvery?: number;
  /** Asked after each progress report: true stops the search, keeping the best month so far. */
  shouldStop?: () => boolean;
}

export interface SearchProgress {
  /** Iterations done so far. */
  iteration: number;
  /** The score of the best month so far. */
  bestScore: number;
  /** The must units of the best month so far. */
  bestMustUnits: number;
  /** Milliseconds since the search started. */
  elapsedMs: number;
  /** The temperature at this point of the current segment, which falls from 60 to 0.3. */
  temperature: number;
}

export interface SearchResult {
  /** The best month found: a row per person of `ctx.people`, a cell per day of `ctx.days`. */
  rows: Uint8Array[];
  /** Its score, as `evaluateMonth` gives it. */
  score: number;
  /** Its must units, as `evaluateMonth` gives them. */
  mustUnits: number;
  /** Iterations done. */
  iterations: number;
}

/**
 * Segments of the search, unless the options say otherwise. Most of what a segment gains, it
 * gains while still hot, and a longer segment spends more of its time cold: at 300,000
 * iterations, 6 segments did better on the scenario months than 4, 5 or 8.
 */
const RESTARTS = 6;
/** Iterations between two progress reports, unless the options say otherwise. */
const PROGRESS_EVERY = 2000;
/**
 * The temperature at the start of each segment, and the one it has cooled down to by its end.
 * `proposeMove` skips moves that break a must that costs HARD because exp(-HARD / 2 / T) is 0 at
 * these temperatures: a much hotter start would have to be checked against that.
 */
const START_TEMPERATURE = 60;
const END_TEMPERATURE = 0.3;
/** With a time budget, the clock is read every this many iterations and at each report. */
const CLOCK_EVERY = 256;

/**
 * The temperature once `fraction` of a segment has passed, of its iterations or of its time. It
 * falls geometrically from START_TEMPERATURE at 0 to END_TEMPERATURE at 1, and stays there.
 */
function temperature(fraction: number): number {
  if (!(fraction < 1)) return END_TEMPERATURE;
  return START_TEMPERATURE * Math.pow(END_TEMPERATURE / START_TEMPERATURE, fraction);
}

/**
 * `value` rounded down, or `fallback` if that is not a finite number of at least 1. A count of
 * NaN or Infinity would otherwise make a loop that never yields, or one that never ends.
 */
function wholeCount(value: number | undefined, fallback: number): number {
  const count = Math.floor(value ?? fallback);
  return Number.isFinite(count) && count >= 1 ? count : fallback;
}

/** Lets other work run first, such as a worker taking in a message to stop. */
function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Searches for the month with the lowest score by simulated annealing, starting from `rows` (which
 * it leaves as they are), and returns the best month it finds. It never changes a fixed cell, and
 * never breaks a must that costs HARD: `construct` makes no such move, and the annealing keeps
 * none. A shift left uncovered (M1) or hours below FPD (M6) cost far more than any wish, so it
 * leaves one only where it finds no way around it.
 *
 * It runs in `restarts` segments. The first starts from the draft `construct` builds, each later
 * one from the best month so far. In each segment the temperature T falls from 60 to 0.3. A move
 * that makes the score worse by `delta` is kept with probability exp(-delta / T), any other
 * always; exp(-HARD / 60) is 0, so a move that costs HARD is never kept.
 *
 * - Without a time budget, each segment runs its share of `maxIterations`, and T follows the
 *   iterations done in it. The result then depends only on the inputs, the seed and
 *   `maxIterations`.
 * - With a time budget, the segments share in equal parts the time that `construct` has left,
 *   and T follows the time passed in the segment, read from the clock every CLOCK_EVERY
 *   iterations and at each progress report. A segment ends when its time is up, and the search
 *   when the last one does, or after `maxIterations` in all.
 *
 * Every `progressEvery` iterations it lets other work run, reports progress, and stops if
 * `shouldStop` says so or the time budget has run out.
 */
export async function search(
  ctx: MonthContext,
  rows: Uint8Array[],
  fixed: Uint8Array[],
  opts: SearchOptions,
  onProgress?: (progress: SearchProgress) => void,
): Promise<SearchResult> {
  const started = performance.now();
  const restarts = wholeCount(opts.restarts, RESTARTS);
  const progressEvery = wholeCount(opts.progressEvery, PROGRESS_EVERY);
  // Infinity is cut to a number the segments can be counted with; NaN counts as none.
  const iterations =
    Math.min(Math.max(Math.floor(opts.maxIterations), 0), Number.MAX_SAFE_INTEGER) || 0;
  // A budget that is not a finite number (Infinity) is no budget.
  const budget = Number.isFinite(opts.timeBudgetMs) ? opts.timeBudgetMs : undefined;
  const rnd = mulberry32(opts.seed);

  const st = new SearchState(ctx, rows, fixed);
  construct(st, rnd);
  const best = st.snapshot();
  let bestScore = st.score;
  let bestMustUnits = st.mustUnits;
  let done = 0;
  const result = (): SearchResult => ({
    rows: best,
    score: bestScore,
    mustUnits: bestMustUnits,
    iterations: done,
  });

  // With a time budget, segment k has the time from k to k + 1 times `segmentMs` after `begin`.
  const begin = performance.now();
  const segmentMs = budget === undefined ? 0 : Math.max(0, budget - (begin - started)) / restarts;

  for (let k = 0; k < restarts && done < iterations; k++) {
    if (k > 0) st.reset(best);
    const from = begin + k * segmentMs;
    // The iterations the segment may run: without a time budget its share, with one all that are
    // left, since its time ends it.
    const len =
      budget === undefined
        ? Math.floor(((k + 1) * iterations) / restarts) - Math.floor((k * iterations) / restarts)
        : iterations - done;
    let fraction = 0; // how much of the segment has passed: of its iterations, or of its time
    for (let i = 0; i < len; i++) {
      if (budget === undefined) fraction = i / len;
      else if (i % CLOCK_EVERY === 0) fraction = (performance.now() - from) / segmentMs;
      if (!(fraction < 1)) break; // the segment's time is up
      const move = proposeMove(st, rnd);
      if (move !== null) {
        const delta = st.tryMove(move);
        if (delta <= 0 || rnd() < Math.exp(-delta / temperature(fraction))) {
          st.commit();
          if (st.score < bestScore) {
            bestScore = st.score;
            bestMustUnits = st.mustUnits;
            st.snapshot(best);
          }
        } else {
          st.revert();
        }
      }

      done++;
      if (done % progressEvery === 0) {
        await pause();
        const now = performance.now();
        if (budget !== undefined) fraction = (now - from) / segmentMs;
        const elapsedMs = now - started;
        onProgress?.({
          iteration: done,
          bestScore,
          bestMustUnits,
          elapsedMs,
          temperature: temperature(fraction),
        });
        const outOfTime = budget !== undefined && elapsedMs >= budget;
        if (opts.shouldStop?.() === true || outOfTime) return result();
      }
    }
  }
  return result();
}
