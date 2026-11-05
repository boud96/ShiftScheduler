import { describe, expect, it } from 'vitest';
import { buildMonthGrid } from '../domain/context';
import { newAppData } from '../domain/defaults';
import type { SearchProgress } from '../generator/search';
import { syntheticTeam } from '../test/team';
import { inProcessRunner } from './runner';
import type { GeneratorInput } from './runner';

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
