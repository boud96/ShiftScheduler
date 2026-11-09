import { describe, it, expect, vi } from 'vitest';
import { mulberry32 } from '../../generator/rng';
import { ctxFor, rowsOf, rules, run } from '../../test/rulekit';
import type { PersonPatch } from '../../test/rulekit';
import { CODE_NAMES, isShift } from '../codes';
import { buildMonthGrid } from '../context';
import type { MonthContext } from '../context';
import { defaultSettings, newAppData } from '../defaults';
import { days as fmtDays, fmtH } from '../format';
import type { CodeName, ISODate, Settings, ShiftName } from '../types';
import { runMusts, weeklyRest } from './restMusts';
import type { Finding, MustId, PersonStats, Sink } from './types';
import { HARD } from './weights';

// fmtH and days are counted (the real ones still run), so that a test can see whether a message
// text was built.
vi.mock('../format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../format')>();
  return { ...actual, fmtH: vi.fn(actual.fmtH), days: vi.fn(actual.days) };
});

// January 2027 starts on Friday 1, a public holiday: Fri 1 to Sun 3 are 12-hour days, and from
// Mon 4 the weeks run Monday to Sunday. A strip starts on 1 January, `|` marks the weeks. A tail
// strip holds Fri 25 to Thu 31 December 2026.
const j = ctxFor('2027-01', 1);
const ROW_MUSTS: MustId[] = ['M9', 'M10', 'M11'];

/** The findings of must `id` for one person's January strip, and the 7 days before it. */
const found = (id: MustId, strip: string, tail = '', ctx: MonthContext = j): Finding[] =>
  rules(run(ctx, rowsOf(ctx, [strip], [tail])), id);
/** The findings of M9, M10 and M11. */
const rowMusts = (strip: string, tail = ''): Finding[] =>
  ROW_MUSTS.flatMap((id) => found(id, strip, tail));

describe('days in a row and weekly rest', () => {
  it('R1 Mon–Fri with the weekend off breaks nothing', () => {
    expect(rowMusts('- - - | R1 R1 R1 R1 R1 - - | R1 R1 R1 R1 R1')).toEqual([]);
  });
  it('six days then two days off is fine', () => {
    // R1 Mon 4 to Fri 8, R12 Sat 9, Sun 10 and Mon 11 off, R1 Tue 12
    expect(rowMusts('- - - | R1 R1 R1 R1 R1 R12 - | - R1')).toEqual([]);
  });
  it('six days then one day off breaks M10', () => {
    // R1 Mon 4 to Sat 9 (on a Saturday also M8's business), Sun 10 off, R1 Mon 11
    expect(found('M10', '- - - | R1 R1 R1 R1 R1 R1 - | R1')).toHaveLength(1);
  });
  it('seven days breaks M9', () => {
    // Mon 4 to Sun 10, and the rest of the month off
    const f = found('M9', '- - - | R1 R1 R1 R1 R1 R12 R12');
    expect(f).toHaveLength(1);
    expect(f[0].penalty).toBe(HARD);
  });
  it('nights Mon–Fri are five days', () => {
    // Friday's night ends at 06:00 on Saturday, which is a day off like Sunday
    expect(rowMusts('- - - | N N N N N - - | R1')).toEqual([]);
  });
  it('weekly rest counts a rest that crosses the window', () => {
    const week = 'R1 R1 R1 R1 R1 - -';
    expect(found('M11', `- - - | ${week} | ${week} | ${week}`)).toEqual([]);
  });
  it('only short rests break M11', () => {
    // O, off, R1, R1 from Mon 4 to Sun 17: rests of 32, 16 and 24 h, over and over
    const strip = '- - - | O - R1 R1 O - R1 | R1 O - R1 R1 O -';
    const m11 = found('M11', strip);
    expect(m11.length).toBeGreaterThanOrEqual(1);
    expect(m11[0].message).toContain('32 h');
    expect([...found('M2', strip), ...found('M9', strip), ...found('M10', strip)]).toEqual([]);
  });

  // Review Focus 4: January with December's last week empty or partly filled.
  it('an empty December raises no alarm in early January', () => {
    // R12 Fri 1 to Sun 3 and R1 Mon 4 to Wed 6: six days from the first
    expect(rowMusts('R12 R12 R12 | R1 R1 R1')).toEqual([]);
  });
  it('a run crossing the turn of the month counts whole', () => {
    // R1 Mon 28 to Thu 31 December, R12 Fri 1 to Sun 3 January
    expect(found('M9', 'R12 R12 R12', '- - - R1 R1 R1 R1')).toHaveLength(1);
  });
});

