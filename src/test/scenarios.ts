import { addDays } from '../domain/calendar';
import { codeFromName, nameOf } from '../domain/codes';
import { newAppData } from '../domain/defaults';
import type { AppData, CodeName, ISODate, MonthKey, PersonId } from '../domain/types';
import { syntheticTeam } from './team';

/** The months the generator is tested on. */
export type ScenarioName =
  | 'jan2027'
  | 'feb2027'
  | 'mar2027'
  | 'dec2027'
  | 'jul2027'
  | 'impossible'
  | 'pins'
  | 'monthEnd'
  | 'q1-2027'
  | 'claimed-holiday'
  | 'x-weekends'
  | 'doctor';

export interface Scenario {
  data: AppData;
  month: MonthKey;
}

/** Stores `code` for person `id` on `date`. */
function put(data: AppData, date: ISODate, id: PersonId, code: CodeName, pinned = false): void {
  const day = (data.cells[date] ??= {});
  day[id] = pinned ? { code, pinned } : { code };
}

/** Stores `code` for person `id` on every date from `from` to `to`, both included. */
function putRange(
  data: AppData,
  from: ISODate,
  to: ISODate,
  id: PersonId,
  code: CodeName,
  pinned = false,
): void {
  for (let date = from; date <= to; date = addDays(date, 1)) put(data, date, id, code, pinned);
}

/** Stores a strip of codes separated by spaces, `-` for none, for person `id` from `from` on. */
function putStrip(data: AppData, from: ISODate, id: PersonId, strip: string): void {
  strip.split(' ').forEach((token, k) => {
    if (token === '-') return;
    const code = codeFromName(token);
    if (code === null) throw new Error(`Unknown code "${token}" in strip "${strip}"`);
    put(data, addDays(from, k), id, nameOf(code) as CodeName);
  });
}

/** Stores a doctor's appointment for person `id` on `date`, from `from` to `to` (as `H:MM`). */
function putDoctor(data: AppData, date: ISODate, id: PersonId, from: string, to: string): void {
  const minutes = (time: string): number => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  };
  (data.doctor[date] ??= {})[id] = { from: minutes(from), to: minutes(to) };
}

/** A plan with the synthetic team and no cells. */
function plan(): AppData {
  const data = newAppData();
  data.people = syntheticTeam();
  return data;
}

/** What each person worked from 25 to 31 December 2026: the tail of January 2027. */
const JANUARY_TAIL: Record<PersonId, string> = {
  A: 'R12 R12 - R1 R1 R1 -',
  B: '- - - R2 R2 R2 R2',
  C: '- - - O O O O',
  D: 'N12 N12 - - N N N',
  E: '- - R12 O20 O20 O20 O20',
  F: '- - N12 - - - -',
  G: '- - - R2 R2 - -',
  H: '- - - N - R2 R1',
};

/**
 * January 2027 after the December above. A, G and H have asked for 1 to 3 January off; B is on
 * leave on the 1st and has asked for the 2nd and the 3rd off. So only C, D, E and F can work the
 * six 12-hour shifts of those days.
 */
function january(): AppData {
  const data = plan();
  for (const [id, strip] of Object.entries(JANUARY_TAIL)) putStrip(data, '2026-12-25', id, strip);
  for (const id of ['A', 'G', 'H']) putRange(data, '2027-01-01', '2027-01-03', id, 'x');
  put(data, '2027-01-01', 'B', 'DOV');
  putRange(data, '2027-01-02', '2027-01-03', 'B', 'x');
  return data;
}

/**
 * The requests of the first quarter of 2027, all stored before January is planned: January's
 * (see `january`), and E's week of leave and C's free weekend in February, B's week of leave, F's
 * free weekend and G's Easter off in March. H has asked for Friday 26 February off.
 */
function quarter(): AppData {
  const data = january();
  putRange(data, '2027-02-06', '2027-02-07', 'C', 'x');
  putRange(data, '2027-02-15', '2027-02-19', 'E', 'DOV');
  put(data, '2027-02-26', 'H', 'x');
  putRange(data, '2027-03-01', '2027-03-05', 'B', 'DOV');
  putRange(data, '2027-03-13', '2027-03-14', 'F', 'x');
  putRange(data, '2027-03-26', '2027-03-29', 'G', 'x');
  return data;
}

/** The 12-hour days of January 2027: New Year's Day and the five weekends. */
const JANUARY_TWELVE_DAYS: readonly ISODate[] = [
  '2027-01-01',
  '2027-01-02',
  '2027-01-03',
  '2027-01-09',
  '2027-01-10',
  '2027-01-16',
  '2027-01-17',
  '2027-01-23',
  '2027-01-24',
  '2027-01-30',
  '2027-01-31',
];

