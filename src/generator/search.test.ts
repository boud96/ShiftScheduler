// src/generator/search.test.ts
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { newAppData } from '../domain/defaults';
import { buildMonthGrid } from '../domain/context';
import { evaluateMonth } from '../domain/rules/evaluate';
import { Code, isShift } from '../domain/codes';
import { syntheticTeam } from '../test/team';
import { SearchState } from './state';
import { breaksHardMust, leavesTooLittleRest, proposeMove } from './moves';
import type { Move } from './moves';
import { construct } from './construct';
import { search } from './search';
import { repairHours } from './repair';
import { mulberry32 } from './rng';
import type { MonthContext, MonthGrid } from '../domain/context';
import { HARD } from '../domain/rules/weights';
import type { RuleId } from '../domain/rules/types';
import type { CodeName, PersonId, Settings } from '../domain/types';
import { scenario } from '../test/scenarios';
import type { ScenarioName } from '../test/scenarios';
import { januaryApplied } from '../test/shortFebruary';

// The repair runs as it always does; the tests of `repair of the hours` look at what it is given.
vi.mock('./repair', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./repair')>();
  return { ...actual, repairHours: vi.fn(actual.repairHours) };
});

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
  it('incremental score equals a full evaluation when cells are stored for the day after', () => {
    // Mon 1 February is the day after this month: what the people have stored there makes pairs
    // with the last day, whichever way the moves go.
    const { data, month } = scenario('jan2027');
    data.cells['2027-02-01'] = {
      A: { code: 'R1' }, B: { code: 'N' }, C: { code: 'x' }, D: { code: 'DOV' },
      E: { code: 'x' }, F: { code: 'O' }, G: { code: 'R2', pinned: true }, H: { code: 'N' },
    };
    const g = buildMonthGrid(data, month);
    const st = new SearchState(g.ctx, g.rows, g.fixed);
    const rnd = mulberry32(17);
    construct(st, rnd);
    // While no must that costs HARD is broken, proposeMove skips the moves that would break one,
    // such as a night on the last day before an x: propose as if one were broken, so that the walk
    // takes such moves too.
    const anyMove = Object.create(st, { score: { get: () => HARD } }) as SearchState;
    const last = g.ctx.days.length - 1;
    const atTheEnd = (rows: Uint8Array[]) =>
      evaluateMonth(g.ctx, rows, true).findings.filter(
        (f) => (f.rule === 'M2' || f.rule === 'M4') && f.days.length === 1 && f.days[0] === last,
      ).length;
    let seen = 0;
    for (let i = 0; i < 3000; i++) {
      const m = proposeMove(anyMove, rnd); if (!m) continue;
      st.tryMove(m);
      const full = evaluateMonth(g.ctx, st.rows);
      expect(Math.abs(st.score - full.score) / Math.max(1, full.score)).toBeLessThan(1e-9);
      expect(st.mustUnits).toBe(full.mustUnits);
      seen += atTheEnd(st.rows);
      if (rnd() < 0.5) st.commit(); else st.revert();
    }
    // the walk did put the last day against a stored cell wrongly now and then
    expect(seen).toBeGreaterThan(0);
    const reset = evaluateMonth(g.ctx, st.rows);
    expect(Math.abs(st.score - reset.score) / Math.max(1, reset.score)).toBeLessThan(1e-9);
    expect(st.mustUnits).toBe(reset.mustUnits);
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

  it('reports the temperature, which falls from 60 to 0.3 in each segment', async () => {
    const g = jan();
    // an infinite time budget is none: the segments are counted in iterations all the same
    for (const timeBudgetMs of [undefined, Infinity]) {
      const temperatures: number[] = [];
      const opts = { seed: 1, maxIterations: 8000, restarts: 4, progressEvery: 500, timeBudgetMs };
      await search(g.ctx, g.rows, g.fixed, opts, (p) => {
        temperatures.push(p.temperature);
      });
      // 4 segments of 2000 iterations, a report after every 500: T = 60 * (0.3 / 60)^f after
      // about a quarter, a half, three quarters and all of a segment is 16, 4.25, 1.13 and 0.30
      const want = [16, 4.25, 1.13, 0.3];
      expect(temperatures).toHaveLength(16);
      temperatures.forEach((t, k) => expect(Math.abs(t / want[k % 4] - 1)).toBeLessThan(0.02));
    }
  });

  it('with a time budget, cools every segment in its share of the time', async () => {
    const g = jan();
    const temperatures: number[] = [];
    // 4 segments of 300 ms: enough reports in each for the checks below, on a busy machine too
    const budget = 1200;
    const opts = {
      seed: 1,
      maxIterations: 1e9,
      timeBudgetMs: budget,
      restarts: 4,
      progressEvery: 10,
    };
    const begin = performance.now();
    const r = await search(g.ctx, g.rows, g.fixed, opts, (p) => {
      temperatures.push(p.temperature);
    });
    const took = performance.now() - begin;

    // The temperature falls within a segment and rises when the next one starts from the best:
    // 4 segments, each starting hot (60) and cooling to near 0.3 before its time is up. Each
    // report reads the clock, and time passes between two, so it falls at every report.
    const segments: number[][] = [[]];
    temperatures.forEach((t, k) => {
      if (k > 0 && t > temperatures[k - 1]) segments.push([]);
      segments[segments.length - 1].push(t);
    });
    expect(segments).toHaveLength(4);
    for (const segment of segments) {
      expect(Math.max(...segment)).toBeGreaterThan(10);
      expect(Math.min(...segment)).toBeLessThan(2);
      segment.slice(1).forEach((t, k) => expect(t).toBeLessThan(segment[k]));
    }
    // It ends when the budget is spent, not after its billion iterations.
    expect(took).toBeGreaterThanOrEqual(budget);
    expect(took).toBeLessThan(budget + 4000);
    expect(r.iterations).toBeLessThan(1e9);
  }, 20_000);

  it('takes the default for restarts and progressEvery below 1, NaN or Infinity', async () => {
    const g = jan();
    const run = async (restarts?: number, progressEvery?: number) => {
      let reports = 0;
      const opts = { seed: 1, maxIterations: 5000, restarts, progressEvery };
      const r = await search(g.ctx, g.rows, g.fixed, opts, () => {
        reports++;
      });
      return { rows: r.rows, iterations: r.iterations, reports };
    };
    // the defaults: a report after 2000 and after 4000 iterations
    const plain = await run();
    expect(plain.reports).toBe(2);
    // Infinity segments would each get no iteration, in a loop that never ends; a progressEvery of
    // NaN or Infinity would never report, nor stop when asked to
    for (const odd of [NaN, Infinity, -Infinity, 0, 0.5, -3]) {
      expect(await run(odd, odd)).toEqual(plain);
    }
  });

  it('with a time budget, still stops after maxIterations', async () => {
    const g = jan();
    const opts = { seed: 1, maxIterations: 3000, timeBudgetMs: 60_000 };
    const r = await search(g.ctx, g.rows, g.fixed, opts);
    expect(r.iterations).toBe(3000);
  });

  it('returns its first draft when the time budget is already spent', async () => {
    const g = jan();
    const st = new SearchState(g.ctx, g.rows, g.fixed);
    construct(st, mulberry32(1));
    const opts = { seed: 1, maxIterations: 1e9, timeBudgetMs: 0 };
    const r = await search(g.ctx, g.rows, g.fixed, opts);
    expect(r.iterations).toBe(0);
    expect(r.rows).toEqual(st.rows);
  });
});

