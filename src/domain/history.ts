import { addMonths, monthDays } from './calendar';
import type { DayInfo } from './calendar';
import { Code, codeFromName, isNight, isShift, isTwelveShift } from './codes';
import type { AppData, FairnessCounts, MonthKey, PersonId, StoredCell } from './types';

const noCounts = (): FairnessCounts => ({ twelve: 0, nights: 0, holidayTwelve: 0, festive: 0 });

/** The sum of two sets of counts, field by field. */
export function addCounts(a: FairnessCounts, b: FairnessCounts): FairnessCounts {
  return {
    twelve: a.twelve + b.twelve,
    nights: a.nights + b.nights,
    holidayTwelve: a.holidayTwelve + b.holidayTwelve,
    festive: a.festive + b.festive,
  };
}

/**
 * Whether `cell`, the cell of a person on `day`, is a claimed holiday shift: an R12 or N12 that is
 * pinned, on a public holiday. Before a quarter the team lead asks who wants which holiday and
 * enters that shift for that person, and a shift entered by hand is pinned, so the pin is the
 * claim. A claimed shift is extra: it counts toward neither the minimum of weekend shifts nor the
 * maximum of 12-hour shifts, and not as a 12-hour shift in the fairness counts.
 *
 * A holiday on a Saturday or a Sunday is claimed the same way. It is the public holiday that
 * counts (`day.holiday`), not the type of the day, which the settings can override.
 */
export function isClaimed(cell: StoredCell | undefined, day: DayInfo): boolean {
  if (cell === undefined || cell.pinned !== true || !day.holiday) return false;
  const code = codeFromName(cell.code);
  return code !== null && isTwelveShift(code);
}

/**
 * The counts that W7 balances, for one person over the days of `month`. They are read from the
 * stored cells, so a draft counts as much as a finished month:
 *
 * - `twelve`: R12 and N12, but not a claimed holiday shift;
 * - `nights`: N and N12;
 * - `holidayTwelve`: R12 and N12 on a public holiday, claimed or not;
 * - `festive`: a shift of any kind on a festive day.
 *
 * Like the counts of a month being planned, they take every stored shift of the month, whether or
 * not the person was in the team that day.
 */
export function monthCounts(data: AppData, month: MonthKey, personId: PersonId): FairnessCounts {
  const counts = noCounts();
  for (const day of monthDays(month, data.settings)) {
    const cell = data.cells[day.date]?.[personId];
    const code = codeFromName(cell?.code ?? '') ?? Code.EMPTY;
    if (!isShift(code)) continue;
    if (day.festive) counts.festive++;
    if (isNight(code)) counts.nights++;
    if (isTwelveShift(code)) {
      if (day.holiday) counts.holidayTwelve++;
      if (!isClaimed(cell, day)) counts.twelve++;
    }
  }
  return counts;
}

/**
 * What the person has already worked, as far as W7 is concerned, when `month` is planned: the sum
 * of `monthCounts` over the `settings.fairnessWindowMonths` months before `month`. Every month of
 * the window counts as stored, a draft too, and one that has no record in `data.months` as well.
 * The starting counts of the person are not in it.
 */
export function historyCounts(data: AppData, month: MonthKey, personId: PersonId): FairnessCounts {
  let total = noCounts();
  for (let back = 1; back <= data.settings.fairnessWindowMonths; back++) {
    total = addCounts(total, monthCounts(data, addMonths(month, -back), personId));
  }
  return total;
}
