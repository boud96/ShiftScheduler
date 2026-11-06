import { describe, expect, it, vi } from 'vitest';
import { buildMonthGrid } from '../domain/context';
import { newAppData } from '../domain/defaults';
import type { SearchProgress, SearchResult } from '../generator/search';
import { syntheticTeam } from '../test/team';
import type { FromWorker, ToWorker } from './protocol';
import { inProcessRunner, makeWorkerRunner, workerRunner } from './runner';
import type { GeneratorInput, WorkerLike } from './runner';

/** The input of a run over January 2027 with the made-up team. */
function input(overrides: Partial<GeneratorInput> = {}): GeneratorInput {
  const data = newAppData();
  data.people = syntheticTeam();
  const { ctx, rows, fixed } = buildMonthGrid(data, '2027-01');
  return { ctx, rows, fixed, seed: 1, maxIterations: 6000, timeBudgetMs: 5000, ...overrides };
}

describe('inProcessRunner', () => {
  it('resolves with the best month it found: a row per person, a cell per day', async () => {
    const given = input();
    const { result } = inProcessRunner(given, () => undefined);
    const found = await result;
    expect(found.rows).toHaveLength(given.rows.length);
    for (const row of found.rows) expect(row).toHaveLength(given.ctx.days.length);
    expect(found.iterations).toBe(6000);
  });

  it('reports progress as it goes', async () => {
    const seen: SearchProgress[] = [];
    await inProcessRunner(input(), (p) => seen.push(p)).result;
    expect(seen.map((p) => p.iteration)).toEqual([2000, 4000, 6000]);
    for (const p of seen) expect(p.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('stops at the next report on stop(), and still returns the best month', async () => {
    const seen: SearchProgress[] = [];
    const run = inProcessRunner(
      input({ maxIterations: 50_000_000, timeBudgetMs: 20_000 }),
      (p) => {
        seen.push(p);
        run.stop();
      },
    );
    const found = await run.result;
    expect(seen).toHaveLength(1);
    expect(found.iterations).toBe(2000);
    expect(found.rows).toHaveLength(8);
  });

  it('stops at the first report when it is stopped before it starts', async () => {
    const run = inProcessRunner(
      input({ maxIterations: 50_000_000, timeBudgetMs: 20_000 }),
      () => undefined,
    );
    run.stop();
    expect((await run.result).iterations).toBe(2000);
  });

  it('keeps the rows it was given as they were', async () => {
    const given = input();
    const before = given.rows.map((row) => Array.from(row));
    await inProcessRunner(given, () => undefined).result;
    expect(given.rows.map((row) => Array.from(row))).toEqual(before);
  });
});

/** An error event as far as the runner reads it: the message, and `preventDefault` to be watched. */
function errorEvent(message: string) {
  return { message, preventDefault: vi.fn() };
}

/** A worker that does nothing by itself: a test plays its script by calling `emit` and the like. */
class FakeWorker implements WorkerLike {
  readonly sent: ToWorker[] = [];
  terminated = 0;
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  onmessageerror: WorkerLike['onmessageerror'] = null;

  postMessage(message: ToWorker): void {
    this.sent.push(message);
  }

  terminate(): void {
    this.terminated++;
  }

  /** The worker script posts a message. */
  emit(message: FromWorker): void {
    this.onmessage?.({ data: message } as MessageEvent<FromWorker>);
  }

  /** The worker script throws, or fails to load. Returns the event that the browser makes of it. */
  crash(message: string) {
    const event = errorEvent(message);
    this.onerror?.(event as unknown as ErrorEvent);
    return event;
  }

  /** The browser cannot read what the worker posted. */
  garble(): void {
    this.onmessageerror?.({} as MessageEvent);
  }
}

const progress = (iteration: number): SearchProgress => ({
  iteration,
  bestScore: 10,
  bestMustUnits: 0,
  elapsedMs: iteration / 10,
  temperature: 30,
});

const found: SearchResult = {
  rows: [new Uint8Array([1, 2, 3])],
  score: 5,
  mustUnits: 2,
  iterations: 90,
};

/** A runner over fake workers, and the workers it made, in order. */
function fakeRunner() {
  const workers: FakeWorker[] = [];
  const runner = makeWorkerRunner(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { runner, workers };
}

/** What `result` came to, without failing the test on a rejection that nobody has awaited yet. */
const settled = (promise: Promise<SearchResult>) =>
  promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

describe('makeWorkerRunner', () => {
  it('starts a worker for each run and sends it the run', () => {
    const { runner, workers } = fakeRunner();
    const given = input({ seed: 9, maxIterations: 777, timeBudgetMs: 1234 });
    runner(given, () => undefined);
    expect(workers).toHaveLength(1);
    expect(workers[0].sent).toEqual([
      {
        type: 'run',
        ctx: given.ctx,
        rows: given.rows,
        fixed: given.fixed,
        seed: 9,
        maxIterations: 777,
        timeBudgetMs: 1234,
      },
    ]);

    runner(input(), () => undefined);
    expect(workers).toHaveLength(2); // one worker per run, never reused
    expect(workers[1].sent).toHaveLength(1);
  });

  it('passes progress on as it comes', () => {
    const { runner, workers } = fakeRunner();
    const seen: SearchProgress[] = [];
    runner(input(), (p) => seen.push(p));
    workers[0].emit({ type: 'progress', progress: progress(20_000) });
    workers[0].emit({ type: 'progress', progress: progress(40_000) });
    expect(seen).toEqual([progress(20_000), progress(40_000)]);
    expect(workers[0].terminated).toBe(0); // still running
  });

  it('resolves with the result on done, and ends the worker', async () => {
    const { runner, workers } = fakeRunner();
    const { result } = runner(input(), () => undefined);
    workers[0].emit({ type: 'done', result: found });
    await expect(result).resolves.toBe(found);
    expect(workers[0].terminated).toBe(1);
  });

  it('stop() tells the worker to stop, and the worker answers with its best month', async () => {
    const { runner, workers } = fakeRunner();
    const run = runner(input(), () => undefined);
    run.stop();
    expect(workers[0].sent.at(-1)).toEqual({ type: 'stop' });
    expect(workers[0].terminated).toBe(0); // it has to answer first
    workers[0].emit({ type: 'done', result: found });
    await expect(run.result).resolves.toBe(found);
    expect(workers[0].terminated).toBe(1);
  });

  it('does nothing on stop() once the run has ended', async () => {
    const { runner, workers } = fakeRunner();
    const run = runner(input(), () => undefined);
    workers[0].emit({ type: 'done', result: found });
    await run.result;
    run.stop();
    expect(workers[0].sent).toHaveLength(1); // the run, and no stop
    expect(workers[0].terminated).toBe(1);
  });

  it('takes no more messages once the run has ended', async () => {
    const { runner, workers } = fakeRunner();
    const seen: SearchProgress[] = [];
    const run = runner(input(), (p) => seen.push(p));
    workers[0].emit({ type: 'done', result: found });
    workers[0].emit({ type: 'progress', progress: progress(1) });
    workers[0].emit({ type: 'error', message: 'late' });
    await expect(run.result).resolves.toBe(found);
    expect(seen).toEqual([]);
    expect(workers[0].terminated).toBe(1);
  });

  describe('when the run fails', () => {
    it('rejects with the message the worker sends, and ends the worker', async () => {
      const { runner, workers } = fakeRunner();
      const run = runner(input(), () => undefined);
      workers[0].emit({ type: 'error', message: 'boom' });
      const outcome = await settled(run.result);
      expect(outcome).toEqual({ error: expect.any(Error) });
      expect((outcome as { error: Error }).error.message).toBe('boom');
      expect(workers[0].terminated).toBe(1);
    });

    it('rejects when the worker script throws or cannot load, with what the browser says', async () => {
      const { runner, workers } = fakeRunner();
      const run = runner(input(), () => undefined);
      workers[0].crash('Uncaught Error: broken');
      const outcome = await settled(run.result);
      expect((outcome as { error: Error }).error).toBeInstanceOf(Error);
      expect((outcome as { error: Error }).error.message).toBe('Uncaught Error: broken');
      expect(workers[0].terminated).toBe(1);
    });

    it('marks the error as handled, so that the browser does not log it a second time', async () => {
      const { runner, workers } = fakeRunner();
      const run = runner(input(), () => undefined);
      const event = workers[0].crash('Uncaught Error: boom');
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      await settled(run.result);
    });

    it('leaves an error event alone that comes once the run has ended', async () => {
      const { runner, workers } = fakeRunner();
      const run = runner(input(), () => undefined);
      workers[0].emit({ type: 'error', message: 'the search failed' }); // the script's own report
      await settled(run.result);
      const late = workers[0].crash('late'); // the run is over, and the handler is gone
      expect(late.preventDefault).not.toHaveBeenCalled();
    });

    it('rejects with a message of its own when the browser gives none', async () => {
      const { runner, workers } = fakeRunner();
      const run = runner(input(), () => undefined);
      workers[0].crash('');
      const outcome = (await settled(run.result)) as { error: Error };
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error.message).not.toBe('');
    });

    it('rejects when a message of the worker cannot be read', async () => {
      const { runner, workers } = fakeRunner();
      const run = runner(input(), () => undefined);
      workers[0].garble();
      const outcome = (await settled(run.result)) as { error: Error };
      expect(outcome.error).toBeInstanceOf(Error);
      expect(workers[0].terminated).toBe(1);
    });

    it('ends the worker once, however many ways the run fails', async () => {
      const { runner, workers } = fakeRunner();
      const run = runner(input(), () => undefined);
      workers[0].emit({ type: 'error', message: 'first' });
      workers[0].crash('second');
      workers[0].garble();
      const outcome = (await settled(run.result)) as { error: Error };
      expect(outcome.error.message).toBe('first');
      expect(workers[0].terminated).toBe(1);
    });

    it('ignores an event that was already on its way when the run ended', async () => {
      const { runner, workers } = fakeRunner();
      const run = runner(input(), () => undefined);
      const { onmessage, onerror, onmessageerror } = workers[0];
      workers[0].emit({ type: 'done', result: found });
      // The worker has been let go, but the browser may still hand over what it had in flight.
      onmessage?.({ data: { type: 'error', message: 'late' } } as MessageEvent<FromWorker>);
      onerror?.(errorEvent('late') as unknown as ErrorEvent);
      onmessageerror?.({} as MessageEvent);
      await expect(run.result).resolves.toBe(found);
      expect(workers[0].terminated).toBe(1);
    });

    it('rejects, and ends the worker, when the run cannot be sent to it', async () => {
      const worker = new FakeWorker();
      worker.postMessage = () => {
        throw new DOMException('Could not be cloned.', 'DataCloneError');
      };
      const run = makeWorkerRunner(() => worker)(input(), () => undefined);
      const outcome = (await settled(run.result)) as { error: Error };
      expect(outcome.error.message).toContain('Could not be cloned.');
      expect(worker.terminated).toBe(1);
    });

    it('makes an Error of a failure that is not one', async () => {
      const runner = makeWorkerRunner(() => {
        throw 'no worker here';
      });
      const outcome = (await settled(runner(input(), () => undefined).result)) as { error: Error };
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error.message).toBe('no worker here');
    });

    it('rejects, rather than throws, when no worker can be made', async () => {
      const runner = makeWorkerRunner(() => {
        throw new DOMException('Blocked by policy.', 'SecurityError');
      });
      const run = runner(input(), () => undefined);
      const outcome = (await settled(run.result)) as { error: Error };
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error.message).toContain('Blocked by policy.');
      expect(() => run.stop()).not.toThrow();
    });
  });

  it('keeps the rows it was given as they were', () => {
    const { runner, workers } = fakeRunner();
    const given = input();
    const before = given.rows.map((row) => Array.from(row));
    runner(given, () => undefined);
    workers[0].emit({ type: 'done', result: found });
    expect(given.rows.map((row) => Array.from(row))).toEqual(before);
  });
});

describe('workerRunner', () => {
  it('is there to be used, and makes no worker until a run starts', () => {
    // Under test there is no Worker at all: building the module must not have needed one.
    expect(workerRunner).toBeTypeOf('function');
    expect(workerRunner).toHaveLength(2);
  });
});
