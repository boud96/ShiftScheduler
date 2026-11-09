import { describe, expect, it } from 'vitest';
import { Code } from '../domain/codes';
import { buildMonthGrid } from '../domain/context';
import type { MonthGrid } from '../domain/context';
import { newAppData, newPerson } from '../domain/defaults';
import type {
  AppData,
  DoctorNote,
  ISODate,
  Person,
  PersonId,
  StoredCell,
} from '../domain/types';
import { parseSaveFile, serialize } from '../storage/saveFile';
import { reduce } from './reducer';
import type { Action } from './reducer';

/** Freezes the data all the way down, so that a reducer that edits its input throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !ArrayBuffer.isView(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

type Put = [date: ISODate, personId: PersonId, cell: StoredCell];

/** A frozen plan of eight people, p1 to p8, with these cells stored. */
function plan(...cells: Put[]): AppData {
  const data = newAppData();
  for (const [date, id, cell] of cells) (data.cells[date] ??= {})[id] = cell;
  return deepFreeze(data);
}

const cellOf = (data: AppData, date: ISODate, id: PersonId): StoredCell | undefined =>
  data.cells[date]?.[id];

describe('load', () => {
  it('replaces the data', () => {
    const loaded = newAppData();
    loaded.people[0].name = 'Jiný plán';
    expect(reduce(plan(), { type: 'load', data: loaded })).toBe(loaded);
  });
});

describe('setCell', () => {
  it('stores a cell and keeps the others of that day', () => {
    const data = plan(['2027-01-04', 'p2', { code: 'R2' }]);
    const next = reduce(data, {
      type: 'setCell',
      date: '2027-01-04',
      personId: 'p1',
      cell: { code: 'R1', pinned: true },
    });
    expect(cellOf(next, '2027-01-04', 'p1')).toEqual({ code: 'R1', pinned: true });
    expect(cellOf(next, '2027-01-04', 'p2')).toEqual({ code: 'R2' });
  });

  it('replaces whatever the cell held', () => {
    const data = plan(['2027-01-04', 'p1', { code: 'R1', pinned: true }]);
    const next = reduce(data, {
      type: 'setCell',
      date: '2027-01-04',
      personId: 'p1',
      cell: { code: 'DOV' },
    });
    expect(cellOf(next, '2027-01-04', 'p1')).toStrictEqual({ code: 'DOV' });
  });

  it('removes the cell for null, and the day with it when it was the last cell', () => {
    const data = plan(
      ['2027-01-04', 'p1', { code: 'R1' }],
      ['2027-01-05', 'p1', { code: 'R1' }],
      ['2027-01-05', 'p2', { code: 'R2' }],
    );
    const set = (date: ISODate, personId: PersonId) =>
      ({ type: 'setCell', date, personId, cell: null }) as const;
    const first = reduce(data, set('2027-01-04', 'p1'));
    expect(first.cells).not.toHaveProperty('2027-01-04');
    const second = reduce(data, set('2027-01-05', 'p1'));
    expect(Object.keys(second.cells['2027-01-05'])).toEqual(['p2']);
  });

  it('gives back the same data when there is no cell to remove', () => {
    const data = plan(['2027-01-04', 'p1', { code: 'R1' }]);
    const clear = (date: ISODate, personId: PersonId) =>
      reduce(data, { type: 'setCell', date, personId, cell: null });
    expect(clear('2027-01-04', 'p2')).toBe(data);
    expect(clear('2027-01-06', 'p1')).toBe(data);
  });
});

