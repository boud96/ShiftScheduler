import type { WishId } from '../types';

/**
 * M1 coverage, M2 rest between shifts, M3 active period, M4 night before a request or absence,
 * M5 12-hour maximum, M6 FPD, M7 no nights, M8 day type, M9 days in a row, M10 days off after a
 * long run, M11 weekly rest.
 */
export type MustId =
  | 'M1'
  | 'M2'
  | 'M3'
  | 'M4'
  | 'M5'
  | 'M6'
  | 'M7'
  | 'M8'
  | 'M9'
  | 'M10'
  | 'M11';
export type RuleId = MustId | WishId;

/** One broken must or one unmet wish, with the text the team lead reads. */
export interface Finding {
  rule: RuleId;
  severity: 'must' | 'wish';
  /** The index in `ctx.people`, or null for a finding about a day or the whole team. */
  person: number | null;
  /** The cells involved, as indices in `ctx.days` (a tail day may be among them). */
  days: number[];
  message: string;
  /** What the finding adds to the score. */
  penalty: number;
  /** True: it only accounts for part of the score, and the checks list does not show it. */
  quiet?: boolean;
}

/** Receives each finding as it is found. Evaluating with no sink builds no findings and no text. */
export type Sink = (f: Finding) => void;

/** What the rules know about one person's month. Counts cover the days of the month only. */
export interface PersonStats {
  /** Hours credited: shifts at their hours, absences at `absenceHours`, a request nothing. */
  hours: number;
  /** R12 and N12. */
  twelve: number;
  /** N and N12. */
  nights: number;
  /** R12 and N12 on a public holiday. */
  holidayTwelve: number;
  /** Shifts of any kind on a festive day. */
  festive: number;
  /** R1, R2, O20, O, N. */
  perShift: [number, number, number, number, number];
  /** Units of the musts of this person: each HARD unit, plus one for being below FPD. */
  mustUnits: number;
}

/** What the rules know about one day of the month. */
export interface DayStats {
  /** People on R2 that day; always 0 on a 12-hour day, where R2 is not a shift. */
  r2: number;
  /** Units of M1: each missing and each extra person. */
  mustUnits: number;
}
