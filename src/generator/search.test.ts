// src/generator/search.test.ts
import { describe, it, expect } from 'vitest';
import { newAppData } from '../domain/defaults';
import { buildMonthGrid } from '../domain/context';
import { evaluateMonth } from '../domain/rules/evaluate';
import { Code } from '../domain/codes';
import { syntheticTeam } from '../test/team';
import { SearchState } from './state';
import { proposeMove } from './moves';
import { construct } from './construct';
import { search } from './search';
import { mulberry32 } from './rng';
import type { MonthContext } from '../domain/context';
import { HARD } from '../domain/rules/weights';

const jan = () => { const d = newAppData(); d.people = syntheticTeam(); return buildMonthGrid(d, '2027-01'); };

describe('generator core', () => {
  it('incremental score equals a full evaluation', () => {
    const g = jan(); const st = new SearchState(g.ctx, g.rows, g.fixed); const rnd = mulberry32(7);
    construct(st, rnd);
    for (let i = 0; i < 5000; i++) {
      const m = proposeMove(st, rnd); if (!m) continue;
      st.tryMove(m); if (rnd() < 0.5) st.commit(); else st.revert();
      if (i % 250 === 0) {
        const full = evaluateMonth(g.ctx, st.rows).score;
        expect(Math.abs(st.score - full) / Math.max(1, full)).toBeLessThan(1e-9);
      }
    }
  });
  it('never changes fixed cells', async () => {
    const d = newAppData(); d.people = syntheticTeam();
    d.cells['2027-01-05'] = { A: { code: 'DOV' } }; d.cells['2027-01-06'] = { B: { code: 'O', pinned: true } };
    const g = buildMonthGrid(d, '2027-01');
    const r = await search(g.ctx, g.rows, g.fixed, { seed: 1, maxIterations: 20000 });
    for (let p = 0; p < g.rows.length; p++) for (let i = 0; i < g.rows[p].length; i++)
      if (g.fixed[p][i]) expect(r.rows[p][i]).toBe(g.rows[p][i]);
  });
  it('is deterministic for a seed', async () => {
    const g = jan();
    const a = await search(g.ctx, g.rows, g.fixed, { seed: 3, maxIterations: 20000 });
    const b = await search(g.ctx, g.rows, g.fixed, { seed: 3, maxIterations: 20000 });
    expect(a.rows).toEqual(b.rows);
  });
  it('keeps pins that break a must, and still finishes', async () => {
    const d = newAppData(); d.people = syntheticTeam();
    d.cells['2027-01-07'] = { C: { code: 'O', pinned: true } }; d.cells['2027-01-08'] = { C: { code: 'R1', pinned: true } };
    const g = buildMonthGrid(d, '2027-01');
    const r = await search(g.ctx, g.rows, g.fixed, { seed: 1, maxIterations: 20000 });
    expect([r.rows[2][7 + 6], r.rows[2][7 + 7]]).toEqual([Code.O, Code.R1]);
    expect(evaluateMonth(g.ctx, r.rows, true).findings.filter((f) => f.rule === 'M2')).toHaveLength(1);
  });
  it('reports progress and honours shouldStop', async () => {
    const g = jan(); let calls = 0;
    const r = await search(g.ctx, g.rows, g.fixed, { seed: 1, maxIterations: 1e9, progressEvery: 1000, shouldStop: () => calls >= 3 }, () => { calls++; });
    expect(calls).toBe(3); expect(r.iterations).toBeLessThan(10000);
  });
});

