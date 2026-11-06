import type { MonthContext } from '../domain/context';
import { search } from '../generator/search';
import type { SearchProgress, SearchResult } from '../generator/search';
// `?worker&inline` makes Vite put the worker's script in the page itself and start it from a blob:
// URL, so the single file works from disk, and under its policy (worker-src blob:).
import GeneratorWorker from './generator.worker?worker&inline';
import type { FromWorker, ToWorker } from './protocol';

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
 * either way. It rejects only if the run itself fails.
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

/** The part of a `Worker` that the runner uses, so that a test can put a fake in its place. */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

const WORKER_FAILED = 'The generator worker stopped unexpectedly.';
const WORKER_UNREADABLE = 'The generator worker sent a message that could not be read.';

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/**
 * A runner that searches in a worker made by `createWorker`: one worker for each run, which ends
 * with the run, however that goes. `result` rejects with an Error when the search fails in the
 * worker (`error`), when the worker script throws or cannot load, when a message of the worker
 * cannot be read, and when no worker can be made. The messages of these errors are English and for
 * the console: the screen says only that the run failed. An uncaught error of the worker script is
 * marked as handled (`preventDefault`), so that the browser does not log it to the page too.
 * `stop()` asks the worker to end the search at its next report, and the worker answers with its
 * best month, so `result` resolves as for any run.
 */
export function makeWorkerRunner(createWorker: () => WorkerLike): GeneratorRunner {
  return (input, onProgress) => {
    let worker: WorkerLike | undefined;
    let ended = false;
    const result = new Promise<SearchResult>((resolve, reject) => {
      /** Ends the run, once: the first way it ends counts, and the worker has no more to do. */
      const end = (settle: () => void): void => {
        if (ended) return;
        ended = true;
        if (worker !== undefined) {
          worker.onmessage = worker.onerror = worker.onmessageerror = null;
          worker.terminate();
        }
        settle();
      };
      try {
        worker = createWorker();
        worker.onmessage = ({ data }) => {
          if (data.type === 'progress') onProgress(data.progress);
          else if (data.type === 'done') end(() => resolve(data.result));
          else end(() => reject(new Error(data.message)));
        };
        worker.onerror = (event) => {
          // The error is the run's to report: the browser must not log it to the page as well.
          event.preventDefault();
          end(() => reject(new Error(event.message || WORKER_FAILED)));
        };
        worker.onmessageerror = () => end(() => reject(new Error(WORKER_UNREADABLE)));
        const { ctx, rows, fixed, seed, maxIterations, timeBudgetMs } = input;
        worker.postMessage({ type: 'run', ctx, rows, fixed, seed, maxIterations, timeBudgetMs });
      } catch (e) {
        end(() => reject(toError(e)));
      }
    });
    return {
      result,
      stop() {
        if (!ended) worker?.postMessage({ type: 'stop' });
      },
    };
  };
}

/** Runs the search in a Web Worker, so the page stays smooth during a long run. */
export const workerRunner: GeneratorRunner = makeWorkerRunner(() => new GeneratorWorker());
