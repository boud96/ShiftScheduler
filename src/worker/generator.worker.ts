import { search } from '../generator/search';
import type { FromWorker, ToWorker } from './protocol';

// The script of the Web Worker that searches for a month off the page's thread (see runner.ts). It
// takes one `run` message, reports progress while the search goes on, and ends with `done` or
// `error`. A `stop` makes the search end at its next report, with the best month so far.

/**
 * Iterations between two progress reports. The search lets the worker read messages at each, with
 * setTimeout(0), which a browser clamps to at least 4 ms: a report every 2000 iterations (about
 * 10 ms of searching) would spend a third of the time waiting.
 */
const PROGRESS_EVERY = 20_000;

const post = (message: FromWorker): void => self.postMessage(message);

let started = false;
let stopRequested = false;

async function run(job: Extract<ToWorker, { type: 'run' }>): Promise<void> {
  try {
    const result = await search(
      job.ctx,
      job.rows,
      job.fixed,
      {
        seed: job.seed,
        maxIterations: job.maxIterations,
        timeBudgetMs: job.timeBudgetMs,
        progressEvery: PROGRESS_EVERY,
        shouldStop: () => stopRequested,
      },
      (progress) => post({ type: 'progress', progress }),
    );
    post({ type: 'done', result });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === 'stop') {
    stopRequested = true;
  } else if (!started) {
    // One worker, one run: the page starts a new worker for the next.
    started = true;
    void run(message);
  }
});
