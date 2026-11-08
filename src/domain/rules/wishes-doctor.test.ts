import { describe, it, expect, vi } from 'vitest';
import { mulberry32 } from '../../generator/rng';
import { ctxFor, noWishes, rowsOf, rules, run, units } from '../../test/rulekit';
import type { PersonPatch } from '../../test/rulekit';
import { CODE_NAMES, isShift } from '../codes';
import type { MonthContext } from '../context';
import { defaultSettings } from '../defaults';
import { clock } from '../format';
import type { DoctorNote, ISODate, Level, Settings, ShiftName } from '../types';
import { doctorWish } from './doctorWish';
import { evaluatePerson } from './person';
import { report } from './personWishes';
import type { Finding } from './types';

// `report` and `clock` are counted (the real ones still run), so that a test can see whether a
// finding or the text of a message was built.
vi.mock('./personWishes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./personWishes')>();
  return { ...actual, report: vi.fn(actual.report) };
});
vi.mock('../format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../format')>();
  return { ...actual, clock: vi.fn(actual.clock) };
});

// February 2027 starts on a Monday, so Wednesday 3 February is day 2 of the month (counted from
// 0). The appointment of a test is on that day, unless it says otherwise. A strip starts at day 0,
// so '- - O' is an O on the day of the appointment and '- N' a night on the day before it.
const DAY: ISODate = '2027-02-03';
const DAY_INDEX = 2;

/** Whole minutes after midnight, from a time written `8` or `6:30`. */
const minutes = (time: string): number => {
  const [hours, mins = '0'] = time.split(':');
  return 60 * Number(hours) + Number(mins);
};

/** A context for one person with an appointment on DAY from `from` to `to`, as `8` or `6:30`. */
const doctor = (from: string, to: string, settings: Partial<Settings> = {}): MonthContext =>
  ctxFor('2027-02', [{ doctor: { [DAY]: { from: minutes(from), to: minutes(to) } } }], settings);

/** The findings of W10 for one person's strip (and the 7 days before the month). */
const found = (ctx: MonthContext, strip: string, tail: string[] = []): Finding[] =>
  rules(run(ctx, rowsOf(ctx, [strip], tail)), 'W10');

/** What findings say: the text and the cells, counted from day 1 (the tail is negative). */
const listed = (ctx: MonthContext, fs: Finding[]) =>
  fs
    .map((f) => ({ message: f.message, days: f.days.map((d) => d - ctx.first) }))
    .sort((a, b) => (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));

describe('the doctor wish W10', () => {
  it('O after L 8–12 is fine', () => {
    // O starts at 14:00, two hours after the appointment ends
    expect(found(doctor('8', '12'), '- - O')).toEqual([]);
  });
  it('O20 after L 8–12 collides', () => {
    // O20 starts at 12:00, inside the hour after the appointment
    const ctx = doctor('8', '12');
    expect(listed(ctx, found(ctx, '- - O20'))).toEqual([
      { message: 'O20 se kryje s lékařem 8:00–12:00', days: [DAY_INDEX] },
    ]);
  });
  it('R1 collides with L 8–12', () => {
    const ctx = doctor('8', '12');
    expect(listed(ctx, found(ctx, '- - R1'))).toEqual([
      { message: 'R1 se kryje s lékařem 8:00–12:00', days: [DAY_INDEX] },
    ]);
  });
  it('no shift is fine', () => {
    const ctx = doctor('8', '12');
    expect(found(ctx, '')).toEqual([]);
    // a request and an absence are no shift either
    for (const off of ['x', 'DOV', 'MD', 'OP', 'NEM']) expect(found(ctx, `- - ${off}`)).toEqual([]);
  });
  it('R1 before L 15–16 is fine', () => {
    // R1 ends at 14:00, exactly one hour before the appointment
    expect(found(doctor('15', '16'), '- - R1')).toEqual([]);
  });
  it('a night ending at 06:00 before L 6:30–7 collides', () => {
    // the night starts on day 1 and ends on the morning of the appointment, half an hour before it
    const ctx = doctor('6:30', '7');
    expect(listed(ctx, found(ctx, '- N'))).toEqual([
      { message: 'N se kryje s lékařem 6:30–7:00', days: [DAY_INDEX - 1, DAY_INDEX] },
    ]);
  });
  it('the finding is quiet and costs W10', () => {
    const ctx = doctor('8', '12');
    // strictly equal: the finding has `quiet`, and no other field than a wish has
    expect(found(ctx, '- - R1')).toStrictEqual([
      {
        rule: 'W10',
        severity: 'wish',
        person: 0,
        days: [ctx.first + DAY_INDEX],
        message: 'R1 se kryje s lékařem 8:00–12:00',
        penalty: ctx.weights.W10,
        quiet: true,
      },
    ]);
    expect(ctx.weights.W10).toBe(10);
  });
});