describe('togglePin', () => {
  const toggle = (data: AppData) =>
    reduce(data, { type: 'togglePin', date: '2027-01-04', personId: 'p1' });

  it('pins a shift that is not pinned', () => {
    const next = toggle(plan(['2027-01-04', 'p1', { code: 'R1' }]));
    expect(cellOf(next, '2027-01-04', 'p1')).toStrictEqual({ code: 'R1', pinned: true });
  });

  it('unpins a pinned shift, leaving no pinned key', () => {
    const next = toggle(plan(['2027-01-04', 'p1', { code: 'R1', pinned: true }]));
    expect(cellOf(next, '2027-01-04', 'p1')).toStrictEqual({ code: 'R1' });
  });

  it('toggles each of the seven shifts', () => {
    for (const code of ['R1', 'R2', 'O20', 'O', 'N', 'R12', 'N12'] as const) {
      const pinned = toggle(plan(['2027-01-04', 'p1', { code }]));
      expect(cellOf(pinned, '2027-01-04', 'p1')).toStrictEqual({ code, pinned: true });
    }
  });

  it('ignores a cell holding x', () => {
    const data = plan(['2027-01-04', 'p1', { code: 'x' }]);
    expect(toggle(data)).toBe(data);
  });

  it('ignores each absence', () => {
    for (const code of ['DOV', 'MD', 'OP', 'NEM'] as const) {
      const data = plan(['2027-01-04', 'p1', { code }]);
      expect(toggle(data)).toBe(data);
    }
  });

  it('ignores a day on which the person has no cell', () => {
    const data = plan(['2027-01-04', 'p2', { code: 'R1' }]);
    expect(toggle(data)).toBe(data);
  });
});

describe('setDoctor', () => {
  const NOTE: DoctorNote = { from: 480, to: 720 };

  type Noted = [date: ISODate, personId: PersonId, note: DoctorNote];

  /** A frozen plan of eight people, p1 to p8, with these doctor's notes stored. */
  function planWithNotes(...notes: Noted[]): AppData {
    const data = newAppData();
    for (const [date, id, note] of notes) (data.doctor[date] ??= {})[id] = note;
    return deepFreeze(data);
  }

  const set = (data: AppData, date: ISODate, personId: PersonId, note: DoctorNote | null) =>
    reduce(data, { type: 'setDoctor', date, personId, note });

  it('stores and deletes a note', () => {
    const stored = set(planWithNotes(), '2027-01-04', 'p1', NOTE);
    expect(stored.doctor).toStrictEqual({ '2027-01-04': { p1: NOTE } });
    const deleted = set(stored, '2027-01-04', 'p1', null);
    expect(deleted.doctor).toStrictEqual({});
  });

  it('keeps the notes of the others, and replaces the note of that person and day', () => {
    const other: DoctorNote = { from: 600, to: 660 };
    const data = planWithNotes(
      ['2027-01-04', 'p2', other],
      ['2027-01-05', 'p1', other],
      ['2027-01-04', 'p1', other],
    );
    const next = set(data, '2027-01-04', 'p1', NOTE);
    expect(next.doctor).toStrictEqual({
      '2027-01-04': { p2: other, p1: NOTE },
      '2027-01-05': { p1: other },
    });
  });

  it('deletes one note and keeps the day while another person has a note on it', () => {
    const data = planWithNotes(['2027-01-04', 'p1', NOTE], ['2027-01-04', 'p2', NOTE]);
    expect(set(data, '2027-01-04', 'p1', null).doctor).toStrictEqual({
      '2027-01-04': { p2: NOTE },
    });
  });

  it('stores the note beside the cell of the day and does not touch it', () => {
    const data = plan(['2027-01-04', 'p1', { code: 'R1', pinned: true }]);
    const next = set(data, '2027-01-04', 'p1', NOTE);
    expect(cellOf(next, '2027-01-04', 'p1')).toStrictEqual({ code: 'R1', pinned: true });
    expect(next.doctor['2027-01-04'].p1).toStrictEqual(NOTE);
    // And the cell goes with setCell alone: a note stays when the cell is cleared.
    const clear: Action = { type: 'setCell', date: '2027-01-04', personId: 'p1', cell: null };
    const cleared = reduce(next, clear);
    expect(cleared.doctor['2027-01-04'].p1).toStrictEqual(NOTE);
  });

  it('gives back the same data when there is no note to delete', () => {
    const data = planWithNotes(['2027-01-04', 'p1', NOTE]);
    expect(set(data, '2027-01-04', 'p2', null)).toBe(data);
    expect(set(data, '2027-01-06', 'p1', null)).toBe(data);
  });

  // The save file drops a note for someone who is not in the team, and is refused with a note that
  // is not a stretch of one day: the reducer does not make either.
  it('ignores a person who is not in the team', () => {
    const data = planWithNotes();
    expect(set(data, '2027-01-04', 'zz', NOTE)).toBe(data);
  });

  it.each([
    ['the first minute of the day', { from: 0, to: 1 }],
    ['the whole day', { from: 0, to: 1440 }],
    ['the last minute of the day', { from: 1439, to: 1440 }],
  ])('stores a note that is at the edge of the day: %s', (_what, note) => {
    const next = set(planWithNotes(), '2027-01-04', 'p1', note);
    expect(next.doctor).toStrictEqual({ '2027-01-04': { p1: note } });
  });

  it.each([
    ['one that ends where it starts', { from: 480, to: 480 }],
    ['one that ends before it starts', { from: 720, to: 480 }],
    ['one that starts before midnight', { from: -1, to: 60 }],
    ['one that ends after the day', { from: 1380, to: 1441 }],
    ['one with a part of a minute', { from: 480.5, to: 720 }],
    ['one that is not a number', { from: Number.NaN, to: 720 }],
  ])('ignores a note that is not a time span of the day: %s', (_what, note) => {
    const data = planWithNotes();
    expect(set(data, '2027-01-04', 'p1', note)).toBe(data);
  });
});

