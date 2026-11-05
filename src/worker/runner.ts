import type { MonthContext } from '../domain/context';
import { search } from '../generator/search';
import type { SearchProgress, SearchResult } from '../generator/search';

/** What a run needs: a month as `buildMonthGrid` gives it, a seed and how long to search. */
export interface GeneratorInput {
  ctx: MonthContext;
  rows: Uint8Array[];
  fixed: Uint8Array[];
  seed: number;
  /** The most iterations to run. Under a time budget it is only a safety cap. */
  maxIterations: number;
  timeBudgetMs: number;
}

/**
 * Starts a search for the best month. `onProgress` is called now and then while it runs. `stop()`
 * ends it at the next progress report, keeping the best month so far, so `result` resolves
 * either way.
 */
export type GeneratorRunner = (
  input: GeneratorInput,
  onProgress: (progress: SearchProgress) => void,
) => { result: Promise<SearchResult>; stop(): void };

/**
 * Runs the search on the page itself, between other work: the search lets the page breathe at
 * each progress report. It is for tests; a worker keeps the page smooth during a long run.
 */
export const inProcessRunner: GeneratorRunner = (input, onProgress) => {
  let stopped = false;
  const { ctx, rows, fixed, seed, maxIterations, timeBudgetMs } = input;
  const result = search(
    ctx,
    rows,
    fixed,
    { seed, maxIterations, timeBudgetMs, shouldStop: () => stopped },
    onProgress,
  );
  return {
    result,
    stop() {
      stopped = true;
    },
  };
};
