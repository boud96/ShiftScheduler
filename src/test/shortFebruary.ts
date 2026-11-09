import { Code, codeFromName } from '../domain/codes';
import { applyRows, buildMonthGrid } from '../domain/context';
import type { MonthGrid } from '../domain/context';
import { newAppData } from '../domain/defaults';
import type { AppData, MonthKey } from '../domain/types';

/**
 * A quarter planned as the app plans it for a new plan (eight default people, no requests), taken
 * from a run in Node of the steps of `tests/e2e/plan-quarter.spec.ts`. January as the search
 * generated it (seed 300, 600,000 iterations), one strip a person: codes from day 1 of the month,
 * `-` for an empty cell.
 */
const JANUARY = [
  '- - - R2 R2 R2 R2 R2 - - O20 O20 O20 O20 O20 - - N N N N N - - - - R2 R2 R2 R12 R12',
  '- - R12 R2 R2 R2 - - R12 R12 - R2 R2 R2 R2 - - O20 O20 O20 O20 O20 - - O O O O O - -',
  '- R12 - O O O O O - - - N N N N N12 N12 - - R2 R2 R2 - - R2 R2 R2 R2 R2 - -',
  'N12 N12 N12 - - R2 R2 R2 - - R2 R2 R2 R2 - - - O O O O O - - R1 R1 R1 R1 R1 - -',
  '- - - N N N N N - - O O O O O - - R2 R2 R2 R2 - R12 R12 - R2 R2 R2 R2 - -',
  '- - - R2 R2 R2 R2 - N12 N12 N - - R2 R2 R12 - R1 R1 R1 R1 R1 - - O20 O20 O20 O20 O20 - -',
  'R12 - - O20 O20 O20 O20 O20 - - R1 R1 R1 R1 R1 - - R2 R2 R2 R2 - N12 N12 N N N - - - -',
  '- - - R1 R1 R1 R1 R1 - - R2 R2 R2 R2 - - R12 R2 R2 R2 R2 - - - R2 R2 - N N N12 N12',
];

/**
 * February as the search left it before the repair of the hours (seed 301, 600,000 iterations):
 * Operátor 8 (p8) one shift below FPD, 143 h of 150 h, and no other must broken. Every free day of
 * p8 is blocked: the run of days after January's last nights, the days off after it, runs of 7.
 */
const FEBRUARY = [
  '- - R2 R2 R2 R12 R12 - R2 R2 R2 R2 - - O O O O O - - R1 R1 R1 R1 R1 - -',
  'R2 R2 R2 R2 R2 - - R1 R1 R1 - - N12 N12 N N N N - - - O20 O20 O20 O20 O20 - -',
  'R2 R2 R2 R2 R2 - - O20 O20 O20 O20 O20 - - R2 R2 R2 - N N12 N12 - - O O O - -',
  'N N N - - - - R2 R2 R2 R2 R2 - - R1 R1 R1 R1 R1 - - O O - N N N12 N12',
  'O O - N N N12 N12 N - - R1 R1 - - O20 O20 O20 O20 O20 - - R2 R2 R2 R2 R2 - -',
  'O20 O20 O20 O20 O20 - - O O O O O - - - R2 R2 R2 R2 - - N N N - - R12 R12',
  'R1 R1 R1 R1 R1 - - - N N N N - - R2 R2 R2 R2 - R12 R12 - R2 R2 R2 R2 - -',
  '- - O O O - - R2 R2 R2 R2 - R12 R12 - R2 R2 R2 R2 - - R2 R2 R2 R2 R2 - -',
];

/** `grid`'s rows with the strips written over the days of its month. */
function rowsFrom(grid: MonthGrid, strips: string[]): Uint8Array[] {
  return grid.rows.map((row, p) => {
    const out = row.slice();
    strips[p].split(' ').forEach((name, k) => {
      const code = name === '-' ? Code.EMPTY : codeFromName(name);
      if (code === null) throw new Error(`Unknown code "${name}" in strip "${strips[p]}"`);
      out[grid.ctx.first + k] = code;
    });
    return out;
  });
}

/** The data of the plan once January is generated and applied, as the app keeps it. */
export function januaryApplied(): AppData {
  const data = newAppData();
  const month: MonthKey = '2027-01';
  const grid = buildMonthGrid(data, month);
  const applied = applyRows(data, month, rowsFrom(grid, JANUARY), grid.fixed);
  return { ...applied, months: { [month]: { status: 'draft', seed: 300 } } };
}

/** February of `januaryApplied()`, with the rows that the search left one shift short. */
export function shortFebruary(): MonthGrid {
  const grid = buildMonthGrid(januaryApplied(), '2027-02');
  return { ...grid, rows: rowsFrom(grid, FEBRUARY) };
}
