import { describe, it, expect } from 'vitest';
import { newAppData } from '../domain/defaults';
import type { AppData, CodeName, DoctorNote, PersonId } from '../domain/types';
import { parseSaveFile, serialize } from '../storage/saveFile';
import { personRowTsv, parseTsv, planPaste, applyPaste, parseDoctor, formatDoctor } from './tsv';
import type { PastePlan } from './tsv';

describe('tsv', () => {
  it('copies a person row with x and absences', () => {
    const d = newAppData();
    const id = d.people[0].id;
    d.cells['2027-02-01'] = { [id]: { code: 'R1' } };
    d.cells['2027-02-02'] = { [id]: { code: 'x' } };
    d.cells['2027-02-03'] = { [id]: { code: 'DOV' } };
    expect(personRowTsv(d, '2027-02', id)).toBe(
      ['R1', 'x', 'DOV', ...Array(25).fill('')].join('\t'),
    );
  });
  it('parses Excel text with CRLF and trailing newline', () => {
    expect(parseTsv('a\tb\r\n\tc\t\r\n')).toEqual([['a', 'b'], ['', 'c', '']]);
  });
  it('maps a requests block, dropping names and ignoring totals', () => {
    const d = newAppData();
    const [p1, p2] = d.people;
    const text = 'Operátor 1\tX\tdov\t\r\nOperátor 2\t\tMD\tŠk.\r\nCelkem\t1\t2\t0';
    const plan = planPaste(d, '2027-01', { personId: p1.id, date: '2027-01-01' }, text);
    expect(plan.writes).toEqual([
      { personId: p1.id, date: '2027-01-01', code: 'x' },
      { personId: p1.id, date: '2027-01-02', code: 'DOV' },
      { personId: p2.id, date: '2027-01-02', code: 'MD' },
    ]);
    expect(plan.ignored.map((i) => i.value)).toEqual(['Šk.', '1', '2', '0']);
  });
  it('pins pasted shifts, not requests', () => {
    const d = newAppData();
    const id = d.people[0].id;
    const out = applyPaste(d, {
      writes: [
        { personId: id, date: '2026-12-31', code: 'N' },
        { personId: id, date: '2027-01-02', code: 'x' },
      ],
      ignored: [],
    });
    expect(out.cells['2026-12-31'][id]).toEqual({ code: 'N', pinned: true });
    expect(out.cells['2027-01-02'][id]).toEqual({ code: 'x' });
  });
});

/** Every code a cell can hold, in the order the tests put them on days 1 to 12. */
const CODES: CodeName[] = [
  'R1', 'R2', 'O20', 'O', 'N', 'R12', 'N12', 'DOV', 'MD', 'OP', 'NEM', 'x',
];

/** A date in January 2027. */
const jan = (day: number): string => `2027-01-${String(day).padStart(2, '0')}`;

/** A fresh team and the ids of its eight people, in order. */
function team(): { d: AppData; ids: PersonId[] } {
  const d = newAppData();
  return { d, ids: d.people.map((p) => p.id) };
}

/** Plans a paste into January 2027. */
const planJan = (d: AppData, personId: PersonId, date: string, text: string): PastePlan =>
  planPaste(d, '2027-01', { personId, date }, text);

describe('personRowTsv', () => {
  it('has one field per day of the month', () => {
    const { d, ids } = team();
    for (const [month, days] of [['2027-01', 31], ['2027-02', 28], ['2028-02', 29]] as const) {
      expect(personRowTsv(d, month, ids[0]).split('\t')).toEqual(Array(days).fill(''));
    }
  });
  it('writes the name of every code, pinned or not', () => {
    const { d, ids } = team();
    CODES.forEach((code, i) => {
      d.cells[jan(i + 1)] = { [ids[0]]: code === 'N' ? { code, pinned: true } : { code } };
    });
    expect(personRowTsv(d, '2027-01', ids[0]).split('\t')).toEqual([
      ...CODES,
      ...Array(19).fill(''),
    ]);
  });
  it('holds only that person and only that month', () => {
    const { d, ids } = team();
    d.cells['2026-12-31'] = { [ids[0]]: { code: 'N' } };
    d.cells[jan(1)] = { [ids[0]]: { code: 'R1' }, [ids[1]]: { code: 'O' } };
    d.cells[jan(31)] = { [ids[1]]: { code: 'DOV' } };
    d.cells['2027-02-01'] = { [ids[0]]: { code: 'x' } };
    expect(personRowTsv(d, '2027-01', ids[0])).toBe(['R1', ...Array(30).fill('')].join('\t'));
  });
});

describe('parseTsv', () => {
  it('reads text without a trailing newline and with plain LF', () => {
    expect(parseTsv('a\tb')).toEqual([['a', 'b']]);
    expect(parseTsv('a\nb\n')).toEqual([['a'], ['b']]);
  });
  it('gives no rows for no text', () => {
    expect(parseTsv('')).toEqual([]);
  });
  it('drops one trailing empty line, not two', () => {
    expect(parseTsv('a\n\n')).toEqual([['a'], ['']]);
    expect(parseTsv('a\r\n\r\n')).toEqual([['a'], ['']]);
    expect(parseTsv('\n')).toEqual([['']]);
  });
  it('keeps empty cells and empty lines', () => {
    expect(parseTsv('\t\t')).toEqual([['', '', '']]);
    expect(parseTsv('a\n\nb')).toEqual([['a'], [''], ['b']]);
  });
  it('keeps the cells as they are, spaces included', () => {
    expect(parseTsv(' a \t b ')).toEqual([[' a ', ' b ']]);
  });
});

