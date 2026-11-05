import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMonthGrid } from '../domain/context';
import { newAppData } from '../domain/defaults';
import type { SearchOptions, SearchProgress, SearchResult } from '../generator/search';
import { syntheticTeam } from '../test/team';
import type { FromWorker, ToWorker } from './protocol';

type Run = Extract<ToWorker, { type: 'run' }>;

/** What the worker script sees as `self`: the page's messages come in, its own go out. */
class FakeScope {
  readonly posted: FromWorker[] = [];
  private listener: ((event: { data: ToWorker }) => void) | null = null;
  private wake: Array<() => void> = [];

  addEventListener(type: string, listener: (event: { data: ToWorker }) => void): void {
    if (type === 'message') this.listener = listener;
  }

  postMessage(message: FromWorker): void {
    this.posted.push(message);
    for (const wake of this.wake.splice(0)) wake();
  }

  /** The page sends a message, as the browser would deliver it to the worker. */
  send(message: ToWorker): void {
    this.listener?.({ data: message });
  }

  /** Resolves with the message that ends the run: the first one that is not a progress report. */
  async ended(): Promise<FromWorker> {
    for (;;) {
      const end = this.posted.find((message) => message.type !== 'progress');
      if (end !== undefined) return end;
      await new Promise<void>((resolve) => this.wake.push(resolve));
    }
  }
}

/** A run over January 2027 with the made-up team. */
function run(overrides: Partial<Run> = {}): Run {
  const data = newAppData();
  data.people = syntheticTeam();
  const { ctx, rows, fixed } = buildMonthGrid(data, '2027-01');
  return {
    type: 'run',
    ctx,
    rows,
    fixed,
    seed: 1,
    maxIterations: 40_000,
    timeBudgetMs: 60_000,
    ...overrides,
  };
}

/** Loads the worker script afresh, as a new worker would, with `self` standing in for its scope. */
async function startWorker(): Promise<FakeScope> {
  vi.resetModules();
  const scope = new FakeScope();
  vi.stubGlobal('self', scope);
  await import('./generator.worker');
  return scope;
}

type Report = (progress: SearchProgress) => void;

/** The search the worker calls, replaced by one that records its calls. */
function mockSearch(impl?: (opts: SearchOptions, onProgress?: Report) => Promise<SearchResult>) {
  const search = vi.fn(
    async (
      _ctx: unknown,
      rows: Uint8Array[],
      _fixed: unknown,
      opts: SearchOptions,
      onProgress?: Report,
    ): Promise<SearchResult> =>
      impl === undefined
        ? { rows, score: 0, mustUnits: 0, iterations: 0 }
        : impl(opts, onProgress),
  );
  vi.doMock('../generator/search', () => ({ search }));
  return search;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../generator/search');
  vi.resetModules();
});

describe('the generator worker, with the real search', () => {
  it('searches what it is sent: a report every 20000 iterations, then the best month', async () => {
    const scope = await startWorker();
    const given = run();
    scope.send(given);
    const end = await scope.ended();

    const reports = scope.posted.flatMap((m) => (m.type === 'progress' ? [m.progress] : []));
    expect(reports.map((progress) => progress.iteration)).toEqual([20_000, 40_000]);
    expect(end.type).toBe('done');
    if (end.type !== 'done') return;
    expect(end.result.iterations).toBe(40_000);
    expect(end.result.rows).toHaveLength(given.rows.length);
    for (const row of end.result.rows) expect(row).toHaveLength(given.ctx.days.length);
    expect(Number.isInteger(end.result.mustUnits)).toBe(true);
  }, 30_000);

  it('stops at its next report when it is told to, and still sends the best month', async () => {
    const scope = await startWorker();
    // The search runs up to its first report before the worker can read another message.
    scope.send(run({ maxIterations: 50_000_000, timeBudgetMs: 20_000 }));
    scope.send({ type: 'stop' });
    const end = await scope.ended();

    expect(end.type).toBe('done');
    if (end.type !== 'done') return;
    expect(end.result.iterations).toBe(20_000);
    expect(scope.posted.filter((m) => m.type === 'progress')).toHaveLength(1);
    expect(end.result.rows).toHaveLength(8);
  }, 30_000);
});