describe('applyPaste', () => {
  it('stores the cells of the plan: shifts pinned, x and absences plain', () => {
    const next = reduce(plan(), {
      type: 'applyPaste',
      plan: {
        writes: [
          { personId: 'p1', date: '2027-01-04', code: 'R1' },
          { personId: 'p2', date: '2027-01-04', code: 'x' },
        ],
        doctorWrites: [],
        ignored: [],
        namesColumn: false,
      },
    });
    expect(cellOf(next, '2027-01-04', 'p1')).toStrictEqual({ code: 'R1', pinned: true });
    expect(cellOf(next, '2027-01-04', 'p2')).toStrictEqual({ code: 'x' });
  });

  it("stores the doctor's notes of the plan in the step of its cells, beside them", () => {
    const data = plan(['2027-01-04', 'p1', { code: 'O', pinned: true }]);
    const next = reduce(data, {
      type: 'applyPaste',
      plan: {
        writes: [{ personId: 'p2', date: '2027-01-04', code: 'R1' }],
        doctorWrites: [
          { personId: 'p1', date: '2027-01-04', note: { from: 480, to: 720 } },
          { personId: 'p2', date: '2027-01-05', note: { from: 510, to: 720 } },
        ],
        ignored: [],
        namesColumn: false,
      },
    });
    expect(cellOf(next, '2027-01-04', 'p1')).toStrictEqual({ code: 'O', pinned: true });
    expect(cellOf(next, '2027-01-04', 'p2')).toStrictEqual({ code: 'R1', pinned: true });
    expect(next.doctor).toStrictEqual({
      '2027-01-04': { p1: { from: 480, to: 720 } },
      '2027-01-05': { p2: { from: 510, to: 720 } },
    });
    expect(parseSaveFile(serialize(next)).doctor).toEqual(next.doctor);
  });
});

