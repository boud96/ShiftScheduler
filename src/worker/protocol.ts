import type { MonthContext } from '../domain/context';
import type { SearchProgress, SearchResult } from '../generator/search';

/** What the page sends to a generator worker. The worker is for one run. */
export type ToWorker =
  | {
      type: 'run';
      ctx: MonthContext;
      rows: Uint8Array[];
      fixed: Uint8Array[];
      seed: number;
      maxIterations: number;
      timeBudgetMs: number;
    }
  /** Ends the run at its next progress report, keeping the best month so far. */
  | { type: 'stop' };

/**
 * What a generator worker sends back: any number of `progress` messages, then `done` with the best
 * month found (also after a `stop`) or, if the search failed, `error`.
 */
export type FromWorker =
  | { type: 'progress'; progress: SearchProgress }
  | { type: 'done'; result: SearchResult }
  | { type: 'error'; message: string };