describe('W10 in detail', () => {
  // Each case: the strip, the appointment, and whether the shift collides with it. The shifts are
  // R1 06:00-14:00, R2 08:00-16:00, O20 12:00-20:00, O 14:00-22:00, N 22:00-06:00 the next day,
  // R12 06:00-18:00 and N12 18:00-06:00 the next day. An hour is kept clear on both sides, and a
  // shift that only touches the hour is fine.
  const cases: Array<[string, string, string, string, boolean]> = [
    // a shift of the day, before the appointment: it must end an hour before it starts
    ['R1 ends 14:00, the appointment starts 15:00', '- - R1', '15', '16', false],
    ['R1 ends 14:00, the appointment starts 14:59', '- - R1', '14:59', '16', true],
    ['R2 ends 16:00, the appointment starts 17:00', '- - R2', '17', '18', false],
    ['R2 ends 16:00, the appointment starts 16:59', '- - R2', '16:59', '18', true],
    ['R12 ends 18:00, the appointment starts 19:00', '- - R12', '19', '20', false],
    ['R12 ends 18:00, the appointment starts 18:30', '- - R12', '18:30', '20', true],
    // a shift of the day, after the appointment: it must start an hour after it ends
    ['O starts 14:00, the appointment ends 13:00', '- - O', '12', '13', false],
    ['O starts 14:00, the appointment ends 13:01', '- - O', '12', '13:01', true],
    ['O20 starts 12:00, the appointment ends 11:00', '- - O20', '10', '11', false],
    ['O20 starts 12:00, the appointment ends 11:30', '- - O20', '10', '11:30', true],
    ['R1 starts 06:00, the appointment ends 05:00', '- - R1', '4', '5', false],
    ['R1 starts 06:00, the appointment ends 05:01', '- - R1', '4', '5:01', true],
    ['N12 starts 18:00, the appointment ends 17:00', '- - N12', '16', '17', false],
    ['N12 starts 18:00, the appointment ends 17:30', '- - N12', '16', '17:30', true],
    // a shift inside the appointment, and an appointment inside the shift
    ['R12 06:00-18:00 holds an appointment 12-13', '- - R12', '12', '13', true],
    ['an appointment 6-18 holds O20', '- - O20', '6', '18', true],
    // a night that starts on the day of the appointment
    ['N starts 22:00, the appointment ends 21:00', '- - N', '20', '21', false],
    ['N starts 22:00, the appointment ends 21:01', '- - N', '20', '21:01', true],
    ['N starts 22:00, inside a late appointment', '- - N', '21:30', '22:30', true],
    ['N starts 22:00, the appointment is at noon', '- - N', '12', '13', false],
    // a night that ends on the day of the appointment: it must end an hour before it starts
    ['N ends 06:00, the appointment starts 07:00', '- N', '7', '8', false],
    ['N ends 06:00, the appointment starts 06:59', '- N', '6:59', '8', true],
    ['N ends 06:00, the appointment starts 10:00', '- N', '10', '11', false],
    ['N ends 06:00, the appointment starts 05:00', '- N', '5', '6:30', true],
    ['N ends 06:00, an appointment 0:00-24:00', '- N', '0', '24', true],
    ['N12 ends 06:00, the appointment starts 07:00', '- N12', '7', '8', false],
    ['N12 ends 06:00, the appointment starts 06:30', '- N12', '6:30', '7', true],
    // a shift of the day before that ends the same day is none of the appointment's business
    ['O of the day before, an appointment at 0:30-1:00', '- O', '0:30', '1', false],
    ['R1 of the day before, an appointment at 9-10', '- R1', '9', '10', false],
    // the shift of the day after starts at 06:00, long after the hour that follows the appointment
    ['R1 of the day after, an appointment ending at 24:00', '- - - R1', '23', '24', false],
  ];
  it.each(cases)('%s', (_, strip, from, to, collides) => {
    const ctx = doctor(from, to);
    expect(found(ctx, strip)).toHaveLength(collides ? 1 : 0);
    expect(units(run(ctx, rowsOf(ctx, [strip])), ctx, 'W10')).toBe(collides ? 1 : 0);
  });

  it('puts the shift and the times of the appointment in the message', () => {
    const message = (strip: string, from: string, to: string) => {
      const ctx = doctor(from, to);
      return found(ctx, strip).map((f) => f.message);
    };
    expect(message('- - R1', '8', '12')).toEqual(['R1 se kryje s lékařem 8:00–12:00']);
    expect(message('- - R2', '9:05', '10:30')).toEqual(['R2 se kryje s lékařem 9:05–10:30']);
    expect(message('- - N12', '17:30', '23:59')).toEqual([
      'N12 se kryje s lékařem 17:30–23:59',
    ]);
    expect(message('- N', '6:30', '7')).toEqual(['N se kryje s lékařem 6:30–7:00']);
    expect(message('- N12', '0', '24')).toEqual(['N12 se kryje s lékařem 0:00–24:00']);
  });
  it('points at the shift of the day, or at the night and the day of the appointment', () => {
    const ctx = doctor('8', '12');
    expect(found(ctx, '- - R1')[0].days).toEqual([ctx.first + 2]);
    const early = doctor('5', '7');
    expect(found(early, '- N')[0].days).toEqual([early.first + 1, early.first + 2]);
  });
  it('asks nothing of a day without an appointment', () => {
    const ctx = doctor('8', '12');
    // the same shifts on every other day of the month
    expect(found(ctx, 'R1 R1 - R1 R1 R1 R1 | R1 R1 R1 R1 R1 R1 R1')).toEqual([]);
    expect(found(ctx, 'N N - N N N N | N N N N N N N')).toEqual([]);
  });
  it('asks nothing when the person has no appointment at all', () => {
    const ctx = ctxFor('2027-02', 1);
    expect(found(ctx, 'R1 R1 R1 R1 R1 R12 R12 | N N N N N N12 N12')).toEqual([]);
  });
  it('counts each collision: a night from the day before and a shift of the day are two', () => {
    // 5:00-23:30 meets the night that ends at 06:00 and the night that starts at 22:00
    const ctx = doctor('5', '23:30');
    expect(listed(ctx, found(ctx, '- N N'))).toEqual([
      { message: 'N se kryje s lékařem 5:00–23:30', days: [1, 2] },
      { message: 'N se kryje s lékařem 5:00–23:30', days: [2] },
    ]);
    expect(units(run(ctx, rowsOf(ctx, ['- N N'])), ctx, 'W10')).toBe(2);
  });
  it('judges the appointment of each day', () => {
    // Wed 3, Thu 4 and Sun 7 February
    const ctx = ctxFor('2027-02', [
      {
        doctor: {
          '2027-02-03': { from: minutes('8'), to: minutes('12') },
          '2027-02-04': { from: minutes('8'), to: minutes('12') },
          '2027-02-07': { from: minutes('18'), to: minutes('19') },
        },
      },
    ]);
    // R1 on the 3rd (collides), O on the 4th (fine), R12 on the 7th (collides)
    expect(listed(ctx, found(ctx, '- - R1 O - - R12'))).toEqual([
      { message: 'R1 se kryje s lékařem 8:00–12:00', days: [2] },
      { message: 'R12 se kryje s lékařem 18:00–19:00', days: [6] },
    ]);
  });
  it('judges the appointments of person p alone', () => {
    const ctx = ctxFor('2027-02', [
      { doctor: { [DAY]: { from: minutes('8'), to: minutes('12') } } },
      {},
      { doctor: { [DAY]: { from: minutes('8'), to: minutes('9') } } },
    ]);
    // the same row for all three: R1 on the day of the appointments, R2 the day before
    const [row] = rowsOf(ctx, ['- R2 R1']);
    const seen = (p: number) => {
      const out: Finding[] = [];
      evaluatePerson(ctx, p, row, (f) => out.push(f));
      return out.filter((f) => f.rule === 'W10').map((f) => [f.person, f.message]);
    };
    expect(seen(0)).toEqual([[0, 'R1 se kryje s lékařem 8:00–12:00']]);
    expect(seen(1)).toEqual([]);
    expect(seen(2)).toEqual([[2, 'R1 se kryje s lékařem 8:00–9:00']]);
  });
  it('follows the shift times of the settings', () => {
    const late = {
      ...defaultSettings().shifts,
      R1: { start: minutes('15'), end: minutes('23'), hours: 7.5 },
    };
    // R1 is 06:00-14:00 by default and collides with L 8-12; at 15:00-23:00 it does not
    expect(found(doctor('8', '12'), '- - R1')).toHaveLength(1);
    expect(found(doctor('8', '12', { shifts: late }), '- - R1')).toEqual([]);
    // and now an afternoon appointment collides with it
    expect(found(doctor('16', '17', { shifts: late }), '- - R1')).toHaveLength(1);
  });

  describe('at the turn of the month', () => {
    it('does not judge an appointment of the previous month', () => {
      // Sun 31 January is the last day of the tail
      const ctx = ctxFor('2027-02', [
        { doctor: { '2027-01-31': { from: minutes('8'), to: minutes('12') } } },
      ]);
      expect(found(ctx, '', ['- - - - - - R1'])).toEqual([]);
      expect(found(ctx, '', ['- - - - - N -'])).toEqual([]);
    });
    it('reads the night of the last day of the tail for an appointment on day 1', () => {
      const ctx = ctxFor('2027-02', [
        { doctor: { '2027-02-01': { from: minutes('6:30'), to: minutes('7') } } },
      ]);
      expect(listed(ctx, found(ctx, '', ['- - - - - - N']))).toEqual([
        { message: 'N se kryje s lékařem 6:30–7:00', days: [-1, 0] },
      ]);
      // a night from a day further back has ended long before
      expect(found(ctx, '', ['- - - - - N -'])).toEqual([]);
    });
    it('judges an appointment on the last day of the month', () => {
      // Sun 28 February is day 27
      const ctx = ctxFor('2027-02', [
        { doctor: { '2027-02-28': { from: minutes('18'), to: minutes('20') } } },
      ]);
      const strip = '- '.repeat(27) + 'N12';
      expect(listed(ctx, found(ctx, strip))).toEqual([
        { message: 'N12 se kryje s lékařem 18:00–20:00', days: [27] },
      ]);
    });
    it('leaves a night on the last day to the next month, which holds the appointment', () => {
      // an appointment on Mon 1 March at 5-6 is not in this month's context at all
      const ctx = ctxFor('2027-02', [
        { doctor: { '2027-03-01': { from: minutes('5'), to: minutes('6') } } },
      ]);
      expect(found(ctx, '- '.repeat(27) + 'N')).toEqual([]);
    });
  });
});

