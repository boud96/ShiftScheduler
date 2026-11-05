import { codeFromName, isShift } from '../domain/codes';
import { applyRows, buildMonthGrid } from '../domain/context';
import { newPerson } from '../domain/defaults';
import type {
  AppData,
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
  /** Pins a shift, or unpins a pinned one. Any other cell is left as it is. */
  | { type: 'togglePin'; date: ISODate; personId: PersonId }
  | { type: 'applyPaste'; plan: PastePlan }
  | {
      type: 'applyGenerated';
      month: MonthKey;
      /** The month a run found, a row per person of `personIds`. */
      rows: Uint8Array[];
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

function setCell(
  data: AppData,
  date: ISODate,
  personId: PersonId,
  cell: StoredCell | null,
): AppData {
  const day = data.cells[date];
  if (cell === null) {
    if (day === undefined || !Object.hasOwn(day, personId)) return data;
    const rest = without(day, personId);
    const cells = { ...data.cells };
    if (Object.keys(rest).length > 0) cells[date] = rest;
    else delete cells[date];
    return { ...data, cells };
  }
  return { ...data, cells: { ...data.cells, [date]: { ...day, [personId]: cell } } };
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
 * Stores a month found by a run that started some time ago. The rows are matched to people by id
 * against the grid as it is now, so a person added, removed or moved since is handled. Only the
 * cells that are free in that grid are written: an edit made while the run went on is kept.
 */
function applyGenerated(data: AppData, a: Extract<Action, { type: 'applyGenerated' }>): AppData {
  const grid = buildMonthGrid(data, a.month);
  const found = new Map(a.personIds.map((id, i) => [id, a.rows[i]]));
  // A person who was not in the run keeps their row, so nothing is written for them.
  const rows = grid.personIds.map((id, p) => found.get(id) ?? grid.rows[p]);
  const applied = applyRows(data, a.month, rows, grid.fixed);
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

function removePerson(data: AppData, personId: PersonId): AppData {
  if (!data.people.some((p) => p.id === personId)) return data;
  const cells: AppData['cells'] = {};
  for (const [date, day] of Object.entries(data.cells)) {
    if (!Object.hasOwn(day, personId)) cells[date] = day;
    else if (Object.keys(day).length > 1) cells[date] = without(day, personId);
  }
  const months = Object.fromEntries(
    Object.entries(data.months).map(([month, meta]) => [month, dropAdjustment(meta, personId)]),
  );
  return { ...data, people: data.people.filter((p) => p.id !== personId), cells, months };
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