describe('generator limits', () => {
  /** Whether `code` may be placed on day `i` of `ctx.days`: EMPTY or a shift of the day's type. */
  const fits = (ctx: MonthContext, i: number, code: number): boolean =>
    ctx.days[i].dayType === 'weekday'
      ? code >= Code.EMPTY && code <= Code.N
      : code === Code.EMPTY || code === Code.R12 || code === Code.N12;
  /** The broken musts that cost HARD: all but a missing person (M1) and hours below FPD (M6). */
  const hardFindings = (ctx: MonthContext, rows: Uint8Array[]) =>
    evaluateMonth(ctx, rows, true).findings.filter(
      (f) => f.severity === 'must' && f.penalty >= HARD,
    );

  it('proposes only changes to free cells of the month, in codes that fit the day', () => {
    const d = newAppData();
    d.people = syntheticTeam();
    d.people[7].activeTo = '2027-01-20'; // H leaves the team: the days after are fixed
    d.cells['2026-12-31'] = { D: { code: 'N' } };
    d.cells['2027-01-05'] = { A: { code: 'DOV' } };
    d.cells['2027-01-06'] = { B: { code: 'O', pinned: true }, C: { code: 'x' } };
    const g = buildMonthGrid(d, '2027-01');
    const st = new SearchState(g.ctx, g.rows, g.fixed);
    const rnd = mulberry32(11);
    construct(st, rnd);

    let proposed = 0;
    for (let k = 0; k < 3000; k++) {
      const m = proposeMove(st, rnd);
      if (!m) continue;
      proposed++;
      const before = st.snapshot();
      st.tryMove(m);
      let changed = 0;
      for (let p = 0; p < g.rows.length; p++) {
        for (let i = 0; i < g.rows[p].length; i++) {
          if (st.rows[p][i] === before[p][i]) continue;
          changed++;
          expect(g.fixed[p][i]).toBe(0);
          expect(fits(g.ctx, i, st.rows[p][i])).toBe(true);
        }
      }
      expect(changed).toBeGreaterThan(0);
      if (rnd() < 0.5) {
        st.commit();
      } else {
        st.revert();
        expect(st.rows).toEqual(before);
      }
    }
    expect(proposed).toBeGreaterThan(2900);
  });

  it('leaves a gap rather than break a must', () => {
    // Wed 13 Jan: everyone but H has x, and after H's pinned night of the 12th only another night
    // leaves H 12 h of rest.
    const d = newAppData();
    d.people = syntheticTeam();
    d.cells['2027-01-12'] = { H: { code: 'N', pinned: true } };
    d.cells['2027-01-13'] = {
      A: { code: 'x' },
      B: { code: 'x' },
      C: { code: 'x' },
      D: { code: 'x' },
      E: { code: 'x' },
      F: { code: 'x' },
      G: { code: 'x' },
    };
    const g = buildMonthGrid(d, '2027-01');
    const st = new SearchState(g.ctx, g.rows, g.fixed);
    construct(st, mulberry32(1));

    // H gets the night; R1, O20, O and R2 stay uncovered that day.
    const { X, N } = Code;
    expect(st.rows.map((row) => row[7 + 12])).toEqual([X, X, X, X, X, X, X, N]);
    expect(hardFindings(g.ctx, st.rows)).toEqual([]);
  });

  it('brings everyone up to their FPD where it can', () => {
    const g = jan();
    const st = new SearchState(g.ctx, g.rows, g.fixed);
    construct(st, mulberry32(4));
    // January 2027 has 21 weekdays: an FPD of 157.5 h, and plenty of free weekdays for an R2
    for (const person of evaluateMonth(g.ctx, st.rows).persons) {
      expect(person.hours).toBeGreaterThanOrEqual(157.5);
    }
  });

  it('refuses a move on a fixed cell and leaves the month as it was', () => {
    const d = newAppData();
    d.people = syntheticTeam();
    d.cells['2027-01-05'] = { A: { code: 'DOV' } };
    const g = buildMonthGrid(d, '2027-01');
    const st = new SearchState(g.ctx, g.rows, g.fixed);
    construct(st, mulberry32(1));
    const rows = st.snapshot();
    const score = st.score;

    // A's DOV on Tue 5 Jan (day 7 + 4) is fixed, and so is every day of December (days 0 to 6)
    expect(() => st.tryMove({ kind: 'set', p: 0, d: 7 + 4, code: Code.R1 })).toThrow();
    expect(() => st.tryMove({ kind: 'swapRange', p: 1, q: 0, d: 7, len: 7 })).toThrow();
    expect(() => st.tryMove({ kind: 'shiftMove', p: 1, from: 6, to: 7 + 2 })).toThrow();
    expect(st.rows).toEqual(rows);
    expect(st.score).toBe(score);

    // no refused move is left in hand: the next one is tried as usual
    st.tryMove({ kind: 'set', p: 1, d: 7 + 4, code: Code.EMPTY });
    st.revert();
    expect(st.rows).toEqual(rows);
  });

  it('scores the rows it is reset to afresh', () => {
    const g = jan();
    const st = new SearchState(g.ctx, g.rows, g.fixed);
    const rnd = mulberry32(8);
    construct(st, rnd);
    const draft = st.snapshot();
    for (let i = 0; i < 200; i++) {
      const m = proposeMove(st, rnd);
      if (m) {
        st.tryMove(m);
        st.commit();
      }
    }

    st.reset(draft);
    const full = evaluateMonth(g.ctx, draft);
    expect(st.rows).toEqual(draft);
    expect(Math.abs(st.score - full.score) / Math.max(1, full.score)).toBeLessThan(1e-9);
    expect(st.mustUnits).toBe(full.mustUnits);
  });

  it('improves on the draft it starts from', async () => {
    const g = jan();
    const st = new SearchState(g.ctx, g.rows, g.fixed);
    construct(st, mulberry32(2)); // the draft search(seed 2) starts from
    const r = await search(g.ctx, g.rows, g.fixed, { seed: 2, maxIterations: 20000 });
    expect(r.score).toBeLessThan(st.score);
  });

  it('returns rows that score what it reports, after all its iterations', async () => {
    const g = jan();
    const r = await search(g.ctx, g.rows, g.fixed, { seed: 2, maxIterations: 20000 });
    const full = evaluateMonth(g.ctx, r.rows);
    expect(Math.abs(r.score - full.score) / Math.max(1, full.score)).toBeLessThan(1e-9);
    expect(r.mustUnits).toBe(full.mustUnits);
    expect(r.iterations).toBe(20000);
    expect(hardFindings(g.ctx, r.rows)).toEqual([]);
  });

  it('finishes a month with nobody in the team', async () => {
    const d = newAppData();
    d.people = [];
    const g = buildMonthGrid(d, '2027-01');
    const r = await search(g.ctx, g.rows, g.fixed, { seed: 1, maxIterations: 1000 });
    // every shift is missing: 20 weekdays with R1, O20, O, N and R2, and 11 12-hour days
    expect(r.rows).toEqual([]);
    expect(r.mustUnits).toBe(20 * 5 + 11 * 2);
  });

  it('stops when the time budget has run out', async () => {
    const g = jan();
    const opts = { seed: 1, maxIterations: 1e9, progressEvery: 500, timeBudgetMs: 0 };
    const r = await search(g.ctx, g.rows, g.fixed, opts);
    expect(r.iterations).toBe(500);
  });
});
