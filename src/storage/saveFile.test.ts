// src/storage/saveFile.test.ts
import { describe, it, expect } from 'vitest';
import { serialize, parseSaveFile, SaveFileError } from './saveFile';
import { newAppData } from '../domain/defaults';
import type { AppData } from '../domain/types';

describe('save file', () => {
  it('round-trips', () => {
    const d = newAppData();
    expect(parseSaveFile(serialize(d))).toEqual(d);
  });
  it.each([
    ['{', 'Tohle není soubor s plánem směn.'],
    ['{"app":"other"}', 'Tohle není soubor s plánem směn.'],
    ['{"app":"shift-scheduler","schemaVersion":2}', 'Soubor je z novější verze aplikace.'],
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

type Raw = Record<string, any>;
type Edit = (raw: Raw) => void;

/** The sample plan as file text, after `edit` has changed its parsed JSON. */
function fileWith(edit: Edit): string {
  const raw: Raw = JSON.parse(serialize(samplePlan()));
  edit(raw);
  return JSON.stringify(raw);
}

/** What parseSaveFile makes of the sample plan after `edit`. */
const parsedWith = (edit: Edit): AppData => parseSaveFile(fileWith(edit));

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

/** The message of the SaveFileError for the sample plan after `edit`. */
const errorWith = (edit: Edit): string => messageOf(fileWith(edit));

describe('serialize', () => {
  it('writes pretty JSON with the app marker first, then the data', () => {
    const d = samplePlan();
    const text = serialize(d);
    expect(text.startsWith('{\n  "app": "shift-scheduler",\n  "schemaVersion": 1,\n')).toBe(true);
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
      ['cells', 'months', 'people', 'schemaVersion', 'settings']);
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
      expect(messageOf('{"app":"other","schemaVersion":2}')).toBe(NOT_A_PLAN);
    });
  });

  describe('schemaVersion', () => {
    it.each([2, 3, 1.5, 99])('%s is from a newer version', (version) => {
      expect(errorWith((raw) => { raw.schemaVersion = version; })).toBe(TOO_NEW);
    });

    it('is checked before the rest of the file', () => {
      const text = '{"app":"shift-scheduler","schemaVersion":2,"people":"nonsense"}';
      expect(messageOf(text)).toBe(TOO_NEW);
    });

    it.each([
      ['missing', undefined],
      ['zero', 0],
      ['negative', -1],
      ['not a whole number below 1', 0.5],
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

    it('accepts no people, an empty name, and the rest of a person as the app wrote it', () => {
      expect(parsedWith((raw) => { raw.people = []; }).people).toEqual([]);
      const people = [{ id: 'a', name: '' }, { id: 'b', name: 'B' }];
      expect(parsedWith((raw) => { raw.people = people; }).people).toEqual(people);
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
