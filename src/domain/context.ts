import { TAIL_DAYS, addDays, monthDays, tailDays } from './calendar';
import type { DayInfo } from './calendar';
import { Code, codeFromName, isAbsence, isShift, nameOf } from './codes';
import type { CodeInt } from './codes';
import { addCounts, historyCounts, isClaimed } from './history';
import { effectiveWeights } from './rules/weights';
import type {
  AppData,
  FairnessCounts,
  ISODate,
  MonthKey,
  Person,
  PersonId,
  Preferences,
  Settings,
  WishId,
} from './types';

/** One person as the rule engine sees them in a month. */
export interface EnginePerson {
  id: PersonId;
  prefs: Preferences;
  /** The hours to reach: active Mon-Fri days times the daily hours, plus the month's adjustment. */
  fpd: number;
  /**
   * The most 12-hour shifts the person may have in the month: their own limit if they have one,
   * else the general maximum of the settings. Claimed holiday shifts do not count toward it.
   */
  maxTwelve: number;
  /** The most nights (N and N12) the person may have in the month; null means no limit. */
  maxNights: number | null;
  /** 1 on each day of `MonthContext.days` on which the person is in the team, 0 on the others. */
  active: Uint8Array;
  /**
   * 1 on each day of `MonthContext.days` on which the person has a claimed holiday shift (see
   * `isClaimed`: a pinned R12 or N12 on a public holiday), 0 on the others.
   */
  claimed: Uint8Array;
  /**
   * The start and the end of the person's doctor's appointment on each day of `MonthContext.days`,
   * in minutes from midnight, or -1 on a day without one. The two arrays are set on the same days.
   */
  doctorFrom: Int16Array;
  doctorTo: Int16Array;
  /**
   * Fairness counts brought in from the months before: the starting counts of the person plus the
   * counts of the earlier planned months in the fairness window (see `historyCounts`).
   */
  history: FairnessCounts;
  /**
   * The code stored for the person on day 1 of the next month, the day after the last of
   * `MonthContext.days`. It is read only and no cell of the rows: the rules that pair a day with
   * the day after it (M2, M4) read it for the pair that the last day of the month makes. It is
   * `Code.EMPTY` when nothing is stored there, and when the person is not in the team on that day.
   */
  nextDay: CodeInt;
}

/** Everything the rule engine needs about one month, apart from the cells themselves. */
export interface MonthContext {
  month: MonthKey;
  /** The last TAIL_DAYS days of the previous month, then every day of the month. */
  days: DayInfo[];
  /** The index in `days` of day 1 of the month. */
  first: number;
  people: EnginePerson[];
  settings: Settings;
  weights: Record<WishId, number>;
}

/** A month as a grid of codes: one row per person, one column per day of `ctx.days`. */
export interface MonthGrid {
  ctx: MonthContext;
  rows: Uint8Array[];
  /** 1 on each cell the generator must not change and `applyRows` does not write. */
  fixed: Uint8Array[];
  /** The person of each row. */
  personIds: PersonId[];
}

interface Member {
  person: Person;
  active: Uint8Array;
}

/** What `EnginePerson.doctorFrom` and `doctorTo` hold on a day without a doctor's appointment. */
const NO_NOTE = -1;

const contextDays = (month: MonthKey, settings: Settings): DayInfo[] => [
  ...tailDays(month, settings),
  ...monthDays(month, settings),
];

/** Whether the person is in the team on `date`. The first and the last active day count. */
function activeOn(person: Person, date: ISODate): boolean {
  return (
    (person.activeFrom === null || date >= person.activeFrom) &&
    (person.activeTo === null || date <= person.activeTo)
  );
}

/**
 * The people who are in the team on at least one day of the month, in the order of `data.people`,
 * each with the days on which they are. The first and the last active day count as active.
 */
function membersOf(data: AppData, days: DayInfo[]): Member[] {
  const members: Member[] = [];
  for (const person of data.people) {
    const active = Uint8Array.from(days, ({ date }) => (activeOn(person, date) ? 1 : 0));
    if (active.subarray(TAIL_DAYS).includes(1)) members.push({ person, active });
  }
  return members;
}

