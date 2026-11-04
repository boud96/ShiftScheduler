import { describe, it, expect, vi } from 'vitest';
import { ctxFor, rowsOf, run } from '../../test/rulekit';
import { defaultSettings } from '../defaults';
import { fmtH } from '../format';
import type { Settings } from '../types';
import { evaluateDay } from './day';
import { evaluateMonth } from './evaluate';
import { evaluatePerson } from './person';
import type { Finding } from './types';
import { GAP, HARD } from './weights';

// Every call of fmtH is counted, so that a test can see whether a message text was built.
vi.mock('../format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../format')>();
  return { ...actual, fmtH: vi.fn(actual.fmtH) };
});

const c = ctxFor('2027-02', 1);
/** Sat 6, Sun 7, Sat 13, Sun 14 and Sat 20 Feb 2027. */
const five = '- - - - - R12 R12 | - - - - - R12 R12 | - - - - - R12';

describe('PersonStats', () => {
  // January 2027: Fri 1 Jan is a holiday and a festive day. The tail is Fri 25 Dec to Thu 31 Dec
  // 2026, with the 25th and 26th holidays and the 25th, 26th and 31st festive days.
  const j = ctxFor('2027-01', 1);
  const month = 'N12 R12 R12 | R1 R2 O20 O | N';
  const tail = 'R12 N12 R12 - - - N12';

  it('counts hours, shifts, nights, holiday and festive shifts of the month', () => {
    const { persons } = run(j, rowsOf(j, [month], [tail]));
    expect(persons[0]).toEqual({
      hours: 3 * 11.5 + 5 * 7.5,
      twelve: 3,
      nights: 2, // N12 and N
      holidayTwelve: 1, // N12 on 1 Jan
      festive: 1, // 1 Jan
      perShift: [1, 1, 1, 1, 1], // R1, R2, O20, O, N
      mustUnits: 2, // N12 -> R12 leaves no rest, and 72 h is below the FPD of 157.5 h
    });
  });
  it('does not count the previous month, though it holds 12-hour shifts and festive days', () => {
    const { persons } = run(j, rowsOf(j, [], [tail]));
    expect(persons[0]).toMatchObject({
      hours: 0,
      twelve: 0,
      nights: 0,
      holidayTwelve: 0,
      festive: 0,
    });
    expect(persons[0].perShift).toEqual([0, 0, 0, 0, 0]);
  });
  it('tells a holiday from a festive day', () => {
    // Fri 26 and Mon 29 Mar 2027 are Good Friday and Easter Monday: holidays, but not festive days
    const m = ctxFor('2027-03', 1);
    const easter = [...Array(25).fill('-'), 'R12', '-', '-', 'N12'].join(' ');
    expect(run(m, rowsOf(m, [easter])).persons[0])
      .toMatchObject({ twelve: 2, holidayTwelve: 2, festive: 0 });
    // Thu 31 Dec 2026 is a festive day, but not a holiday (here set to a 12-hour day)
    const d = ctxFor('2026-12', 1, { dayTypeOverrides: { '2026-12-31': 'twelve' } });
    const newYearsEve = [...Array(30).fill('-'), 'R12'].join(' ');
    expect(run(d, rowsOf(d, [newYearsEve])).persons[0])
      .toMatchObject({ twelve: 1, holidayTwelve: 0, festive: 1 });
  });
  it('credits the hours of each code from the settings', () => {
    const shifts = { ...defaultSettings().shifts, R1: { start: 360, end: 840, hours: 8.25 } };
    const k = ctxFor('2027-02', 1, { shifts, absenceHours: 8 });
    // R1 8.25 h, four absences 8 h each, and a request nothing
    expect(run(k, rowsOf(k, ['R1 DOV x MD OP NEM'])).persons[0].hours).toBe(8.25 + 4 * 8);
  });
  it('gives the stats of each person, in the order of the context', () => {
    const t = ctxFor('2027-02', 2);
    const { persons } = run(t, rowsOf(t, ['R1', 'N12']));
    expect(persons.map((s) => [s.hours, s.nights])).toEqual([[7.5, 0], [11.5, 1]]);
  });
});

