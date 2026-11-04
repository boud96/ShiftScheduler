import type { ISODate, MonthKey, Settings } from './types';

// All date arithmetic is done in UTC (Date.UTC and getUTC*), so daylight saving time and the
// time zone of the machine can never shift a date.

export interface DayInfo {
  date: ISODate;
  /** 0 = Monday ... 6 = Sunday. */
  weekday: number;
  dayType: 'weekday' | 'twelve';
  /** A Czech public holiday, whatever the day type is set to. */
  holiday: boolean;
  festive: boolean;
  inMonth: boolean;
}

/** How many days of the previous month the rules look back on. */
export const TAIL_DAYS = 7;

const pad2 = (n: number): string => String(n).padStart(2, '0');
const iso = (year: number, month: number, day: number): ISODate =>
  `${year}-${pad2(month)}-${pad2(day)}`;

function parseDate(date: ISODate): [year: number, month: number, day: number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

/** Monday-based: 0 = Monday ... 6 = Sunday. */
function weekdayOf(date: ISODate): number {
  const [y, m, d] = parseDate(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function daysInMonth(month: MonthKey): number {
  const [y, m] = parseDate(`${month}-01`);
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of the next month = last day of this one
}

export function addDays(date: ISODate, n: number): ISODate {
  const [y, m, d] = parseDate(date);
  const moved = new Date(Date.UTC(y, m - 1, d + n));
  return iso(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

export function addMonths(month: MonthKey, n: number): MonthKey {
  const [y, m] = parseDate(`${month}-01`);
  const index = y * 12 + (m - 1) + n;
  const year = Math.floor(index / 12);
  return `${year}-${pad2(index - year * 12 + 1)}`;
}

export function monthOf(date: ISODate): MonthKey {
  return date.slice(0, 7);
}

/** Easter Sunday by the anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(year: number): ISODate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/** The Czech public holidays of a year. */
export function czechHolidays(year: number): Set<ISODate> {
  const easter = easterSunday(year);
  return new Set<ISODate>([
    `${year}-01-01`,
    addDays(easter, -2), // Good Friday
    addDays(easter, 1), // Easter Monday
    `${year}-05-01`,
    `${year}-05-08`,
    `${year}-07-05`,
    `${year}-07-06`,
    `${year}-09-28`,
    `${year}-10-28`,
    `${year}-11-17`,
    `${year}-12-24`,
    `${year}-12-25`,
    `${year}-12-26`,
  ]);
}

function describeDays(dates: ISODate[], inMonth: boolean, settings: Settings): DayInfo[] {
  // The dates all lie in one calendar month, so in one year. Take it from the dates, not from the
  // month asked for: the tail of a January belongs to the previous year.
  const holidays = czechHolidays(Number(dates[0].slice(0, 4)));
  return dates.map((date) => {
    const weekday = weekdayOf(date);
    const holiday = holidays.has(date);
    const naturalType = weekday >= 5 || holiday ? 'twelve' : 'weekday';
    return {
      date,
      weekday,
      dayType: settings.dayTypeOverrides[date] ?? naturalType,
      holiday,
      festive: settings.festiveDays.includes(date.slice(5)),
      inMonth,
    };
  });
}

/** Every day of the month, in order. */
export function monthDays(month: MonthKey, settings: Settings): DayInfo[] {
  const dates = Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${pad2(i + 1)}`);
  return describeDays(dates, true, settings);
}

/** The last TAIL_DAYS days of the previous month, in order. */
export function tailDays(month: MonthKey, settings: Settings): DayInfo[] {
  const first = `${month}-01`;
  const dates = Array.from({ length: TAIL_DAYS }, (_, i) => addDays(first, i - TAIL_DAYS));
  return describeDays(dates, false, settings);
}

/** Mon-Fri days in the month; public holidays stay in the count. */
export function weekdayCount(month: MonthKey): number {
  const last = daysInMonth(month);
  let count = 0;
  for (let day = 1; day <= last; day++) {
    if (weekdayOf(`${month}-${pad2(day)}`) < 5) count++;
  }
  return count;
}

/** The working-time fund of a month, in hours. */
export function fpdForMonth(month: MonthKey, settings: Settings): number {
  return weekdayCount(month) * settings.fpdHoursPerWeekday;
}