describe('the generator worker, with a search that is replaced', () => {
  it('hands the run to the search: its seed, its cap, its budget and a report every 20000 iterations', async () => {
    const search = mockSearch();
    const scope = await startWorker();
    const given = run({ seed: 7, maxIterations: 123, timeBudgetMs: 456 });
    scope.send(given);
    await scope.ended();

    expect(search).toHaveBeenCalledTimes(1);
    const [ctx, rows, fixed, opts, onProgress] = search.mock.calls[0];
    expect(ctx).toBe(given.ctx);
    expect(rows).toBe(given.rows);
    expect(fixed).toBe(given.fixed);
    expect(opts).toMatchObject({
      seed: 7,
      maxIterations: 123,
      timeBudgetMs: 456,
      progressEvery: 20_000,
    });
    expect(onProgress).toBeTypeOf('function');
  });

  it('posts each report as progress, then the result as done', async () => {
    const progress: SearchProgress = {
      iteration: 20_000,
      bestScore: 12,
      bestMustUnits: 1,
      elapsedMs: 150,
      temperature: 40,
    };
    const result: SearchResult = { rows: [], score: 12, mustUnits: 1, iterations: 20_001 };
    mockSearch(async (_, onProgress) => {
      onProgress?.(progress);
      return result;
    });
    const scope = await startWorker();
    scope.send(run());
    await scope.ended();

    expect(scope.posted).toEqual([
      { type: 'progress', progress },
      { type: 'done', result },
    ]);
  });

  it('asks to stop only after it was told to', async () => {
    let shouldStop!: () => boolean;
    let finish!: (result: SearchResult) => void;
    mockSearch((opts) => {
      shouldStop = opts.shouldStop as () => boolean;
      return new Promise((resolve) => (finish = resolve));
    });
    const scope = await startWorker();
    scope.send(run());
    expect(shouldStop()).toBe(false);
    scope.send({ type: 'stop' });
    expect(shouldStop()).toBe(true);
    finish({ rows: [], score: 0, mustUnits: 0, iterations: 5 });
    expect((await scope.ended()).type).toBe('done');
  });

  it.each([
    ['an error', new Error('boom'), 'boom'],
    ['something that is not an error', 'nope', 'nope'],
  ])('says so, with the message, when the search fails with %s', async (_, failure, message) => {
    mockSearch(() => Promise.reject(failure));
    const scope = await startWorker();
    scope.send(run());
    expect(await scope.ended()).toEqual({ type: 'error', message });
    expect(scope.posted.filter((m) => m.type === 'done')).toEqual([]);
  });

  it('says so when the search throws before it gives back a promise', async () => {
    const search = mockSearch();
    search.mockImplementation(() => {
      throw new Error('bad month');
    });
    const scope = await startWorker();
    scope.send(run());
    expect(await scope.ended()).toEqual({ type: 'error', message: 'bad month' });
  });

  it('is for one run: a second run message is ignored', async () => {
    const search = mockSearch();
    const scope = await startWorker();
    scope.send(run());
    scope.send(run({ seed: 2 }));
    await scope.ended();
    expect(search).toHaveBeenCalledTimes(1);
    expect(scope.posted.filter((m) => m.type === 'done')).toHaveLength(1);
  });

  it('does nothing for a stop that comes when there is no run, but a run after it stops at its first report', async () => {
    let shouldStop!: () => boolean;
    mockSearch(async (opts) => {
      shouldStop = opts.shouldStop as () => boolean;
      return { rows: [], score: 0, mustUnits: 0, iterations: 0 };
    });
    const scope = await startWorker();
    scope.send({ type: 'stop' });
    expect(scope.posted).toEqual([]);
    scope.send(run());
    await scope.ended();
    expect(shouldStop()).toBe(true);
  });
});