describe('planPaste', () => {
  it('reports the ignored values at their places in the pasted text', () => {
    const { d, ids } = team();
    const text = 'Operátor 1\tX\tdov\t\r\nOperátor 2\t\tMD\tŠk.\r\nCelkem\t1\t2\t0';
    expect(planJan(d, ids[0], jan(1), text).ignored).toEqual([
      { row: 1, col: 3, value: 'Šk.' },
      { row: 2, col: 1, value: '1' },
      { row: 2, col: 2, value: '2' },
      { row: 2, col: 3, value: '0' },
    ]);
  });
  it('counts positions in the text as pasted, whether or not names were dropped', () => {
    const { d, ids } = team();
    expect(planJan(d, ids[0], jan(1), 'x\tŠk.').ignored).toEqual([
      { row: 0, col: 1, value: 'Šk.' },
    ]);
    expect(planJan(d, ids[0], jan(1), 'Jméno\tx\tŠk.\nOperátor 2\t\t?').ignored).toEqual([
      { row: 0, col: 2, value: 'Šk.' },
      { row: 1, col: 2, value: '?' },
    ]);
  });
  it('lists an ignored value as pasted, spaces included', () => {
    const { d, ids } = team();
    expect(planJan(d, ids[0], jan(1), 'x\t Šk. ').ignored).toEqual([
      { row: 0, col: 1, value: ' Šk. ' },
    ]);
  });

  describe('the first column', () => {
    it('is dropped when it holds only names, and writes nothing on its own', () => {
      const { d, ids } = team();
      expect(planJan(d, ids[0], jan(1), 'Operátor 1\nOperátor 2')).toEqual({
        writes: [],
        doctorWrites: [],
        ignored: [],
        namesColumn: true,
      });
    });
    it('is a day column when it holds a code', () => {
      const { d, ids } = team();
      const plan = planJan(d, ids[0], jan(1), 'x\tDOV\nMD');
      expect(plan.writes).toEqual([
        { personId: ids[0], date: jan(1), code: 'x' },
        { personId: ids[0], date: jan(2), code: 'DOV' },
        { personId: ids[1], date: jan(1), code: 'MD' },
      ]);
      expect(plan.ignored).toEqual([]);
    });
    it('is a day column when only some of its values are unrecognised', () => {
      const { d, ids } = team();
      const plan = planJan(d, ids[0], jan(1), 'Operátor 1\tx\nx\tDOV');
      expect(plan.writes).toEqual([
        { personId: ids[0], date: jan(2), code: 'x' },
        { personId: ids[1], date: jan(1), code: 'x' },
        { personId: ids[1], date: jan(2), code: 'DOV' },
      ]);
      expect(plan.ignored).toEqual([{ row: 0, col: 0, value: 'Operátor 1' }]);
    });
    it('keeps its place when it is empty in every row, as in a copied row', () => {
      const { d, ids } = team();
      const plan = planJan(d, ids[0], jan(1), '\tx\tDOV\n \tMD');
      expect(plan.writes).toEqual([
        { personId: ids[0], date: jan(2), code: 'x' },
        { personId: ids[0], date: jan(3), code: 'DOV' },
        { personId: ids[1], date: jan(2), code: 'MD' },
      ]);
      expect(plan.ignored).toEqual([]);
    });
    it('is dropped although some of its cells are empty', () => {
      const { d, ids } = team();
      const plan = planJan(d, ids[0], jan(1), 'Operátor 1\tx\n\tDOV');
      expect(plan.writes).toEqual([
        { personId: ids[0], date: jan(1), code: 'x' },
        { personId: ids[1], date: jan(1), code: 'DOV' },
      ]);
      expect(plan.ignored).toEqual([]);
    });
    it('does not list the names of rows beyond the last person', () => {
      const { d, ids } = team();
      const plan = planJan(d, ids[7], jan(1), 'Operátor 8\tx\nOperátor 9\tDOV');
      expect(plan.writes).toEqual([{ personId: ids[7], date: jan(1), code: 'x' }]);
      expect(plan.ignored).toEqual([{ row: 1, col: 1, value: 'DOV' }]);
    });
    it('is reported in namesColumn: true only when it was left out as names', () => {
      const { d, ids } = team();
      const flag = (text: string): boolean => planJan(d, ids[0], jan(1), text).namesColumn;
      expect(flag('Operátor 1\tx\nOperátor 2\tDOV')).toBe(true);
      expect(flag('Operátor 1')).toBe(true); // names alone: nothing is written, but they were names
      expect(flag('x\tDOV')).toBe(false); // the first column is a day
      expect(flag('Operátor 1\tx\nx\tDOV')).toBe(false); // one value of it is a code
      expect(flag('\tx\n \tDOV')).toBe(false); // empty in every row: a day column (R30)
      expect(flag('')).toBe(false);
    });
    it('is reported in namesColumn whatever happens to the values after it', () => {
      const { d, ids } = team();
      // The start person is not in the data, so nothing is written; the names were still names.
      const plan = planJan(d, 'nobody', jan(1), 'Operátor 1\tx');
      expect(plan.writes).toEqual([]);
      expect(plan.ignored).toEqual([{ row: 0, col: 1, value: 'x' }]);
      expect(plan.namesColumn).toBe(true);
      expect(planJan(d, ids[0], jan(1), 'Operátor 1\tŠk.').namesColumn).toBe(true);
    });
  });

  it('reads codes in any case, with spaces around them', () => {
    const { d, ids } = team();
    const plan = planJan(d, ids[0], jan(1), ' dov \tn12\tOp\tnem\t x\tR1 ');
    expect(plan.writes.map((w) => w.code)).toEqual(['DOV', 'N12', 'OP', 'NEM', 'x', 'R1']);
    expect(plan.ignored).toEqual([]);
  });
  it('takes every code, in consecutive dates', () => {
    const { d, ids } = team();
    const plan = planJan(d, ids[0], jan(1), CODES.join('\t'));
    expect(plan.writes).toEqual(
      CODES.map((code, i) => ({ personId: ids[0], date: jan(i + 1), code })),
    );
    expect(plan.ignored).toEqual([]);
  });
  it('starts at the person and the date it is given', () => {
    const { d, ids } = team();
    expect(planJan(d, ids[2], jan(10), 'x\tDOV\nMD').writes).toEqual([
      { personId: ids[2], date: jan(10), code: 'x' },
      { personId: ids[2], date: jan(11), code: 'DOV' },
      { personId: ids[3], date: jan(10), code: 'MD' },
    ]);
  });
  it('writes nothing for empty cells and lists nothing for them', () => {
    const { d, ids } = team();
    // Row 0 runs off the end of the month; row 1 is beyond the last person. Both are empty there.
    const plan = planJan(d, ids[7], jan(31), 'x\t \t\t\n\t\t\t');
    expect(plan.writes).toEqual([{ personId: ids[7], date: jan(31), code: 'x' }]);
    expect(plan.ignored).toEqual([]);
  });
  it('gives an empty plan for no text', () => {
    const { d, ids } = team();
    expect(planJan(d, ids[0], jan(1), '')).toEqual({
      writes: [],
      doctorWrites: [],
      ignored: [],
      namesColumn: false,
    });
  });
  it('does not change the data it plans for', () => {
    const { d, ids } = team();
    d.cells[jan(1)] = { [ids[0]]: { code: 'R1', pinned: true } };
    const before = structuredClone(d);
    planJan(d, ids[0], jan(1), 'x\tDOV\nMD');
    expect(d).toEqual(before);
  });

  describe('the dates', () => {
    it('are the last 7 days of the previous month and the days of the month', () => {
      const { d, ids } = team();
      // 24 Dec is one day before the tail; the 8 columns after it are valid.
      const plan = planJan(d, ids[0], '2026-12-24', Array(9).fill('x').join('\t'));
      expect(plan.ignored).toEqual([{ row: 0, col: 0, value: 'x' }]);
      expect(plan.writes.map((w) => w.date)).toEqual([
        '2026-12-25', '2026-12-26', '2026-12-27', '2026-12-28',
        '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01',
      ]);
    });
    it('end with the last day of the month', () => {
      const { d, ids } = team();
      const plan = planJan(d, ids[0], jan(30), 'x\tDOV\tMD\tOP');
      expect(plan.writes).toEqual([
        { personId: ids[0], date: jan(30), code: 'x' },
        { personId: ids[0], date: jan(31), code: 'DOV' },
      ]);
      expect(plan.ignored).toEqual([
        { row: 0, col: 2, value: 'MD' },
        { row: 0, col: 3, value: 'OP' },
      ]);
    });
    it('follow each other across the changes of the clock', () => {
      const { d, ids } = team();
      const datesOf = (month: string, date: string): string[] =>
        planPaste(d, month, { personId: ids[0], date }, 'x\tx\tx\tx').writes.map((w) => w.date);
      // Summer time began on 28 Mar 2027 (a day of 23 hours) and ended on 25 Oct 2026 (25 hours).
      expect(datesOf('2027-03', '2027-03-26')).toEqual([
        '2027-03-26', '2027-03-27', '2027-03-28', '2027-03-29',
      ]);
      expect(datesOf('2026-10', '2026-10-24')).toEqual([
        '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27',
      ]);
    });
    it('are checked against the month asked for, not the start date', () => {
      const { d, ids } = team();
      const plan = planPaste(d, '2027-02', { personId: ids[0], date: jan(30) }, 'x\tx\tx\tx');
      // The tail of February is 25 to 31 January, so 30 and 31 January are valid.
      expect(plan.writes.map((w) => w.date)).toEqual([
        jan(30), jan(31), '2027-02-01', '2027-02-02',
      ]);
      const other = planPaste(d, '2027-03', { personId: ids[0], date: jan(30) }, 'x\tx');
      expect(other.writes).toEqual([]);
      expect(other.ignored).toHaveLength(2);
    });
  });

  describe('the rows', () => {
    it('ignore the rows beyond the last person, recognised codes included', () => {
      const { d, ids } = team();
      const plan = planJan(d, ids[7], jan(1), 'x\nDOV\n\nMD');
      expect(plan.writes).toEqual([{ personId: ids[7], date: jan(1), code: 'x' }]);
      expect(plan.ignored).toEqual([
        { row: 1, col: 0, value: 'DOV' },
        { row: 3, col: 0, value: 'MD' },
      ]);
    });
    it('write nothing when the start person is not in the data', () => {
      const { d } = team();
      const plan = planJan(d, 'nobody', jan(1), 'x\tDOV\n\tMD');
      expect(plan.writes).toEqual([]);
      expect(plan.ignored).toEqual([
        { row: 0, col: 0, value: 'x' },
        { row: 0, col: 1, value: 'DOV' },
        { row: 1, col: 1, value: 'MD' },
      ]);
    });

    // The rows are the people of the month grid: those in the team on a day of the month.
    it('skip a person who is not in the team all month', () => {
      const { d, ids } = team();
      d.people[1].activeTo = '2026-12-31'; // B left before the month
      const plan = planJan(d, ids[0], jan(1), 'x\nDOV');
      expect(plan.writes).toEqual([
        { personId: ids[0], date: jan(1), code: 'x' },
        { personId: ids[2], date: jan(1), code: 'DOV' },
      ]);
      expect(plan.ignored).toEqual([]);
    });
    it('skip a person who only joins after the month', () => {
      const { d, ids } = team();
      d.people[1].activeFrom = '2027-02-01';
      expect(planJan(d, ids[0], jan(1), 'x\nDOV').writes.map((w) => w.personId)).toEqual([
        ids[0],
        ids[2],
      ]);
    });
    it('keep a person who is in the team on a single day of the month', () => {
      const { d, ids } = team();
      d.people[1].activeFrom = jan(31);
      d.people[2].activeTo = jan(1);
      const plan = planJan(d, ids[0], jan(1), 'x\nDOV\nMD');
      expect(plan.writes.map((w) => w.personId)).toEqual([ids[0], ids[1], ids[2]]);
    });
    it('count the beyond-the-last-person rows from the last person in the team', () => {
      const { d, ids } = team();
      d.people[7].activeTo = '2026-12-31'; // the last person has left
      const plan = planJan(d, ids[6], jan(1), 'x\nDOV');
      expect(plan.writes).toEqual([{ personId: ids[6], date: jan(1), code: 'x' }]);
      expect(plan.ignored).toEqual([{ row: 1, col: 0, value: 'DOV' }]);
    });
    it('write nothing when the start person is not in the team that month', () => {
      const { d, ids } = team();
      d.people[1].activeTo = '2026-12-31';
      const plan = planJan(d, ids[1], jan(1), 'x\tDOV\n\tMD');
      expect(plan.writes).toEqual([]);
      expect(plan.ignored).toEqual([
        { row: 0, col: 0, value: 'x' },
        { row: 0, col: 1, value: 'DOV' },
        { row: 1, col: 1, value: 'MD' },
      ]);
    });
    it('follow the team of the month asked for', () => {
      const { d, ids } = team();
      d.people[1].activeTo = '2027-01-31'; // in the team in January, gone in February
      const rows = (month: string, date: string): string[] =>
        planPaste(d, month, { personId: ids[0], date }, 'x\nDOV').writes.map((w) => w.personId);
      expect(rows('2027-01', jan(1))).toEqual([ids[0], ids[1]]);
      expect(rows('2027-02', '2027-02-01')).toEqual([ids[0], ids[2]]);
    });
    it('take the team of the month, also when the paste starts in the month before', () => {
      const { d, ids } = team();
      d.people[2].activeFrom = jan(4); // C joins in January
      const plan = planJan(d, ids[0], '2026-12-28', 'x\nDOV\nMD');
      expect(plan.writes.map((w) => w.personId)).toEqual([ids[0], ids[1], ids[2]]);
    });
  });
});

