import { describe, expect, it } from 'vitest';
import { CODE_NAMES, Code, isAbsence, isNight, isShift } from '../domain/codes';
import { applyRows, buildMonthGrid } from '../domain/context';
import type { MonthGrid } from '../domain/context';
import { evaluateMonth } from '../domain/rules/evaluate';
import type { MonthEval } from '../domain/rules/evaluate';
import type { Finding } from '../domain/rules/types';
import { GAP, HARD } from '../domain/rules/weights';
import type { AppData, ISODate, MonthKey, PersonId, ShiftName } from '../domain/types';
import { scenario } from '../test/scenarios';
import type { ScenarioName } from '../test/scenarios';
import { search } from './search';

/**
 * Counted in iterations, with no time budget: a scenario and a seed always give the same month.
 *
 * 300,000 iterations are too few for the search to settle, so each run is a draw. Over seeds 1-24
 * the committed search passes these checks on every scenario 24/24 but doctor, 19/24 (over 1-96:
 * jan2027 96/96, doctor 73/96). q1-2027 checks every month for `Musí: 0` (no must unit) too, and
 * passes 24/24. Phase 1 passed jan2027 21/24, feb2027 22/24, dec2027 23/24 and impossible 22/24;
 * the Phase 1.1 rules took jan2027 down to 0/24 and dec2027 and impossible to 9/24, until the
 * exchange moves, the shifts that only one person can take in the first draft and the shape of
 * W5b. So after a change to the rules, the weights, construct or the moves, a red run may be seed
 * noise. Before changing a seed or an assertion, compare the pass rates over many seeds before and
 * after the change, and keep the change only if no scenario's rate drops. Never weaken an
 * assertion to make a seed pass.
 *
 * SCENARIO_SEEDS (such as `1-24` or `1,5,7-9`) replaces the seeds of every scenario. A sweep, one
 * process per scenario:
 *
 *   d=$(mktemp -d)
 *   for s in jan2027 feb2027 mar2027 dec2027 jul2027 impossible pins monthEnd q1-2027 \
 *       claimed-holiday x-weekends doctor; do
 *     SCENARIO_SEEDS=1-24 npx vitest run src/generator/scenarios.test.ts -t $s > $d/$s.txt &
 *   done; wait; grep 'Tests ' $d/*.txt
 */
const ITERATIONS = 300_000;
const TIMEOUT = 120_000;

/** The seeds that SCENARIO_SEEDS lists, or null if it is not set. */
function sweepSeeds(text: string | undefined): number[] | null {
  if (text === undefined || text.trim() === '') return null;
  const seeds: number[] = [];
  for (const part of text.split(',')) {
    const range = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (range === null) throw new Error(`SCENARIO_SEEDS: "${part}" is not a seed or a range`);
    const to = Number(range[2] ?? range[1]);
    for (let seed = Number(range[1]); seed <= to; seed++) seeds.push(seed);
  }
  if (seeds.length === 0) throw new Error(`SCENARIO_SEEDS: "${text}" lists no seed`);
  return seeds;
}

const SWEEP = sweepSeeds(process.env.SCENARIO_SEEDS);

/** The seeds a scenario runs on: the plan's, unless SCENARIO_SEEDS gives others. */
const seeds = (planned: number[]): number[] => SWEEP ?? planned;

interface Generated {
  g: MonthGrid;
  rows: Uint8Array[];
  ev: MonthEval;
}

/** Generates the month of a scenario, and evaluates it with every finding listed. */
async function generate(name: ScenarioName, seed: number): Promise<Generated> {
  const { data, month } = scenario(name);
  const g = buildMonthGrid(data, month);
  const r = await search(g.ctx, g.rows, g.fixed, { seed, maxIterations: ITERATIONS });
  return { g, rows: r.rows, ev: evaluateMonth(g.ctx, r.rows, true) };
}

/** A finding as one line: its rule, its person, its dates and its message. */
function line(g: MonthGrid, f: Finding): string {
  const who = f.person === null ? '' : `${g.personIds[f.person]} `;
  const when = f.days.map((i) => g.ctx.days[i].date).join(', ');
  return `${f.rule} ${who}${when}: ${f.message}`;
}

