/** Hours with a Czech decimal comma: `8` gives `8`, `127.5` gives `127,5`. */
export function fmtH(h: number): string {
  // Round to 2 decimals so sums such as 0.1 + 0.2 do not print as 0,30000000000000004.
  return String(Math.round(h * 100) / 100).replace('.', ',');
}

/** A number of days with the Czech plural: 1 den, 2-4 dny, 0 and 5 or more dní. */
export function days(n: number): string {
  const form = n === 1 ? 'den' : n >= 2 && n <= 4 ? 'dny' : 'dní';
  return `${n} ${form}`;
}

/**
 * A number of 12-hour shifts with the Czech plural: 1 dvanáctihodinová směna, 2-4 dvanáctihodinové
 * směny, 0 and 5 or more dvanáctihodinových směn.
 */
export function twelveShifts(n: number): string {
  const form =
    n === 1
      ? 'dvanáctihodinová směna'
      : n >= 2 && n <= 4
        ? 'dvanáctihodinové směny'
        : 'dvanáctihodinových směn';
  return `${n} ${form}`;
}

/**
 * A number of weekend shifts with the Czech plural: 1 víkendová směna, 2-4 víkendové směny, 0 and
 * 5 or more víkendových směn.
 */
export function weekendShifts(n: number): string {
  const form =
    n === 1 ? 'víkendová směna' : n >= 2 && n <= 4 ? 'víkendové směny' : 'víkendových směn';
  return `${n} ${form}`;
}

/** A number of nights with the Czech plural: 1 noční, 2-4 noční, 0 and 5 or more nočních. */
export function nightShifts(n: number): string {
  const form = n >= 1 && n <= 4 ? 'noční' : 'nočních';
  return `${n} ${form}`;
}

/** A date `YYYY-MM-DD` as the Czech `D. M.`: `2027-01-04` gives `4. 1.`. */
export function shortDate(date: string): string {
  return `${Number(date.slice(8, 10))}. ${Number(date.slice(5, 7))}.`;
}

/**
 * A time of day from whole minutes after midnight, as the Czech `H:MM`: `480` gives `8:00`, `390`
 * gives `6:30`. The end of the day, `1440`, is `24:00`.
 */
export function clock(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