// --- Beyond the brief: what its examples leave open ---------------------------------------------

/** `n` empty days, then `codes`. */
const pad = (n: number, ...codes: string[]) => [...Array(n).fill('-'), ...codes].join(' ');
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => from + k);
/** The index in `ctx.days` of `d` January; 25 to 31 December are 0 to 6. */
const jan = (d: number) => j.first + d - 1;
/** Stats with nothing counted, for a rule called on its own. */
const fresh = (): PersonStats => ({
  hours: 0,
  twelve: 0,
  claimedTwelve: 0,
  nights: 0,
  holidayTwelve: 0,
  festive: 0,
  perShift: [0, 0, 0, 0, 0],
  mustUnits: 0,
});
type RowRule = (
  ctx: MonthContext,
  p: number,
  row: Uint8Array,
  stats: PersonStats,
  sink?: Sink,
) => number;
/** What one rule alone gives for person 0's January strip: its score, its units, its findings. */
function alone(rule: RowRule, strip: string, tail = '', ctx: MonthContext = j) {
  const [row] = rowsOf(ctx, [strip], [tail]);
  const stats = fresh();
  const findings: Finding[] = [];
  const score = rule(ctx, 0, row, stats, (f) => findings.push(f));
  return { score, units: stats.mustUnits, findings };
}

describe('M9 in detail', () => {
  it('is one finding on the days of the run, HARD and a unit for each day over the maximum', () => {
    expect(found('M9', '- - - | R1 R1 R1 R1 R1 R12 R12')).toEqual([{
      rule: 'M9', severity: 'must', person: 0, days: range(jan(4), jan(10)),
      message: '7 dní v kuse (max. 6)', penalty: HARD,
    }]);
    // Mon 4 to Tue 12: 9 days, 3 over
    const nine = alone(runMusts, '- - - | R1 R1 R1 R1 R1 R12 R12 | R1 R1');
    expect(nine.findings.map((f) => [f.message, f.penalty]))
      .toEqual([['9 dní v kuse (max. 6)', 3 * HARD]]);
    expect([nine.score, nine.units]).toEqual([3 * HARD, 3]);
  });
  it('takes the maximum from the settings', () => {
    const five = ctxFor('2027-01', 1, { maxDaysInRow: 5 });
    expect(found('M9', '- - - | R1 R1 R1 R1 R1 R12', '', five).map((f) => f.message))
      .toEqual(['6 dní v kuse (max. 5)']);
    expect(found('M9', '- - - | R1 R1 R1 R1 R1', '', five)).toEqual([]);
    const eight = ctxFor('2027-01', 1, { maxDaysInRow: 8 });
    expect(found('M9', '- - - | R1 R1 R1 R1 R1 R12 R12 | R1', '', eight)).toEqual([]);
  });
  it('ends a run on any day without a shift: empty, a request or an absence', () => {
    for (const off of ['-', 'x', 'DOV', 'MD', 'OP', 'NEM']) {
      expect(found('M9', `- - - | R1 R1 R1 R1 ${off} R12 R12 | R1 R1`)).toEqual([]);
    }
  });
  it('counts a run that began last month with its days there, but not one that ended there', () => {
    const december = 'R12 R12 R12 R1 R1 R1 R1'; // all 7 days of the tail
    expect(found('M9', '', december)).toEqual([]);
    expect(found('M9', '- R12', december)).toEqual([]);
    expect(found('M9', 'R12', december)).toEqual([{
      rule: 'M9', severity: 'must', person: 0, days: range(0, jan(1)),
      message: '8 dní v kuse (max. 6)', penalty: 2 * HARD,
    }]);
  });
  it('reads the day after the month, which is no cell of the finding', () => {
    // R1 Tue 26 to Fri 29, R12 Sat 30 and Sun 31, and what is stored for Mon 1 February
    const strip = pad(25, 'R1 R1 R1 R1 R12 R12');
    expect(found('M9', strip, '', ctxFor('2027-01', [{ nextDay: 'R1' }]))).toEqual([{
      rule: 'M9', severity: 'must', person: 0, days: range(jan(26), jan(31)),
      message: '7 dní v kuse (max. 6)', penalty: HARD,
    }]);
    expect(found('M9', strip)).toEqual([]);
    expect(found('M9', strip, '', ctxFor('2027-01', [{ nextDay: 'x' }]))).toEqual([]);
  });
});

