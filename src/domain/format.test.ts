import { describe, it, expect } from 'vitest';
import { clock, fmtH, days, nightShifts, shortDate, twelveShifts, weekendShifts } from './format';

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

describe('weekendShifts', () => {
  it('uses the Czech plural forms of "víkendová směna"', () => {
    expect(weekendShifts(1)).toBe('1 víkendová směna');
    expect(weekendShifts(2)).toBe('2 víkendové směny');
    expect(weekendShifts(3)).toBe('3 víkendové směny');
    expect(weekendShifts(4)).toBe('4 víkendové směny');
    expect(weekendShifts(5)).toBe('5 víkendových směn');
  });
  it('treats 0 and the numbers from 5 up as the many form', () => {
    expect(weekendShifts(0)).toBe('0 víkendových směn');
    expect(weekendShifts(11)).toBe('11 víkendových směn');
    expect(weekendShifts(22)).toBe('22 víkendových směn');
  });
});

describe('nightShifts', () => {
  it('uses the Czech plural forms of "noční"', () => {
    expect(nightShifts(1)).toBe('1 noční');
    expect(nightShifts(2)).toBe('2 noční');
    expect(nightShifts(3)).toBe('3 noční');
    expect(nightShifts(4)).toBe('4 noční');
    expect(nightShifts(5)).toBe('5 nočních');
  });
  it('treats 0 and the numbers from 5 up as the many form', () => {
    expect(nightShifts(0)).toBe('0 nočních');
    expect(nightShifts(11)).toBe('11 nočních');
    expect(nightShifts(22)).toBe('22 nočních');
  });
});

describe('shortDate', () => {
  it('gives the Czech day and month of a date, without zeros: D. M.', () => {
    expect(shortDate('2027-01-04')).toBe('4. 1.');
    expect(shortDate('2027-12-31')).toBe('31. 12.');
    expect(shortDate('2026-10-09')).toBe('9. 10.');
  });
  it('does not depend on the year', () => {
    expect(shortDate('2028-02-29')).toBe('29. 2.');
  });
});

describe('clock', () => {
  it('gives minutes from midnight as hours and minutes, with no zero before the hour', () => {
    expect(clock(480)).toBe('8:00');
    expect(clock(390)).toBe('6:30');
    expect(clock(725)).toBe('12:05');
    expect(clock(0)).toBe('0:00');
  });
  it('keeps two digits for the minutes', () => {
    expect(clock(1)).toBe('0:01');
    expect(clock(61)).toBe('1:01');
    expect(clock(599)).toBe('9:59');
  });
  it('reaches 24:00 at the end of the day', () => {
    expect(clock(1440)).toBe('24:00');
  });
});