describe('applyPaste', () => {
  const write = (personId: PersonId, date: string, code: CodeName): PastePlan => ({
    writes: [{ personId, date, code }],
    doctorWrites: [],
    ignored: [],
    namesColumn: false,
  });

  it.each(['R1', 'R2', 'O20', 'O', 'N', 'R12', 'N12'] as const)('pins the shift %s', (code) => {
    const { d, ids } = team();
    const out = applyPaste(d, write(ids[0], jan(5), code));
    expect(out.cells[jan(5)][ids[0]]).toStrictEqual({ code, pinned: true });
  });
  it.each(['DOV', 'MD', 'OP', 'NEM', 'x'] as const)('stores %s without a pin', (code) => {
    const { d, ids } = team();
    const out = applyPaste(d, write(ids[0], jan(5), code));
    expect(out.cells[jan(5)][ids[0]]).toStrictEqual({ code });
  });
  it('replaces the cell it writes to, pin included', () => {
    const { d, ids } = team();
    d.cells[jan(4)] = { [ids[0]]: { code: 'N', pinned: true } };
    d.cells[jan(5)] = { [ids[0]]: { code: 'DOV' } };
    const out = applyPaste(d, {
      writes: [
        { personId: ids[0], date: jan(4), code: 'x' },
        { personId: ids[0], date: jan(5), code: 'R2' },
      ],
      ignored: [],
    });
    expect(out.cells[jan(4)][ids[0]]).toStrictEqual({ code: 'x' });
    expect(out.cells[jan(5)][ids[0]]).toStrictEqual({ code: 'R2', pinned: true });
  });
  it('keeps every other cell and leaves its input alone', () => {
    const { d, ids } = team();
    d.cells[jan(4)] = { [ids[0]]: { code: 'R1' }, [ids[1]]: { code: 'N', pinned: true } };
    d.cells[jan(5)] = { [ids[1]]: { code: 'DOV' } };
    d.cells[jan(6)] = { [ids[2]]: { code: 'O' } };
    const before = structuredClone(d);
    const out = applyPaste(d, write(ids[0], jan(5), 'x'));
    expect(d).toEqual(before);
    expect(out.cells).toEqual({
      ...before.cells,
      [jan(5)]: { [ids[0]]: { code: 'x' }, [ids[1]]: { code: 'DOV' } },
    });
    expect({ ...out, cells: {} }).toEqual({ ...before, cells: {} });
  });
  it('changes nothing for an empty plan', () => {
    const { d, ids } = team();
    d.cells[jan(4)] = { [ids[0]]: { code: 'R1' } };
    expect(applyPaste(d, { writes: [], ignored: [] })).toEqual(d);
  });
});