describe('M10 in detail', () => {
  it('is one finding on the run, the day off and the first day of work after it', () => {
    expect(found('M10', '- - - | R1 R1 R1 R1 R1 R1 - | R1')).toEqual([{
      rule: 'M10', severity: 'must', person: 0, days: range(jan(4), jan(11)),
      message: 'po 6 dnech práce jen 1 den volna (min. 2 dny)', penalty: HARD,
    }]);
    const one = alone(runMusts, '- - - | R1 R1 R1 R1 R1 R1 - | R1');
    expect([one.score, one.units]).toEqual([HARD, 1]);
  });
  it('asks it after 6 days or more, whatever the maximum in the settings', () => {
    // 5 days, 1 day off, work: not even when 5 days are over the maximum
    expect(found('M10', '- - - | R1 R1 R1 R1 R1 - R12')).toEqual([]);
    const four = ctxFor('2027-01', 1, { maxDaysInRow: 4 });
    expect(found('M10', '- - - | R1 R1 R1 R1 R1 - R12', '', four)).toEqual([]);
    // 6 days, 1 day off, work: even when more days in a row are allowed
    const eight = ctxFor('2027-01', 1, { maxDaysInRow: 8 });
    expect(found('M10', '- - - | R1 R1 R1 R1 R1 R12 - | R1', '', eight)).toHaveLength(1);
    // 7 days: M9 for the length, and M10 for the one day off after it
    expect(found('M10', '- - - | R1 R1 R1 R1 R1 R12 R12 | - R1').map((f) => f.message))
      .toEqual(['po 7 dnech práce jen 1 den volna (min. 2 dny)']);
  });
  it('takes a request or an absence for the day off like an empty day', () => {
    for (const off of ['x', 'DOV', 'MD', 'OP', 'NEM']) {
      expect(found('M10', `- - - | R1 R1 R1 R1 R1 R12 ${off} | R1`)).toHaveLength(1);
    }
  });
  it('counts a run of the previous month when the work after its day off is in the month', () => {
    // R12 Fri 25 to Sun 27 and R1 Mon 28 to Wed 30 December, Thu 31 off, R12 on 1 January
    expect(found('M10', 'R12', 'R12 R12 R12 R1 R1 R1 -')).toEqual([{
      rule: 'M10', severity: 'must', person: 0, days: range(0, jan(1)),
      message: 'po 6 dnech práce jen 1 den volna (min. 2 dny)', penalty: HARD,
    }]);
  });
  it('reads the day after the month, which is no cell of the finding', () => {
    // Mon 25 to Sat 30, Sun 31 off, and what is stored for Mon 1 February
    const strip = pad(24, 'R1 R1 R1 R1 R1 R12 -');
    expect(found('M10', strip, '', ctxFor('2027-01', [{ nextDay: 'R1' }]))).toEqual([{
      rule: 'M10', severity: 'must', person: 0, days: range(jan(25), jan(31)),
      message: 'po 6 dnech práce jen 1 den volna (min. 2 dny)', penalty: HARD,
    }]);
    expect(found('M10', strip)).toEqual([]);
  });
});

