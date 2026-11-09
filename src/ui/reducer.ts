import { codeFromName, isShift } from '../domain/codes';
import { applyRows, buildMonthGrid } from '../domain/context';
import { newPerson } from '../domain/defaults';
import type {
  AppData,
  DoctorNote,
  ISODate,
  MonthKey,
  MonthMeta,
  Person,
  PersonId,
  Settings,
  StoredCell,
} from '../domain/types';
import { applyPaste } from '../clipboard/tsv';
import type { PastePlan } from '../clipboard/tsv';

/**
 * Everything that changes the app data. The reducer is pure, so what is random or depends on the
 * time comes in the action: the id of a new person and the time a month was generated.
 */
export type Action =
  | { type: 'load'; data: AppData }
  | { type: 'setCell'; date: ISODate; personId: PersonId; cell: StoredCell | null }
  /**
   * Stores the doctor's note of a person on a day beside the day's cell, which it does not touch;
   * null deletes the note. A person who is not in the team, and a note that is not a time span of
   * one day, are ignored: the save file drops the note of the first, and is refused with the other.
   */
  | { type: 'setDoctor'; date: ISODate; personId: PersonId; note: DoctorNote | null }
  /** Pins a shift, or unpins a pinned one. Any other cell is left as it is. */
  | { type: 'togglePin'; date: ISODate; personId: PersonId }
  /** Stores a paste: the cells and the doctor's notes of the plan, in this one step. */
  | { type: 'applyPaste'; plan: PastePlan }
  | {
      type: 'applyGenerated';
      month: MonthKey;
      /** The month a run found, a row per person of `personIds`. */
      rows: Uint8Array[];
      /** The cells the run could not change, aligned with `rows`: `buildMonthGrid(...).fixed`. */
      fixed: Uint8Array[];
      seed: number;
      /** The people of the rows: `buildMonthGrid(...).personIds` when the run started. */
      personIds: PersonId[];
      /** When the run ended, as an ISO time. */
      generatedAt: string;
    }
  | { type: 'updatePerson'; person: Person }
  /** The new person is named after the size of the team. `id` is unique, e.g. a random UUID. */
  | { type: 'addPerson'; id: PersonId }
  | { type: 'removePerson'; personId: PersonId }
  | { type: 'movePerson'; personId: PersonId; delta: -1 | 1 }
  /** The entries of `patch` replace those of the settings as they are, nested ones whole. */
  | { type: 'updateSettings'; patch: Partial<Settings> };

/** A copy of the record without `key`. */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

/** What is kept for each person on each day: the cells and the doctor's notes. */
type ByDay<T> = Record<ISODate, Record<PersonId, T>>;

/**
 * The record with `value` stored for the person on the date. Null removes it, and the day with it
 * when it was the last one there; the same record comes back when there was nothing to remove.
 */
function putByDay<T>(
  record: ByDay<T>,
  date: ISODate,
  personId: PersonId,
  value: T | null,
): ByDay<T> {
  const day = record[date];
  if (value === null) {
    if (day === undefined || !Object.hasOwn(day, personId)) return record;
    const rest = without(day, personId);
    const next = { ...record };
    if (Object.keys(rest).length > 0) next[date] = rest;
    else delete next[date];
    return next;
  }
  return { ...record, [date]: { ...day, [personId]: value } };
}

/** The record without the person, and without the days that held nobody else. */
function withoutPerson<T>(record: ByDay<T>, personId: PersonId): ByDay<T> {
  const rest: ByDay<T> = {};
  for (const [date, day] of Object.entries(record)) {
    if (!Object.hasOwn(day, personId)) rest[date] = day;
    else if (Object.keys(day).length > 1) rest[date] = without(day, personId);
  }
  return rest;
}

function setCell(
  data: AppData,
  date: ISODate,
  personId: PersonId,
  cell: StoredCell | null,
): AppData {
  const cells = putByDay(data.cells, date, personId, cell);
  return cells === data.cells ? data : { ...data, cells };
}

/** Whether the note is a stretch of one day in whole minutes: `0 <= from < to <= 1440`. */
function isTimeSpan({ from, to }: DoctorNote): boolean {
  return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from < to && to <= 1440;
}

function setDoctor(
  data: AppData,
  date: ISODate,
  personId: PersonId,
  note: DoctorNote | null,
): AppData {
  // A note for someone who is not in the team is dropped by `parseSaveFile`, and one that is no
  // time span makes it refuse the file, so neither is stored.
  if (note !== null && !(isTimeSpan(note) && data.people.some((p) => p.id === personId))) {
    return data;
  }
  const doctor = putByDay(data.doctor, date, personId, note);
  return doctor === data.doctor ? data : { ...data, doctor };
}