describe('copy a row, paste it back', () => {
  it.each([
    ['empty', []],
    ['filled', [[1, 'R1']]],
  ] as const)('restores a row whose first day is %s', (_, first) => {
    const { d, ids } = team();
    const cells: Array<readonly [number, CodeName]> = [
      ...first,
      [2, 'R1'], [3, 'x'], [4, 'DOV'], [9, 'N12'], [10, 'R12'], [31, 'N'],
    ];
    for (const [day, code] of cells) d.cells[jan(day)] = { [ids[0]]: { code } };
    const row = personRowTsv(d, '2027-01', ids[0]);

    const plan = planJan(d, ids[1], jan(1), row);
    const out = applyPaste(d, plan);

    expect(plan.ignored).toEqual([]);
    expect(plan.writes).toHaveLength(cells.length);
    expect(personRowTsv(out, '2027-01', ids[1])).toBe(row);
    expect(out.cells[jan(9)][ids[1]]).toEqual({ code: 'N12', pinned: true });
    expect(out.cells[jan(3)][ids[1]]).toEqual({ code: 'x' });
  });
});

// --- Doctor's notes: the code L --------------------------------------------------------------

/** 8:00 to 12:00, the appointment that most of these tests use. */
const MORNING: DoctorNote = { from: 480, to: 720 };

describe('parseDoctor', () => {
  it("parses doctor's notes in the usual forms", () => {
    for (const text of ['L 8-12', 'L8-12', 'l 8:00 - 12:00', 'L 8\u201312']) {
      expect(parseDoctor(text), text).toEqual(MORNING);
    }
    expect(parseDoctor('L 8:30-12')).toEqual({ from: 510, to: 720 });
    for (const text of ['L', 'L 12-8', 'L 8']) expect(parseDoctor(text), text).toBeNull();

    // The forms beyond these (the tables below go through them one by one): spaces around the
    // cell, a leading zero, a dot for the colon, 24 as the end of the day, and what is not a time
    // or has text after it.
    expect(parseDoctor('  l 08:00 \u2013 12:00  ')).toEqual(MORNING);
    expect(parseDoctor('L 8.30-12')).toEqual({ from: 510, to: 720 });
    expect(parseDoctor('L 8.30-12.15')).toEqual({ from: 510, to: 735 });
    expect(parseDoctor('L 8-24')).toEqual({ from: 480, to: 1440 });
    expect(parseDoctor('L 8-24:00')).toEqual({ from: 480, to: 1440 });
    const no = ['L 25-26', 'L 8:5-12', 'L 8.5-12', 'L 8-24:30', 'L 8-12 h', 'L 24-25', 'L 8-8'];
    for (const text of [...no, 'L 8h-12']) expect(parseDoctor(text), text).toBeNull();
  });

  it.each<[string, string, DoctorNote]>([
    ['L in lower case', 'l 8-12', MORNING],
    ['spaces around the cell', '  L 8-12  ', MORNING],
    ['a no-break space around the cell, as Excel can leave one', '\u00a0L 8-12\u00a0', MORNING],
    ['more than one space', 'L  8  -  12', MORNING],
    ['no-break spaces inside the note', 'L\u00a08\u00a0-\u00a012', MORNING],
    ['a tab inside the note', 'L\t8-12', MORNING],
    ['spaces around an en dash', 'L 8 \u2013 12', MORNING],
    ['spaces on one side of the dash', 'L 8 -12', MORNING],
    ['no space after the L but one before the dash', 'L8 -12', MORNING],
    ['a leading zero on the hours', 'L 08-12', MORNING],
    ['a leading zero on the end only', 'L 8-09', { from: 480, to: 540 }],
    ['minutes with a leading zero hour', 'L 08:30-09:45', { from: 510, to: 585 }],
    ['hour 0', 'L 0-1', { from: 0, to: 60 }],
    ['hour 00', 'L 00:00-00:30', { from: 0, to: 30 }],
    ['hour 23', 'L 22-23', { from: 1320, to: 1380 }],
    ['minutes on both times', 'L 8:30-12:45', { from: 510, to: 765 }],
    ['minutes on the end only', 'L 8-12:30', { from: 480, to: 750 }],
    ['minutes with an en dash', 'L 8:00\u201312:00', MORNING],
    ['a dot between the hours and the minutes', 'L 8.30-12', { from: 510, to: 720 }],
    ['a dot on both times', 'L 8.30-12.15', { from: 510, to: 735 }],
    ['a dot on the end only', 'L 8-12.30', { from: 480, to: 750 }],
    ['a dot, spaces and an en dash', 'l 8.00 \u2013 12.00', MORNING],
    ['a dot with a leading zero hour', 'L 08.30-09.45', { from: 510, to: 585 }],
    ['a dot on one time and a colon on the other', 'L 8:30-12.15', { from: 510, to: 735 }],
    ['24.00 as the end of the day', 'L 22-24.00', { from: 1320, to: 1440 }],
    ['the last minute of the day, with a dot', 'L 23.59-24.00', { from: 1439, to: 1440 }],
    ['24 as the end of the day', 'L 22-24', { from: 1320, to: 1440 }],
    ['24:00 as the end of the day', 'L 22-24:00', { from: 1320, to: 1440 }],
    ['the whole day', 'L 0-24', { from: 0, to: 1440 }],
    ['the last minute of the day', 'L 23:59-24:00', { from: 1439, to: 1440 }],
    ['the first minute of the day', 'L 0:00-0:01', { from: 0, to: 1 }],
  ])('reads %s: %j', (_what, text, note) => {
    expect(parseDoctor(text)).toEqual(note);
  });

  it.each<[string, string]>([
    ['nothing', ''],
    ['spaces only', '   '],
    ['a bare L', 'L'],
    ['a bare L with spaces', ' l  '],
    ['one time only', 'L 8'],
    ['one time with minutes only', 'L 8:30'],
    ['a note that ends before it starts', 'L 12-8'],
    ['a note that ends where it starts', 'L 8-8'],
    ['the same time with minutes', 'L 8:30-8:30'],
    ['an end before the start within the hour', 'L 8:30-8:15'],
    ['an overnight note', 'L 22-2'],
    ['hours past 23', 'L 25-26'],
    ['24 as the start', 'L 24-25'],
    ['24 on both times', 'L 24-24'],
    ['an end past 24', 'L 8-25'],
    ['24 with minutes as the end', 'L 8-24:30'],
    ['24:01 as the end', 'L 8-24:01'],
    ['minutes past 59 on the start', 'L 8:60-12'],
    ['minutes past 59 on the end', 'L 8-12:60'],
    ['one digit of minutes on the start', 'L 8:5-12'],
    ['one digit of minutes on the end', 'L 8-12:5'],
    ['an empty minutes part', 'L 8:-12'],
    ['three digits of minutes', 'L 8:300-12'],
    ['three digits of hours', 'L 008-12'],
    ['seconds', 'L 8:00:00-12:00:00'],
    ['a letter after the second time', 'L 8-12 h'],
    ['a word after the second time', 'L 8-12 lékař'],
    ['a third time', 'L 8-12-14'],
    ['text before the L', 'x L 8-12'],
    ['a word that starts with L', 'Lékař 8-12'],
    ['a second L', 'LL 8-12'],
    ['no L', '8-12'],
    ['another code with a time', 'R1 8-12'],
    ['a code', 'R1'],
    ['an em dash', 'L 8\u201412'],
    ['a minus sign', 'L 8\u221212'],
    ['no dash', 'L 8 12'],
    ['two hyphens', 'L 8--12'],
    ['a dash and one time', 'L 8-'],
    ['a dash before the only time', 'L -12'],
    ['a minus before the start', 'L -8-12'],
    ['one digit of minutes after a dot', 'L 8.5-12'],
    ['one digit of minutes after a dot, on the end', 'L 8-12.5'],
    ['an empty minutes part after a dot', 'L 8.-12'],
    ['three digits of minutes after a dot', 'L 8.300-12'],
    ['minutes past 59 after a dot', 'L 8.60-12'],
    ['minutes past 59 after a dot, on the end', 'L 8-12.60'],
    ['24 with minutes after a dot as the end', 'L 8-24.30'],
    ['seconds after a dot', 'L 8.30.00-12'],
    ['a space before the dot', 'L 8 .30-12'],
    ['a space after the dot', 'L 8. 30-12'],
    ['a dot after the second time', 'L 8-12.'],
    ['a dot after the L', 'L. 8-12'],
    ['a comma between hours and minutes', 'L 8,30-12'],
    ['an h after the hours', 'L 8h-12h'],
    ['an h between hours and minutes', 'L 8h30-12'],
    ['words for the times', 'L dopoledne'],
  ])('reads no note from %s: %j', (_what, text) => {
    expect(parseDoctor(text)).toBeNull();
  });
});