describe('M11 in detail', () => {
  /** O, off, R1, R1 from Mon 4 to Sun 17: rests of 32, 16 and 24 h, over and over. */
  const short = '- - - | O - R1 R1 O - R1 | R1 O - R1 R1 O -';

  it('is one finding for a stretch of failing windows, on their days of the month', () => {
    // The rest before the O of Mon 4, unknown and so rest, reaches the window from Mon 4; the one
    // after the O of Sat 16 the windows from Sun 10 on. The five from Tue 5 to Sat 9 fail.
    expect(found('M11', short)).toEqual([{
      rule: 'M11', severity: 'must', person: 0, days: range(jan(5), jan(15)),
      message: 'jen 32 h volna v kuse za 7 dní (min. 35 h)', penalty: 5 * HARD,
    }]);
    const all = alone(weeklyRest, short);
    expect([all.score, all.units]).toEqual([5 * HARD, 5]);
  });
  it('compares with the weekly rest of the settings, which a rest of just that length meets', () => {
    expect(found('M11', short, '', ctxFor('2027-01', 1, { weeklyRestHours: 32 }))).toEqual([]);
    const more = ctxFor('2027-01', 1, { weeklyRestHours: 32.5 });
    expect(found('M11', short, '', more).map((f) => f.message))
      .toEqual(['jen 32 h volna v kuse za 7 dní (min. 32,5 h)']);
  });
  it('takes the rests from the shift times in the settings', () => {
    // O from 14:30 to 22:30: 31.5 h to the R1 after the day off
    const shifts = { ...defaultSettings().shifts, O: { start: 870, end: 1350, hours: 7.5 } };
    expect(found('M11', short, '', ctxFor('2027-01', 1, { shifts })).map((f) => f.message))
      .toEqual(['jen 31,5 h volna v kuse za 7 dní (min. 35 h)']);
  });
  it('finds 40 h after R1, a day off and R1: enough', () => {
    expect(found('M11', 'R1 R1 - R1 R1 - R1 R1 - R1 R1 - R1 R1 - R1 R1 - R1 R1 - R1 R1 -'))
      .toEqual([]);
  });
  it('gives each stretch of failing windows a finding of its own, with its own longest rest', () => {
    // O, off, R1, R1 from Mon 4 to Thu 14, then 70 h off, then O20, off, R1, R1 from Sun 17 to
    // Sun 31: O20 ends at 20:00, 34 h before the R1 after the day off
    const strip =
      '- - - | O - R1 R1 O - R1 | R1 O - R1 - - O20 | - R1 R1 O20 - R1 R1 | O20 - R1 R1 O20 - R1';
    expect(found('M11', strip).map((f) => [f.days, f.message, f.penalty])).toEqual([
      [range(jan(5), jan(13)), 'jen 32 h volna v kuse za 7 dní (min. 35 h)', 3 * HARD],
      [range(jan(18), jan(30)), 'jen 34 h volna v kuse za 7 dní (min. 35 h)', 7 * HARD],
    ]);
  });
  it('quotes the longest rest of the first failing window of a stretch', () => {
    // From Mon 4, O, off, R1, R1 twice, then O20, off, R1, R1 twice: the 34 h after the first O20
    // (Tue 12) lies outside the first failing window, Tue 5 to Mon 11
    const strip = '- - - | O - R1 R1 O - R1 | R1 O20 - R1 R1 O20 - | R1 R1';
    expect(found('M11', strip)).toEqual([{
      rule: 'M11', severity: 'must', person: 0, days: range(jan(5), jan(18)),
      message: 'jen 32 h volna v kuse za 7 dní (min. 35 h)', penalty: 8 * HARD,
    }]);
  });
  it('checks the windows that reach back into the previous month, naming their month days', () => {
    // O, off, R1, R1 from Fri 25 December to Wed 6 January, then nothing
    expect(found('M11', 'R1 O - R1 R1 O', 'O - R1 R1 O - R1')).toEqual([{
      rule: 'M11', severity: 'must', person: 0, days: range(jan(1), jan(5)),
      message: 'jen 32 h volna v kuse za 7 dní (min. 35 h)', penalty: 5 * HARD,
    }]);
  });
  it('takes the time before the first shift it knows of for rest', () => {
    // December filled in part: R1 on Thu 31 only, then R12 Fri 1 to Sun 3, R1 Mon 4 and Tue 5
    expect(rowMusts('R12 R12 R12 | R1 R1', '- - - - - - R1')).toEqual([]);
  });
  it('reads the day after the month', () => {
    // O, off, R1, R1 from Wed 20 to Sun 31, and a night stored for Mon 1 February: 32 h after the
    // R1 of Sun 31, and it ends on Tue 2
    const strip = pad(19, 'O - R1 R1 O - R1 R1 O - R1 R1');
    expect(found('M11', strip).map((f) => [f.days, f.penalty]))
      .toEqual([[range(jan(21), jan(30)), 4 * HARD]]);
    const night = ctxFor('2027-01', [{ nextDay: 'N' }]);
    expect(found('M11', strip, '', night).map((f) => [f.days, f.penalty]))
      .toEqual([[range(jan(21), jan(31)), 6 * HARD]]);
  });
  it('asks nothing of a person with no shift, or with one only on the day after the month', () => {
    expect(found('M11', '')).toEqual([]);
    expect(found('M11', '', '', ctxFor('2027-01', [{ nextDay: 'N' }]))).toEqual([]);
  });
});

