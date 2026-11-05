import { describe, it, expect } from 'vitest';
import { fmtH, days, twelveShifts } from './format';

describe('fmtH', () => {
  it('prints whole hours without a decimal part', () => {
    expect(fmtH(8)).toBe('8');
    expect(fmtH(0)).toBe('0');
  });
  it('uses a decimal comma', () => {
    expect(fmtH(127.5)).toBe('127,5');
    expect(fmtH(-4.5)).toBe('-4,5');
  });
  it('does not show floating-point noise', () => {
    expect(fmtH(0.1 + 0.2)).toBe('0,3');
    expect(fmtH(157.5 + 0.1)).toBe('157,6');
  });
});

describe('days', () => {
  it('uses the Czech plural forms', () => {
    expect(days(1)).toBe('1 den');
    expect(days(3)).toBe('3 dny');
    expect(days(5)).toBe('5 dní');
  });
  it('treats 0 and the numbers from 5 up as the many form', () => {
    expect(days(0)).toBe('0 dní');
    expect(days(2)).toBe('2 dny');
    expect(days(4)).toBe('4 dny');
    expect(days(11)).toBe('11 dní');
    expect(days(21)).toBe('21 dní');
    expect(days(22)).toBe('22 dní');
  });
});

describe('twelveShifts', () => {
  it('uses the Czech plural forms of "dvanáctihodinová směna"', () => {
    expect(twelveShifts(1)).toBe('1 dvanáctihodinová směna');
    expect(twelveShifts(2)).toBe('2 dvanáctihodinové směny');
    expect(twelveShifts(3)).toBe('3 dvanáctihodinové směny');
    expect(twelveShifts(4)).toBe('4 dvanáctihodinové směny');
    expect(twelveShifts(5)).toBe('5 dvanáctihodinových směn');
  });
  it('treats 0 and the numbers from 5 up as the many form', () => {
    expect(twelveShifts(0)).toBe('0 dvanáctihodinových směn');
    expect(twelveShifts(11)).toBe('11 dvanáctihodinových směn');
    expect(twelveShifts(21)).toBe('21 dvanáctihodinových směn');
    expect(twelveShifts(22)).toBe('22 dvanáctihodinových směn');
  });
});
