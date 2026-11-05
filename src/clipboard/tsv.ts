import { addDays, monthDays, tailDays } from '../domain/calendar';
import { codeFromName, isShift, nameOf } from '../domain/codes';
import type {
  AppData,
  CodeName,
  ISODate,
  MonthKey,
  PersonId,
  StoredCell,
} from '../domain/types';

/**
 * One person's month as a row to paste into Excel: the code of each day, x and absences included,
 * or nothing on an empty day, separated by tabs. Pinned or not, a shift is just its name.
 */
export function personRowTsv(data: AppData, month: MonthKey, personId: PersonId): string {
  return monthDays(month, data.settings)
    .map(({ date }) => data.cells[date]?.[personId]?.code ?? '')
    .join('\t');
}

/**
 * Splits text copied from Excel into rows of cells: rows are separated by `\n` or `\r\n`, cells by
 * a tab. One empty line at the very end is the newline after the last row, so it is not a row.
 * Empty cells and the spaces in a cell are kept.
 */
export function parseTsv(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => line.split('\t'));
}

export interface PastePlan {
  /** The cells to store, row by row. */
  writes: Array<{ personId: PersonId; date: ISODate; code: CodeName }>;
  /**
   * The pasted values that were not used, row by row. `row` and `col` count from 0 in the text as
   * pasted (a names column included), and `value` is the cell as pasted.
   */
  ignored: Array<{ row: number; col: number; value: string }>;
}

/** What a pasted cell holds: a code name, `''` if it is empty, or `null` if it is not a code. */
function readCell(value: string): CodeName | '' | null {
  const code = codeFromName(value);
  return code === null ? null : (nameOf(code) ?? '');
}

/**
 * The first column holds names, not days, when it has a value and none of its values is a code. An
 * empty first column is a day column: a copied row whose first day is empty starts that way.
 */
function hasNamesColumn(rows: string[][]): boolean {
  const filled = rows.map((cells) => readCell(cells[0])).filter((cell) => cell !== '');
  return filled.length > 0 && filled.every((cell) => cell === null);
}

/**
 * Plans what pasting `text` (cells copied from Excel) does to `month`. The first row goes to
 * `start.personId` and the next rows to the next people of `data.people`; the first column goes to
 * `start.date` and the next columns to the next dates. Only the last 7 days of the previous month
 * and the days of `month` take a value.
 *
 * Empty cells write nothing. A value that is not a code, and a value that has no person or no valid
 * date, is listed in `ignored`. A first column holding only values that are not codes (and at least
 * one) is taken for names and left out, unlisted. `data` is not changed.
 */
export function planPaste(
  data: AppData,
  month: MonthKey,
  start: { personId: PersonId; date: ISODate },
  text: string,
): PastePlan {
  const rows = parseTsv(text);
  const skip = hasNamesColumn(rows) ? 1 : 0;
  const valid = new Set(
    [...tailDays(month, data.settings), ...monthDays(month, data.settings)].map((day) => day.date),
  );
  const first = data.people.findIndex((person) => person.id === start.personId);
  const plan: PastePlan = { writes: [], ignored: [] };

  rows.forEach((cells, row) => {
    const person = first < 0 ? undefined : data.people[first + row];
    cells.forEach((value, col) => {
      if (col < skip) return; // the names
      const code = readCell(value);
      if (code === '') return; // empty: nothing to write, nothing to report
      const date = addDays(start.date, col - skip);
      if (person !== undefined && code !== null && valid.has(date)) {
        plan.writes.push({ personId: person.id, date, code });
      } else {
        plan.ignored.push({ row, col, value });
      }
    });
  });
  return plan;
}

/** A pasted shift is pinned, so that generating again keeps it; x and absences are fixed anyway. */
function storedCell(code: CodeName): StoredCell {
  const c = codeFromName(code);
  return c !== null && isShift(c) ? { code, pinned: true } : { code };
}

/** Stores the cells of a plan in a copy of `data`, over whatever they held. */
export function applyPaste(data: AppData, plan: PastePlan): AppData {
  const cells = { ...data.cells };
  for (const { personId, date, code } of plan.writes) {
    cells[date] = { ...cells[date], [personId]: storedCell(code) };
  }
  return { ...data, cells };
}