describe('M11 and the last shift before the tail', () => {
  // February 2027: the tail is Mon 25 to Sun 31 January, and the week before it Mon 18 to Sun 24.
  // From Tue 26: O, O, N, N, N12, a day off, R1 and R1, with rests of 16, 24, 16, 12, 24 and 16 h.
  const tail = '- O O N N N12 -';
  const month = 'R1 R1';

  it('starts the rest at 06:00 on the first day of the tail after a night the day before', () => {
    // The night of Sun 24 ends at 06:00 on Mon 25: 32 h before the O of Tue 26, the longest rest
    // in the 7 days from Tue 26.
    const at = (hours: number) =>
      ctxFor('2027-02', [{ before: '- - - - - - N' }], { weeklyRestHours: hours });
    expect(at(32).people[0].restBefore).toBe(360);
    expect(found('M11', month, tail, at(32))).toEqual([]);
    expect(found('M11', month, tail, at(32.5))).toEqual([{
      rule: 'M11', severity: 'must', person: 0, days: [at(32.5).first],
      message: 'jen 32 h volna v kuse za 7 dní (min. 32,5 h)', penalty: HARD,
    }]);
  });
  it('quotes a short rest that began before the tail, when it is the longest in the window', () => {
    // The O of Sun 24 January ends at 22:00, 2 h before the tail begins (`restBefore` is -120):
    // 32 h to the R1 of Tue 26, where nine days of R1 begin, with rests of 16 h between them. The
    // windows from Tue 26 and from Wed 27 fail, and the longest rest of the first is the 32 h that
    // began before the first day of the row.
    const k = ctxFor('2027-02', [{ before: '- - - - - - O' }]);
    expect(k.people[0].restBefore).toBe(-120);
    expect(found('M11', 'R1 R1 R1', '- R1 R1 R1 R1 R1 R1', k)).toEqual([{
      rule: 'M11', severity: 'must', person: 0, days: [k.first, k.first + 1],
      message: 'jen 32 h volna v kuse za 7 dní (min. 35 h)', penalty: 2 * HARD,
    }]);
    // With no shift stored the week before, the time before the first R1 is unknown, so it counts
    // as rest that reaches the window from Tue 26: that one passes, the window from Wed 27 alone
    // fails, and its longest rest is one of 16 h.
    const unknown = ctxFor('2027-02', 1);
    expect(found('M11', 'R1 R1 R1', '- R1 R1 R1 R1 R1 R1', unknown)).toEqual([{
      rule: 'M11', severity: 'must', person: 0, days: [unknown.first, unknown.first + 1],
      message: 'jen 16 h volna v kuse za 7 dní (min. 35 h)', penalty: HARD,
    }]);
  });
  it('takes the time before the first shift for rest when no shift is stored the week before', () => {
    const none = ctxFor('2027-02', 1, { weeklyRestHours: 32.5 });
    expect(none.people[0].restBefore).toBeNull();
    expect(found('M11', month, tail, none)).toEqual([]);
  });
  it('fails in February too the window of 26 January to 1 February that fails in January', () => {
    // N12 on Sun 24 January, Mon 25 off, then R1 at 06:00 on Tue 26: 24 h of rest. Short rests
    // follow up to the night of Mon 1 February, which ends on Tue 2.
    const data = newAppData();
    const stored: Array<[ISODate, CodeName]> = [
      ['2027-01-24', 'N12'], ['2027-01-26', 'R1'], ['2027-01-27', 'R1'], ['2027-01-28', 'O'],
      ['2027-01-30', 'R12'], ['2027-01-31', 'R12'], ['2027-02-01', 'N'],
    ];
    for (const [date, code] of stored) data.cells[date] = { p1: { code } };
    const weeklyRestOf = (month: string) => {
      const g = buildMonthGrid(data, month);
      return rules(run(g.ctx, g.rows), 'M11').map((f) => ({
        person: f.person,
        dates: f.days.map((d) => g.ctx.days[d].date),
        message: f.message,
        penalty: f.penalty,
      }));
    };
    const message = 'jen 32 h volna v kuse za 7 dní (min. 35 h)';
    // January: the windows from Mon 25 and from Tue 26, the last that ends with 1 February
    const january = ['25', '26', '27', '28', '29', '30', '31'].map((d) => `2027-01-${d}`);
    expect(weeklyRestOf('2027-01')).toEqual([
      { person: 0, dates: january, message, penalty: 2 * HARD },
    ]);
    // February: the window from Tue 26, whose rest before it began at 06:00 on Mon 25
    expect(weeklyRestOf('2027-02')).toEqual([
      { person: 0, dates: ['2027-02-01'], message, penalty: HARD },
    ]);
  });
});