describe('rest pre-filter', () => {
  /** The pairs of days with too little rest that the engine finds (M2). */
  const restFindings = (ctx: MonthContext, rows: Uint8Array[]) =>
    evaluateMonth(ctx, rows, true).findings.filter((f) => f.rule === 'M2');

  /**
   * Rows with a random code that fits the day in every free cell of the month, and then, until
   * the engine finds no pair of days with too little rest, the later shift of each such pair
   * emptied (for a pair that the last day makes with the day after the month, the last day's).
   * Many shifts are covered twice: a must that costs HARD is broken all along.
   */
  function randomRows(g: MonthGrid, rnd: () => number): Uint8Array[] {
    const { ctx } = g;
    const rows = g.rows.map((row) => row.slice());
    rows.forEach((row, p) => {
      for (let i = ctx.first; i < row.length; i++) {
        if (g.fixed[p][i] !== 0) continue;
        const choices =
          ctx.days[i].dayType === 'weekday'
            ? [Code.EMPTY, Code.EMPTY, Code.R1, Code.R2, Code.O20, Code.O, Code.N]
            : [Code.EMPTY, Code.EMPTY, Code.R12, Code.N12];
        row[i] = choices[Math.floor(rnd() * choices.length)];
      }
    });
    for (;;) {
      const short = restFindings(ctx, rows);
      if (short.length === 0) return rows;
      for (const f of short) rows[f.person as number][f.days[f.days.length - 1]] = Code.EMPTY;
    }
  }

  // The rest rule comes from the settings: the defaults, a shorter and a longer rest, other times.
  const variants: Array<[string, (s: Settings) => void]> = [
    ['12 h of rest', () => {}],
    ['10 h of rest', (s) => (s.minRestHours = 10)],
    [
      '14 h of rest, R2 from 7:00 to 15:00',
      (s) => {
        s.minRestHours = 14;
        s.shifts.R2 = { start: 420, end: 900, hours: 7.5 };
      },
    ],
  ];

  /** What each person has stored for Mon 1 February 2027, the day after January. */
  const MORNING_AFTER: Record<PersonId, CodeName> = {
    A: 'R1', B: 'R2', C: 'O', D: 'N', E: 'R1', F: 'O20', G: 'R2', H: 'N',
  };

  /**
   * Walks random moves over a month in which a HARD must is broken, and checks the verdict of the
   * pre-filter on each against the engine. Returns how many moves it flagged and let pass, and how
   * many left too little rest at the end of the month, against the day after it.
   */
  function compare(adjust: (s: Settings) => void, shiftsOnTheFirst: boolean) {
    const { data, month } = scenario('jan2027'); // a tail of nights, and requests
    adjust(data.settings);
    if (shiftsOnTheFirst) {
      for (const [id, code] of Object.entries(MORNING_AFTER)) {
        (data.cells['2027-02-01'] ??= {})[id] = { code };
      }
    }
    const g = buildMonthGrid(data, month);
    const rnd = mulberry32(31);
    const st = new SearchState(g.ctx, randomRows(g, rnd), g.fixed);
    expect(restFindings(g.ctx, st.rows)).toEqual([]);
    // with a HARD must broken, every pick is proposed, those that leave too little rest too
    expect(st.score).toBeGreaterThan(HARD);

    let flagged = 0;
    let passed = 0;
    let atTheEnd = 0;
    for (let k = 0; k < 2000; k++) {
      const m = proposeMove(st, rnd);
      if (!m) continue;
      const verdict = leavesTooLittleRest(st, m);
      st.tryMove(m);
      const found = restFindings(g.ctx, st.rows);
      expect(found.length > 0, JSON.stringify(m)).toBe(verdict);
      if (found.some((f) => f.days.length === 1)) atTheEnd++;
      if (verdict) flagged++;
      else passed++;
      // walk on, but never into a month with too little rest somewhere
      if (!verdict && rnd() < 0.5) st.commit();
      else st.revert();
    }
    return { flagged, passed, atTheEnd };
  }

  it.each(variants)(
    'tells exactly the moves after which the engine finds too little rest (%s)',
    (_, adjust) => {
      const { flagged, passed } = compare(adjust, false);
      expect(flagged).toBeGreaterThan(200);
      expect(passed).toBeGreaterThan(200);
    },
  );

  it.each(variants)(
    'tells them at the end of the month too, against a shift stored for the day after (%s)',
    (_, adjust) => {
      const { flagged, passed, atTheEnd } = compare(adjust, true);
      expect(flagged).toBeGreaterThan(200);
      expect(passed).toBeGreaterThan(200);
      // the moves that matter here are the ones on the last day: some of them were walked
      expect(atTheEnd).toBeGreaterThan(5);
    },
  );

  it('skips, while no HARD must is broken, only moves the search could never keep', () => {
    const g = jan();
    const st = new SearchState(g.ctx, g.rows, g.fixed);
    const rnd = mulberry32(32);
    construct(st, rnd);
    expect(st.score).toBeLessThan(HARD / 2);
    // the same month as if a HARD must were broken: nothing is skipped in it
    const unfiltered = Object.create(st, { score: { get: () => HARD } }) as SearchState;

    let skipped = 0;
    for (let k = 0; k < 3000; k++) {
      const u = proposeMove(unfiltered, rnd);
      if (u && leavesTooLittleRest(st, u)) {
        skipped++;
        expect(st.tryMove(u)).toBeGreaterThan(HARD / 2);
        st.revert();
      }
      const m = proposeMove(st, rnd);
      if (!m) continue;
      expect(leavesTooLittleRest(st, m)).toBe(false);
      const delta = st.tryMove(m);
      if (delta < HARD / 2 && rnd() < 0.5) st.commit();
      else st.revert();
    }
    expect(skipped).toBeGreaterThan(300);
  });
});

