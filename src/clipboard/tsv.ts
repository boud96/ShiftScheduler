import { addDays, monthDays, tailDays } from '../domain/calendar';
import { codeFromName, isShift, nameOf } from '../domain/codes';
import { buildMonthGrid } from '../domain/context';
import { clock } from '../domain/format';
import type {
  AppData,
  CodeName,
  DoctorNote,
  ISODate,
  MonthKey,
  PersonId,
  StoredCell,
} from '../domain/types';

/**
 * The minutes of a time, if it has them: two digits after a colon or a dot, as `8:30` and `8.30`
 * are both written in Czech.
 */
const MINUTES = String.raw`(?:[:.]([0-5]\d))?`;

/**
 * An `L`, the time the appointment starts, a hyphen or an en dash, the time it ends. A time is the
 * hours (0 to 23, with or without a leading zero) and, if given, the minutes (`MINUTES`). The end
 * may also be 24, which `parseDoctor` lets through with no minutes only. Spaces may follow the L
 * and surround the dash.
 */
const DOCTOR = new RegExp(
  String.raw`^L\s*([01]?\d|2[0-3])${MINUTES}\s*[-–]\s*(2[0-4]|[01]?\d)${MINUTES}$`,
  'i',
);

/**
 * Reads a doctor's appointment as the team lead writes it in Excel, `L` with its time: `L 8-12`,
 * `L8-12`, `l 8:30 - 12:00`, `L 8.30-12` or `L 8–12`. The spaces around the cell are ignored, as
 * for a code. Anything else gives null, so that a cell which is no note is left out and not guessed
 * at: a bare `L`, one time only, an end that is not after the start (a note is a stretch of one
 * day), hours past 23 (24 is the end of the day, and allowed as the end only), minutes that are not
 * two digits from 00 to 59 (`8.5`, `8h30`), and text before the `L` or after the second time.
 */
export function parseDoctor(value: string): DoctorNote | null {
  const match = DOCTOR.exec(value.trim());
  if (match === null) return null;
  const from = Number(match[1]) * 60 + Number(match[2] ?? 0);
  const to = Number(match[3]) * 60 + Number(match[4] ?? 0);
  return from < to && to <= 1440 ? { from, to } : null;
}

/**
 * A doctor's note as the team lead writes it in Excel, which `parseDoctor` reads back: `L 8-12`,
 * `L 8:30-12`. The times are those of `clock` (a colon, not a dot) with the `:00` of a whole hour
 * left off, and the end of the day is 24.
 */
export function formatDoctor(note: DoctorNote): string {
  const time = (minutes: number): string => clock(minutes).replace(/:00$/, '');
  return `L ${time(note.from)}-${time(note.to)}`;
}

/**
 * One person's month as a row to paste into Excel: the code of each day, x and absences included,
 * or nothing on an empty day, separated by tabs. Pinned or not, a shift is just its name. A day
 * with a doctor's note and no code gives the note instead (`L 8-12`, see `formatDoctor`). A cell in
 * Excel holds one thing and a code comes first, so that the sheet shows the x and the absences; the
 * note of a day that has a code stays in the app.
 */
export function personRowTsv(data: AppData, month: MonthKey, personId: PersonId): string {
  return monthDays(month, data.settings)
    .map(({ date }) => {
      const cell = data.cells[date]?.[personId];
      if (cell !== undefined) return cell.code;
      const note = data.doctor[date]?.[personId];
      return note === undefined ? '' : formatDoctor(note);
    })
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
   * The doctor's notes to store, row by row: the cells that read as `L` with a time. A note is
   * kept beside the code of its day, so such a cell is no entry of `writes`.
   */
  doctorWrites: Array<{ personId: PersonId; date: ISODate; note: DoctorNote }>;
  /**
   * The pasted values that were not used, row by row. `row` and `col` count from 0 in the text as
   * pasted (a names column included), and `value` is the cell as pasted.
   */
  ignored: Array<{ row: number; col: number; value: string }>;
  /**
   * True when the first column was left out as a names column, so that the dialog can say so. It
   * follows from the text alone, not from where the values land.
   */
  namesColumn: boolean;
}