describe('DayStats and evaluateDay', () => {
  const t = ctxFor('2027-02', 3);
  it('counts R2 on a weekday, and a missing person for each code short of its minimum', () => {
    const rows = rowsOf(t, ['R2', 'R2', 'R2']);
    expect(evaluateDay(t, t.first, rows))
      .toEqual({ score: 4 * GAP, stats: { r2: 3, mustUnits: 4 } });
  });
  it('scores HARD for each extra person and GAP for each missing one, and counts them all', () => {
    // two extra on R1; R2, O20, O and N missing
    expect(evaluateDay(t, t.first, rowsOf(t, ['R1', 'R1', 'R1']))).toEqual({
      score: 2 * HARD + 4 * GAP,
      stats: { r2: 0, mustUnits: 6 },
    });
    // nobody on R1, which wants three: three missing, besides the four other gaps
    const coverage = { ...defaultSettings().coverage, R1: { min: 3, max: 3 } };
    const k = ctxFor('2027-02', 3, { coverage });
    expect(evaluateDay(k, k.first, rowsOf(k, []))).toEqual({
      score: 7 * GAP,
      stats: { r2: 0, mustUnits: 7 },
    });
  });
  it('counts one unit for each missing or extra person on a 12-hour day', () => {
    const rows = rowsOf(t, ['- - - - - R12', '- - - - - R12']);
    expect(evaluateDay(t, t.first + 5, rows))
      .toEqual({ score: HARD + GAP, stats: { r2: 0, mustUnits: 2 } });
  });
  it('asks nothing of a 12-hour day for the weekday shifts, and counts no R2 on it', () => {
    const rows = rowsOf(t, ['- - - - - R2']);
    expect(evaluateDay(t, t.first + 5, rows))
      .toEqual({ score: 2 * GAP, stats: { r2: 0, mustUnits: 2 } });
  });
  it('gives one DayStats per day of the month in evaluateMonth', () => {
    const ev = run(t, rowsOf(t, ['R2']));
    expect(ev.days).toHaveLength(28);
    expect(ev.days[0]).toEqual({ r2: 1, mustUnits: 4 });
    expect(ev.days[5]).toEqual({ r2: 0, mustUnits: 2 });
  });
});

describe('evaluatePerson', () => {
  it('uses the preferences, the FPD and the active days of person p', () => {
    const t = ctxFor('2027-02', [{}, { prefs: { nights: 'never' } }, { activeFrom: '2027-02-15' }]);
    const row = rowsOf(t, ['N', 'N', 'N'])[0];
    const rulesOf = (p: number) => {
      const found: Finding[] = [];
      evaluatePerson(t, p, row, (f) => found.push(f));
      return found.map((f) => f.rule).sort();
    };
    expect(rulesOf(0)).toEqual(['M6']);
    expect(rulesOf(1)).toEqual(['M6', 'M7']);
    expect(rulesOf(2)).toEqual(['M3', 'M6']);
    expect(evaluatePerson(t, 2, row).stats.mustUnits).toBe(2);
  });
  it('measures person p against the FPD of person p', () => {
    const t = ctxFor('2027-02', [{}, { activeFrom: '2027-02-15' }]); // FPD 150 h and 75 h
    const tenDays = [...Array(14).fill('-'), ...Array(10).fill('R1')].join(' '); // 75 h from Mon 15
    const [row] = rowsOf(t, [tenDays]);
    const short = (p: number) => {
      const found: Finding[] = [];
      evaluatePerson(t, p, row, (f) => found.push(f));
      return found.some((f) => f.rule === 'M6');
    };
    expect([short(0), short(1)]).toEqual([true, false]);
  });
});