describe('pre-filter of the musts that cost HARD', () => {
  const grid = (name: ScenarioName) => {
    const { data, month } = scenario(name);
    return buildMonthGrid(data, month);
  };

  /** The rules of the findings that cost HARD. */
  const hardRules = (ctx: MonthContext, rows: Uint8Array[]) =>
    evaluateMonth(ctx, rows, true)
      .findings.filter((f) => f.severity === 'must' && f.penalty >= HARD)
      .map((f) => f.rule);

  /**
   * Months in which moves can break the musts that cost HARD, with the musts that a walk over each
   * sees broken among others: a night before a request (M4) where requests follow days of the
   * month, the limits of 12-hour shifts and nights (M5, M13) where people have limits of their own.
   */
  const months: Array<[string, () => MonthGrid, RuleId[]]> = [
    [
      'January after a December of nights',
      () => grid('jan2027'),
      ['M1', 'M2', 'M5', 'M9', 'M10', 'M11'],
    ],
    ['February with a weekend off for all but H', () => grid('impossible'), ['M4']],
    ['January before requests on 1 February', () => grid('monthEnd'), ['M4']],
    [
      'January with a claimed holiday and limits of their own',
      () => {
        const d = newAppData();
        d.people = syntheticTeam();
        d.cells['2027-01-01'] = { C: { code: 'R12', pinned: true } }; // a claimed holiday shift
        for (const person of d.people) {
          if (person.id === 'B') person.maxTwelve = 2;
          if (person.id === 'D') person.maxNights = 4;
          if (person.id === 'F') person.maxNights = 0;
        }
        return buildMonthGrid(d, '2027-01');
      },
      ['M5', 'M13'],
    ],
  ];

  it.each(months)(
    'tells exactly the moves that make the score worse by HARD / 2 or more (%s)',
    (_, make, expected) => {
      const g = make();
      const st = new SearchState(g.ctx, g.rows, g.fixed);
      const rnd = mulberry32(43);
      construct(st, rnd);
      expect(st.score).toBeLessThan(HARD / 2);
      // as if a HARD must were broken: every pick is proposed, those that break one too
      const unfiltered = Object.create(st, { score: { get: () => HARD } }) as SearchState;

      const kinds = new Set<Move['kind']>();
      const broken = new Set<RuleId>();
      let breaking = 0;
      let keeping = 0;
      for (let k = 0; k < 3000; k++) {
        const m = proposeMove(unfiltered, rnd);
        if (!m) continue;
        kinds.add(m.kind);
        const verdict = breaksHardMust(st, m);
        const delta = st.tryMove(m);
        expect(delta >= HARD / 2, JSON.stringify(m)).toBe(verdict);
        if (verdict) {
          breaking++;
          for (const rule of hardRules(g.ctx, st.rows)) broken.add(rule);
        } else {
          keeping++;
        }
        // walk on, but never into a month with a HARD must broken
        if (!verdict && rnd() < 0.5) st.commit();
        else st.revert();
      }
      expect(breaking).toBeGreaterThan(300);
      expect(keeping).toBeGreaterThan(300);
      expect([...kinds].sort()).toEqual(['exchange', 'set', 'shiftMove', 'swapDay', 'swapRange']);
      expect([...broken]).toEqual(expect.arrayContaining(expected));
    },
  );

  it('lets the search propose only moves that break no such must, while none is broken', () => {
    const g = grid('jan2027');
    const st = new SearchState(g.ctx, g.rows, g.fixed);
    const rnd = mulberry32(44);
    construct(st, rnd);
    for (let k = 0; k < 2000; k++) {
      const m = proposeMove(st, rnd);
      if (!m) continue;
      expect(breaksHardMust(st, m), JSON.stringify(m)).toBe(false);
      const delta = st.tryMove(m);
      expect(delta).toBeLessThan(HARD / 2);
      if (rnd() < 0.5) st.commit();
      else st.revert();
    }
    expect(st.score).toBeLessThan(HARD / 2);
  });
});

