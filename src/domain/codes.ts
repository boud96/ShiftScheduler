import type { CodeName } from './types';

/** Numeric cell codes, so the rule engine and the generator can work on `Uint8Array` rows. */
export const Code = {
  EMPTY: 0,
  R1: 1,
  R2: 2,
  O20: 3,
  O: 4,
  N: 5,
  R12: 6,
  N12: 7,
  DOV: 8,
  MD: 9,
  OP: 10,
  NEM: 11,
  X: 12,
} as const;
export type CodeInt = (typeof Code)[keyof typeof Code];

/** The name of each code, indexed by its number. EMPTY has the empty name. */
export const CODE_NAMES: readonly string[] = [
  '', 'R1', 'R2', 'O20', 'O', 'N', 'R12', 'N12', 'DOV', 'MD', 'OP', 'NEM', 'x',
];

const BY_NAME = new Map<string, CodeInt>(
  CODE_NAMES.map((name, code) => [name.toUpperCase(), code as CodeInt]),
);

/** Reads a code from text typed or pasted by the user: trims it and ignores case. */
export function codeFromName(s: string): CodeInt | null {
  return BY_NAME.get(s.trim().toUpperCase()) ?? null;
}

/** The name stored in the save file; EMPTY (and any number outside the table) has none. */
export function nameOf(c: CodeInt): CodeName | null {
  return (CODE_NAMES[c] || null) as CodeName | null;
}

/** Any worked shift, weekday or twelve-hour. */
export function isShift(c: number): boolean {
  return c >= Code.R1 && c <= Code.N12;
}

export function isNight(c: number): boolean {
  return c === Code.N || c === Code.N12;
}

export function isTwelveShift(c: number): boolean {
  return c === Code.R12 || c === Code.N12;
}

export function isWeekdayShift(c: number): boolean {
  return c >= Code.R1 && c <= Code.N;
}

export function isAbsence(c: number): boolean {
  return c >= Code.DOV && c <= Code.NEM;
}

/** Not working that day: empty, a request (x) or an absence. */
export function isOff(c: number): boolean {
  return c === Code.EMPTY || c === Code.X || isAbsence(c);
}

export const WEEKDAY_CODES: readonly CodeInt[] = [Code.R1, Code.R2, Code.O20, Code.O, Code.N];
export const TWELVE_CODES: readonly CodeInt[] = [Code.R12, Code.N12];