/**
 * M11 the slow way, straight from the rule: the rests are the gaps between the shifts, from the
 * end of the last shift before the tail (`restBefore`) or, if none is known, from forever, and up
 * to forever after the last shift. A window of 7 days is checked if it has a day of the month and
 * ends by the end of the day after the month, and it fails if no rest of the minimum overlaps it.
 * Each stretch of failing windows is a finding.
 */
function slowWeeklyRest(
  ctx: MonthContext,
  row: Uint8Array,
  next: number,
  restBefore: number | null,
) {
  const DAY = 1440;
  const n = ctx.days.length; // the index of the day after the month
  const { shifts, weeklyRestHours } = ctx.settings;
  const rests: Array<[number, number]> = [];
  let free = restBefore ?? -Infinity;
  for (let i = 0; i <= n; i++) {
    const code = i < n ? row[i] : next;
    if (!isShift(code)) continue;
    const { start, end } = shifts[CODE_NAMES[code] as ShiftName];
    if (i * DAY + start >= free) rests.push([free, i * DAY + start]);
    free = Math.max(free, i * DAY + end);
  }
  rests.push([free, Infinity]);
  const overlapping = (w: number) => rests.filter(([a, b]) => a < (w + 7) * DAY && b > w * DAY);

  const failing: number[] = [];
  for (let w = 0; w + 7 <= n + 1; w++) {
    if (w + 6 < ctx.first) continue;
    if (!overlapping(w).some(([a, b]) => b - a >= weeklyRestHours * 60)) failing.push(w);
  }
  const findings: Array<{ days: number[]; message: string; penalty: number }> = [];
  for (let k = 0; k < failing.length; ) {
    let m = k;
    while (m + 1 < failing.length && failing[m + 1] === failing[m] + 1) m++;
    const longest = Math.max(0, ...overlapping(failing[k]).map(([a, b]) => b - a));
    findings.push({
      days: range(Math.max(ctx.first, failing[k]), Math.min(n - 1, failing[m] + 6)),
      message: `jen ${fmtH(longest / 60)} h volna v kuse za 7 dní (min. ${fmtH(weeklyRestHours)} h)`,
      penalty: (m - k + 1) * HARD,
    });
    k = m + 1;
  }
  return { windows: failing.length, findings };
}