describe('exchange', () => {
  /** How many shifts `row` holds on the days of the month. */
  const shifts = (g: MonthGrid, row: Uint8Array) => {
    let count = 0;
    for (let i = g.ctx.first; i < row.length; i++) if (isShift(row[i])) count++;
    return count;
  };

  it('hands back as many shifts as it hands over, on two ranges apart, and keeps each day', () => {
    const g = jan();
    const st = new SearchState(g.ctx, g.rows, g.fixed);
    const rnd = mulberry32(5);
    construct(st, rnd);
    let seen = 0;
    const lengths = new Set<number>();
    for (let k = 0; k < 20000 && seen < 300; k++) {
      const m = proposeMove(st, rnd);
      if (!m || m.kind !== 'exchange') continue;
      seen++;
      lengths.add(m.len);
      // at least one day between the ranges
      expect(m.e + m.len < m.d || m.e > m.d + m.len, JSON.stringify(m)).toBe(true);
      const before = st.snapshot();
      st.tryMove(m);
      for (const p of [m.p, m.q]) expect(shifts(g, st.rows[p])).toBe(shifts(g, before[p]));
      for (let i = g.ctx.first; i < g.ctx.days.length; i++) {
        const day = (rows: Uint8Array[]) => rows.map((row) => row[i]).sort();
        expect(day(st.rows)).toEqual(day(before));
        const inside = (i >= m.d && i < m.d + m.len) || (i >= m.e && i < m.e + m.len);
        st.rows.forEach((row, p) => {
          if (!inside || (p !== m.p && p !== m.q)) expect(row[i]).toBe(before[p][i]);
        });
      }
      if (rnd() < 0.5) st.commit();
      else st.revert();
    }
    expect(seen).toBe(300);
    expect([...lengths].sort()).toEqual([1, 2]);
  });

  it('refuses an exchange whose ranges overlap or touch, or that changes a fixed cell', () => {
    const d = newAppData();
    d.people = syntheticTeam();
    d.cells['2027-01-20'] = { A: { code: 'DOV' } };
    const g = buildMonthGrid(d, '2027-01');
    const st = new SearchState(g.ctx, g.rows, g.fixed);
    construct(st, mulberry32(1));
    const rows = st.snapshot();
    const score = st.score;

    // Wed 20 Jan is day 7 + 19
    const tries: Move[] = [
      { kind: 'exchange', p: 1, q: 2, d: 7 + 3, e: 7 + 4, len: 1 }, // the ranges touch
      { kind: 'exchange', p: 1, q: 2, d: 7 + 3, e: 7 + 4, len: 2 }, // they overlap
      { kind: 'exchange', p: 1, q: 2, d: 7 + 3, e: 7 + 3, len: 1 }, // the same range
      { kind: 'exchange', p: 0, q: 1, d: 7 + 3, e: 7 + 19, len: 1 }, // A's DOV
      { kind: 'exchange', p: 1, q: 2, d: 6, e: 7 + 10, len: 1 }, // a day of December
    ];
    for (const m of tries) expect(() => st.tryMove(m), JSON.stringify(m)).toThrow();
    expect(st.rows).toEqual(rows);
    expect(st.score).toBe(score);

    // no refused move is left in hand: the next one is tried as usual
    st.tryMove({ kind: 'exchange', p: 1, q: 2, d: 7 + 3, e: 7 + 5, len: 1 });
    st.revert();
    expect(st.rows).toEqual(rows);
  });
});

