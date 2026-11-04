import { TAIL_DAYS, monthDays, tailDays } from './calendar';
import type { DayInfo } from './calendar';
import { Code, codeFromName, isAbsence, isShift, nameOf } from './codes';
import type { CodeInt } from './codes';
import { effectiveWeights } from './rules/weights';
import type {
  AppData,
  FairnessCounts,
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
  /** 1 on each day of `MonthContext.days` on which the person is in the team, 0 on the others. */
  active: Uint8Array;
  /** Fairness counts brought in from the months before. */
  history: FairnessCounts;
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

const contextDays = (month: MonthKey, settings: Settings): DayInfo[] => [
  ...tailDays(month, settings),
  ...monthDays(month, settings),
];

/**
 * The people who are in the team on at least one day of the month, in the order of `data.people`,
 * each with the days on which they are. The first and the last active day count as active.
 */
function membersOf(data: AppData, days: DayInfo[]): Member[] {
  const members: Member[] = [];
  for (const person of data.people) {
    const active = Uint8Array.from(days, ({ date }) =>
      (person.activeFrom === null || date >= person.activeFrom) &&
      (person.activeTo === null || date <= person.activeTo)
        ? 1
        : 0,
    );
    if (active.subarray(TAIL_DAYS).includes(1)) members.push({ person, active });
  }
  return members;
}

/**
 * Builds the engine's view of a month from the stored data. The context shares `settings`, and each
 * person's `prefs` and `startingCounts`, with `data`, so it must not be edited.
 *
 * A cell is fixed when it is a day of the previous month, holds x or an absence, is a pinned shift,
 * or lies on a day on which the person is not in the team. Whatever is stored on such a day stays
 * in the row, so that rule M3 can flag a shift there.
 */
export function buildMonthGrid(data: AppData, month: MonthKey): MonthGrid {
  const { settings } = data;
  const days = contextDays(month, settings);
  const adjustments = data.months[month]?.hoursAdjust;
  const people: EnginePerson[] = [];
  const rows: Uint8Array[] = [];
  const fixed: Uint8Array[] = [];

  for (const { person, active } of membersOf(data, days)) {
    const row = new Uint8Array(days.length);
    const locked = new Uint8Array(days.length);
    let weekdays = 0;
    days.forEach((day, i) => {
      const cell = data.cells[day.date]?.[person.id];
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
      if (day.inMonth && inTeam && day.weekday < 5) weekdays++;
    });
    people.push({
      id: person.id,
      prefs: person.prefs,
      fpd: weekdays * settings.fpdHoursPerWeekday + (adjustments?.[person.id] ?? 0),
      active,
      history: person.startingCounts,
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
