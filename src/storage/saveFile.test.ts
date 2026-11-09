// src/storage/saveFile.test.ts
import { describe, it, expect } from 'vitest';
import { serialize, parseSaveFile, SaveFileError } from './saveFile';
import { newAppData, newPerson } from '../domain/defaults';
import type { AppData, Person } from '../domain/types';

describe('save file', () => {
  it('round-trips', () => {
    const d = newAppData();
    expect(parseSaveFile(serialize(d))).toEqual(d);
  });
  it.each([
    ['{', 'Tohle není soubor s plánem směn.'],
    ['{"app":"other"}', 'Tohle není soubor s plánem směn.'],
    ['{"app":"shift-scheduler","schemaVersion":3}', 'Soubor je z novější verze aplikace.'],
    ['{"app":"shift-scheduler","schemaVersion":2}', 'Soubor je poškozený.'],
    ['{"app":"shift-scheduler","schemaVersion":1}', 'Soubor je poškozený.'],
  ])('rejects %s', (text, msg) => {
    expect(() => parseSaveFile(text)).toThrow(SaveFileError);
    expect(() => parseSaveFile(text)).toThrow(msg);
  });
  it('fills settings missing from older files', () => {
    const d = newAppData();
    const raw = JSON.parse(serialize(d));
    delete raw.settings.generatorTimeBudgetSec;
    expect(parseSaveFile(JSON.stringify(raw)).settings.generatorTimeBudgetSec).toBe(20);
  });
});

// Beyond the brief: what parseSaveFile checks (ruling R27), in the order it checks it.

const NOT_A_PLAN = 'Tohle není soubor s plánem směn.';
const TOO_NEW = 'Soubor je z novější verze aplikace.';
const CORRUPT = 'Soubor je poškozený.';

/** A plan with a little of everything: pins, requests, absences, a closed and a draft month. */
function samplePlan(): AppData {
  const d = newAppData();
  d.cells['2027-01-04'] = {
    p1: { code: 'R1', pinned: true },
    p2: { code: 'x' },
    p3: { code: 'N' },
  };
  d.cells['2027-02-28'] = { p1: { code: 'DOV' } };
  d.months['2027-01'] = { status: 'closed', seed: 7, generatedAt: '2027-01-02T10:00:00.000Z' };
  d.months['2027-02'] = { status: 'draft', hoursAdjust: { p1: -7.5 } };
  return d;
}

/**
 * The sample plan with what version 2 added: doctor's notes (one beside a shift, one on a day of
 * its own, the shortest and the longest possible) and a personal limit on three people. A limit
 * of 0 is a limit: no nights, or no 12-hour shifts, at all.
 */
function planWithDoctor(): AppData {
  const d = samplePlan();
  d.doctor['2027-01-04'] = { p1: { from: 480, to: 720 }, p2: { from: 1439, to: 1440 } };
  d.doctor['2027-01-19'] = { p3: { from: 0, to: 1440 } };
  d.doctor['2027-02-10'] = { p1: { from: 0, to: 1 } };
  d.people[0].maxTwelve = 2;
  d.people[0].maxNights = 0;
  d.people[1].maxTwelve = 0;
  d.people[2].maxNights = 4;
  return d;
}

type Raw = Record<string, any>;
type Edit = (raw: Raw) => void;

/** A plan (the sample plan unless given) as file text, after `edit` has changed its parsed JSON. */
function fileWith(edit: Edit, plan: AppData = samplePlan()): string {
  const raw: Raw = JSON.parse(serialize(plan));
  edit(raw);
  return JSON.stringify(raw);
}

/** What parseSaveFile makes of a plan (the sample plan unless given) after `edit`. */
const parsedWith = (edit: Edit, plan?: AppData): AppData => parseSaveFile(fileWith(edit, plan));

/** The message of the SaveFileError that parsing the text throws. */
function messageOf(text: string): string {
  try {
    parseSaveFile(text);
  } catch (e) {
    expect(e).toBeInstanceOf(SaveFileError);
    return (e as SaveFileError).message;
  }
  return 'did not throw';
}

/** The message of the SaveFileError for a plan (the sample plan unless given) after `edit`. */
const errorWith = (edit: Edit, plan?: AppData): string => messageOf(fileWith(edit, plan));