describe('W10 as a wish', () => {
  const strip = '- - R1 - - - R12';
  const patch: PersonPatch = {
    doctor: {
      [DAY]: { from: minutes('8'), to: minutes('12') },
      '2027-02-07': { from: minutes('17'), to: minutes('18') },
    },
  };
  const atLevel = (level: Level) =>
    ctxFor('2027-02', [patch], { wishLevels: { ...defaultSettings().wishLevels, W10: level } });
  const cost = (ctx: MonthContext) => found(ctx, strip).reduce((sum, f) => sum + f.penalty, 0);

  it('costs the weight of its level, and nothing when switched off', () => {
    expect(cost(atLevel(1))).toBeGreaterThan(0);
    expect(cost(atLevel(5)) / cost(atLevel(1))).toBe(16); // level 5 is x4, level 1 is x0.25
    // the units do not depend on the level
    const [low, high] = [atLevel(1), atLevel(5)];
    expect(units(run(high, rowsOf(high, [strip])), high, 'W10')).toBe(
      units(run(low, rowsOf(low, [strip])), low, 'W10'),
    );
    expect(found(atLevel(0), strip)).toEqual([]);
  });
  it('is part of the score of the person: each collision adds the weight', () => {
    const withNotes = atLevel(3);
    const without = ctxFor('2027-02', 1);
    const [row] = rowsOf(withNotes, [strip]);
    const penalty = withNotes.weights.W10;
    expect(penalty).toBeGreaterThan(0);
    // the same row and settings; only the notes differ, and the row collides twice
    const gain = evaluatePerson(withNotes, 0, row).score - evaluatePerson(without, 0, row).score;
    expect(gain).toBeCloseTo(2 * penalty, 6);
    // with the explanations on, the findings add up to the same score
    const seen: Finding[] = [];
    const scored = evaluatePerson(withNotes, 0, row, (f) => seen.push(f)).score;
    expect(scored).toBe(evaluatePerson(withNotes, 0, row).score);
    expect(seen.filter((f) => f.rule === 'W10')).toHaveLength(2);
  });
  it('is scored by doctorWish alone: W10 for each collision, and a sink is optional', () => {
    const ctx = atLevel(3);
    const [row] = rowsOf(ctx, [strip]);
    expect(doctorWish(ctx, 0, row)).toBe(2 * ctx.weights.W10);
    const seen: Finding[] = [];
    expect(doctorWish(ctx, 0, row, (f) => seen.push(f))).toBe(2 * ctx.weights.W10);
    expect(seen.map((f) => f.rule)).toEqual(['W10', 'W10']);
    expect(doctorWish(ctx, 0, rowsOf(ctx, ['- - O'])[0])).toBe(0);
    expect(doctorWish(atLevel(0), 0, row)).toBe(0);
  });
  it('is switched off on its own: the other wishes go on', () => {
    const off = atLevel(0);
    expect(off.weights.W10).toBe(0);
    expect(found(off, strip)).toEqual([]);
    // one 12-hour shift is a unit of W5a, the distance from the target of 2
    expect(rules(run(off, rowsOf(off, [strip])), 'W5a')).not.toEqual([]);
  });
  it('builds no finding and no message text unless a sink is given', () => {
    const t = atLevel(3);
    const [row] = rowsOf(t, [strip]); // two collisions
    vi.mocked(report).mockClear();
    vi.mocked(clock).mockClear();
    evaluatePerson(t, 0, row);
    expect(report).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();

    evaluatePerson(t, 0, row, () => undefined);
    const doctorCalls = vi.mocked(report).mock.calls.filter((call) => call[1] === 'W10');
    expect(doctorCalls).toHaveLength(2);
    expect(clock).toHaveBeenCalled();
  });
});

