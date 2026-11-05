import { CODE_NAMES } from '../domain/codes';
import { defaultSettings } from '../domain/defaults';
import type { AppData, Person, Settings } from '../domain/types';

/** The version of the save file format that this app writes and reads. */
export const SCHEMA_VERSION = 1;

/** Marks a file as ours; the first thing `parseSaveFile` looks for. */
const APP_ID = 'shift-scheduler';

const NOT_A_PLAN = 'Tohle není soubor s plánem směn.';
const TOO_NEW = 'Soubor je z novější verze aplikace.';
const CORRUPT = 'Soubor je poškozený.';

/** A save file that cannot be used. Its message is Czech and fit to show to the user. */
export class SaveFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveFileError';
  }
}

/** The text of a save file: pretty JSON, the data behind the name of the app. */
export function serialize(data: AppData): string {
  return JSON.stringify({ app: APP_ID, ...data }, null, 2);
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** What a stored cell can hold: every code name but the empty one, which is no cell at all. */
const CELL_CODES: ReadonlySet<string> = new Set(CODE_NAMES.filter((name) => name !== ''));

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Whether the text is a real calendar date written as `YYYY-MM-DD`. */
function isCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // Built in UTC, like all date arithmetic here. An impossible date (30 February, month 13)
  // rolls over into another one, so it does not come back as it went in. setUTCFullYear, not
  // Date.UTC, so that a year below 100 stays as it is.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const isPerson = (v: unknown): boolean =>
  isObject(v) && typeof v.id === 'string' && v.id !== '' && typeof v.name === 'string';

const isPeople = (v: unknown): v is Person[] =>
  Array.isArray(v) && v.every(isPerson) && new Set(v.map((p) => p.id)).size === v.length;

const isStoredCell = (v: unknown): boolean =>
  isObject(v) &&
  typeof v.code === 'string' &&
  CELL_CODES.has(v.code) &&
  (v.pinned === undefined || typeof v.pinned === 'boolean');

const isDay = (v: unknown): boolean => isObject(v) && Object.values(v).every(isStoredCell);

const isCells = (v: unknown): v is AppData['cells'] =>
  isObject(v) && Object.entries(v).every(([date, day]) => isCalendarDate(date) && isDay(day));

const isMonth = (v: unknown): boolean =>
  isObject(v) && (v.status === 'draft' || v.status === 'closed');

const isMonths = (v: unknown): v is AppData['months'] =>
  isObject(v) && Object.entries(v).every(([key, month]) => MONTH_KEY.test(key) && isMonth(month));

/** `defaults` with the entries of `given` on top. Anything but an object counts as missing. */
function fillIn<T extends object>(defaults: T, given: unknown): T {
  return isObject(given) ? { ...defaults, ...given } : defaults;
}

/** The settings of a file, completed from the defaults where an older file has no such entry. */
function completeSettings(given: Json): Settings {
  const defaults = defaultSettings();
  return {
    ...fillIn(defaults, given),
    // A later version may add a shift or a wish, so these are filled in entry by entry.
    shifts: fillIn(defaults.shifts, given.shifts),
    coverage: fillIn(defaults.coverage, given.coverage),
    wishLevels: fillIn(defaults.wishLevels, given.wishLevels),
  };
}

/**
 * Reads the text of a save file. It throws a `SaveFileError` for a file that is not a plan, one
 * from a newer version of the app, or one that is damaged. The checks are what the app relies on
 * when it builds a month: people with their own ids, cells on real dates holding real codes,
 * months with a status. Anything else is trusted as the app wrote it. Keys the app does not know
 * are dropped, so the result is exactly an `AppData`. A file the app wrote always passes.
 */
export function parseSaveFile(text: string): AppData {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new SaveFileError(NOT_A_PLAN);
  }
  if (!isObject(file) || file.app !== APP_ID) throw new SaveFileError(NOT_A_PLAN);

  const { schemaVersion, people, settings, cells, months = {} } = file;
  if (typeof schemaVersion === 'number' && schemaVersion > SCHEMA_VERSION) {
    throw new SaveFileError(TOO_NEW);
  }
  if (
    schemaVersion !== SCHEMA_VERSION ||
    !isPeople(people) ||
    !isObject(settings) ||
    !isCells(cells) ||
    !isMonths(months)
  ) {
    throw new SaveFileError(CORRUPT);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    people,
    settings: completeSettings(settings),
    cells,
    months,
  };
}
