import type { MonthContext } from '../domain/context';
import { construct } from './construct';
import { proposeMove } from './moves';
import { mulberry32 } from './rng';
import { SearchState } from './state';

export interface SearchOptions {
  /** The seed of the random numbers. The same inputs, seed and iterations give the same result. */
  seed: number;
  /** How many iterations (one move tried each) to run, over all the segments together. */
  maxIterations: number;
  /** Stop once this many milliseconds have passed, keeping the best month so far. */
  timeBudgetMs?: number;
  /** How many segments the iterations are split into (default 4); see `search`. */
  restarts?: number;
  /** Iterations between two progress reports (default 2000). */
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

/** Segments of the search, unless the options say otherwise. */
const RESTARTS = 4;
/** Iterations between two progress reports, unless the options say otherwise. */
const PROGRESS_EVERY = 2000;
/** The temperature at the start of each segment, and the one it has cooled down to by its end. */
const START_TEMPERATURE = 60;
const END_TEMPERATURE = 0.3;

/** The temperature after `i` of the `len` iterations of a segment: it falls geometrically. */
function temperature(i: number, len: number): number {
  return START_TEMPERATURE * Math.pow(END_TEMPERATURE / START_TEMPERATURE, i / len);
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
 * The iterations are split into `restarts` segments. The first starts from the draft `construct`
 * builds, each later one from the best month so far. In each segment the temperature T falls from
 * 60 to 0.3. A move that makes the score worse by `delta` is kept with probability exp(-delta / T),
 * any other always; exp(-HARD / 60) is 0, so a move that costs HARD is never kept.
 *
 * Every `progressEvery` iterations it lets other work run, reports progress, and stops if
 * `shouldStop` says so or the time budget has run out. Without a time budget the result depends
 * only on the inputs, the seed and `maxIterations`.
 */
export async function search(
  ctx: MonthContext,
  rows: Uint8Array[],
  fixed: Uint8Array[],
  opts: SearchOptions,
  onProgress?: (progress: SearchProgress) => void,
): Promise<SearchResult> {
  const started = performance.now();
  const restarts = Math.max(1, Math.floor(opts.restarts ?? RESTARTS));
  const progressEvery = Math.max(1, Math.floor(opts.progressEvery ?? PROGRESS_EVERY));
  // Infinity is cut to a number the segments can be counted with; NaN counts as none.
  const iterations =
    Math.min(Math.max(Math.floor(opts.maxIterations), 0), Number.MAX_SAFE_INTEGER) || 0;
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

  for (let k = 0; k < restarts; k++) {
    if (k > 0) st.reset(best);
    const len =
      Math.floor(((k + 1) * iterations) / restarts) - Math.floor((k * iterations) / restarts);
    for (let i = 0; i < len; i++) {
      const move = proposeMove(st, rnd);
      if (move !== null) {
        const delta = st.tryMove(move);
        if (delta <= 0 || rnd() < Math.exp(-delta / temperature(i, len))) {
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
        const elapsedMs = performance.now() - started;
        onProgress?.({ iteration: done, bestScore, bestMustUnits, elapsedMs });
        const outOfTime = opts.timeBudgetMs !== undefined && elapsedMs >= opts.timeBudgetMs;
        if (opts.shouldStop?.() === true || outOfTime) return result();
      }
    }
  }
  return result();
}