/** The broken musts, one line each: what a failing `mustUnits` check shows. */
function musts(g: MonthGrid, ev: MonthEval): string {
  const lines = ev.findings.filter((f) => f.severity === 'must').map((f) => line(g, f));
  return `broken musts:\n${lines.join('\n')}`;
}

/** The longest run of days with a shift in `row` that has a day of the month, the tail included. */
function longestRun(g: MonthGrid, row: Uint8Array): number {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < row.length; i++) {
    run = isShift(row[i]) ? run + 1 : 0;
    if (i >= g.ctx.first) longest = Math.max(longest, run);
  }
  return longest;
}

/**
 * What every month of the Phase 1.1 scenarios asks of the generator: no broken must that costs
 * HARD, every shift covered, no run of more than 6 working days, and neither too few days off
 * after a long run (M10) nor too little weekly rest (M11). The runs are counted on the rows, not
 * by the engine. M6 and M12, which may be left short when they must, are left to each test.
 */
function expectSound(g: MonthGrid, rows: Uint8Array[], ev: MonthEval): void {
  const { month } = g.ctx;
  const hard = ev.findings.filter((f) => f.severity === 'must' && f.penalty >= HARD);
  expect(hard.map((f) => line(g, f)), `${month}: musts that cost HARD`).toEqual([]);
  const coverage = ev.findings.filter((f) => f.rule === 'M1');
  expect(coverage.map((f) => line(g, f)), `${month}: coverage`).toEqual([]);
  rows.forEach((row, k) => {
    const id = g.personIds[k];
    expect(longestRun(g, row), `${month}: ${id}'s longest run`).toBeLessThanOrEqual(6);
  });
  const rest = ev.findings.filter((f) => f.rule === 'M10' || f.rule === 'M11');
  expect(rest.map((f) => line(g, f)), `${month}: days off and weekly rest`).toEqual([]);
}

/**
 * Whether the shifts in `row` keep an hour clear of a doctor's appointment on day `i`, from `from`
 * to `to` minutes after midnight: the shift of that day, and a night of the day before, which ends
 * on it. A shift that ends an hour before the appointment, or starts an hour after it, is clear.
 */
function clearOfDoctor(
  g: MonthGrid,
  row: Uint8Array,
  i: number,
  from: number,
  to: number,
): boolean {
  const { shifts } = g.ctx.settings;
  const near = (start: number, end: number) => start < to + 60 && end > from - 60;
  if (isShift(row[i])) {
    const { start, end } = shifts[CODE_NAMES[row[i]] as ShiftName];
    if (near(start, end)) return false;
  }
  if (isNight(row[i - 1])) {
    const { start, end } = shifts[CODE_NAMES[row[i - 1]] as ShiftName];
    if (near(start - 1440, end - 1440)) return false;
  }
  return true;
}

/** The row of person `id`. */
function rowOf(g: MonthGrid, rows: Uint8Array[], id: PersonId): Uint8Array {
  return rows[g.personIds.indexOf(id)];
}

/** The index in `ctx.days` of `date`. A date that is not there is a slip of the test: it throws. */
function dayOf(g: MonthGrid, date: ISODate): number {
  const index = g.ctx.days.findIndex((day) => day.date === date);
  if (index < 0) throw new Error(`dayOf: ${date} is not in the tail or the days of ${g.ctx.month}`);
  return index;
}

/** The runs of nights (N and N12 one after the other) in the days of the month of `row`. */
function nightRuns(g: MonthGrid, row: Uint8Array): number {
  let runs = 0;
  for (let i = g.ctx.first; i < row.length; i++) {
    if (isNight(row[i]) && (i === g.ctx.first || !isNight(row[i - 1]))) runs++;
  }
  return runs;
}

/** Everyone's number of 12-hour shifts, from the fewest to the most. */
function twelveCounts(ev: MonthEval): number[] {
  return ev.persons.map((p) => p.twelve).sort((a, b) => a - b);
}