/**
 * A month of the generator tests, with the synthetic team:
 *
 * - `jan2027`: January 2027 (a holiday and 5 weekends) after a December tail, with four people
 *   unavailable on 1 to 3 January;
 * - `feb2027`: February 2027, a plain month of 4 weekends, with no requests;
 * - `mar2027`: March 2027, with Easter (Good Friday and Easter Monday), and no requests;
 * - `dec2027`: December 2027, with Christmas; A and G have worked 4 festive days already;
 * - `jul2027`: July 2027 with heavy leave: B, D and G each take two weeks, at most two people
 *   are away on any day;
 * - `impossible`: `feb2027`, with everyone but H off on the weekend of 13 and 14 February, whose
 *   four 12-hour shifts H alone cannot cover;
 * - `pins`: `jan2027`, with D pinned to N from 11 to 15 January;
 * - `monthEnd`: `jan2027`, with requests already stored for Mon 1 February 2027, the day after the
 *   month: C, E and F have asked for it off, and D is on leave. So none of the four, who are the
 *   people who work nights most willingly, can work the night of Sun 31 January.
 * - `q1-2027`: January 2027 as in `jan2027`, the first month of a quarter whose requests for
 *   February and March are stored too (see `quarter`). The months are planned one after another,
 *   each on top of the one before, so February and March carry the history of the months before.
 * - `claimed-holiday`: January 2027 with no tail and no requests, and C's R12 on New Year's Day
 *   pinned: a claimed holiday shift, which counts toward neither the minimum nor the maximum of
 *   12-hour shifts.
 * - `x-weekends`: January 2027 with no tail, where D has asked for every 12-hour day off but
 *   Saturday 16 January, New Year's Day included. So D can have one weekend shift at most, short
 *   of the minimum of two.
 * - `doctor`: January 2027 with no tail and no requests, and doctor's appointments on weekdays:
 *   from 8 to 12 for C and H, whom an O keeps clear of it; at 9 for F, whom an O or a night does;
 *   from 15 to 17 for A and B, whom an R1 does; and from 15 to 16 every day of the last week for
 *   G, who likes R1 and R2 the same and is clear of it on R1 only.
 *
 * Each call returns fresh objects.
 */
export function scenario(name: ScenarioName): Scenario {
  switch (name) {
    case 'jan2027':
      return { data: january(), month: '2027-01' };
    case 'feb2027':
      return { data: plan(), month: '2027-02' };
    case 'mar2027':
      return { data: plan(), month: '2027-03' };
    case 'dec2027': {
      const data = plan();
      for (const person of data.people) {
        if (person.id === 'A' || person.id === 'G') person.startingCounts.festive = 4;
      }
      return { data, month: '2027-12' };
    }
    case 'jul2027': {
      const data = plan();
      putRange(data, '2027-07-05', '2027-07-09', 'B', 'DOV');
      putRange(data, '2027-07-12', '2027-07-16', 'B', 'DOV');
      putRange(data, '2027-07-12', '2027-07-16', 'D', 'DOV');
      putRange(data, '2027-07-19', '2027-07-23', 'D', 'DOV');
      putRange(data, '2027-07-19', '2027-07-23', 'G', 'DOV');
      putRange(data, '2027-07-26', '2027-07-30', 'G', 'DOV');
      return { data, month: '2027-07' };
    }
    case 'impossible': {
      const data = plan();
      for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
        putRange(data, '2027-02-13', '2027-02-14', id, 'x');
      }
      return { data, month: '2027-02' };
    }
    case 'pins': {
      const data = january();
      putRange(data, '2027-01-11', '2027-01-15', 'D', 'N', true);
      return { data, month: '2027-01' };
    }
    case 'monthEnd': {
      const data = january();
      for (const id of ['C', 'E', 'F']) put(data, '2027-02-01', id, 'x');
      put(data, '2027-02-01', 'D', 'DOV');
      return { data, month: '2027-01' };
    }
    case 'q1-2027':
      return { data: quarter(), month: '2027-01' };
    case 'claimed-holiday': {
      const data = plan();
      put(data, '2027-01-01', 'C', 'R12', true);
      return { data, month: '2027-01' };
    }
    case 'x-weekends': {
      const data = plan();
      for (const date of JANUARY_TWELVE_DAYS) if (date !== '2027-01-16') put(data, date, 'D', 'x');
      return { data, month: '2027-01' };
    }
    case 'doctor': {
      const data = plan();
      putDoctor(data, '2027-01-07', 'H', '8:00', '12:00');
      putDoctor(data, '2027-01-12', 'C', '8:00', '12:00');
      putDoctor(data, '2027-01-13', 'B', '15:00', '17:00');
      putDoctor(data, '2027-01-18', 'F', '9:00', '11:00');
      putDoctor(data, '2027-01-22', 'A', '15:00', '17:00');
      for (const date of ['2027-01-25', '2027-01-26', '2027-01-27', '2027-01-28', '2027-01-29']) {
        putDoctor(data, date, 'G', '15:00', '16:00');
      }
      return { data, month: '2027-01' };
    }
  }
}
