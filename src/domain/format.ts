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
