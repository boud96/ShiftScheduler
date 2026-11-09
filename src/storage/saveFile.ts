import { CODE_NAMES } from '../domain/codes';
import { defaultSettings, newPerson } from '../domain/defaults';
import type { AppData, ISODate, Person, Settings } from '../domain/types';

/** The version of the save file format that this app writes. */
export const SCHEMA_VERSION = 2;

/** The oldest version that this app still opens: Phase 1 wrote version 1. */
const OLDEST_VERSION = 1;

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

const isWholeNumber = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Whether the version is one that this app opens: a whole number from the oldest to the newest. */
const isReadableVersion = (v: unknown): v is number =>
  isWholeNumber(v) && v >= OLDEST_VERSION && v <= SCHEMA_VERSION;

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

/** The least a person must have to be one: an id of their own and a name. The rest is completed. */
const isPerson = (v: unknown): v is Json & { id: string; name: string } =>
  isObject(v) && typeof v.id === 'string' && v.id !== '' && typeof v.name === 'string';

const isPeople = (v: unknown): v is Array<Json & { id: string; name: string }> =>
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

const MINUTES_PER_DAY = 1440;

/** A doctor's note: whole minutes from midnight, with `0 <= from < to <= 1440`. */
const isDoctorNote = (v: unknown): boolean =>
  isObject(v) &&
  isWholeNumber(v.from) &&
  isWholeNumber(v.to) &&
  v.from >= 0 &&
  v.from < v.to &&
  v.to <= MINUTES_PER_DAY;

/** The notes of one day: each is a real note, of whoever it is. */
const isDoctorDay = (v: unknown): boolean => isObject(v) && Object.values(v).every(isDoctorNote);

const isDoctor = (v: unknown): v is AppData['doctor'] =>
  isObject(v) && Object.entries(v).every(([date, day]) => isCalendarDate(date) && isDoctorDay(day));

/**
 * The notes without those of people who are not in `personIds`, and without the days that this
 * leaves empty; a day that was empty in the file stays. The app makes no such note, so one is a
 * hand edit, and refusing the whole file for it would be the costliest answer to a harmless slip.
 * The cells of such a person are kept as well.
 */
function withoutStrangers(
  doctor: AppData['doctor'],
  personIds: ReadonlySet<string>,
): AppData['doctor'] {
  const kept: AppData['doctor'] = {};
  for (const [date, day] of Object.entries(doctor)) {
    const notes = Object.entries(day);
    const known = notes.filter(([id]) => personIds.has(id));
    if (known.length === notes.length) kept[date] = day;
    else if (known.length > 0) kept[date] = Object.fromEntries(known);
  }
  return kept;
}

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
 * The date if it is a real calendar date written `YYYY-MM-DD`, else null: the person is then in the
 * team without a limit on that side.
 */
const dateOrNull = (v: unknown): ISODate | null =>
  typeof v === 'string' && isCalendarDate(v) ? v : null;

/**
 * The limit if it is a whole number from 0 up, else null: the person is then under the general
 * maximum of 12-hour shifts, and has no limit on nights. 0 is a limit, not a missing one.
 */
const limitOrNull = (v: unknown): number | null => (isWholeNumber(v) && v >= 0 ? v : null);

/**
 * A person of a file, completed from the defaults of `newPerson` entry by entry, as the settings
 * are: an entry the file lacks, or has as anything but what it should be (an object for `prefs`,
 * `allowance`, `startingCounts` and the ratings), is taken from the defaults, and one that it has
 * stays. The app builds a month straight from the person, so a person without `prefs` would bring
 * the page down. `activeFrom` and `activeTo` are null unless they are real dates.
 */
function completePerson(given: Json & { id: string; name: string }): Person {
  const defaults = newPerson(given.id, given.name);
  const prefs = isObject(given.prefs) ? given.prefs : {};
  return {
    id: defaults.id,
    name: defaults.name,
    activeFrom: dateOrNull(given.activeFrom),
    activeTo: dateOrNull(given.activeTo),
    prefs: {
      ...fillIn(defaults.prefs, prefs),
      // The ratings are an entry of their own, and may hold only some of the shifts.
      ratings: fillIn(defaults.prefs.ratings, prefs.ratings),
    },
    maxTwelve: limitOrNull(given.maxTwelve),
    maxNights: limitOrNull(given.maxNights),
    allowance: fillIn(defaults.allowance, given.allowance),
    startingCounts: fillIn(defaults.startingCounts, given.startingCounts),
  };
}

/**
 * Reads the text of a save file. It throws a `SaveFileError` for a file that is not a plan, one
 * from a newer version of the app, or one that is damaged. The checks are what the app relies on
 * when it builds a month: people with their own ids, cells on real dates holding real codes,
 * doctor's notes on real dates with a real time of day, months with a status. A doctor's note of a
 * person who is not in the file is dropped, not refused (a cell of such a person is kept): the app
 * makes none, so it comes from a hand edit. A person is completed from the defaults where the file
 * lacks an entry (see `completePerson`), and so are the settings. Anything else is trusted as the
 * app wrote it. Keys the app does not know are dropped, so the result is exactly an `AppData`. A
 * file the app wrote always passes.
 *
 * Version 1, which Phase 1 wrote, is opened too. It differs from version 2 only by what it lacks:
 * the doctor's notes, the limits of a person, three settings and the wish W10. All of them are
 * completed from the defaults (no notes, no limits), and the result is of the current version, so
 * the next save writes version 2.
 */
export function parseSaveFile(text: string): AppData {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new SaveFileError(NOT_A_PLAN);
  }
  if (!isObject(file) || file.app !== APP_ID) throw new SaveFileError(NOT_A_PLAN);

  const { schemaVersion, people, settings, cells, months = {}, doctor = {} } = file;
  if (typeof schemaVersion === 'number' && schemaVersion > SCHEMA_VERSION) {
    throw new SaveFileError(TOO_NEW);
  }
  if (
    !isReadableVersion(schemaVersion) ||
    !isPeople(people) ||
    !isObject(settings) ||
    !isCells(cells) ||
    !isMonths(months) ||
    !isDoctor(doctor)
  ) {
    throw new SaveFileError(CORRUPT);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    people: people.map(completePerson),
    settings: completeSettings(settings),
    cells,
    doctor: withoutStrangers(doctor, new Set(people.map((person) => person.id))),
    months,
  };
}