function togglePin(data: AppData, date: ISODate, personId: PersonId): AppData {
  const cell = data.cells[date]?.[personId];
  const code = cell === undefined ? null : codeFromName(cell.code);
  if (cell === undefined || code === null || !isShift(code)) return data;
  const wasPinned = cell.pinned === true;
  const toggled: StoredCell = wasPinned ? { code: cell.code } : { ...cell, pinned: true };
  return setCell(data, date, personId, toggled);
}

/**
 * Stores a month found by a run that started some time ago. The rows and the fixed cells of the run
 * are matched to people by id against the grid as it is now, so a person added, removed or moved
 * since is handled. A cell is written only if it was free when the run started and is free now:
 * an edit made during the run is kept, and so is a cell that the run could not change, such as an
 * x or an absence that the team lead has cleared since. The run's rows still hold such a cell as
 * it was.
 */
function applyGenerated(data: AppData, a: Extract<Action, { type: 'applyGenerated' }>): AppData {
  const grid = buildMonthGrid(data, a.month);
  const run = new Map(a.personIds.map((id, i) => [id, { row: a.rows[i], fixed: a.fixed[i] }]));
  const rows: Uint8Array[] = [];
  const fixed: Uint8Array[] = [];
  grid.personIds.forEach((id, p) => {
    const found = run.get(id);
    if (found === undefined) {
      // A person who was not in the run: nothing to write for them.
      rows.push(grid.rows[p]);
      fixed.push(new Uint8Array(grid.ctx.days.length).fill(1));
    } else {
      rows.push(found.row);
      fixed.push(grid.fixed[p].map((now, i) => now | found.fixed[i]));
    }
  });
  const applied = applyRows(data, a.month, rows, fixed);
  const meta: MonthMeta = {
    ...applied.months[a.month],
    status: 'draft',
    seed: a.seed,
    generatedAt: a.generatedAt,
  };
  return { ...applied, months: { ...applied.months, [a.month]: meta } };
}

/** The month without the hours adjustment of the person. */
function dropAdjustment(meta: MonthMeta, personId: PersonId): MonthMeta {
  if (meta.hoursAdjust?.[personId] === undefined) return meta;
  return { ...meta, hoursAdjust: without(meta.hoursAdjust, personId) };
}

/**
 * The team without the person, and without what is kept for them: their cells, their doctor's
 * notes and their hours adjustments. A note must not outlive its person: `data.doctor` holds notes
 * of people in the team only, and `parseSaveFile` drops the others.
 */
function removePerson(data: AppData, personId: PersonId): AppData {
  if (!data.people.some((p) => p.id === personId)) return data;
  const months = Object.fromEntries(
    Object.entries(data.months).map(([month, meta]) => [month, dropAdjustment(meta, personId)]),
  );
  return {
    ...data,
    people: data.people.filter((p) => p.id !== personId),
    cells: withoutPerson(data.cells, personId),
    doctor: withoutPerson(data.doctor, personId),
    months,
  };
}

function movePerson(data: AppData, personId: PersonId, delta: -1 | 1): AppData {
  const from = data.people.findIndex((p) => p.id === personId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= data.people.length) return data;
  const people = [...data.people];
  [people[from], people[to]] = [people[to], people[from]];
  return { ...data, people };
}

/**
 * The data after the action. The input is not modified. An action that has nothing to do (a pin on
 * a cell holding x, a person who is not there) gives the same data back, so that a caller can tell
 * by identity.
 */
export function reduce(data: AppData, a: Action): AppData {
  switch (a.type) {
    case 'load':
      return a.data;
    case 'setCell':
      return setCell(data, a.date, a.personId, a.cell);
    case 'setDoctor':
      return setDoctor(data, a.date, a.personId, a.note);
    case 'togglePin':
      return togglePin(data, a.date, a.personId);
    case 'applyPaste':
      return applyPaste(data, a.plan);
    case 'applyGenerated':
      return applyGenerated(data, a);
    case 'updatePerson':
      if (!data.people.some((p) => p.id === a.person.id)) return data;
      return { ...data, people: data.people.map((p) => (p.id === a.person.id ? a.person : p)) };
    case 'addPerson':
      if (data.people.some((p) => p.id === a.id)) return data;
      return {
        ...data,
        people: [...data.people, newPerson(a.id, `Operátor ${data.people.length + 1}`)],
      };
    case 'removePerson':
      return removePerson(data, a.personId);
    case 'movePerson':
      return movePerson(data, a.personId, a.delta);
    case 'updateSettings':
      return { ...data, settings: { ...data.settings, ...a.patch } };
  }
}
