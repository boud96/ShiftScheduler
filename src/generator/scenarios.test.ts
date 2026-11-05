import { describe, expect, it } from 'vitest';
import { Code, isAbsence, isNight, isShift } from '../domain/codes';
import { buildMonthGrid } from '../domain/context';
import type { MonthGrid } from '../domain/context';
import { evaluateMonth } from '../domain/rules/evaluate';
import type { MonthEval } from '../domain/rules/evaluate';
import { GAP } from '../domain/rules/weights';
import type { ISODate, PersonId } from '../domain/types';
import { scenario } from '../test/scenarios';
import type { ScenarioName } from '../test/scenarios';
import { search } from './search';

/** Counted in iterations, with no time budget: a scenario and a seed always give the same month. */
const ITERATIONS = 300_000;
const TIMEOUT = 120_000;

interface Generated {
  g: MonthGrid;
  rows: Uint8Array[];
  ev: MonthEval;
}

/** Generates the month of a scenario, and evaluates it with every finding listed. */
async function generate(name: ScenarioName, seed = 1): Promise<Generated> {
  const { data, month } = scenario(name);
  const g = buildMonthGrid(data, month);
  const r = await search(g.ctx, g.rows, g.fixed, { seed, maxIterations: ITERATIONS });
  return { g, rows: r.rows, ev: evaluateMonth(g.ctx, r.rows, true) };
}

/** The broken musts, one line each: what a failing `mustUnits` check shows. */
function musts(g: MonthGrid, ev: MonthEval): string {
  const lines = ev.findings
    .filter((f) => f.severity === 'must')
    .map((f) => {
      const who = f.person === null ? '' : `${g.personIds[f.person]} `;
      const when = f.days.map((i) => g.ctx.days[i].date).join(', ');
      return `${f.rule} ${who}${when}: ${f.message}`;
    });
  return `broken musts:\n${lines.join('\n')}`;
}

/** The row of person `id`. */
function rowOf(g: MonthGrid, rows: Uint8Array[], id: PersonId): Uint8Array {
  return rows[g.personIds.indexOf(id)];
}

/** The index in `ctx.days` of `date`. */
function dayOf(g: MonthGrid, date: ISODate): number {
  return g.ctx.days.findIndex((day) => day.date === date);
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
  it('builds July 2027 with at most two people away on any day', () => {
    const { data, month } = scenario('jul2027');
    const g = buildMonthGrid(data, month);
    for (let i = g.ctx.first; i < g.ctx.days.length; i++) {
      const away = g.rows.filter((row) => isAbsence(row[i])).length;
      expect(away).toBeLessThanOrEqual(2);
    }
  });

  it.each([1, 2, 3])(
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

  it(
    'feb2027: no must broken, two 12-hour shifts each and 0.5 h over FPD',
    async () => {
      const { g, ev } = await generate('feb2027');
      expect(ev.mustUnits, musts(g, ev)).toBe(0);
      ev.persons.forEach((p, k) => {
        expect(p.twelve, `${g.personIds[k]}'s 12-hour shifts`).toBe(2);
        expect(p.hours - g.ctx.people[k].fpd, `${g.personIds[k]}'s overtime`).toBe(0.5);
      });
    },
    TIMEOUT,
  );

  it(
    'mar2027 (Easter): no must broken, two or three 12-hour shifts each',
    async () => {
      const { g, ev } = await generate('mar2027');
      expect(ev.mustUnits, musts(g, ev)).toBe(0);
      // 20 twelve-hour shifts (Good Friday, Easter Monday and 4 weekends)
      expect(twelveCounts(ev)).toEqual([2, 2, 2, 2, 3, 3, 3, 3]);
    },
    TIMEOUT,
  );

  it(
    'dec2027: no must broken, and no shift on 24 to 26 December for A and G, ahead in festive days',
    async () => {
      const { g, rows, ev } = await generate('dec2027');
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

  it(
    'jul2027 (heavy leave): no must broken',
    async () => {
      const { g, ev } = await generate('jul2027');
      expect(ev.mustUnits, musts(g, ev)).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'impossible: leaves only the 2 shifts no one can take uncovered, and bends no limit',
    async () => {
      const { g, ev } = await generate('impossible');
      const bent = ['M2', 'M3', 'M4', 'M5', 'M7', 'M8'];
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

  it(
    'pins: no must broken, and D keeps the nights pinned from 11 to 15 January',
    async () => {
      const { g, rows, ev } = await generate('pins');
      expect(ev.mustUnits, musts(g, ev)).toBe(0);
      const row = rowOf(g, rows, 'D');
      const pinned = ['11', '12', '13', '14', '15'].map((day) => row[dayOf(g, `2027-01-${day}`)]);
      expect(pinned).toEqual([Code.N, Code.N, Code.N, Code.N, Code.N]);
    },
    TIMEOUT,
  );
});