describe('applyGenerated', () => {
  const MONTH = '2027-01';
  const GENERATED_AT = '2027-01-02T09:30:00.000Z';

  /** Where a date sits in a row of the month grid. */
  const column = (grid: MonthGrid, date: ISODate) =>
    grid.ctx.days.findIndex((day) => day.date === date);

  /** The rows of the grid with these cells set to a code number. */
  function generated(grid: MonthGrid, ...sets: Array<[PersonId, ISODate, number]>): Uint8Array[] {
    const rows = grid.rows.map((row) => row.slice());
    for (const [id, date, code] of sets) {
      rows[grid.personIds.indexOf(id)][column(grid, date)] = code;
    }
    return rows;
  }

  /** What `useGenerator` dispatches when a run ends: the rows of a grid captured at its start. */
  function apply(data: AppData, grid: MonthGrid, rows: Uint8Array[]): AppData {
    const action: Action = {
      type: 'applyGenerated',
      month: MONTH,
      rows,
      fixed: grid.fixed,
      seed: 42,
      personIds: grid.personIds,
      generatedAt: GENERATED_AT,
    };
    return reduce(data, action);
  }

  /** The plan after these actions, in order. */
  const edit = (data: AppData, ...actions: Action[]): AppData =>
    actions.reduce((current, action) => reduce(current, action), data);

  /** The action that clears a cell. */
  const clear = (date: ISODate, personId: PersonId): Action => ({
    type: 'setCell',
    date,
    personId,
    cell: null,
  });

  const person = (data: AppData, id: PersonId) => data.people.find((p) => p.id === id) as Person;

  // A request, an absence, a pin, and the last day of December (which is no part of the month).
  const start = plan(
    ['2027-01-01', 'p1', { code: 'x' }],
    ['2027-01-04', 'p2', { code: 'DOV' }],
    ['2027-01-05', 'p3', { code: 'R2', pinned: true }],
    ['2026-12-31', 'p4', { code: 'N' }],
    ['2027-02-02', 'p1', { code: 'R1' }],
  );

  it('stores the rows, sets the status draft, and keeps the fixed cells', () => {
    const grid = buildMonthGrid(start, MONTH);
    const rows = generated(
      grid,
      ['p1', '2027-01-04', Code.R1],
      ['p5', '2027-01-09', Code.R12],
      // The generator never changes these, but the reducer must not rely on that.
      ['p1', '2027-01-01', Code.R12],
      ['p2', '2027-01-04', Code.R1],
      ['p3', '2027-01-05', Code.O],
      ['p4', '2026-12-31', Code.R1],
    );
    const next = apply(start, grid, rows);

    expect(cellOf(next, '2027-01-04', 'p1')).toStrictEqual({ code: 'R1' });
    expect(cellOf(next, '2027-01-09', 'p5')).toStrictEqual({ code: 'R12' });
    expect(cellOf(next, '2027-01-01', 'p1')).toStrictEqual({ code: 'x' });
    expect(cellOf(next, '2027-01-04', 'p2')).toStrictEqual({ code: 'DOV' });
    expect(cellOf(next, '2027-01-05', 'p3')).toStrictEqual({ code: 'R2', pinned: true });
    expect(cellOf(next, '2026-12-31', 'p4')).toStrictEqual({ code: 'N' });
    expect(cellOf(next, '2027-02-02', 'p1')).toStrictEqual({ code: 'R1' });
    expect(next.months[MONTH]).toStrictEqual({
      status: 'draft',
      seed: 42,
      generatedAt: GENERATED_AT,
    });
  });

  it('clears a free cell that the generated month leaves empty', () => {
    const data = plan(['2027-01-12', 'p6', { code: 'O' }]);
    const grid = buildMonthGrid(data, MONTH);
    const next = apply(data, grid, generated(grid, ['p6', '2027-01-12', Code.EMPTY]));
    expect(next.cells).not.toHaveProperty('2027-01-12');
  });

  it('merges into the month, keeping its hours adjustment, and leaves other months alone', () => {
    const data = structuredClone(start);
    data.months[MONTH] = { status: 'closed', hoursAdjust: { p1: 2 } };
    data.months['2026-12'] = { status: 'closed', seed: 7 };
    const grid = buildMonthGrid(data, MONTH);
    const next = apply(data, grid, grid.rows);
    expect(next.months[MONTH]).toStrictEqual({
      status: 'draft',
      seed: 42,
      generatedAt: GENERATED_AT,
      hoursAdjust: { p1: 2 },
    });
    expect(next.months['2026-12']).toStrictEqual({ status: 'closed', seed: 7 });
  });

  it('keeps an edit made while the generator ran', () => {
    const grid = buildMonthGrid(start, MONTH);
    const rows = generated(
      grid,
      ['p6', '2027-01-12', Code.R1],
      ['p6', '2027-01-13', Code.R1],
      ['p6', '2027-01-14', Code.R1],
    );
    // Meanwhile the team lead pins one cell, asks for x on another and fills a third.
    let edited = reduce(start, {
      type: 'setCell',
      date: '2027-01-12',
      personId: 'p6',
      cell: { code: 'O', pinned: true },
    });
    edited = reduce(edited, {
      type: 'setCell',
      date: '2027-01-13',
      personId: 'p6',
      cell: { code: 'x' },
    });
    edited = reduce(edited, {
      type: 'setCell',
      date: '2027-01-14',
      personId: 'p6',
      cell: { code: 'MD' },
    });
    const next = apply(edited, grid, rows);
    expect(cellOf(next, '2027-01-12', 'p6')).toStrictEqual({ code: 'O', pinned: true });
    expect(cellOf(next, '2027-01-13', 'p6')).toStrictEqual({ code: 'x' });
    expect(cellOf(next, '2027-01-14', 'p6')).toStrictEqual({ code: 'MD' });
  });

  it('does not bring back an x, an absence or a pin that was cleared during the run', () => {
    const grid = buildMonthGrid(start, MONTH);
    const rows = generated(grid, ['p5', '2027-01-09', Code.R12]);
    // The rows of the run still hold what was fixed when it began.
    const held = (id: PersonId, date: ISODate) =>
      rows[grid.personIds.indexOf(id)][column(grid, date)];
    expect([held('p1', '2027-01-01'), held('p2', '2027-01-04'), held('p3', '2027-01-05')]).toEqual([
      Code.X,
      Code.DOV,
      Code.R2,
    ]);

    // Meanwhile the team lead clears all three.
    const edited = edit(
      start,
      clear('2027-01-01', 'p1'),
      clear('2027-01-04', 'p2'),
      clear('2027-01-05', 'p3'),
    );
    const next = apply(edited, grid, rows);
    expect(cellOf(next, '2027-01-01', 'p1')).toBeUndefined();
    expect(cellOf(next, '2027-01-04', 'p2')).toBeUndefined();
    expect(cellOf(next, '2027-01-05', 'p3')).toBeUndefined();
    expect(cellOf(next, '2027-01-09', 'p5')).toStrictEqual({ code: 'R12' }); // the run still lands
  });

  it('does not overwrite a cell that was fixed at the start and replaced during the run', () => {
    const grid = buildMonthGrid(start, MONTH);
    const rows = generated(grid);
    const edited = reduce(start, {
      type: 'setCell',
      date: '2027-01-01',
      personId: 'p1',
      cell: { code: 'R2' }, // an unpinned shift, so a free cell now, where the run holds the x
    });
    const next = apply(edited, grid, rows);
    expect(cellOf(next, '2027-01-01', 'p1')).toStrictEqual({ code: 'R2' });
  });

  it('does not write a day that was outside the team dates when the run started', () => {
    // p4 joins on the 11th, so the days before are fixed for the run. A leftover R1 stands on the
    // 5th, and the row of the run holds it.
    const begin = edit(
      start,
      { type: 'updatePerson', person: { ...person(start, 'p4'), activeFrom: '2027-01-11' } },
      { type: 'setCell', date: '2027-01-05', personId: 'p4', cell: { code: 'R1' } },
    );
    const grid = buildMonthGrid(begin, MONTH);
    const rows = generated(grid, ['p4', '2027-01-12', Code.R2]);
    expect(rows[grid.personIds.indexOf('p4')][column(grid, '2027-01-05')]).toBe(Code.R1);

    // Meanwhile p4 joins from the start of the month and the leftover is cleared.
    const edited = edit(
      begin,
      { type: 'updatePerson', person: { ...person(begin, 'p4'), activeFrom: null } },
      clear('2027-01-05', 'p4'),
    );
    const next = apply(edited, grid, rows);
    expect(cellOf(next, '2027-01-05', 'p4')).toBeUndefined();
    expect(cellOf(next, '2027-01-12', 'p4')).toStrictEqual({ code: 'R2' });
  });

  it('does not write a day that has left the team dates since the run started', () => {
    const grid = buildMonthGrid(start, MONTH);
    const rows = generated(grid, ['p4', '2027-01-14', Code.R1], ['p4', '2027-01-20', Code.R1]);
    const edited = reduce(start, {
      type: 'updatePerson',
      person: { ...person(start, 'p4'), activeTo: '2027-01-15' },
    });
    const next = apply(edited, grid, rows);
    expect(cellOf(next, '2027-01-14', 'p4')).toStrictEqual({ code: 'R1' });
    expect(cellOf(next, '2027-01-20', 'p4')).toBeUndefined();
  });

  it('matches the cells that were fixed at the start to people by id too', () => {
    const grid = buildMonthGrid(start, MONTH);
    // p1 holds the x on the 1st, fixed; p2, the next row, is free that day and gets R12.
    const rows = generated(grid, ['p2', '2027-01-01', Code.R12]);
    // Meanwhile p1 moves down a place, and its x is cleared.
    const edited = edit(
      start,
      { type: 'movePerson', personId: 'p1', delta: 1 },
      clear('2027-01-01', 'p1'),
    );
    const next = apply(edited, grid, rows);
    expect(cellOf(next, '2027-01-01', 'p2')).toStrictEqual({ code: 'R12' });
    expect(cellOf(next, '2027-01-01', 'p1')).toBeUndefined();
  });

  it('gives each row to its person by id, however the team changed meanwhile', () => {
    const grid = buildMonthGrid(start, MONTH);
    const rows = generated(
      grid,
      ['p1', '2027-01-06', Code.R1],
      ['p3', '2027-01-07', Code.R2],
      ['p6', '2027-01-08', Code.O],
      ['p7', '2027-01-11', Code.O20],
      ['p8', '2027-01-12', Code.N],
    );
    // Meanwhile p1 is removed, p7 moves up a place and a new person joins.
    let edited = reduce(start, { type: 'removePerson', personId: 'p1' });
    edited = reduce(edited, { type: 'movePerson', personId: 'p7', delta: -1 });
    edited = reduce(edited, { type: 'addPerson', id: 'p9' });
    const next = apply(edited, grid, rows);

    expect(cellOf(next, '2027-01-06', 'p1')).toBeUndefined();
    expect(cellOf(next, '2027-01-07', 'p3')).toStrictEqual({ code: 'R2' });
    expect(cellOf(next, '2027-01-08', 'p6')).toStrictEqual({ code: 'O' });
    expect(cellOf(next, '2027-01-11', 'p7')).toStrictEqual({ code: 'O20' });
    expect(cellOf(next, '2027-01-12', 'p8')).toStrictEqual({ code: 'N' });
    expect(Object.values(next.cells).some((day) => 'p9' in day)).toBe(false);
  });

  it('leaves a person who was not in the run exactly as they are', () => {
    const grid = buildMonthGrid(start, MONTH);
    const rows = generated(grid, ['p3', '2027-01-07', Code.R2]);
    // Meanwhile a person joins, and a cell is filled in for them, its pin switched off.
    const edited = edit(
      start,
      { type: 'addPerson', id: 'p9' },
      { type: 'setCell', date: '2027-01-12', personId: 'p9', cell: { code: 'O', pinned: false } },
    );
    const next = apply(edited, grid, rows);
    expect(cellOf(next, '2027-01-12', 'p9')).toStrictEqual({ code: 'O', pinned: false });
    expect(cellOf(next, '2027-01-07', 'p3')).toStrictEqual({ code: 'R2' }); // the run lands
  });

  it('skips a person who is no longer in the team that month', () => {
    const grid = buildMonthGrid(start, MONTH);
    const rows = generated(grid, ['p3', '2027-01-07', Code.R2], ['p4', '2027-01-07', Code.R1]);
    const p3 = start.people.find((p) => p.id === 'p3')!;
    const edited = reduce(start, {
      type: 'updatePerson',
      person: { ...p3, activeTo: '2026-12-31' },
    });
    const next = apply(edited, grid, rows);
    expect(cellOf(next, '2027-01-07', 'p3')).toBeUndefined();
    expect(cellOf(next, '2027-01-07', 'p4')).toStrictEqual({ code: 'R1' });
  });
});