describe('construct', () => {
  it('leaves a shift that two people can take to the days in order, which take the better', () => {
    // Everyone but D and G has asked for Saturday 13 February off, so only D or G can work the
    // night of Friday 12 February, which ends that morning. D likes nights; G never works them.
    const d = newAppData();
    d.people = syntheticTeam();
    d.cells['2027-02-13'] = Object.fromEntries(
      ['A', 'B', 'C', 'E', 'F', 'H'].map((id) => [id, { code: 'x' as const }]),
    );
    const g = buildMonthGrid(d, '2027-02');
    const st = new SearchState(g.ctx, g.rows, g.fixed);
    construct(st, mulberry32(1));
    const friday = g.ctx.days.findIndex((day) => day.date === '2027-02-12');
    expect(st.rows[g.personIds.indexOf('D')][friday]).toBe(Code.N);
    expect(evaluateMonth(g.ctx, st.rows, true).findings.filter((f) => f.rule === 'S1')).toEqual([]);
  });

  it('first gives a shift that only one person can take to that person', () => {
    // Everyone but H has asked for 13 and 14 February off, so only H can work those days, and only
    // H the night of Friday 12 February, which ends on the morning of the 13th. Taken first, that
    // night leaves H the nights of the weekend, N12 after N: just its two R12 stay uncovered.
    const { data, month } = scenario('impossible');
    const g = buildMonthGrid(data, month);
    const st = new SearchState(g.ctx, g.rows, g.fixed);
    construct(st, mulberry32(1));
    const h = g.personIds.indexOf('H');
    const at = (date: string) => g.ctx.days.findIndex((day) => day.date === date);
    const dates = ['2027-02-12', '2027-02-13', '2027-02-14'];
    expect(dates.map((date) => st.rows[h][at(date)])).toEqual([Code.N, Code.N12, Code.N12]);
    const gaps = evaluateMonth(g.ctx, st.rows, true).findings.filter((f) => f.rule === 'M1');
    expect(gaps.map((f) => `${g.ctx.days[f.days[0]].date} ${f.message}`)).toEqual([
      '2027-02-13 chybí R12',
      '2027-02-14 chybí R12',
    ]);
  });
});

