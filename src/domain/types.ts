/** A calendar date as `YYYY-MM-DD`. All date arithmetic on it is done in UTC. */
export type ISODate = string;
/** A month as `YYYY-MM`. */
export type MonthKey = string;
export type PersonId = string;

export type ShiftName = 'R1' | 'R2' | 'O20' | 'O' | 'N' | 'R12' | 'N12';
export type WeekdayShift = 'R1' | 'R2' | 'O20' | 'O' | 'N';
export type AbsenceName = 'DOV' | 'MD' | 'OP' | 'NEM';
/** What a stored cell can hold. `x` is a request for "no shift that day", not an absence. */
export type CodeName = ShiftName | AbsenceName | 'x';

export type Rating = 1 | 2 | 3 | 4 | 5;
export type NightsPref = 'never' | 'ifNeeded' | 'normal' | 'extra';
export type WeekendStyle = 'whole' | 'single' | 'any';
export type AfterWeekend = 'want' | 'noAutomatic' | 'any';

export interface Preferences {
  ratings: Partial<Record<WeekdayShift, Rating>>;
  nights: NightsPref;
  weekendStyle: WeekendStyle;
  afterWeekend: AfterWeekend;
  afterNights: Array<'R1' | 'R2' | 'O' | 'O20'>;
  notes: string;
}

export interface FairnessCounts {
  twelve: number;
  nights: number;
  holidayTwelve: number;
  festive: number;
}

export interface Person {
  id: PersonId;
  name: string;
  activeFrom: ISODate | null;
  activeTo: ISODate | null;
  prefs: Preferences;
  /** The most 12-hour shifts a month for this person; null means the general maximum. */
  maxTwelve: number | null;
  /** The most nights (N and N12) a month for this person; null means no limit. */
  maxNights: number | null;
  allowance: { DOV: number; MD: number };
  startingCounts: FairnessCounts;
}

export type WishId =
  | 'W1'
  | 'W2'
  | 'W3'
  | 'W4a'
  | 'W4b'
  | 'W4c'
  | 'W4d'
  | 'W5a'
  | 'W5b'
  | 'W5c'
  | 'W5d'
  | 'W6'
  | 'W7'
  | 'W8'
  | 'W9'
  | 'W10';
/** How much a wish matters: 0 switches it off, 5 is the strongest. */
export type Level = 0 | 1 | 2 | 3 | 4 | 5;

/** How many people may hold a shift on one day; `max: null` means no upper limit. */
export interface Range {
  min: number;
  max: number | null;
}
/** Minutes from midnight of the start day; `end` may exceed 1440 (a shift ending next day). */
export interface ShiftTime {
  start: number;
  end: number;
  hours: number;
}

export interface Settings {
  shifts: Record<ShiftName, ShiftTime>;
  absenceHours: number;
  fpdHoursPerWeekday: number;
  coverage: Record<ShiftName, Range>;
  minRestHours: number;
  /** The most working days a person may have in a row. */
  maxDaysInRow: number;
  /** The fewest weekend shifts (R12 or N12) a person has in a month. */
  minWeekendShifts: number;
  /** The rest, in hours, that every 7 consecutive days must contain. */
  weeklyRestHours: number;
  maxTwelvePerMonth: number;
  twelveTarget: number;
  wishLevels: Record<WishId, Level>;
  dayTypeOverrides: Record<ISODate, 'weekday' | 'twelve'>;
  fairnessWindowMonths: number;
  /** Festive days as `MM-DD`, for the fairness count. */
  festiveDays: string[];
  generatorTimeBudgetSec: number;
}

export interface StoredCell {
  code: CodeName;
  pinned?: boolean;
}

/**
 * A doctor's appointment on one day, kept beside the code of that day's cell and not instead of
 * it. Minutes from midnight, whole numbers, with `0 <= from < to <= 1440`.
 */
export interface DoctorNote {
  from: number;
  to: number;
}

export interface MonthMeta {
  status: 'draft' | 'closed';
  seed?: number;
  generatedAt?: string;
  hoursAdjust?: Record<PersonId, number>;
}

export interface AppData {
  schemaVersion: 2;
  people: Person[];
  settings: Settings;
  cells: Record<ISODate, Record<PersonId, StoredCell>>;
  /** Doctor's appointments by day and person; a person in it is in `people`. */
  doctor: Record<ISODate, Record<PersonId, DoctorNote>>;
  months: Record<MonthKey, MonthMeta>;
}