/** The wishes this file tests: only W10 is on, so a score is that of the musts and W10. */
function onlyMine(): Settings['wishLevels'] {
  const levels = noWishes();
  levels.W10 = 3;
  return levels;
}
/** Whether `a` and `b` differ by no more than rounding errors, which grow with the numbers. */
const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * The collisions of a row by a literal reading: every shift of the row is laid on one timeline of
 * minutes from midnight of the first day, and so is each appointment with its hour on either side.
 * It looks at the shifts of every day that could reach the appointment, not only at the night of
 * the day before.
 */
function collisions(ctx: MonthContext, p: number, row: Uint8Array): number {
  const { doctorFrom, doctorTo } = ctx.people[p];
  const DAY_MINUTES = 24 * 60;
  let found = 0;
  for (let i = ctx.first; i < ctx.days.length; i++) {
    if (doctorFrom[i] < 0) continue;
    const lo = i * DAY_MINUTES + doctorFrom[i] - 60;
    const hi = i * DAY_MINUTES + doctorTo[i] + 60;
    for (let d = Math.max(0, i - 2); d <= Math.min(row.length - 1, i + 1); d++) {
      if (!isShift(row[d])) continue;
      const { start, end } = ctx.settings.shifts[CODE_NAMES[row[d]] as ShiftName];
      if (d * DAY_MINUTES + start < hi && d * DAY_MINUTES + end > lo) found++;
    }
  }
  return found;
}