/**
 * Builds the engine's view of a month from the stored data. The context shares `settings`, and each
 * person's `prefs`, with `data`, so it must not be edited.
 *
 * A cell is fixed when it is a day of the previous month, holds x or an absence, is a pinned shift,
 * or lies on a day on which the person is not in the team. Whatever is stored on such a day stays
 * in the row, so that rule M3 can flag a shift there.
 *
 * What is stored for a person on day 1 of the next month goes to `EnginePerson.nextDay`, outside
 * the rows: the month's last day is judged against it, and no move can change it.
 *
 * Beside the rows, each person carries what the rules need to know of them: their limits, the days
 * of their claimed holiday shifts, their doctor's notes, and the fairness counts of the months
 * before (their starting counts plus the earlier planned months of the file, drafts included).
 */
export function buildMonthGrid(data: AppData, month: MonthKey): MonthGrid {
  const { settings } = data;
  const days = contextDays(month, settings);
  const dayAfter = addDays(days[days.length - 1].date, 1);
  const adjustments = data.months[month]?.hoursAdjust;
  const people: EnginePerson[] = [];
  const rows: Uint8Array[] = [];
  const fixed: Uint8Array[] = [];

  for (const { person, active } of membersOf(data, days)) {
    const row = new Uint8Array(days.length);
    const locked = new Uint8Array(days.length);
    const claimed = new Uint8Array(days.length);
    const doctorFrom = new Int16Array(days.length).fill(NO_NOTE);
    const doctorTo = new Int16Array(days.length).fill(NO_NOTE);
    let weekdays = 0;
    days.forEach((day, i) => {
      const cell = data.cells[day.date]?.[person.id];
      const note = data.doctor[day.date]?.[person.id];
      const code = codeFromName(cell?.code ?? '') ?? Code.EMPTY;
      const inTeam = active[i] === 1;
      row[i] = code;
      locked[i] =
        !day.inMonth ||
        !inTeam ||
        code === Code.X ||
        isAbsence(code) ||
        (isShift(code) && cell?.pinned === true)
          ? 1
          : 0;
      claimed[i] = isClaimed(cell, day) ? 1 : 0;
      if (note !== undefined) {
        doctorFrom[i] = note.from;
        doctorTo[i] = note.to;
      }
      if (day.inMonth && inTeam && day.weekday < 5) weekdays++;
    });
    const next = activeOn(person, dayAfter) ? data.cells[dayAfter]?.[person.id] : undefined;
    people.push({
      id: person.id,
      prefs: person.prefs,
      fpd: weekdays * settings.fpdHoursPerWeekday + (adjustments?.[person.id] ?? 0),
      maxTwelve: person.maxTwelve ?? settings.maxTwelvePerMonth,
      maxNights: person.maxNights,
      active,
      claimed,
      doctorFrom,
      doctorTo,
      history: addCounts(person.startingCounts, historyCounts(data, month, person.id)),
      nextDay: codeFromName(next?.code ?? '') ?? Code.EMPTY,
    });
    rows.push(row);
    fixed.push(locked);
  }

  return {
    ctx: {
      month,
      days,
      first: TAIL_DAYS,
      people,
      settings,
      weights: effectiveWeights(settings.wishLevels),
    },
    rows,
    fixed,
    personIds: people.map((p) => p.id),
  };
}

/**
 * Stores `rows` in a copy of `data`: every month cell that is not fixed gets the code in `rows`,
 * a shift without a pin and an empty cell as no cell at all. `rows` and `fixed` come from
 * `buildMonthGrid(data, month)`, with `rows` changed since. The input is not modified.
 */
export function applyRows(
  data: AppData,
  month: MonthKey,
  rows: Uint8Array[],
  fixed: Uint8Array[],
): AppData {
  const days = contextDays(month, data.settings);
  const members = membersOf(data, days);
  const cells = { ...data.cells };

  for (let i = TAIL_DAYS; i < days.length; i++) {
    const date = days[i].date;
    const day = { ...cells[date] };
    members.forEach(({ person }, p) => {
      if (fixed[p][i] === 1) return;
      const name = nameOf(rows[p][i] as CodeInt);
      if (name === null) delete day[person.id];
      else day[person.id] = { code: name };
    });
    if (Object.keys(day).length > 0) cells[date] = day;
    else delete cells[date];
  }

  return { ...data, cells };
}