describe('serialize', () => {
  it('writes pretty JSON with the app marker first, then the data', () => {
    const d = samplePlan();
    const text = serialize(d);
    expect(text.startsWith('{\n  "app": "shift-scheduler",\n  "schemaVersion": 2,\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({ app: 'shift-scheduler', ...d });
  });
});

describe('SaveFileError', () => {
  it('is an Error that carries the message', () => {
    const e = new SaveFileError('Soubor je poškozený.');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(SaveFileError);
    expect(e.name).toBe('SaveFileError');
    expect(e.message).toBe('Soubor je poškozený.');
  });
});

describe('parseSaveFile', () => {
  it('round-trips a plan with pins, requests, absences and months', () => {
    const d = samplePlan();
    expect(parseSaveFile(serialize(d))).toEqual(d);
  });

  it('drops the app marker and any unknown top-level key', () => {
    const parsed = parsedWith((raw) => { raw.futureThing = { a: 1 }; });
    expect(Object.keys(parsed).sort()).toEqual(
      ['cells', 'doctor', 'months', 'people', 'schemaVersion', 'settings']);
    expect(parsed).toEqual(samplePlan());
  });

  describe('is it a plan file at all?', () => {
    it.each([
      ['empty text', ''],
      ['broken JSON', '{"app":"shift-scheduler",'],
      ['a JSON array', '[]'],
      ['JSON null', 'null'],
      ['a JSON number', '42'],
      ['a JSON string', '"shift-scheduler"'],
      ['no app marker', '{"schemaVersion":1}'],
      ['a different app', '{"app":"other","schemaVersion":1}'],
      ['an app marker that is not a string', '{"app":["shift-scheduler"],"schemaVersion":1}'],
      ['the wrong case', '{"app":"Shift-Scheduler","schemaVersion":1}'],
    ])('%s is not a plan', (_what, text) => {
      expect(messageOf(text)).toBe(NOT_A_PLAN);
    });

    it('checks the marker before the version', () => {
      expect(messageOf('{"app":"other","schemaVersion":3}')).toBe(NOT_A_PLAN);
    });
  });

  describe('schemaVersion', () => {
    it.each([3, 2.5, 99])('%s is from a newer version', (version) => {
      expect(errorWith((raw) => { raw.schemaVersion = version; })).toBe(TOO_NEW);
    });

    it('is checked before the rest of the file', () => {
      const text = '{"app":"shift-scheduler","schemaVersion":3,"people":"nonsense"}';
      expect(messageOf(text)).toBe(TOO_NEW);
    });

    it.each([
      ['missing', undefined],
      ['zero', 0],
      ['negative', -1],
      ['not a whole number below 1', 0.5],
      ['not a whole number between the two versions', 1.5],
      ['a string', '1'],
      ['null', null],
      ['a boolean', true],
      ['an array', [1]],
    ])('%s is corrupt', (_what, version) => {
      const message = errorWith((raw) => {
        if (version === undefined) delete raw.schemaVersion;
        else raw.schemaVersion = version;
      });
      expect(message).toBe(CORRUPT);
    });
  });

  describe('people', () => {
    it.each([
      ['missing', (raw: Raw) => { delete raw.people; }],
      ['not an array', (raw: Raw) => { raw.people = { p1: { id: 'p1', name: 'A' } }; }],
      ['null', (raw: Raw) => { raw.people = null; }],
      ['holding null', (raw: Raw) => { raw.people.push(null); }],
      ['holding a string', (raw: Raw) => { raw.people.push('p9'); }],
      ['holding an array', (raw: Raw) => { raw.people.push([]); }],
      ['a person without an id', (raw: Raw) => { delete raw.people[0].id; }],
      ['a person with an empty id', (raw: Raw) => { raw.people[0].id = ''; }],
      ['a person with a numeric id', (raw: Raw) => { raw.people[0].id = 1; }],
      ['a person without a name', (raw: Raw) => { delete raw.people[0].name; }],
      ['a person with a numeric name', (raw: Raw) => { raw.people[0].name = 7; }],
      ['two people with the same id', (raw: Raw) => { raw.people[1].id = raw.people[0].id; }],
    ])('%s is corrupt', (_what, edit) => {
      expect(errorWith(edit)).toBe(CORRUPT);
    });

    it('accepts no people and an empty name, and completes a person from the defaults', () => {
      expect(parsedWith((raw) => { raw.people = []; }).people).toEqual([]);
      const people = [{ id: 'a', name: '' }, { id: 'b', name: 'B' }];
      expect(parsedWith((raw) => { raw.people = people; }).people)
        .toEqual([newPerson('a', ''), newPerson('b', 'B')]);
    });
  });

  // A person in the file may lack an entry that the app now has (an older file, a hand edit). The
  // app builds a month straight from the person, so each entry is completed from newPerson(id,
  // name) the way the settings are completed from the defaults, and no person is refused for it.
  describe('a person', () => {
    /** The first person of the sample plan, as the raw JSON of the file has it. */
    const first = (raw: Raw): Raw => raw.people[0];
    /** The people of the sample plan after `edit`, as parsed. */
    const peopleWith = (edit: Edit): Person[] => parsedWith(edit).people;
    const defaults = (): Person => newPerson('p1', 'Operátor 1');

    /** A person with every entry set to something other than the default. */
    function filledIn(): Person {
      return {
        id: 'p1',
        name: 'Operátor 1',
        activeFrom: '2027-01-10',
        activeTo: '2027-12-31',
        prefs: {
          ratings: { R1: 5, O20: 1, N: 3 },
          nights: 'never',
          weekendStyle: 'single',
          afterWeekend: 'want',
          afterNights: ['R1', 'O'],
          notes: 'Chce volné pondělky.',
        },
        maxTwelve: 2,
        maxNights: 4,
        allowance: { DOV: 20, MD: 3 },
        startingCounts: { twelve: 2, nights: 4, holidayTwelve: 1, festive: 3 },
      };
    }

    it('keeps every entry that the file has', () => {
      const given = filledIn();
      expect(peopleWith((raw) => { raw.people[0] = given; })[0]).toEqual(given);
    });

    it('is the defaults of newPerson when the file has only the id and the name', () => {
      const parsed = peopleWith((raw) => { raw.people = [{ id: 'p1', name: 'Operátor 1' }]; });
      expect(parsed).toEqual([defaults()]);
    });

    it.each([
      'prefs', 'allowance', 'startingCounts', 'activeFrom', 'activeTo', 'maxTwelve', 'maxNights',
    ])('gets the default %s when the file has none', (entry) => {
      const parsed = peopleWith((raw) => { delete first(raw)[entry]; });
      expect(parsed[0]).toEqual(parsedWith(() => undefined).people[0]); // the others as they were
      expect(parsed[0][entry as keyof Person]).toEqual(defaults()[entry as keyof Person]);
    });

    it.each([
      ['null', null], ['a number', 7], ['a string', 'normal'], ['an array', []], ['true', true],
    ])('takes prefs, allowance and startingCounts that are %s for missing', (_what, value) => {
      const parsed = peopleWith((raw) => {
        for (const entry of ['prefs', 'allowance', 'startingCounts']) first(raw)[entry] = value;
      });
      expect(parsed[0]).toEqual(defaults());
    });

    describe('prefs', () => {
      it('are completed entry by entry', () => {
        const parsed = peopleWith((raw) => { first(raw).prefs = { nights: 'never', notes: 'Pozn.' }; });
        expect(parsed[0].prefs).toEqual({ ...defaults().prefs, nights: 'never', notes: 'Pozn.' });
      });
      it.each(['ratings', 'nights', 'weekendStyle', 'afterWeekend', 'afterNights', 'notes'])(
        'get the default %s when the file lacks it', (entry) => {
          const given = filledIn().prefs;
          delete (given as unknown as Raw)[entry];
          const parsed = peopleWith((raw) => { first(raw).prefs = given; });
          expect(parsed[0].prefs[entry as keyof Person['prefs']])
            .toEqual(defaults().prefs[entry as keyof Person['prefs']]);
          // and what the file has stays
          const kept = Object.keys(given) as Array<keyof Person['prefs']>;
          for (const key of kept) expect(parsed[0].prefs[key]).toEqual(given[key]);
        });
      it('have ratings that are completed too: a missing or odd one is empty, a partial one stays', () => {
        const ratingsOf = (ratings: unknown) =>
          peopleWith((raw) => { first(raw).prefs = { ratings }; })[0].prefs.ratings;
        expect(ratingsOf(undefined)).toEqual({});
        for (const odd of [null, 5, 'R1', [], [1, 2], true]) expect(ratingsOf(odd)).toEqual({});
        expect(ratingsOf({ R1: 5 })).toEqual({ R1: 5 }); // no rating is made up for the others
        expect(ratingsOf({ R1: 5, N: 2 })).toEqual({ R1: 5, N: 2 });
      });
    });

    describe('allowance and startingCounts', () => {
      it('are completed entry by entry', () => {
        const parsed = peopleWith((raw) => {
          first(raw).allowance = { DOV: 12 };
          first(raw).startingCounts = { nights: 6, festive: 2 };
        });
        expect(parsed[0].allowance).toEqual({ DOV: 12, MD: 5 });
        expect(parsed[0].startingCounts).toEqual({ twelve: 0, nights: 6, holidayTwelve: 0, festive: 2 });
      });
    });

    describe('activeFrom and activeTo', () => {
      it.each(['2027-01-01', '2027-12-31', '2028-02-29', '2000-02-29'])(
        'keep the real date %s', (date) => {
          const parsed = peopleWith((raw) => { first(raw).activeFrom = date; first(raw).activeTo = date; });
          expect([parsed[0].activeFrom, parsed[0].activeTo]).toEqual([date, date]);
        });
      it.each([
        ['an impossible date', '2027-02-30'], ['a date out of form', '2027-1-4'],
        ['a date with a time', '2027-01-04T00:00'], ['a month', '2027-01'], ['the empty text', ''],
        ['text', 'zítra'], ['a number', 20270104], ['true', true], ['an array', ['2027-01-04']],
        ['an object', { date: '2027-01-04' }], ['undefined', undefined],
      ])('stay null for %s', (_what, value) => {
        const parsed = peopleWith((raw) => {
          first(raw).activeFrom = value;
          first(raw).activeTo = value;
        });
        expect([parsed[0].activeFrom, parsed[0].activeTo]).toEqual([null, null]);
      });
      it('are judged one by one', () => {
        const parsed = peopleWith((raw) => {
          first(raw).activeFrom = '2027-03-01';
          first(raw).activeTo = 'nikdy';
        });
        expect([parsed[0].activeFrom, parsed[0].activeTo]).toEqual(['2027-03-01', null]);
      });
    });

    it('is judged person by person, and the order stays', () => {
      const parsed = peopleWith((raw) => {
        raw.people = [{ id: 'z', name: 'Z' }, filledIn(), { id: 'a', name: 'A', prefs: 5 }];
      });
      expect(parsed.map((p) => p.id)).toEqual(['z', 'p1', 'a']);
      expect(parsed[0]).toEqual(newPerson('z', 'Z'));
      expect(parsed[1]).toEqual(filledIn());
      expect(parsed[2]).toEqual(newPerson('a', 'A'));
    });

    it('drops an entry that the app does not know', () => {
      const parsed = peopleWith((raw) => { first(raw).futureThing = { a: 1 }; });
      expect(Object.keys(parsed[0]).sort()).toEqual([
        'activeFrom', 'activeTo', 'allowance', 'id', 'maxNights', 'maxTwelve', 'name', 'prefs',
        'startingCounts',
      ]);
    });

    it('is not shared between two parses, nor with the defaults', () => {
      const text = fileWith((raw) => { raw.people = [{ id: 'p1', name: 'Operátor 1' }]; });
      const a = parseSaveFile(text);
      a.people[0].prefs.ratings.R1 = 5;
      a.people[0].prefs.afterNights.push('R1');
      a.people[0].allowance.DOV = 1;
      a.people[0].startingCounts.twelve = 9;
      expect(parseSaveFile(text).people[0]).toEqual(defaults());
      expect(newPerson('p1', 'Operátor 1')).toEqual(defaults());
    });

    it('still has to have a name and a unique id', () => {
      expect(errorWith((raw) => { raw.people = [{ id: 'a' }]; })).toBe(CORRUPT);
      expect(errorWith((raw) => { raw.people = [{ name: 'A' }]; })).toBe(CORRUPT);
      expect(errorWith((raw) => { raw.people = [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }]; }))
        .toBe(CORRUPT);
    });
  });

  describe('settings', () => {
    it.each([
      ['missing', undefined],
      ['null', null],
      ['an array', []],
      ['a string', 'default'],
      ['a number', 3],
    ])('%s is corrupt', (_what, settings) => {
      const message = errorWith((raw) => {
        if (settings === undefined) delete raw.settings;
        else raw.settings = settings;
      });
      expect(message).toBe(CORRUPT);
    });

    it('fills in everything for empty settings', () => {
      expect(parsedWith((raw) => { raw.settings = {}; }).settings).toEqual(newAppData().settings);
    });

    it('fills in missing settings and missing entries of shifts, coverage and wishLevels', () => {
      const defaults = newAppData().settings;
      const parsed = parsedWith((raw) => {
        raw.settings.minRestHours = 10;
        delete raw.settings.festiveDays;
        delete raw.settings.twelveTarget;
        raw.settings.shifts.R1.hours = 8;
        delete raw.settings.shifts.N12;
        raw.settings.coverage.R2 = { min: 2, max: 3 };
        delete raw.settings.coverage.O;
        raw.settings.wishLevels.W1 = 5;
        delete raw.settings.wishLevels.W9;
        delete raw.settings.wishLevels.W4b;
      }).settings;
      // What the file has stays.
      expect(parsed.minRestHours).toBe(10);
      expect(parsed.shifts.R1).toEqual({ ...defaults.shifts.R1, hours: 8 });
      expect(parsed.coverage.R2).toEqual({ min: 2, max: 3 });
      expect(parsed.wishLevels.W1).toBe(5);
      // What it lacks comes from the defaults.
      expect(parsed.festiveDays).toEqual(defaults.festiveDays);
      expect(parsed.twelveTarget).toBe(defaults.twelveTarget);
      expect(parsed.shifts.N12).toEqual(defaults.shifts.N12);
      expect(parsed.coverage.O).toEqual(defaults.coverage.O);
      expect(parsed.wishLevels.W9).toBe(defaults.wishLevels.W9);
      expect(parsed.wishLevels.W4b).toBe(defaults.wishLevels.W4b);
      // Nothing else changed.
      expect(parsed).toEqual({
        ...defaults,
        minRestHours: 10,
        shifts: { ...defaults.shifts, R1: { ...defaults.shifts.R1, hours: 8 } },
        coverage: { ...defaults.coverage, R2: { min: 2, max: 3 } },
        wishLevels: { ...defaults.wishLevels, W1: 5 },
      });
    });

    it('treats shifts, coverage and wishLevels that are not objects as missing', () => {
      const defaults = newAppData().settings;
      const parsed = parsedWith((raw) => {
        raw.settings.shifts = 5;
        raw.settings.coverage = null;
        raw.settings.wishLevels = [1, 2];
      }).settings;
      expect(parsed.shifts).toEqual(defaults.shifts);
      expect(parsed.coverage).toEqual(defaults.coverage);
      expect(parsed.wishLevels).toEqual(defaults.wishLevels);
    });

    it('gives each parse its own settings objects', () => {
      const a = parsedWith((raw) => { raw.settings = {}; });
      a.settings.shifts.R1.hours = 99;
      a.settings.festiveDays.push('05-01');
      const b = parsedWith((raw) => { raw.settings = {}; });
      expect(b.settings).toEqual(newAppData().settings);
    });
  });

  describe('cells', () => {
    it.each([
      ['missing', undefined],
      ['null', null],
      ['an array', []],
      ['a string', '2027-01-04'],
    ])('%s is corrupt', (_what, cells) => {
      const message = errorWith((raw) => {
        if (cells === undefined) delete raw.cells;
        else raw.cells = cells;
      });
      expect(message).toBe(CORRUPT);
    });

    it.each([
      '2027-02-30', '2027-02-29', '2027-13-01', '2027-00-10', '2027-01-00', '2027-01-32',
      '2027-1-4', '27-01-04', '2027-01', '2027-01-04T00:00', ' 2027-01-04', '2027/01/04',
      '2027-01-0４', // a full-width 4
      '', 'today',
    ])('the date key "%s" is corrupt', (date) => {
      expect(errorWith((raw) => { raw.cells[date] = { p1: { code: 'R1' } }; })).toBe(CORRUPT);
    });

    it.each(['2028-02-29', '2027-12-31', '2027-01-01', '2000-02-29', '2026-12-25', '0099-12-31'])(
      'the real date %s is accepted', (date) => {
        const parsed = parsedWith((raw) => { raw.cells[date] = { p1: { code: 'R1' } }; });
        expect(parsed.cells[date]).toEqual({ p1: { code: 'R1' } });
      });

    it.each([
      ['null', null],
      ['an array', []],
      ['a string', 'R1'],
      ['a number', 1],
    ])('a day holding %s is corrupt', (_what, day) => {
      expect(errorWith((raw) => { raw.cells['2027-01-05'] = day; })).toBe(CORRUPT);
    });

    it.each([
      ['null', null],
      ['a string', 'R1'],
      ['an array', ['R1']],
      ['no code', {}],
      ['a numeric code', { code: 1 }],
      ['a code that does not exist', { code: 'R3' }],
      ['a code in the wrong case', { code: 'r1' }],
      ['a code with spaces', { code: ' R1' }],
      ['the empty code', { code: '' }],
      ['a pin that is a string', { code: 'R1', pinned: 'yes' }],
      ['a pin that is a number', { code: 'R1', pinned: 1 }],
      ['a pin that is null', { code: 'R1', pinned: null }],
    ])('a cell holding %s is corrupt', (_what, cell) => {
      expect(errorWith((raw) => { raw.cells['2027-01-05'] = { p1: cell }; })).toBe(CORRUPT);
    });

    it('accepts every code the app knows, pinned or not, and an empty day', () => {
      const codes = ['R1', 'R2', 'O20', 'O', 'N', 'R12', 'N12', 'DOV', 'MD', 'OP', 'NEM', 'x'];
      const day: Raw = {};
      codes.forEach((code, i) => { day[`q${i}`] = i % 2 ? { code, pinned: true } : { code }; });
      day.off = { code: 'N', pinned: false };
      const parsed = parsedWith((raw) => {
        raw.cells['2027-03-01'] = day;
        raw.cells['2027-03-02'] = {};
      });
      expect(parsed.cells['2027-03-01']).toEqual(day);
      expect(parsed.cells['2027-03-02']).toEqual({});
    });

    it('is corrupt when only a later cell of a day, or a later day, is bad', () => {
      const good = { p1: { code: 'R1' }, p2: { code: 'N', pinned: true } };
      const laterCell = { ...good, p3: { code: 'R3' } };
      expect(errorWith((raw) => { raw.cells = { '2027-01-04': laterCell }; })).toBe(CORRUPT);
      const laterDay = { '2027-01-04': good, '2027-01-05': good, '2027-01-06': { p1: 'R1' } };
      expect(errorWith((raw) => { raw.cells = laterDay; })).toBe(CORRUPT);
      const laterDate = { '2027-01-04': good, '2027-01-05': good, '2027-01-33': good };
      expect(errorWith((raw) => { raw.cells = laterDate; })).toBe(CORRUPT);
    });

    it('does not ask whether the person is still in the team', () => {
      const parsed = parsedWith((raw) => { raw.cells['2027-01-05'] = { gone: { code: 'OP' } }; });
      expect(parsed.cells['2027-01-05']).toEqual({ gone: { code: 'OP' } });
    });
  });

  describe('months', () => {
    it('are optional and become an empty object', () => {
      expect(parsedWith((raw) => { delete raw.months; }).months).toEqual({});
    });

    it.each([
      ['null', null],
      ['an array', []],
      ['a string', 'draft'],
    ])('months that are %s are corrupt', (_what, months) => {
      expect(errorWith((raw) => { raw.months = months; })).toBe(CORRUPT);
    });

    it.each([
      '2027-13', '2027-00', '2027-1', '2027-01-01', '27-01', '2027/01', '2027-1x', '', 'january',
    ])('the month key "%s" is corrupt', (month) => {
      expect(errorWith((raw) => { raw.months[month] = { status: 'draft' }; })).toBe(CORRUPT);
    });

    it.each(['2027-01', '2027-09', '2027-10', '2027-12', '1999-02'])(
      'the month key %s is accepted', (month) => {
        const parsed = parsedWith((raw) => { raw.months[month] = { status: 'closed' }; });
        expect(parsed.months[month]).toEqual({ status: 'closed' });
      });

    it.each([
      ['null', null],
      ['a string', 'draft'],
      ['an array', []],
      ['no status', {}],
      ['an unknown status', { status: 'open' }],
      ['a status in the wrong case', { status: 'Draft' }],
      ['a numeric status', { status: 1 }],
    ])('a month holding %s is corrupt', (_what, meta) => {
      expect(errorWith((raw) => { raw.months['2027-03'] = meta; })).toBe(CORRUPT);
    });

    it('keeps the seed, the time and the hours adjustment as the app wrote them', () => {
      const parsed = parseSaveFile(serialize(samplePlan()));
      expect(parsed.months['2027-01']).toEqual({
        status: 'closed',
        seed: 7,
        generatedAt: '2027-01-02T10:00:00.000Z',
      });
      expect(parsed.months['2027-02']).toEqual({ status: 'draft', hoursAdjust: { p1: -7.5 } });
    });
  });
});

// Version 2 (Phase 1.1) adds doctor's notes, a personal limit of 12-hour shifts and of nights per
// person, and three settings. A file that Phase 1 wrote (version 1) must still open, with all of
// it at the defaults.
describe('save file version 2', () => {
  /** Turns the raw JSON of a version 2 file into what Phase 1 wrote: version 1, none of the new. */
  function asPhase1(raw: Raw): void {
    raw.schemaVersion = 1;
    delete raw.doctor;
    for (const person of raw.people) {
      delete person.maxTwelve;
      delete person.maxNights;
    }
    for (const key of ['maxDaysInRow', 'minWeekendShifts', 'weeklyRestHours']) {
      delete raw.settings[key];
    }
    delete raw.settings.wishLevels.W10;
  }

  it('opens a version 1 file with the new fields at their defaults', () => {
    const text = fileWith((raw) => {
      raw.settings.minRestHours = 10; // a setting that the file has, and that must stay
      asPhase1(raw);
    });
    // The file is what Phase 1 wrote: none of the new fields is in it.
    const file: Raw = JSON.parse(text);
    expect(file.schemaVersion).toBe(1);
    expect(file).not.toHaveProperty('doctor');
    expect(file.people[0]).not.toHaveProperty('maxTwelve');
    expect(file.people[0]).not.toHaveProperty('maxNights');
    expect(file.settings).not.toHaveProperty('maxDaysInRow');
    expect(file.settings).not.toHaveProperty('minWeekendShifts');
    expect(file.settings).not.toHaveProperty('weeklyRestHours');
    expect(file.settings.wishLevels).not.toHaveProperty('W10');

    const parsed = parseSaveFile(text);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.doctor).toEqual({});
    expect(parsed.people).toHaveLength(8);
    for (const person of parsed.people) {
      expect(person.maxTwelve).toBeNull();
      expect(person.maxNights).toBeNull();
    }
    expect(parsed.settings.maxDaysInRow).toBe(6);
    expect(parsed.settings.minWeekendShifts).toBe(2);
    expect(parsed.settings.weeklyRestHours).toBe(35);
    expect(parsed.settings.wishLevels.W10).toBe(3);
    // Everything else is as the file had it.
    const expected = samplePlan();
    expected.settings.minRestHours = 10;
    expect(parsed).toEqual(expected);
  });

  it('writes version 2 when an opened version 1 file is saved again', () => {
    const parsed = parseSaveFile(fileWith(asPhase1));
    const saved = serialize(parsed);
    expect(JSON.parse(saved).schemaVersion).toBe(2);
    expect(parseSaveFile(saved)).toEqual(parsed);
  });

  it('round-trips a version 2 file', () => {
    const data = planWithDoctor();
    expect(data.schemaVersion).toBe(2);
    expect(parseSaveFile(serialize(data))).toEqual(data);
  });

  it('treats a version 2 file without a doctor entry as one without notes', () => {
    expect(parsedWith((raw) => { delete raw.doctor; })).toEqual(samplePlan());
  });

  it('refuses version 3 as from a newer version, whatever else the file holds', () => {
    expect(errorWith((raw) => { raw.schemaVersion = 3; }, planWithDoctor())).toBe(TOO_NEW);
    expect(messageOf('{"app":"shift-scheduler","schemaVersion":3}')).toBe(TOO_NEW);
  });

  describe('doctor notes', () => {
    /** Replaces the note of p1 on 4 January, which `planWithDoctor` has. */
    const setNote = (note: unknown): Edit => (raw) => { raw.doctor['2027-01-04'].p1 = note; };
    /** Adds a note on `date` for p1. */
    const noteOn = (date: string): Edit => (raw) => {
      raw.doctor[date] = { p1: { from: 480, to: 720 } };
    };

    it.each<[string, Edit]>([
      ['from equal to to', setNote({ from: 600, to: 600 })],
      ['from after to', setNote({ from: 720, to: 480 })],
      ['from a fraction', setNote({ from: 480.5, to: 720 })],
      ['to a fraction', setNote({ from: 480, to: 720.5 })],
      ['from below 0', setNote({ from: -1, to: 60 })],
      ['to above 1440', setNote({ from: 1380, to: 1441 })],
      ['from at 1440 or later', setNote({ from: 1440, to: 1500 })],
      ['from as text', setNote({ from: '480', to: 720 })],
      ['to as text', setNote({ from: 480, to: '12:00' })],
      ['from null', setNote({ from: null, to: 720 })],
      ['no to', setNote({ from: 480 })],
      ['no from', setNote({ to: 720 })],
      ['an empty note', setNote({})],
      ['a note that is null', setNote(null)],
      ['a note that is text', setNote('L 8-12')],
      ['a note that is an array', setNote([480, 720])],
      ['a note that is a number', setNote(480)],
      ['an unreal date', noteOn('2027-02-30')],
      ['a month in place of a date', noteOn('2027-01')],
      ['a date out of form', noteOn('2027-1-4')],
      ['a date with a time', noteOn('2027-01-04T00:00')],
      ['an empty date', noteOn('')],
      ['a bad note of a person who is not in the team',
        (raw) => { raw.doctor['2027-01-04'].p99 = { from: 720, to: 480 }; }],
      ['a day that is null', (raw) => { raw.doctor['2027-01-05'] = null; }],
      ['a day that is an array', (raw) => { raw.doctor['2027-01-05'] = []; }],
      ['a day that is text', (raw) => { raw.doctor['2027-01-05'] = 'p1'; }],
      ['doctor that is null', (raw) => { raw.doctor = null; }],
      ['doctor that is an array', (raw) => { raw.doctor = []; }],
      ['doctor that is text', (raw) => { raw.doctor = 'L 8-12'; }],
      ['a bad note after good ones on the same day', (raw) => {
        raw.doctor['2027-03-01'] = {
          p1: { from: 480, to: 720 }, p2: { from: 510, to: 570 }, p4: { from: 720, to: 480 },
        };
      }],
      ['a bad note on a later day', (raw) => {
        raw.doctor['2027-03-01'] = { p1: { from: 480, to: 720 } };
        raw.doctor['2027-03-02'] = { p1: { from: 480, to: 2000 } };
      }],
    ])('refuses a broken doctor note: %s', (_what, edit) => {
      expect(errorWith(edit, planWithDoctor())).toBe(CORRUPT);
    });

    it('keeps the notes that the file has, the shortest and the longest included', () => {
      const parsed = parseSaveFile(serialize(planWithDoctor()));
      expect(parsed.doctor).toEqual({
        '2027-01-04': { p1: { from: 480, to: 720 }, p2: { from: 1439, to: 1440 } },
        '2027-01-19': { p3: { from: 0, to: 1440 } },
        '2027-02-10': { p1: { from: 0, to: 1 } },
      });
    });

    it('accepts a day without notes', () => {
      expect(parsedWith((raw) => { raw.doctor['2027-01-05'] = {}; }, planWithDoctor()).doctor)
        .toEqual({ ...planWithDoctor().doctor, '2027-01-05': {} });
    });

    it('drops the notes of a person who is not in the team', () => {
      // p99 is nobody of the file, and has a note beside those of p1 and p2. p3 has left the file,
      // with a note on a day of its own, and with cells. The other notes and every cell stay.
      const parsed = parsedWith((raw) => {
        raw.doctor['2027-01-04'].p99 = { from: 480, to: 720 };
        raw.people = raw.people.filter((person: Raw) => person.id !== 'p3');
      }, planWithDoctor());
      const want = planWithDoctor();
      want.people = want.people.filter((person) => person.id !== 'p3');
      delete want.doctor['2027-01-19']; // the day held nothing else
      expect(parsed).toEqual(want);
      expect(parsed.doctor).toEqual({
        '2027-01-04': { p1: { from: 480, to: 720 }, p2: { from: 1439, to: 1440 } },
        '2027-02-10': { p1: { from: 0, to: 1 } },
      });
      expect(parsed.cells).toEqual(samplePlan().cells); // p3's N on 4 January included
      expect(parseSaveFile(serialize(parsed))).toEqual(parsed); // and what is left is a plan
    });

    it('drops the notes of strangers from a day, and keeps a day that was empty already', () => {
      const parsed = parsedWith((raw) => {
        raw.doctor['2027-01-05'] = {};
        raw.doctor['2027-01-06'] = { p98: { from: 60, to: 120 }, p99: { from: 120, to: 180 } };
        raw.doctor['2027-01-07'] = { p98: { from: 60, to: 120 }, p2: { from: 60, to: 120 } };
      }, planWithDoctor());
      expect(parsed.doctor).toEqual({
        ...planWithDoctor().doctor,
        '2027-01-05': {},
        '2027-01-07': { p2: { from: 60, to: 120 } },
      });
    });
  });

  describe('person limits', () => {
    /** The first two people after the first is given `value` as both limits, the second 3 and 0. */
    function limitsWith(value: unknown): Person[] {
      return parsedWith((raw) => {
        raw.people[0].maxTwelve = value;
        raw.people[0].maxNights = value;
        raw.people[1].maxTwelve = 3;
        raw.people[1].maxNights = 0;
      }).people;
    }

    it.each([
      ['text', 'x'],
      ['a number as text', '3'],
      ['true', true],
      ['an array', [3]],
      ['an object', { max: 3 }],
    ])('takes a wrong-typed person limit as null: %s', (_what, value) => {
      const [first, second] = limitsWith(value);
      expect(first.maxTwelve).toBeNull();
      expect(first.maxNights).toBeNull();
      expect(first).toEqual(newPerson('p1', 'Operátor 1')); // the rest of the person is as it was
      expect([second.maxTwelve, second.maxNights]).toEqual([3, 0]); // the next one is not hit
    });

    it.each([
      ['negative', -1],
      ['not a whole number', 2.5],
    ])('takes a limit that is %s as null', (_what, value) => {
      const [first] = limitsWith(value);
      expect([first.maxTwelve, first.maxNights]).toEqual([null, null]);
    });

    it('keeps a limit of 0: no nights, or no 12-hour shifts, at all', () => {
      const [first] = limitsWith(0);
      expect([first.maxTwelve, first.maxNights]).toEqual([0, 0]);
    });

    it('takes a limit that the file lacks as null, and keeps the other limit of the person', () => {
      const [first] = parsedWith(
        (raw) => { delete raw.people[0].maxTwelve; },
        planWithDoctor(),
      ).people;
      expect([first.maxTwelve, first.maxNights]).toEqual([null, 0]); // it was [2, 0]
    });
  });
});
