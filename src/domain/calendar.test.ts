import { describe, it, expect } from 'vitest';
import {
  easterSunday,
  czechHolidays,
  monthDays,
  tailDays,
  fpdForMonth,
  addMonths,
  addDays,
  monthOf,
  weekdayCount,
} from './calendar';
import { defaultSettings } from './defaults';
const S = defaultSettings();

describe('calendar', () => {
  it('computes Easter Sunday', () => {
    expect([2026, 2027, 2028].map(easterSunday)).toEqual(['2026-04-05', '2027-03-28', '2028-04-16']);
  });
  it('lists Czech public holidays', () => {
    expect([...czechHolidays(2027)].sort()).toEqual(['2027-01-01','2027-03-26','2027-03-29','2027-05-01','2027-05-08',
      '2027-07-05','2027-07-06','2027-09-28','2027-10-28','2027-11-17','2027-12-24','2027-12-25','2027-12-26']);
  });
  it('January 2027: 11 twelve-hour days, FPD 157.5', () => {
    const d = monthDays('2027-01', S);
    expect(d).toHaveLength(31);
    expect(d.filter((x) => x.dayType === 'twelve').map((x) => x.date.slice(8)))
      .toEqual(['01','02','03','09','10','16','17','23','24','30','31']);
    expect(fpdForMonth('2027-01', S)).toBe(157.5);
  });
  it('FPD counts Mon–Fri including holidays', () => {
    expect(fpdForMonth('2026-11', S)).toBe(157.5);
    expect(fpdForMonth('2026-12', S)).toBe(172.5);
    expect(fpdForMonth('2027-02', S)).toBe(150);
  });
  it("tail = the previous month's last 7 days", () => {
    expect(tailDays('2027-01', S).map((x) => x.date)).toEqual(
      ['2026-12-25','2026-12-26','2026-12-27','2026-12-28','2026-12-29','2026-12-30','2026-12-31']);
    expect(tailDays('2027-01', S).every((x) => !x.inMonth)).toBe(true);
  });
  it('is DST-safe and Monday-based', () => {
    const m = monthDays('2027-03', S);
    expect(m.map((x) => x.date)).toEqual(Array.from({ length: 31 }, (_, i) => `2027-03-${String(i + 1).padStart(2, '0')}`));
    expect(m[0].weekday).toBe(0);
    expect(m[27].weekday).toBe(6);
  });
  it('marks festive days and applies day-type overrides', () => {
    expect(monthDays('2027-12', S).filter((x) => x.festive).map((x) => x.date.slice(8))).toEqual(['24','25','26','31']);
    expect(monthDays('2027-02', { ...S, dayTypeOverrides: { '2027-02-03': 'twelve' } })[2].dayType).toBe('twelve');
  });
  it('adds months across years', () => { expect(addMonths('2026-12', 1)).toBe('2027-01'); });
});

describe('calendar edge cases', () => {
  it('computes Easter in the years that need the Gregorian corrections and at both extremes', () => {
    const years = [1818, 1943, 1954, 1981];
    expect(years.map(easterSunday)).toEqual(['1818-03-22', '1943-04-25', '1954-04-18', '1981-04-19']);
  });
  it('puts Good Friday in the previous month when Easter Sunday is 1 April', () => {
    const h = czechHolidays(2029);
    expect(easterSunday(2029)).toBe('2029-04-01');
    expect(h.has('2029-03-30')).toBe(true);
    expect(h.has('2029-04-02')).toBe(true);
    expect(h.has('2029-04-01')).toBe(false);
    expect(h.size).toBe(13);
  });
  it('describes tail days across the year boundary with their own holiday and day type', () => {
    const rows = tailDays('2027-01', S).map((x) =>
      [x.date.slice(8), x.weekday, x.dayType, x.holiday, x.festive]);
    expect(rows).toEqual([
      ['25', 4, 'twelve', true, true],
      ['26', 5, 'twelve', true, true],
      ['27', 6, 'twelve', false, false],
      ['28', 0, 'weekday', false, false],
      ['29', 1, 'weekday', false, false],
      ['30', 2, 'weekday', false, false],
      ['31', 3, 'weekday', false, true],
    ]);
  });
  it('flags every day of the month as inMonth', () => {
    expect(monthDays('2027-01', S).every((x) => x.inMonth)).toBe(true);
  });
  it('lets an override make a holiday or a Saturday a weekday, keeping the holiday flag', () => {
    const [jan1, jan2, jan3] = monthDays('2027-01', {
      ...S,
      dayTypeOverrides: { '2027-01-01': 'weekday', '2027-01-02': 'weekday' },
    });
    expect([jan1.dayType, jan1.holiday]).toEqual(['weekday', true]);
    expect([jan2.dayType, jan2.holiday]).toEqual(['weekday', false]);
    expect(jan3.dayType).toBe('twelve');
  });
  it('counts Mon–Fri days of a month', () => {
    const counts = ['2027-01', '2027-02', '2026-12'].map(weekdayCount);
    expect(counts).toEqual([21, 20, 23]);
  });
  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-03-27', 2)).toBe('2027-03-29'); // over the DST switch of 28 Mar 2027
    expect(addDays('2027-10-30', 2)).toBe('2027-11-01'); // over the DST switch of 31 Oct 2027
  });
  it('adds months backwards and over several years', () => {
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(addMonths('2027-01', -13)).toBe('2025-12');
    expect(addMonths('2027-01', 12)).toBe('2028-01');
    expect(addMonths('2027-05', 0)).toBe('2027-05');
  });
  it('names the month of a date', () => {
    expect(monthOf('2027-01-31')).toBe('2027-01');
  });
});