describe('generator scenarios', () => {
  it('finds a date in the context, and throws for one that is not there', () => {
    const { data, month } = scenario('jan2027');
    const g = buildMonthGrid(data, month);
    expect(dayOf(g, '2026-12-25')).toBe(0); // the first day of the tail
    expect(dayOf(g, '2027-01-01')).toBe(g.ctx.first);
    expect(dayOf(g, '2027-01-31')).toBe(g.ctx.days.length - 1);
    // a day after the month, one before the tail, a slip of the pen
    expect(() => dayOf(g, '2027-02-01')).toThrow('2027-02-01');
    expect(() => dayOf(g, '2026-12-24')).toThrow('2026-12-24');
    expect(() => dayOf(g, '2027-1-15')).toThrow('2027-1-15');
  });

  it('builds July 2027 with at most two people away on any day', () => {
    const { data, month } = scenario('jul2027');
    const g = buildMonthGrid(data, month);
    for (let i = g.ctx.first; i < g.ctx.days.length; i++) {
      const away = g.rows.filter((row) => isAbsence(row[i])).length;
      expect(away).toBeLessThanOrEqual(2);
    }
  });

  it.each(seeds([1, 2, 3]))(
    'jan2027, seed %i: no must broken, two or three 12-hour shifts each, the least overtime, ' +
      'whole weekends and night runs',
    async (seed) => {
      const { g, rows, ev } = await generate('jan2027', seed);
      expect(ev.mustUnits, musts(g, ev)).toBe(0);
      // 22 twelve-hour shifts (1 January and 5 weekends) and at most 3 each
      expect(twelveCounts(ev)).toEqual([2, 2, 3, 3, 3, 3, 3, 3]);
      ev.persons.forEach((p, k) => {
        const overtime = p.hours - g.ctx.people[k].fpd;
        expect(overtime, `${g.personIds[k]}'s overtime`).toBeLessThanOrEqual(4.5);
      });
      g.ctx.people.forEach((person, k) => {
        if (person.prefs.weekendStyle !== 'whole') return;
        const split = ev.findings.filter((f) => f.rule === 'W5b' && f.person === k);
        expect(split.length, `${person.id}'s W5b findings`).toBeLessThanOrEqual(1);
      });
      ev.persons.forEach((p, k) => {
        if (p.nights <= 5) return;
        const runs = nightRuns(g, rows[k]);
        expect(runs, `${g.personIds[k]}'s runs of ${p.nights} nights`).toBeLessThanOrEqual(
          Math.ceil(p.nights / 5) + 1,
        );
      });
    },
    TIMEOUT,
  );

  it.each(seeds([1]))(
    'feb2027, seed %i: no must broken, two 12-hour shifts each and 0.5 h over FPD',
    async (seed) => {
      const { g, ev } = await generate('feb2027', seed);
      expect(ev.mustUnits, musts(g, ev)).toBe(0);
      ev.persons.forEach((p, k) => {
        expect(p.twelve, `${g.personIds[k]}'s 12-hour shifts`).toBe(2);
        expect(p.hours - g.ctx.people[k].fpd, `${g.personIds[k]}'s overtime`).toBe(0.5);
      });
    },
    TIMEOUT,
  );

  it.each(seeds([1]))(
    'mar2027 (Easter), seed %i: no must broken, two or three 12-hour shifts each',
    async (seed) => {
      const { g, ev } = await generate('mar2027', seed);
      expect(ev.mustUnits, musts(g, ev)).toBe(0);
      // 20 twelve-hour shifts (Good Friday, Easter Monday and 4 weekends)
      expect(twelveCounts(ev)).toEqual([2, 2, 2, 2, 3, 3, 3, 3]);
    },
    TIMEOUT,
  );

  it.each(seeds([1]))(
    'dec2027, seed %i: no must broken, and A and G, ahead in festive days, off on 24 to 26 Dec',
    async (seed) => {
      const { g, rows, ev } = await generate('dec2027', seed);
      expect(ev.mustUnits, musts(g, ev)).toBe(0);
      // 31 December is a working weekday, which A and G may need for their FPD: not asserted
      for (const id of ['A', 'G']) {
        const row = rowOf(g, rows, id);
        for (const date of ['2027-12-24', '2027-12-25', '2027-12-26']) {
          expect(isShift(row[dayOf(g, date)]), `${id} on ${date}`).toBe(false);
        }
      }
    },
    TIMEOUT,
  );

  it.each(seeds([1]))(
    'jul2027 (heavy leave), seed %i: no must broken',
    async (seed) => {
      const { g, ev } = await generate('jul2027', seed);
      expect(ev.mustUnits, musts(g, ev)).toBe(0);
    },
    TIMEOUT,
  );

  it.each(seeds([1]))(
    'impossible, seed %i: leaves only the 2 shifts no one can take uncovered, and bends no limit',
    async (seed) => {
      const { g, ev } = await generate('impossible', seed);
      // every must that costs HARD; a night for someone who never works nights (S1) is a strong
      // wish, which the generator may give to cover a night
      const bent = ['M2', 'M3', 'M4', 'M5', 'M8', 'M9', 'M10', 'M11', 'M13'];
      expect(ev.findings.filter((f) => bent.includes(f.rule))).toEqual([]);

      const coverage = ev.findings.filter((f) => f.rule === 'M1');
      const gaps = coverage.filter((f) => f.message.startsWith('chybí '));
      expect(coverage.filter((f) => !gaps.includes(f)), 'M1 findings other than gaps').toEqual([]);
      expect(gaps.reduce((missing, f) => missing + f.penalty / GAP, 0)).toBe(2);
      for (const f of gaps) {
        for (const i of f.days) expect(['2027-02-13', '2027-02-14']).toContain(g.ctx.days[i].date);
      }
    },
    TIMEOUT,
  );

  it.each(seeds([1]))(
    'pins, seed %i: no must broken, and D keeps the nights pinned from 11 to 15 January',
    async (seed) => {
      const { g, rows, ev } = await generate('pins', seed);
      expect(ev.mustUnits, musts(g, ev)).toBe(0);
      const row = rowOf(g, rows, 'D');
      const pinned = ['11', '12', '13', '14', '15'].map((day) => row[dayOf(g, `2027-01-${day}`)]);
      expect(pinned).toEqual([Code.N, Code.N, Code.N, Code.N, Code.N]);
    },
    TIMEOUT,
  );

  // Seeds 2, 3 and 5 are the first three of 1-8 on which the search, blind to the day after the
  // month, put C or E on the night of 31 January: the test fails on all three without the fix.
  it.each(seeds([2, 3, 5]))(
    'monthEnd, seed %i: no must broken, and no night on 31 January before a request on 1 February',
    async (seed) => {
      const { g, rows, ev } = await generate('monthEnd', seed);
      expect(ev.mustUnits, musts(g, ev)).toBe(0);

      // The same without the engine that steered the search: C, D, E and F have the morning of
      // 1 February taken, so none of them may be on a night that ends in it.
      const last = g.ctx.days.length - 1;
      expect(g.ctx.days[last].date).toBe('2027-01-31');
      for (const id of ['C', 'D', 'E', 'F']) {
        const code = rowOf(g, rows, id)[last];
        expect(isNight(code), `${id}'s code on 31 January`).toBe(false);
      }

      // And February, which reads January's last days as its tail, finds nothing wrong at its start.
      const { data, month } = scenario('monthEnd');
      const february = buildMonthGrid(applyRows(data, month, rows, g.fixed), '2027-02');
      const wrong = evaluateMonth(february.ctx, february.rows, true).findings.filter(
        (f) => f.severity === 'must' && (f.rule === 'M2' || f.rule === 'M4'),
      );
      expect(wrong.map((f) => f.message)).toEqual([]);
    },
    TIMEOUT,
  );

  it.each(seeds([1]))(
    'q1-2027, seed %i: January to March one after another, each sound and with no must broken, ' +
      'and over the quarter twelve-hour shifts within 2 of one another',
    async (seed) => {
      let data: AppData = scenario('q1-2027').data;
      const twelve = new Map<PersonId, number>(data.people.map((person) => [person.id, 0]));
      for (const month of ['2027-01', '2027-02', '2027-03'] as MonthKey[]) {
        const g = buildMonthGrid(data, month);
        // the months before, generated and applied, are history: their record makes them count
        g.ctx.people.forEach((person) => {
          expect(person.history.twelve, `${month}: ${person.id}'s history`).toBe(
            twelve.get(person.id),
          );
        });
        const r = await search(g.ctx, g.rows, g.fixed, { seed, maxIterations: ITERATIONS });
        const ev = evaluateMonth(g.ctx, r.rows, true);
        expectSound(g, r.rows, ev);
        expect(ev.mustUnits, `${month}: ${musts(g, ev)}`).toBe(0); // Musí: 0, M6 and M12 included
        ev.persons.forEach((p, k) => {
          const id = g.personIds[k];
          twelve.set(id, (twelve.get(id) ?? 0) + p.twelve - p.claimedTwelve);
        });
        // as the app applies a generated month: its cells, and its record as a draft
        data = applyRows(data, month, r.rows, g.fixed);
        data = { ...data, months: { ...data.months, [month]: { status: 'draft', seed } } };
      }
      const allQuarter = data.people.filter(
        (person) =>
          (person.activeFrom === null || person.activeFrom <= '2027-01-01') &&
          (person.activeTo === null || person.activeTo >= '2027-03-31'),
      );
      const counts = allQuarter.map((person) => twelve.get(person.id) ?? 0);
      const spread = Math.max(...counts) - Math.min(...counts);
      expect(spread, `12-hour shifts over the quarter: ${counts}`).toBeLessThanOrEqual(2);
    },
    TIMEOUT,
  );

  it.each(seeds([1]))(
    'claimed-holiday, seed %i: C keeps the claimed R12 of New Year\'s Day and may have 4 ' +
      'twelve-hour shifts, since the claim counts toward neither the minimum nor the maximum',
    async (seed) => {
      const { g, rows, ev } = await generate('claimed-holiday', seed);
      expectSound(g, rows, ev);
      const c = g.personIds.indexOf('C');
      expect(rows[c][dayOf(g, '2027-01-01')]).toBe(Code.R12);
      expect(ev.persons[c].claimedTwelve).toBe(1);
      expect(ev.persons[c].twelve).toBeLessThanOrEqual(4);
      const limits = ev.findings.filter(
        (f) => f.person === c && (f.rule === 'M5' || f.rule === 'M12'),
      );
      expect(limits.map((f) => line(g, f)), 'C\'s minimum and maximum').toEqual([]);
    },
    TIMEOUT,
  );

  it.each(seeds([1]))(
    'x-weekends, seed %i: D, free on one Saturday only, has at most 1 weekend shift, Kontrola ' +
      'shows M12 for D, and nothing else gives way',
    async (seed) => {
      const { g, rows, ev } = await generate('x-weekends', seed);
      expectSound(g, rows, ev);
      const d = g.personIds.indexOf('D');
      expect(ev.persons[d].twelve).toBeLessThanOrEqual(1);
      const short = ev.findings.filter((f) => f.rule === 'M12' && f.person === d);
      expect(short.map((f) => f.severity)).toEqual(['must']);
    },
    TIMEOUT,
  );

  it.each(seeds([1]))(
    'doctor, seed %i: no must that costs HARD, and at least half of the shifts on days with a ' +
      'doctor\'s appointment keep an hour clear of it',
    async (seed) => {
      const { data } = scenario('doctor');
      const { g, rows, ev } = await generate('doctor', seed);
      expectSound(g, rows, ev);
      // W10 is quiet, so Kontrola shows nothing of it: the rows tell
      let withShift = 0;
      let clear = 0;
      for (const [date, notes] of Object.entries(data.doctor)) {
        for (const [id, note] of Object.entries(notes)) {
          const row = rowOf(g, rows, id);
          const i = dayOf(g, date);
          if (!isShift(row[i])) continue;
          withShift++;
          if (clearOfDoctor(g, row, i, note.from, note.to)) clear++;
        }
      }
      expect(withShift, 'appointments on a day with a shift').toBeGreaterThan(0);
      expect(clear, `clear of ${withShift} appointments`).toBeGreaterThanOrEqual(withShift / 2);
    },
    TIMEOUT,
  );
});