describe('updatePerson', () => {
  it('replaces the person with that id and keeps the order', () => {
    const data = plan();
    const person = { ...data.people[2], name: 'Nové jméno', allowance: { DOV: 20, MD: 3 } };
    const next = reduce(data, { type: 'updatePerson', person });
    expect(next.people[2]).toEqual(person);
    expect(next.people.map((p) => p.id)).toEqual(data.people.map((p) => p.id));
    expect(next.people[1]).toBe(data.people[1]);
  });

  it('does not add a person it does not know', () => {
    const data = plan();
    expect(reduce(data, { type: 'updatePerson', person: newPerson('zz', 'Cizí') })).toBe(data);
  });
});

describe('addPerson', () => {
  it('adds a default person at the end, named by the size of the team', () => {
    const next = reduce(plan(), { type: 'addPerson', id: 'new-id' });
    expect(next.people).toHaveLength(9);
    expect(next.people[8]).toEqual(newPerson('new-id', 'Operátor 9'));
  });

  it('numbers the name from the people there are now', () => {
    const smaller = reduce(plan(), { type: 'removePerson', personId: 'p2' });
    const next = reduce(smaller, { type: 'addPerson', id: 'new-id' });
    expect(next.people[7].name).toBe('Operátor 8');
  });

  it('gives the same result for the same action, as a pure reducer must', () => {
    const data = plan();
    const action: Action = { type: 'addPerson', id: 'new-id' };
    expect(reduce(data, action)).toEqual(reduce(data, action));
  });

  it('does not add a second person with an id that is taken', () => {
    const data = plan();
    expect(reduce(data, { type: 'addPerson', id: 'p3' })).toBe(data);
  });
});

