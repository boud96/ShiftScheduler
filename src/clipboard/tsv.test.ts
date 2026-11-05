import { describe, it, expect } from 'vitest';
import { newAppData } from '../domain/defaults';
import type { AppData, CodeName, PersonId } from '../domain/types';
import { personRowTsv, parseTsv, planPaste, applyPaste } from './tsv';
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
        ignored: [],
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
    expect(planJan(d, ids[0], jan(1), '')).toEqual({ writes: [], ignored: [] });
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
    it('write nothing when the start person is not in the team', () => {
      const { d } = team();
      const plan = planJan(d, 'nobody', jan(1), 'x\tDOV\n\tMD');
      expect(plan.writes).toEqual([]);
      expect(plan.ignored).toEqual([
        { row: 0, col: 0, value: 'x' },
        { row: 0, col: 1, value: 'DOV' },
        { row: 1, col: 1, value: 'MD' },
      ]);
    });
  });
});

describe('applyPaste', () => {
  const write = (personId: PersonId, date: string, code: CodeName): PastePlan => ({
    writes: [{ personId, date, code }],
    ignored: [],
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
