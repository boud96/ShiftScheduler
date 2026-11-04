import type { AppData, Person, PersonId, Settings } from './types';

/** The default settings. Each call returns a fresh object, so callers may edit it. */
export function defaultSettings(): Settings {
  return {
    // Minutes from midnight of the start day; a night shift ends at 1440 + 360 = 06:00 next day.
    shifts: {
      R1: { start: 360, end: 840, hours: 7.5 }, // 06:00-14:00
      R2: { start: 480, end: 960, hours: 7.5 }, // 08:00-16:00
      O20: { start: 720, end: 1200, hours: 7.5 }, // 12:00-20:00
      O: { start: 840, end: 1320, hours: 7.5 }, // 14:00-22:00
      N: { start: 1320, end: 1800, hours: 7.5 }, // 22:00-06:00
      R12: { start: 360, end: 1080, hours: 11.5 }, // 06:00-18:00
      N12: { start: 1080, end: 1800, hours: 11.5 }, // 18:00-06:00
    },
    absenceHours: 7.5,
    fpdHoursPerWeekday: 7.5,
    coverage: {
      R1: { min: 1, max: 1 },
      R2: { min: 1, max: null },
      O20: { min: 1, max: 1 },
      O: { min: 1, max: 1 },
      N: { min: 1, max: 1 },
      R12: { min: 1, max: 1 },
      N12: { min: 1, max: 1 },
    },
    minRestHours: 12,
    maxTwelvePerMonth: 3,
    twelveTarget: 2,
    wishLevels: {
      W1: 3,
      W2: 3,
      W3: 3,
      W4a: 3,
      W4b: 3,
      W4c: 3,
      W4d: 3,
      W5a: 3,
      W5b: 3,
      W5c: 3,
      W5d: 3,
      W6: 3,
      W7: 3,
      W8: 3,
      W9: 3,
    },
    dayTypeOverrides: {},
    fairnessWindowMonths: 6,
    festiveDays: ['12-24', '12-25', '12-26', '12-31', '01-01'],
    generatorTimeBudgetSec: 20,
  };
}

export function newPerson(id: PersonId, name: string): Person {
  return {
    id,
    name,
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
  };
}

/** An empty plan with eight placeholder operators, ready for the team lead to rename. */
export function newAppData(): AppData {
  return {
    schemaVersion: 1,
    people: Array.from({ length: 8 }, (_, i) => newPerson(`p${i + 1}`, `Operátor ${i + 1}`)),
    settings: defaultSettings(),
    cells: {},
    months: {},
  };
}
