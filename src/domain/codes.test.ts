import { describe, it, expect } from 'vitest';
import {
  Code,
  CODE_NAMES,
  WEEKDAY_CODES,
  TWELVE_CODES,
  codeFromName,
  nameOf,
  isShift,
  isNight,
  isTwelveShift,
  isWeekdayShift,
  isAbsence,
  isOff,
} from './codes';

/** Names of the codes (EMPTY shown as '') for which the predicate holds. */
const matching = (pred: (c: number) => boolean): string[] => CODE_NAMES.filter((_, c) => pred(c));

describe('codeFromName', () => {
  it('trims and ignores case', () => {
    expect(codeFromName(' x ')).toBe(Code.X);
    expect(codeFromName('X')).toBe(Code.X);
    expect(codeFromName('dov')).toBe(Code.DOV);
    expect(codeFromName('\tn12\n')).toBe(Code.N12);
  });
  it('maps an empty string to EMPTY', () => {
    expect(codeFromName('')).toBe(Code.EMPTY);
    expect(codeFromName('   ')).toBe(Code.EMPTY);
  });
  it('returns null for anything unknown', () => {
    expect(codeFromName('Šk.')).toBeNull();
    expect(codeFromName('R3')).toBeNull();
    expect(codeFromName('HO')).toBeNull();
  });
});

describe('code table', () => {
  it('keeps CODE_NAMES in step with Code', () => {
    expect(CODE_NAMES).toHaveLength(13);
    expect(CODE_NAMES[Code.EMPTY]).toBe('');
    expect(CODE_NAMES[Code.X]).toBe('x');
    for (const [key, value] of Object.entries(Code)) {
      if (key !== 'EMPTY' && key !== 'X') expect(CODE_NAMES[value]).toBe(key);
    }
  });
  it('round-trips every code through its name', () => {
    for (const c of Object.values(Code)) {
      const name = nameOf(c);
      expect(codeFromName(name ?? '')).toBe(c);
    }
  });
  it('gives no name to EMPTY', () => {
    expect(nameOf(Code.EMPTY)).toBeNull();
    expect(nameOf(Code.X)).toBe('x');
    expect(nameOf(Code.N12)).toBe('N12');
  });
  it('lists the weekday and twelve-hour codes', () => {
    expect(WEEKDAY_CODES).toEqual([Code.R1, Code.R2, Code.O20, Code.O, Code.N]);
    expect(TWELVE_CODES).toEqual([Code.R12, Code.N12]);
  });
});

describe('predicates', () => {
  it('classify the codes as the rules need', () => {
    expect(isOff(Code.DOV)).toBe(true);
    expect(isNight(Code.N12)).toBe(true);
    expect(matching(isShift)).toEqual(['R1', 'R2', 'O20', 'O', 'N', 'R12', 'N12']);
    expect(matching(isNight)).toEqual(['N', 'N12']);
    expect(matching(isTwelveShift)).toEqual(['R12', 'N12']);
    expect(matching(isWeekdayShift)).toEqual(['R1', 'R2', 'O20', 'O', 'N']);
    expect(matching(isAbsence)).toEqual(['DOV', 'MD', 'OP', 'NEM']);
    expect(matching(isOff)).toEqual(['', 'DOV', 'MD', 'OP', 'NEM', 'x']);
  });
  it('are false for values outside the table', () => {
    for (const pred of [isShift, isNight, isTwelveShift, isWeekdayShift, isAbsence, isOff]) {
      expect(pred(13)).toBe(false);
      expect(pred(255)).toBe(false);
    }
  });
});