describe('repair of the hours', () => {
  it('brings up to FPD the person whom the annealing left one shift short', async () => {
    // February 2027 of a new plan, after January as the app generated it (see shortFebruary.ts).
    // With seed 12 and 150,000 iterations, the search before the repair left p8 at 143 h of 150 h:
    // every free day of p8's blocked by the days in a row or the days off after them, and nothing
    // else broken.
    const g = buildMonthGrid(januaryApplied(), '2027-02');
    const r = await search(g.ctx, g.rows, g.fixed, { seed: 12, maxIterations: 150_000 });
    const musts = evaluateMonth(g.ctx, r.rows, true).findings.filter((f) => f.severity === 'must');
    const who = (person: number | null) => (person === null ? 'the day' : g.personIds[person]);
    expect(musts.map((f) => `${who(f.person)}: ${f.message}`)).toEqual([]);
  });

  // March 2027 of a new plan: with seed 8, the first draft leaves two people below FPD. (It does
  // with seeds 1, 2, 4, 5, 6 and many more, one person each.)
  const march = () => {
    const { data, month } = scenario('mar2027');
    return buildMonthGrid(data, month);
  };
  const SEED = 8;
  const below = (g: MonthGrid, rows: Uint8Array[]) =>
    evaluateMonth(g.ctx, rows, true).findings.filter((f) => f.rule === 'M6');

  it('repairs the best month when the search is stopped early too', async () => {
    const g = march();
    const draft = new SearchState(g.ctx, g.rows, g.fixed);
    construct(draft, mulberry32(SEED)); // the draft search(seed 8) starts from
    expect(below(g, draft.rows)).toHaveLength(2);

    // the first report stops the search, after one iteration
    const opts = { seed: SEED, maxIterations: 1_000_000, progressEvery: 1, shouldStop: () => true };
    const r = await search(g.ctx, g.rows, g.fixed, opts);
    expect(r.iterations).toBe(1);
    expect(below(g, r.rows)).toEqual([]);
    // and the score and the must units it reports are those of the repaired month
    const full = evaluateMonth(g.ctx, r.rows);
    expect(r.mustUnits).toBe(full.mustUnits);
    expect(Math.abs(r.score - full.score) / Math.max(1, full.score)).toBeLessThan(1e-9);
  });

  it('does not repair a best month again until it has changed', async () => {
    // D can have one weekend shift at most (M12), so the best month keeps a must unit that no
    // repair clears, and every segment ends with a best month that may be worth repairing
    const { data, month } = scenario('x-weekends');
    const g = buildMonthGrid(data, month);
    const { repairHours: real } = await vi.importActual<typeof import('./repair')>('./repair');
    const seen: Array<{ before: Uint8Array[]; after: Uint8Array[] }> = [];
    vi.mocked(repairHours).mockImplementation((st, stop) => {
      const before = st.snapshot();
      const made = real(st, stop);
      seen.push({ before, after: st.snapshot() });
      return made;
    });
    try {
      // 20 segments of 10 iterations: most of them find no better month than the best so far
      await search(g.ctx, g.rows, g.fixed, { seed: 1, maxIterations: 200, restarts: 20 });
    } finally {
      vi.mocked(repairHours).mockImplementation(real);
    }
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.length).toBeLessThan(20);
    // each repair after the first starts from a month that is not the one the last repair left
    seen.slice(1).forEach(({ before }, k) => expect(before).not.toEqual(seen[k].after));
  });

  describe('with a time budget, after a stop', () => {
    const START = 1000;
    let clock: MockInstance | undefined;
    afterEach(() => clock?.mockRestore());

    /**
     * Searches March 2027 with the clock held still at START ms, but for a jump of `jump` ms at the
     * first report, so that the second report finds `jump` ms gone and stops the search. Returns
     * the stop that the repair was given, and a way to ask it with `ms` gone since the start.
     */
    async function stopOfRepair(budget: number | undefined, jump: number) {
      const g = march();
      let now = START;
      clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
      vi.mocked(repairHours).mockClear();
      let asked = 0;
      const shouldStop = () => {
        if (++asked === 1) now += jump;
        return asked > 1;
      };
      const opts = { seed: SEED, maxIterations: 1_000_000, timeBudgetMs: budget, progressEvery: 1 };
      await search(g.ctx, g.rows, g.fixed, { ...opts, shouldStop });
      const { calls } = vi.mocked(repairHours).mock;
      expect(calls).toHaveLength(1);
      const stop = calls[0][1];
      return { stop, ask: (ms: number) => ((now = START + ms), stop?.()) };
    }

    it('ends the repair 200 ms from a stop that comes before the budget is spent', async () => {
      const { ask } = await stopOfRepair(60_000, 3000);
      expect([ask(0), ask(3000), ask(3199)]).toEqual([false, false, false]);
      expect([ask(3200), ask(4000)]).toEqual([true, true]);
    });

    it('ends it 200 ms past the budget when the search is out of time', async () => {
      const { ask } = await stopOfRepair(2000, 3000);
      expect([ask(0), ask(2000), ask(2199)]).toEqual([false, false, false]);
      expect([ask(2200), ask(3000)]).toEqual([true, true]);
    });

    it('gives it no stop and reads no clock without a budget', async () => {
      const { stop } = await stopOfRepair(undefined, 3000);
      expect(stop).toBeUndefined();
    });
  });
});