describe('formatDoctor', () => {
  it.each<[string, DoctorNote, string]>([
    ['whole hours', MORNING, 'L 8-12'],
    ['minutes on the start', { from: 510, to: 720 }, 'L 8:30-12'],
    ['minutes on the end', { from: 480, to: 735 }, 'L 8-12:15'],
    ['minutes on both times', { from: 510, to: 765 }, 'L 8:30-12:45'],
    ['minutes that are not a half hour', { from: 605, to: 725 }, 'L 10:05-12:05'],
    ['a start at midnight', { from: 0, to: 60 }, 'L 0-1'],
    ['an end at the end of the day', { from: 1380, to: 1440 }, 'L 23-24'],
    ['the whole day', { from: 0, to: 1440 }, 'L 0-24'],
    ['the last minute of the day', { from: 1439, to: 1440 }, 'L 23:59-24'],
    ['the first minute of the day', { from: 0, to: 1 }, 'L 0-0:01'],
  ])('writes %s', (_what, note, text) => {
    expect(formatDoctor(note)).toBe(text);
  });

  it('is read back by parseDoctor, for every start and a spread of ends', () => {
    for (let from = 0; from < 1440; from++) {
      for (const to of new Set([from + 1, from + 30, from + 60, from + 185, 1440])) {
        if (to > 1440) continue;
        const note = { from, to };
        expect(parseDoctor(formatDoctor(note)), formatDoctor(note)).toEqual(note);
      }
    }
  });
});

describe("copying a row with doctor's notes", () => {
  it('copying a row writes the shift, or the note on a day without one', () => {
    const { d, ids } = team();
    const [a] = ids;
    d.cells[jan(1)] = { [a]: { code: 'R1' } }; // a shift
    d.cells[jan(2)] = { [a]: { code: 'N', pinned: true } }; // a shift, and a note beside it
    d.doctor[jan(2)] = { [a]: MORNING };
    d.doctor[jan(3)] = { [a]: MORNING }; // a note and no cell
    d.doctor[jan(4)] = { [a]: { from: 510, to: 720 } }; // the same with minutes
    // Day 5 holds nothing.
    expect(personRowTsv(d, '2027-01', a).split('\t')).toEqual([
      'R1', 'N', 'L 8-12', 'L 8:30-12', ...Array(27).fill(''),
    ]);
  });

  // Any code wins, an x and an absence included: the sheet in Excel must show those. The note is in
  // the copy only on a day that holds no code at all.
  it.each(['R1', 'R2', 'O20', 'O', 'N', 'R12', 'N12', 'x', 'DOV', 'MD', 'OP', 'NEM'] as const)(
    'writes the code %s, not the note beside it',
    (code) => {
      const { d, ids } = team();
      d.cells[jan(1)] = { [ids[0]]: { code } };
      d.doctor[jan(1)] = { [ids[0]]: { from: 600, to: 660 } };
      expect(personRowTsv(d, '2027-01', ids[0]).split('\t')[0]).toBe(code);
    },
  );

  it('writes the note on a day that holds no code, and nothing on a day with neither', () => {
    const { d, ids } = team();
    d.doctor[jan(2)] = { [ids[0]]: { from: 600, to: 660 } };
    d.cells[jan(4)] = { [ids[1]]: { code: 'DOV' } }; // somebody else's
    expect(personRowTsv(d, '2027-01', ids[0]).split('\t').slice(0, 4)).toEqual([
      '', 'L 10-11', '', '',
    ]);
  });

  it('holds only that person and only that month, notes included', () => {
    const { d, ids } = team();
    d.doctor['2026-12-31'] = { [ids[0]]: MORNING }; // the tail of the month before
    d.doctor[jan(1)] = { [ids[1]]: MORNING }; // somebody else
    d.doctor[jan(31)] = { [ids[0]]: MORNING };
    d.doctor['2027-02-01'] = { [ids[0]]: MORNING }; // the month after
    expect(personRowTsv(d, '2027-01', ids[0])).toBe([...Array(30).fill(''), 'L 8-12'].join('\t'));
  });
});