describe('removePerson', () => {
  const data = (() => {
    const base = plan(
      ['2027-01-04', 'p1', { code: 'R1' }],
      ['2027-01-04', 'p2', { code: 'R2' }],
      ['2027-01-05', 'p1', { code: 'x' }],
      ['2026-12-31', 'p1', { code: 'N' }],
    );
    const copy = structuredClone(base);
    copy.months['2027-01'] = { status: 'draft', hoursAdjust: { p1: 3, p2: -1.5 } };
    copy.months['2026-12'] = { status: 'closed', hoursAdjust: { p1: 1 } };
    copy.months['2026-11'] = { status: 'closed' };
    copy.doctor['2027-01-04'] = { p1: { from: 480, to: 720 }, p2: { from: 600, to: 660 } };
    copy.doctor['2027-01-06'] = { p1: { from: 0, to: 1440 } };
    return deepFreeze(copy);
  })();

  const remove = (personId: PersonId) => reduce(data, { type: 'removePerson', personId });

  it('removes the person from the team', () => {
    const ids = remove('p1').people.map((p) => p.id);
    expect(ids).toEqual(['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
  });

  it('removes their cells, and the days that held nothing else', () => {
    const next = remove('p1');
    expect(cellOf(next, '2027-01-04', 'p1')).toBeUndefined();
    expect(next.cells).not.toHaveProperty('2027-01-05');
    expect(next.cells).not.toHaveProperty('2026-12-31');
  });

  it('keeps the cells of the others', () => {
    expect(cellOf(remove('p1'), '2027-01-04', 'p2')).toStrictEqual({ code: 'R2' });
  });

  it('removes their hours adjustments and keeps the others', () => {
    const next = remove('p1');
    expect(next.months['2027-01']).toStrictEqual({ status: 'draft', hoursAdjust: { p2: -1.5 } });
    expect(next.months['2026-12']).toStrictEqual({ status: 'closed', hoursAdjust: {} });
    expect(next.months['2026-11']).toStrictEqual({ status: 'closed' });
  });

  it('leaves the hours adjustments of the others when a person with none is removed', () => {
    expect(remove('p5').months['2027-01'].hoursAdjust).toEqual({ p1: 3, p2: -1.5 });
  });

  it("deletes the person's doctor's notes", () => {
    // p1's other note was alone on its day: that day goes too.
    expect(remove('p1').doctor).toStrictEqual({ '2027-01-04': { p2: { from: 600, to: 660 } } });
    expect(remove('p2').doctor).toStrictEqual({
      '2027-01-04': { p1: { from: 480, to: 720 } },
      '2027-01-06': { p1: { from: 0, to: 1440 } },
    });
  });

  it('leaves the notes alone when a person with none is removed', () => {
    expect(remove('p5').doctor).toStrictEqual(data.doctor);
  });

  // A note of someone who is not in the team is dropped when a file opens, so a plan that was
  // saved after the removal must open as it was, with every note that is left.
  it('leaves a plan that still saves and opens, though the person had a note', () => {
    for (const personId of ['p1', 'p2', 'p5']) {
      const next = remove(personId);
      expect(parseSaveFile(serialize(next))).toEqual(next);
    }
  });

  it('ignores a person who is not there', () => {
    expect(remove('zz')).toBe(data);
  });
});

describe('movePerson', () => {
  const ids = (data: AppData) => data.people.map((p) => p.id).join(' ');

  it('moves a person one place down', () => {
    const next = reduce(plan(), { type: 'movePerson', personId: 'p2', delta: 1 });
    expect(ids(next)).toBe('p1 p3 p2 p4 p5 p6 p7 p8');
  });

  it('moves a person one place up', () => {
    const next = reduce(plan(), { type: 'movePerson', personId: 'p2', delta: -1 });
    expect(ids(next)).toBe('p2 p1 p3 p4 p5 p6 p7 p8');
  });

  it('keeps the order at either end of the team', () => {
    const data = plan();
    expect(reduce(data, { type: 'movePerson', personId: 'p1', delta: -1 })).toBe(data);
    expect(reduce(data, { type: 'movePerson', personId: 'p8', delta: 1 })).toBe(data);
  });

  it('ignores a person it does not know', () => {
    const data = plan();
    expect(reduce(data, { type: 'movePerson', personId: 'zz', delta: 1 })).toBe(data);
  });
});

describe('updateSettings', () => {
  it('lays the patch over the settings', () => {
    const data = plan();
    const next = reduce(data, {
      type: 'updateSettings',
      patch: { minRestHours: 10, generatorTimeBudgetSec: 5 },
    });
    expect(next.settings).toEqual({
      ...data.settings,
      minRestHours: 10,
      generatorTimeBudgetSec: 5,
    });
  });

  it('replaces a nested setting as a whole', () => {
    const data = plan();
    const wishLevels = { ...data.settings.wishLevels, W6: 0 as const };
    const next = reduce(data, { type: 'updateSettings', patch: { wishLevels } });
    expect(next.settings.wishLevels).toEqual(wishLevels);
    expect(next.settings.coverage).toBe(data.settings.coverage);
  });
});