describe('the sink', () => {
  const row = rowsOf(c, ['O R1 R12'])[0]; // M2 (O -> R1), M8 (R12 on a Wednesday) and M6
  it('gets every finding of a person, and changes neither the score nor the stats', () => {
    const seen: Finding[] = [];
    const withSink = evaluatePerson(c, 0, row, (f) => seen.push(f));
    expect(withSink).toEqual(evaluatePerson(c, 0, row));
    expect(seen.map((f) => f.rule).sort()).toEqual(['M2', 'M6', 'M8']);
  });
  it('gets every finding of a day, and changes nothing else', () => {
    const t = ctxFor('2027-02', 2);
    const rows = rowsOf(t, ['- - - - - R12', '- - - - - R12']);
    const seen: Finding[] = [];
    const withSink = evaluateDay(t, t.first + 5, rows, (f) => seen.push(f));
    expect(withSink).toEqual(evaluateDay(t, t.first + 5, rows));
    expect(seen.map((f) => f.message).sort()).toEqual(['R12 2×', 'chybí N12']);
  });
  it('is not needed for the score: evaluateMonth gives the same without explain', () => {
    const rows = rowsOf(c, ['O R1']);
    const quiet = evaluateMonth(c, rows);
    const loud = evaluateMonth(c, rows, true);
    expect(quiet.findings).toEqual([]);
    expect(loud.findings.length).toBeGreaterThan(0);
    expect({ ...loud, findings: [] }).toEqual(quiet);
  });
  it('builds no message text unless a sink is given', () => {
    const broken = rowsOf(c, ['O R1']); // breaks M2 and M6, which both format hours
    vi.mocked(fmtH).mockClear();
    evaluatePerson(c, 0, broken[0]);
    expect(fmtH).not.toHaveBeenCalled();
    evaluatePerson(c, 0, broken[0], () => undefined);
    expect(fmtH).toHaveBeenCalled();
  });
});

describe('evaluateMonth', () => {
  it('sums the scores of the persons and the days, and counts the must units of both', () => {
    const t = ctxFor('2027-02', 3);
    const rows = rowsOf(t, ['R1 R2 O', 'O R1 - N', 'N12 - - - - R12']);
    const ev = evaluateMonth(t, rows);
    let score = 0;
    let units = 0;
    t.people.forEach((_, p) => {
      const r = evaluatePerson(t, p, rows[p]);
      score += r.score;
      units += r.stats.mustUnits;
    });
    for (let d = t.first; d < t.days.length; d++) {
      const r = evaluateDay(t, d, rows);
      score += r.score;
      units += r.stats.mustUnits;
    }
    expect(ev.score).toBeCloseTo(score, 3);
    expect(ev.mustUnits).toBe(units);
    expect(ev.persons).toHaveLength(3);
    expect(ev.days).toHaveLength(28);
  });
  it('lists musts first, then by first day, those without a day last', () => {
    const t = ctxFor('2027-02', 2);
    const ev = run(t, rowsOf(t, [`${five} | - - R12 R12`, 'O R1']));
    const first = (f: Finding) =>
      f.days.length > 0 ? Math.min(...f.days) : Number.MAX_SAFE_INTEGER;
    const severities = ev.findings.map((f) => f.severity);
    const mustsFirst = (a: string, b: string) => (a === b ? 0 : a === 'must' ? -1 : 1);
    expect(severities).toEqual([...severities].sort(mustsFirst));
    const musts = ev.findings.filter((f) => f.severity === 'must');
    const keys = musts.map(first);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
    expect(musts.slice(-2).map((f) => [f.rule, f.person])).toEqual([['M6', 0], ['M6', 1]]);
  });
  it('scores what it lists: with the wishes off, the score is the sum of the penalties', () => {
    const wishLevels = Object.fromEntries(
      Object.keys(defaultSettings().wishLevels).map((id) => [id, 0]),
    ) as Settings['wishLevels'];
    // person 1 joins on Thu 4 Feb and never works nights
    const joiner = { activeFrom: '2027-02-04', prefs: { nights: 'never' as const } };
    const t = ctxFor('2027-02', [joiner, {}, {}], { wishLevels });
    const ev = run(t, rowsOf(t, [
      'R1 N - N', // M3 on Mon and Tue, M7 on both nights
      `${five} | - - R12 R12`, // M5 and, on Tue and Wed, M8
      'O R1 R12 - - - N12 N | N DOV', // M2, M8 on Wed, M4
    ]));
    const musts = ev.findings.filter((f) => f.severity === 'must');
    expect(new Set(musts.map((f) => f.rule))).toEqual(
      new Set(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']),
    );
    expect(ev.score).toBeCloseTo(ev.findings.reduce((sum, f) => sum + f.penalty, 0), 3);
  });
});