/** What a pasted cell holds: nothing, a code, a doctor's note, or something that is neither. */
type Cell =
  | { kind: 'empty' }
  | { kind: 'code'; code: CodeName }
  | { kind: 'doctor'; note: DoctorNote }
  | { kind: 'other' };

/** Reads a pasted cell as a code or a doctor's note, trimming it as `codeFromName` does. */
function readCell(value: string): Cell {
  const code = codeFromName(value);
  if (code !== null) {
    const name = nameOf(code);
    return name === null ? { kind: 'empty' } : { kind: 'code', code: name };
  }
  const note = parseDoctor(value);
  return note === null ? { kind: 'other' } : { kind: 'doctor', note };
}

/**
 * The first column holds names, not days, when it has a value and none of its values is a code or a
 * doctor's note. An empty first column is a day column: a copied row whose first day is empty
 * starts that way, and so does one whose first day is a note.
 */
function hasNamesColumn(rows: string[][]): boolean {
  const filled = rows.map((cells) => readCell(cells[0]).kind).filter((kind) => kind !== 'empty');
  return filled.length > 0 && filled.every((kind) => kind === 'other');
}

/**
 * Plans what pasting `text` (cells copied from Excel) does to `month`. The first row goes to
 * `start.personId` and the next rows to the next people of the month grid (`buildMonthGrid`: the
 * people in the team on at least one day of the month, in the order of `data.people`); the first
 * column goes to `start.date` and the next columns to the next dates. Only the last 7 days of the
 * previous month and the days of `month` take a value.
 *
 * Empty cells write nothing. A code goes to `writes` and a doctor's note (`L 8-12`, see
 * `parseDoctor`) to `doctorWrites`, both under the same rules: the same people and the same days. A
 * value that is neither, and a value that has no person (a row beyond the last person, or a start
 * person who is not in the month grid) or no valid date, is listed in `ignored`. A first column
 * holding only values that are neither codes nor notes (and at least one) is taken for names and
 * left out, unlisted; `namesColumn` says so. `data` is not changed.
 */
export function planPaste(
  data: AppData,
  month: MonthKey,
  start: { personId: PersonId; date: ISODate },
  text: string,
): PastePlan {
  const rows = parseTsv(text);
  const namesColumn = hasNamesColumn(rows);
  const skip = namesColumn ? 1 : 0;
  const valid = new Set(
    [...tailDays(month, data.settings), ...monthDays(month, data.settings)].map((day) => day.date),
  );
  const { personIds } = buildMonthGrid(data, month);
  const first = personIds.indexOf(start.personId);
  const plan: PastePlan = { writes: [], doctorWrites: [], ignored: [], namesColumn };

  rows.forEach((cells, row) => {
    const personId = first < 0 ? undefined : personIds[first + row];
    cells.forEach((value, col) => {
      if (col < skip) return; // the names
      const cell = readCell(value);
      if (cell.kind === 'empty') return; // empty: nothing to write, nothing to report
      const date = addDays(start.date, col - skip);
      if (personId === undefined || !valid.has(date) || cell.kind === 'other') {
        plan.ignored.push({ row, col, value });
      } else if (cell.kind === 'code') {
        plan.writes.push({ personId, date, code: cell.code });
      } else {
        plan.doctorWrites.push({ personId, date, note: cell.note });
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

/**
 * Stores the cells and the doctor's notes of a plan in a copy of `data`, over whatever they held.
 * A note goes beside the cell of its day and leaves the cell as it is, and a cell that is stored
 * leaves the notes of its day. Only `writes` and `doctorWrites` are read, so a plan built by hand
 * needs no `ignored` or `namesColumn`, and one with no notes needs no `doctorWrites`. The plan is
 * taken as it is: `planPaste` makes notes only for people of `data` and only for stretches of one
 * day, as the save file asks.
 */
export function applyPaste(
  data: AppData,
  plan: Pick<PastePlan, 'writes'> & Partial<PastePlan>,
): AppData {
  const cells = { ...data.cells };
  for (const { personId, date, code } of plan.writes) {
    cells[date] = { ...cells[date], [personId]: storedCell(code) };
  }
  const doctor = { ...data.doctor };
  for (const { personId, date, note } of plan.doctorWrites ?? []) {
    doctor[date] = { ...doctor[date], [personId]: note };
  }
  return { ...data, cells, doctor };
}