describe('W10 on rows of any kind', () => {
  // Rows of 35 cells with a bit of everything, from a fixed seed, for people with appointments on
  // random days (the tail too) from random times, in three months with other weekdays.
  const random = mulberry32(20270501);
  const months = ['2027-02', '2027-03', '2027-08'].map((month) => {
    const dates = ctxFor(month, 1).days.map((day) => day.date);
    // a person with few appointments, and ones with many
    const people: PersonPatch[] = [0.05, 0.1, 0.3, 0.6].map((density) => {
      const notes: Record<ISODate, DoctorNote> = {};
      for (const date of dates) {
        if (random() >= density) continue;
        const from = 15 * Math.floor(random() * 96); // a quarter of an hour, from 0:00 to 23:45
        const to = Math.min(1440, from + 15 * (1 + Math.floor(random() * 40)));
        notes[date] = { from, to };
      }
      return { doctor: notes };
    });
    return {
      on: ctxFor(month, people, { wishLevels: onlyMine() }),
      off: ctxFor(month, people, { wishLevels: noWishes() }),
    };
  });

  it('agrees with a literal reading, and with and without a sink', () => {
    const fired = { same: 0, spill: 0, none: 0 };
    for (let k = 0; k < 900; k++) {
      const { on, off } = months[k % months.length];
      const row = new Uint8Array(on.days.length);
      const shifty = random() < 0.5 ? 0.85 : 0.45; // some rows are dense, some sparse
      for (let i = 0; i < row.length; i++) {
        if (random() >= shifty) {
          row[i] = random() < 0.15 ? 8 + Math.floor(random() * 5) : 0; // an absence, x or none
        } else {
          row[i] = 1 + Math.floor(random() * 7);
        }
      }
      const p = k % on.people.length;
      const expected = collisions(on, p, row);

      const seen: Finding[] = [];
      const withSink = evaluatePerson(on, p, row, (f) => seen.push(f));
      const plain = evaluatePerson(on, p, row);
      const musts = evaluatePerson(off, p, row);
      expect(withSink).toEqual(plain);
      expect(withSink.stats).toEqual(musts.stats);

      const mine = seen.filter((f) => f.rule === 'W10');
      expect(seen.filter((f) => f.severity === 'wish')).toEqual(mine); // no other wish is on
      expect(mine).toHaveLength(expected);
      expect(close(withSink.score, musts.score + expected * on.weights.W10)).toBe(true);
      for (const f of mine) {
        expect(f.severity).toBe('wish');
        expect(f.person).toBe(p);
        expect(f.quiet).toBe(true);
        expect(f.penalty).toBe(on.weights.W10);
        expect(f.message).toMatch(
          /^(R1|R2|O20|O|N|R12|N12) se kryje s lékařem \d{1,2}:\d{2}–\d{1,2}:\d{2}$/,
        );
        // the cells: the shift of the day, or the night before it and then the day of the note
        expect(f.days.length === 1 || f.days.length === 2).toBe(true);
        const day = f.days[f.days.length - 1];
        expect(day).toBeGreaterThanOrEqual(on.first);
        expect(on.people[p].doctorFrom[day]).toBeGreaterThanOrEqual(0);
        if (f.days.length === 2) expect(f.days[0]).toBe(day - 1);
        fired[f.days.length === 1 ? 'same' : 'spill']++;
      }
      if (expected === 0) fired.none++;

      // a wish that is switched off scores nothing and reports nothing
      const silent: Finding[] = [];
      evaluatePerson(off, p, row, (f) => silent.push(f));
      expect(silent.filter((f) => f.rule === 'W10')).toEqual([]);
    }
    // the rows really did meet both kinds of collision, and also missed appointments
    for (const [kind, count] of Object.entries(fired)) expect(count, kind).toBeGreaterThan(100);
  });
});

describe('W10 on a row longer than the month', () => {
  it('reads nothing after the last day', () => {
    // a cell after the month is none of the rules' business: the row scores like the same row cut
    const random = mulberry32(20270502);
    const people: PersonPatch[] = [
      {
        doctor: {
          '2027-02-28': { from: minutes('21'), to: minutes('23') },
          '2027-02-27': { from: minutes('8'), to: minutes('9') },
        },
      },
    ];
    const ctx = ctxFor('2027-02', people);
    const n = ctx.days.length;
    for (let k = 0; k < 100; k++) {
      const row = new Uint8Array(n + 4);
      for (let i = 0; i < row.length; i++) {
        row[i] = random() < 0.25 ? 0 : 1 + Math.floor(random() * 7);
      }
      const cut = row.slice(0, n);
      const seenLong: Finding[] = [];
      const seenCut: Finding[] = [];
      expect(evaluatePerson(ctx, 0, row, (f) => seenLong.push(f))).toEqual(
        evaluatePerson(ctx, 0, cut, (f) => seenCut.push(f)),
      );
      expect(seenLong).toEqual(seenCut);
    }
  });
});
