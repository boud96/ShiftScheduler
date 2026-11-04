import { describe, it, expect } from 'vitest';
import { defaultSettings, newPerson, newAppData } from './defaults';

/** Minutes from midnight of the start day; `nextDay` adds 24 h. */
const at = (hhmm: string, nextDay = false): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m + (nextDay ? 1440 : 0);
};

describe('defaultSettings', () => {
  it('has the default shift times and counted hours', () => {
    expect(defaultSettings().shifts).toEqual({
      R1: { start: at('06:00'), end: at('14:00'), hours: 7.5 },
      R2: { start: at('08:00'), end: at('16:00'), hours: 7.5 },
      O20: { start: at('12:00'), end: at('20:00'), hours: 7.5 },
      O: { start: at('14:00'), end: at('22:00'), hours: 7.5 },
      N: { start: at('22:00'), end: at('06:00', true), hours: 7.5 },
      R12: { start: at('06:00'), end: at('18:00'), hours: 11.5 },
      N12: { start: at('18:00'), end: at('06:00', true), hours: 11.5 },
    });
  });
  it('covers each shift exactly once, except R2 which needs at least one', () => {
    expect(defaultSettings().coverage).toEqual({
      R1: { min: 1, max: 1 },
      R2: { min: 1, max: null },
      O20: { min: 1, max: 1 },
      O: { min: 1, max: 1 },
      N: { min: 1, max: 1 },
      R12: { min: 1, max: 1 },
      N12: { min: 1, max: 1 },
    });
  });
  it('has the default hours and limits', () => {
    const s = defaultSettings();
    expect(s.absenceHours).toBe(7.5);
    expect(s.fpdHoursPerWeekday).toBe(7.5);
    expect(s.minRestHours).toBe(12);
    expect(s.maxTwelvePerMonth).toBe(3);
    expect(s.twelveTarget).toBe(2);
  });
  it('rates all 15 wishes at level 3', () => {
    const { wishLevels } = defaultSettings();
    expect(Object.keys(wishLevels).sort()).toEqual([
      'W1', 'W2', 'W3', 'W4a', 'W4b', 'W4c', 'W4d',
      'W5a', 'W5b', 'W5c', 'W5d', 'W6', 'W7', 'W8', 'W9',
    ]);
    expect(Object.values(wishLevels).every((level) => level === 3)).toBe(true);
  });
  it('has the festive days, the fairness window and the generator time budget', () => {
    const s = defaultSettings();
    expect(s.festiveDays).toEqual(['12-24', '12-25', '12-26', '12-31', '01-01']);
    expect(s.fairnessWindowMonths).toBe(6);
    expect(s.generatorTimeBudgetSec).toBe(20);
    expect(s.dayTypeOverrides).toEqual({});
  });
  it('returns a fresh object every time', () => {
    const a = defaultSettings();
    a.coverage.R1.max = 2;
    a.festiveDays.push('05-01');
    a.dayTypeOverrides['2027-01-04'] = 'twelve';
    const b = defaultSettings();
    expect(b.coverage.R1.max).toBe(1);
    expect(b.festiveDays).toHaveLength(5);
    expect(b.dayTypeOverrides).toEqual({});
  });
});

describe('newPerson', () => {
  it('starts with neutral preferences, the usual allowance and zero counts', () => {
    expect(newPerson('p9', 'Operátor 9')).toEqual({
      id: 'p9',
      name: 'Operátor 9',
      activeFrom: null,
      activeTo: null,
      prefs: {
        ratings: {},
        nights: 'normal',
        weekendStyle: 'whole',
        afterWeekend: 'any',
        afterNights: [],
        notes: '',
      },
      allowance: { DOV: 25, MD: 5 },
      startingCounts: { twelve: 0, nights: 0, holidayTwelve: 0, festive: 0 },
    });
  });
  it('does not share nested objects between people', () => {
    const a = newPerson('a', 'A');
    a.prefs.ratings.R1 = 5;
    a.prefs.afterNights.push('R2');
    a.allowance.DOV = 20;
    a.startingCounts.twelve = 3;
    const b = newPerson('b', 'B');
    expect(b.prefs.ratings).toEqual({});
    expect(b.prefs.afterNights).toEqual([]);
    expect(b.allowance.DOV).toBe(25);
    expect(b.startingCounts.twelve).toBe(0);
  });
});

describe('newAppData', () => {
  it('starts with 8 people, default settings and no cells or months', () => {
    const data = newAppData();
    expect(data.schemaVersion).toBe(1);
    expect(data.people.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    expect(data.people.map((p) => p.name)).toEqual(
      Array.from({ length: 8 }, (_, i) => `Operátor ${i + 1}`));
    expect(data.settings).toEqual(defaultSettings());
    expect(data.cells).toEqual({});
    expect(data.months).toEqual({});
  });
  it('returns independent data every time', () => {
    const a = newAppData();
    a.people[0].activeFrom = '2027-01-18';
    a.cells['2027-01-04'] = { p1: { code: 'R1' } };
    const b = newAppData();
    expect(b.people[0].activeFrom).toBeNull();
    expect(b.cells).toEqual({});
  });
});