describe("planPaste, doctor's notes", () => {
  it('turns an L with a time into a doctor write, and not into a code write', () => {
    const { d, ids } = team();
    expect(planJan(d, ids[0], jan(1), 'R1\tL 8-12\tx\tL 8:30-12')).toEqual({
      writes: [
        { personId: ids[0], date: jan(1), code: 'R1' },
        { personId: ids[0], date: jan(3), code: 'x' },
      ],
      doctorWrites: [
        { personId: ids[0], date: jan(2), note: MORNING },
        { personId: ids[0], date: jan(4), note: { from: 510, to: 720 } },
      ],
      ignored: [],
      namesColumn: false,
    });
  });
  it('reads L in the usual forms, with spaces around it', () => {
    const { d, ids } = team();
    const plan = planJan(d, ids[0], jan(1), ' l 8-12 \tL8\u201312\tL 8:00 - 12:00\t\u00a0L 08-12');
    expect(plan.doctorWrites.map((w) => w.note)).toEqual(Array(4).fill(MORNING));
    expect(plan.writes).toEqual([]);
    expect(plan.ignored).toEqual([]);
  });
  it('reads a dot between hours and minutes as a colon, and still wants two digits', () => {
    const { d, ids } = team();
    const plan = planJan(d, ids[0], jan(1), 'L 8.30-12\tL 8.30-12.15\tL 8.5-12');
    expect(plan.doctorWrites).toEqual([
      { personId: ids[0], date: jan(1), note: { from: 510, to: 720 } },
      { personId: ids[0], date: jan(2), note: { from: 510, to: 735 } },
    ]);
    expect(plan.ignored).toEqual([{ row: 0, col: 2, value: 'L 8.5-12' }]);
  });
  it('goes down the rows to the next people, as a code does', () => {
    const { d, ids } = team();
    const plan = planJan(d, ids[2], jan(5), 'L 8-12\tR1\nx\tL 9-10');
    expect(plan.doctorWrites).toEqual([
      { personId: ids[2], date: jan(5), note: MORNING },
      { personId: ids[3], date: jan(6), note: { from: 540, to: 600 } },
    ]);
    expect(plan.writes).toEqual([
      { personId: ids[2], date: jan(6), code: 'R1' },
      { personId: ids[3], date: jan(5), code: 'x' },
    ]);
  });
  it('lists an L that is no note as ignored, as pasted, and writes nothing for it', () => {
    const { d, ids } = team();
    const bad = ['L', 'L 8', 'L 12-8', 'L 25-26', 'L 8:5-12', 'L 8-12 h', ' L 8 '];
    const plan = planJan(d, ids[0], jan(1), `x\t${bad.join('\t')}`);
    expect(plan.writes).toEqual([{ personId: ids[0], date: jan(1), code: 'x' }]);
    expect(plan.doctorWrites).toEqual([]);
    expect(plan.ignored).toEqual(bad.map((value, i) => ({ row: 0, col: i + 1, value })));
  });
  it('writes nothing for empty cells next to the notes', () => {
    const { d, ids } = team();
    const plan = planJan(d, ids[0], jan(1), 'L 8-12\t\t \tL 9-10');
    expect(plan.doctorWrites.map((w) => w.date)).toEqual([jan(1), jan(4)]);
    expect(plan.ignored).toEqual([]);
  });
  it('does not change the data it plans for', () => {
    const { d, ids } = team();
    d.doctor[jan(1)] = { [ids[0]]: { from: 60, to: 120 } };
    const before = structuredClone(d);
    planJan(d, ids[0], jan(1), 'L 8-12\tL 9-10\nR1');
    expect(d).toEqual(before);
  });

  describe('the first column', () => {
    it('is a day column when it holds a note, not a column of names', () => {
      const { d, ids } = team();
      expect(planJan(d, ids[0], jan(1), 'L 8-12\nR1')).toEqual({
        writes: [{ personId: ids[1], date: jan(1), code: 'R1' }],
        doctorWrites: [{ personId: ids[0], date: jan(1), note: MORNING }],
        ignored: [],
        namesColumn: false,
      });
    });
    it('is a day column when only some of its values are notes', () => {
      const { d, ids } = team();
      const plan = planJan(d, ids[0], jan(1), 'Operátor 1\tx\nL 8-12\tR1');
      expect(plan.namesColumn).toBe(false);
      expect(plan.doctorWrites).toEqual([{ personId: ids[1], date: jan(1), note: MORNING }]);
      expect(plan.writes).toEqual([
        { personId: ids[0], date: jan(2), code: 'x' },
        { personId: ids[1], date: jan(2), code: 'R1' },
      ]);
      expect(plan.ignored).toEqual([{ row: 0, col: 0, value: 'Operátor 1' }]);
    });
    it('is still dropped when it holds names, and the notes after it are read', () => {
      const { d, ids } = team();
      const plan = planJan(d, ids[0], jan(1), 'Operátor 1\tL 8-12\nOperátor 2\tx');
      expect(plan.namesColumn).toBe(true);
      expect(plan.doctorWrites).toEqual([{ personId: ids[0], date: jan(1), note: MORNING }]);
      expect(plan.writes).toEqual([{ personId: ids[1], date: jan(1), code: 'x' }]);
      expect(plan.ignored).toEqual([]);
    });
    it('is a day column when it holds an L with a time that is no note, which is listed', () => {
      const { d, ids } = team();
      // 'L 8' is a note without its end: the cell of the first day, and no name
      const plan = planJan(d, ids[0], jan(1), 'L 8\tR1\tR2');
      expect(plan.namesColumn).toBe(false);
      expect(plan.doctorWrites).toEqual([]);
      expect(plan.writes).toEqual([
        { personId: ids[0], date: jan(2), code: 'R1' },
        { personId: ids[0], date: jan(3), code: 'R2' },
      ]);
      expect(plan.ignored).toEqual([{ row: 0, col: 0, value: 'L 8' }]);
    });
    it('is a day column when one value is an L with a time that is no note, a bare L too', () => {
      const { d, ids } = team();
      const plan = planJan(d, ids[0], jan(1), 'L 8\tx\nL\tR1\n l8:30-\tDOV');
      expect(plan.namesColumn).toBe(false);
      expect(plan.doctorWrites).toEqual([]);
      expect(plan.writes).toEqual([
        { personId: ids[0], date: jan(2), code: 'x' },
        { personId: ids[1], date: jan(2), code: 'R1' },
        { personId: ids[2], date: jan(2), code: 'DOV' },
      ]);
      expect(plan.ignored).toEqual([
        { row: 0, col: 0, value: 'L 8' },
        { row: 1, col: 0, value: 'L' },
        { row: 2, col: 0, value: ' l8:30-' },
      ]);
    });
    it('is names when its values are words, also words that start with an L', () => {
      const { d, ids } = team();
      const plan = planJan(d, ids[0], jan(1), 'Levandule\tx\nL. Testová\tR1\nLucerna\tDOV');
      expect(plan.namesColumn).toBe(true);
      expect(plan.writes).toEqual([
        { personId: ids[0], date: jan(1), code: 'x' },
        { personId: ids[1], date: jan(1), code: 'R1' },
        { personId: ids[2], date: jan(1), code: 'DOV' },
      ]);
      expect(plan.ignored).toEqual([]);
    });
  });

  // An L lands on the people and the days where a code lands, no others. The rule is the one of
  // `planPaste`: the rows are the people of the month, from the start person on; a day takes a
  // value if it is one of the last 7 of the month before or one of the month. The days of a
  // person's active period are not part of it.
  describe('lands where a code lands', () => {
    type Place = [person: number, date: string];
    type Cut = [row: number, col: number];

    it.each<
      [
        what: string,
        setup: (d: AppData) => void,
        start: [person: number | 'nobody', date: string],
        size: [rows: number, cols: number],
        lands: Place[],
        cut: Cut[],
      ]
    >([
      [
        'the last 7 days of the month before, and on into the month',
        () => undefined,
        [0, '2026-12-30'],
        [1, 3],
        [[0, '2026-12-30'], [0, '2026-12-31'], [0, jan(1)]],
        [],
      ],
      [
        'a day before the last 7 of the month before: cut off',
        () => undefined,
        [0, '2026-12-24'],
        [1, 2],
        [[0, '2026-12-25']],
        [[0, 0]],
      ],
      [
        'a day after the month: cut off',
        () => undefined,
        [0, jan(31)],
        [1, 2],
        [[0, jan(31)]],
        [[0, 1]],
      ],
      [
        'a row below the last person: cut off',
        () => undefined,
        [7, jan(1)],
        [2, 1],
        [[7, jan(1)]],
        [[1, 0]],
      ],
      [
        'a start person who is not in the data',
        () => undefined,
        ['nobody', jan(1)],
        [1, 2],
        [],
        [[0, 0], [0, 1]],
      ],
      [
        'a start person who left before the month',
        (d) => { d.people[1].activeTo = '2026-12-31'; },
        [1, jan(1)],
        [1, 2],
        [],
        [[0, 0], [0, 1]],
      ],
      [
        'a start person who joins after the month',
        (d) => { d.people[1].activeFrom = '2027-02-01'; },
        [1, jan(1)],
        [1, 2],
        [],
        [[0, 0], [0, 1]],
      ],
      [
        'a person who left before the month: no row for them',
        (d) => { d.people[1].activeTo = '2026-12-31'; },
        [0, jan(1)],
        [3, 1],
        [[0, jan(1)], [2, jan(1)], [3, jan(1)]],
        [],
      ],
      [
        'a person who joins after the month: no row for them',
        (d) => { d.people[1].activeFrom = '2027-02-01'; },
        [0, jan(1)],
        [2, 1],
        [[0, jan(1)], [2, jan(1)]],
        [],
      ],
      [
        'days before a person joins, within the month: not checked',
        (d) => { d.people[0].activeFrom = jan(10); },
        [0, jan(1)],
        [1, 3],
        [[0, jan(1)], [0, jan(2)], [0, jan(3)]],
        [],
      ],
      [
        'days after a person leaves, within the month: not checked',
        (d) => { d.people[0].activeTo = jan(3); },
        [0, jan(3)],
        [1, 3],
        [[0, jan(3)], [0, jan(4)], [0, jan(5)]],
        [],
      ],
    ])('%s', (_what, setup, [person, start], [rows, cols], lands, cut) => {
      const { d, ids } = team();
      setup(d);
      const startId = person === 'nobody' ? 'nobody' : ids[person];
      const fill = (cell: string): string =>
        Array.from({ length: rows }, () => Array(cols).fill(cell).join('\t')).join('\n');
      const places = (items: Array<{ personId: PersonId; date: string }>): Place[] =>
        items.map((item) => [ids.indexOf(item.personId), item.date]);
      const cutAt = (plan: PastePlan): Cut[] => plan.ignored.map(({ row, col }) => [row, col]);

      const asCode = planJan(d, startId, start, fill('x'));
      const asNote = planJan(d, startId, start, fill('L 8-12'));

      expect(places(asCode.writes)).toEqual(lands);
      expect(places(asNote.doctorWrites)).toEqual(lands);
      expect(cutAt(asCode)).toEqual(cut);
      expect(cutAt(asNote)).toEqual(cut);
      // And each goes to its own list.
      expect(asCode.doctorWrites).toEqual([]);
      expect(asNote.writes).toEqual([]);
    });
  });
});