describe('the rules of days in a row and weekly rest, on rows of any kind', () => {
  /** People with different codes stored for the day after the month and the week before the tail. */
  const people: PersonPatch[] = [
    {}, { nextDay: 'R1' }, { nextDay: 'O' }, { nextDay: 'N' }, { nextDay: 'N12' }, { nextDay: 'x' },
    { before: '- - - - - - N' }, { before: '- - - - - - R1', nextDay: 'N' },
    { before: '- - - - O - -' }, { before: 'N12 - - - - - -' }, { before: '- - - - - - x' },
  ];
  const variants: Array<[string, Partial<Settings>]> = [
    ['the default settings', {}],
    ['a weekly rest of 24 h and at most 4 days in a row', { weeklyRestHours: 24, maxDaysInRow: 4 }],
    [
      // R1 starts at midnight, and the night before it runs into it until 07:00
      'R1 from 00:00 to 08:00 and N from 22:00 to 07:00',
      {
        shifts: {
          ...defaultSettings().shifts,
          R1: { start: 0, end: 480, hours: 8 },
          N: { start: 1320, end: 1860, hours: 9 },
        },
      },
    ],
  ];

  /** A row with a random code in every cell: a shift for a share `dense` of them. */
  function randomRow(length: number, random: () => number, dense: number): Uint8Array {
    const row = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      const r = random();
      if (r < dense) row[i] = 1 + Math.floor(random() * 7); // R1 to N12
      else if (r >= 0.95) row[i] = 8 + Math.floor(random() * 5); // an absence or x
    }
    return row;
  }

  it.each(variants)('find M11 as the rule is written (%s)', (_, settings) => {
    const ctx = ctxFor('2027-01', people, settings);
    const random = mulberry32(20270111);
    let windows = 0;
    for (let k = 0; k < 600; k++) {
      const p = k % people.length;
      const row = randomRow(ctx.days.length, random, k % 2 === 0 ? 0.9 : 0.7);
      const { nextDay, restBefore } = ctx.people[p];
      const slow = slowWeeklyRest(ctx, row, nextDay, restBefore);
      const stats = fresh();
      const seen: Finding[] = [];
      const score = weeklyRest(ctx, p, row, stats, (f) => seen.push(f));
      expect(seen.map(({ days, message, penalty }) => ({ days, message, penalty })))
        .toEqual(slow.findings);
      expect([score, stats.mustUnits]).toEqual([slow.windows * HARD, slow.windows]);
      windows += slow.windows;
    }
    expect(windows).toBeGreaterThan(300); // the rows really did fail windows
  });

  it.each(variants)('score alike with a sink or without, and list each penalty (%s)', (_, s) => {
    const ctx = ctxFor('2027-01', people, s);
    const random = mulberry32(20270112);
    let listed = 0;
    for (let k = 0; k < 600; k++) {
      const p = k % people.length;
      const row = randomRow(ctx.days.length, random, k % 2 === 0 ? 0.9 : 0.6);
      for (const rule of [runMusts, weeklyRest]) {
        const quiet = fresh();
        const loud = fresh();
        const seen: Finding[] = [];
        const score = rule(ctx, p, row, loud, (f) => seen.push(f));
        expect([rule(ctx, p, row, quiet), quiet.mustUnits]).toEqual([score, loud.mustUnits]);
        expect(seen.reduce((sum, f) => sum + f.penalty, 0)).toBe(score);
        for (const f of seen) {
          expect(f.severity).toBe('must');
          expect(f.person).toBe(p);
          expect(f.message).not.toBe('');
          expect(f.penalty).toBeGreaterThanOrEqual(HARD);
          for (const d of f.days) {
            expect(Number.isInteger(d) && d >= 0 && d < row.length).toBe(true);
          }
          expect(Math.max(...f.days)).toBeGreaterThanOrEqual(ctx.first); // it touches the month
        }
        listed += seen.length;
      }
    }
    expect(listed).toBeGreaterThan(500);
  });

  it('build no message text unless a sink is given', () => {
    // M11 from Tue 5, then 7 days in a row from Mon 18 (M9), and one day off after them (M10)
    const [row] = rowsOf(j, [
      '- - - | O - R1 R1 O - R1 | R1 O - R1 R1 O - | R1 R1 R1 R1 R1 R12 R12 | - R1',
    ]);
    vi.mocked(fmtH).mockClear();
    vi.mocked(fmtDays).mockClear();
    expect(runMusts(j, 0, row, fresh()) + weeklyRest(j, 0, row, fresh())).toBeGreaterThan(2 * HARD);
    expect(fmtH).not.toHaveBeenCalled();
    expect(fmtDays).not.toHaveBeenCalled();
    const seen = new Set<string>();
    runMusts(j, 0, row, fresh(), (f) => seen.add(f.rule));
    weeklyRest(j, 0, row, fresh(), (f) => seen.add(f.rule));
    expect(seen).toEqual(new Set(['M9', 'M10', 'M11']));
    expect(fmtH).toHaveBeenCalled();
    expect(fmtDays).toHaveBeenCalled();
  });
});