describe("applyPaste, doctor's notes", () => {
  const plan = (...doctorWrites: PastePlan['doctorWrites']): PastePlan => ({
    writes: [],
    doctorWrites,
    ignored: [],
    namesColumn: false,
  });

  it('pasting L onto a day with a shift keeps the shift and adds the note', () => {
    const { d, ids } = team();
    d.cells[jan(5)] = { [ids[0]]: { code: 'R1', pinned: true } };
    d.cells[jan(6)] = { [ids[0]]: { code: 'O' } };
    const out = applyPaste(d, planJan(d, ids[0], jan(5), 'L 8-12\tL 8:30-12'));
    expect(out.cells[jan(5)][ids[0]]).toStrictEqual({ code: 'R1', pinned: true });
    expect(out.cells[jan(6)][ids[0]]).toStrictEqual({ code: 'O' }); // not pinned by a note
    expect(out.doctor[jan(5)][ids[0]]).toStrictEqual(MORNING);
    expect(out.doctor[jan(6)][ids[0]]).toStrictEqual({ from: 510, to: 720 });
  });
  it.each(['x', 'DOV', 'MD', 'OP', 'NEM'] as const)(
    'keeps %s on the day when it adds the note',
    (code) => {
      const { d, ids } = team();
      d.cells[jan(5)] = { [ids[0]]: { code } };
      const out = applyPaste(d, planJan(d, ids[0], jan(5), 'L 8-12'));
      expect(out.cells[jan(5)][ids[0]]).toStrictEqual({ code });
      expect(out.doctor[jan(5)][ids[0]]).toStrictEqual(MORNING);
    },
  );
  it('stores a note on a day with no cell, and makes no cell for it', () => {
    const { d, ids } = team();
    const out = applyPaste(d, planJan(d, ids[0], jan(5), 'L 8-12'));
    expect(out.doctor).toStrictEqual({ [jan(5)]: { [ids[0]]: MORNING } });
    expect(out.cells).toStrictEqual({});
  });
  it('replaces the note of that person and day, and keeps every other note', () => {
    const { d, ids } = team();
    const other = { from: 60, to: 120 };
    d.doctor[jan(5)] = { [ids[0]]: other, [ids[1]]: other };
    d.doctor[jan(6)] = { [ids[0]]: other };
    const out = applyPaste(d, plan({ personId: ids[0], date: jan(5), note: MORNING }));
    expect(out.doctor).toStrictEqual({
      [jan(5)]: { [ids[0]]: MORNING, [ids[1]]: other },
      [jan(6)]: { [ids[0]]: other },
    });
  });
  it('keeps the notes of a day when a code is pasted onto it', () => {
    const { d, ids } = team();
    d.doctor[jan(5)] = { [ids[0]]: MORNING };
    const out = applyPaste(d, planJan(d, ids[0], jan(5), 'x\tR1'));
    expect(out.cells[jan(5)][ids[0]]).toStrictEqual({ code: 'x' });
    expect(out.cells[jan(6)][ids[0]]).toStrictEqual({ code: 'R1', pinned: true });
    expect(out.doctor).toStrictEqual({ [jan(5)]: { [ids[0]]: MORNING } });
  });
  it('stores the codes and the notes of one paste together', () => {
    const { d, ids } = team();
    const out = applyPaste(d, planJan(d, ids[0], jan(1), 'R1\tL 8-12\nL 9-10\tN'));
    expect(out.cells).toStrictEqual({
      [jan(1)]: { [ids[0]]: { code: 'R1', pinned: true } },
      [jan(2)]: { [ids[1]]: { code: 'N', pinned: true } },
    });
    expect(out.doctor).toStrictEqual({
      [jan(2)]: { [ids[0]]: MORNING },
      [jan(1)]: { [ids[1]]: { from: 540, to: 600 } },
    });
  });
  it('stores a code and a note for one day side by side', () => {
    const { d, ids } = team();
    const out = applyPaste(d, {
      writes: [{ personId: ids[0], date: jan(5), code: 'R2' }],
      doctorWrites: [{ personId: ids[0], date: jan(5), note: MORNING }],
    });
    expect(out.cells[jan(5)][ids[0]]).toStrictEqual({ code: 'R2', pinned: true });
    expect(out.doctor[jan(5)][ids[0]]).toStrictEqual(MORNING);
  });
  it('leaves its input alone, notes included, and keeps what it does not write', () => {
    const { d, ids } = team();
    d.doctor[jan(4)] = { [ids[2]]: { from: 60, to: 120 } };
    d.doctor[jan(5)] = { [ids[1]]: { from: 60, to: 120 } };
    const before = structuredClone(d);
    const out = applyPaste(d, planJan(d, ids[0], jan(5), 'L 8-12'));
    expect(d).toEqual(before);
    expect(out.doctor).toEqual({
      ...before.doctor,
      [jan(5)]: { ...before.doctor[jan(5)], [ids[0]]: MORNING },
    });
    expect({ ...out, doctor: {} }).toEqual({ ...before, doctor: {} });
  });
  it('changes no note for a plan with none, also one written by hand without the list', () => {
    const { d, ids } = team();
    d.doctor[jan(5)] = { [ids[0]]: MORNING };
    const out = applyPaste(d, { writes: [{ personId: ids[0], date: jan(6), code: 'x' }] });
    expect(out.doctor).toStrictEqual(d.doctor);
    expect(applyPaste(d, { writes: [], ignored: [] }).doctor).toStrictEqual(d.doctor);
  });

  // `parseSaveFile` drops a note for someone who is not in the team. A paste writes to the people
  // of the month grid, who are all in `data.people`.
  it('stores notes that a save file accepts: only for people of the team', () => {
    const { d, ids } = team();
    d.people[1].activeTo = '2026-12-31'; // B left before the month
    d.people[7].activeFrom = '2027-02-01'; // H joins after it
    const text = Array.from({ length: 9 }, () => 'L 8-12\tL 8:30-12').join('\n');
    const planned = planJan(d, ids[0], jan(30), text); // more rows than people in the month
    const inTheMonth = [0, 2, 3, 4, 5, 6].map((i) => ids[i]);
    expect(new Set(planned.doctorWrites.map((w) => w.personId))).toEqual(new Set(inTheMonth));
    expect(planned.doctorWrites).toHaveLength(12);
    expect(planned.ignored).toHaveLength(6); // the three rows below the last person

    const out = applyPaste(d, planned);
    expect(parseSaveFile(serialize(out)).doctor).toEqual(out.doctor);
    expect(Object.values(out.doctor).flatMap((day) => Object.keys(day))).not.toContain(ids[1]);
  });
});

describe("copy a row with doctor's notes, paste it back", () => {
  it.each(['a note', 'a shift', 'nothing'] as const)(
    'restores a row whose first day holds %s',
    (first) => {
      const { d, ids } = team();
      const [source, target] = ids;
      if (first === 'a note') d.doctor[jan(1)] = { [source]: MORNING };
      if (first === 'a shift') d.cells[jan(1)] = { [source]: { code: 'R1' } };
      d.cells[jan(3)] = { [source]: { code: 'x' } };
      d.doctor[jan(4)] = { [source]: { from: 510, to: 720 } };
      d.cells[jan(5)] = { [source]: { code: 'DOV' } };
      d.cells[jan(6)] = { [source]: { code: 'NEM' } };
      d.doctor[jan(6)] = { [source]: MORNING }; // beside an absence: the copy carries the absence
      d.cells[jan(7)] = { [source]: { code: 'x' } };
      d.doctor[jan(7)] = { [source]: MORNING }; // beside an x: the same
      d.cells[jan(9)] = { [source]: { code: 'N12' } };
      d.doctor[jan(9)] = { [source]: MORNING }; // beside a shift: the copy carries the shift only
      d.doctor[jan(31)] = { [source]: { from: 0, to: 1440 } };
      const row = personRowTsv(d, '2027-01', source);

      const plan = planJan(d, target, jan(1), row);
      const out = applyPaste(d, plan);

      expect(plan.ignored).toEqual([]);
      expect(personRowTsv(out, '2027-01', target)).toBe(row);
      expect(out.doctor[jan(4)][target]).toStrictEqual({ from: 510, to: 720 });
      expect(out.doctor[jan(31)][target]).toStrictEqual({ from: 0, to: 1440 });
      expect(out.cells[jan(9)][target]).toStrictEqual({ code: 'N12', pinned: true });
      // The absence, the x and the shift come back as they are; the notes beside them stay behind.
      expect(out.cells[jan(6)][target]).toStrictEqual({ code: 'NEM' });
      expect(out.cells[jan(7)][target]).toStrictEqual({ code: 'x' });
      for (const day of [6, 7, 9]) expect(out.doctor[jan(day)]?.[target]).toBeUndefined();
      expect(out.doctor[jan(1)]?.[target]).toStrictEqual(first === 'a note' ? MORNING : undefined);
    },
  );
});
