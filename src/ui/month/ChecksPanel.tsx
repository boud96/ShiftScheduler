import { useId } from 'react';
import type { MonthContext } from '../../domain/context';
import { shortDate } from '../../domain/format';
import type { Finding } from '../../domain/rules/types';
import { MONTH_SCREEN } from '../text';

/** One line of the list: a finding that is shown, the text of its line, and a key for it. */
export interface Check {
  /**
   * Names the finding for as long as it stands, so that a line that is selected stays selected
   * through edits that leave it be. Unique among the checks of a month.
   */
  key: string;
  finding: Finding;
  text: string;
}

/** What the grid marks for the findings. A cell is named by `cellId(person, day)`. */
export interface Marks {
  /** The cells of every broken must that names a person: they always have a red outline. */
  must: ReadonlySet<string>;
  /** The cells of the selected finding: they have an amber one. */
  picked: ReadonlySet<string>;
  /** The days of the selected finding, if it names no person: the coverage row marks them. */
  pickedDays: ReadonlySet<number>;
  /** The person of the selected finding, if it names one: their name is marked. */
  pickedPerson: number | null;
}

/** The name of a cell: `person` is an index in the grid's rows, `day` one in `ctx.days`. */
export const cellId = (person: number, day: number): string => `${person}:${day}`;

/** The dates of the days of the finding that lie in the month, as `D. M.`, in day order. */
function datesOf(finding: Finding, ctx: MonthContext): string[] {
  return finding.days
    .filter((day) => day >= ctx.first) // a day of the previous month is not shown as a date
    .sort((a, b) => a - b)
    .map((day) => shortDate(ctx.days[day].date));
}

/**
 * The text of the line of a finding. The dates come from its days, and only from there. A finding
 * about a person is `name · first date: message`. One about the whole team is
 * `every date: message`, the dates joined with commas. A finding with no day in the month has no
 * date: its line is the name and the message, or for the whole team the message alone.
 */
function lineOf(finding: Finding, ctx: MonthContext, names: readonly string[]): string {
  const dates = datesOf(finding, ctx);
  if (finding.person === null) {
    return dates.length === 0 ? finding.message : `${dates.join(', ')}: ${finding.message}`;
  }
  const name = names[finding.person];
  if (dates.length === 0) return `${name}: ${finding.message}`;
  return `${name} · ${dates[0]}: ${finding.message}`;
}

/**
 * The lines of the list for the findings of a month: those that are not quiet, the musts first,
 * then the strong wishes, then the other wishes, each group in the order of `findings`. `names`
 * are the people of `ctx`.
 */
export function checksOf(
  findings: readonly Finding[],
  ctx: MonthContext,
  names: readonly string[],
): Check[] {
  const seen = new Map<string, number>();
  const checks = findings
    .filter((finding) => finding.quiet !== true)
    .map((finding): Check => {
      const base = `${finding.rule}:${finding.person}:${finding.days.join(',')}:${finding.message}`;
      const times = seen.get(base) ?? 0;
      seen.set(base, times + 1);
      const key = times === 0 ? base : `${base}#${times}`;
      return { key, finding, text: lineOf(finding, ctx, names) };
    });
  const wishes = checks.filter((c) => c.finding.severity === 'wish');
  return [
    ...checks.filter((c) => c.finding.severity === 'must'),
    ...wishes.filter((c) => c.finding.strong === true),
    ...wishes.filter((c) => c.finding.strong !== true),
  ];
}

/** The marks for the grid: the cells of the musts, and those of the check with key `pickedKey`. */
export function marksOf(checks: readonly Check[], pickedKey: string | null): Marks {
  const must = new Set<string>();
  for (const { finding } of checks) {
    if (finding.severity !== 'must' || finding.person === null) continue;
    for (const day of finding.days) must.add(cellId(finding.person, day));
  }

  const picked = new Set<string>();
  const pickedDays = new Set<number>();
  let pickedPerson: number | null = null;
  const chosen = checks.find((c) => c.key === pickedKey)?.finding;
  if (chosen !== undefined) {
    const { person } = chosen;
    if (person === null) for (const day of chosen.days) pickedDays.add(day);
    else {
      pickedPerson = person;
      for (const day of chosen.days) picked.add(cellId(person, day));
    }
  }
  return { must, picked, pickedDays, pickedPerson };
}

/** How many of the checks are broken musts: the `Musí: N` of the panel. */
export const countMusts = (checks: readonly Check[]): number =>
  checks.filter((c) => c.finding.severity === 'must').length;

interface ChecksPanelProps {
  checks: readonly Check[];
  /** The key of the check that is selected, if one is. */
  picked: string | null;
  onPick(key: string): void;
}

/**
 * What the rules say about the month: the number of musts and of wishes, and a line for each. A
 * strong wish is a wish: it is counted with them and is amber like them, but its line is marked
 * (`data-strong`), and it comes before the others.
 */
export function ChecksPanel({ checks, picked, onPick }: ChecksPanelProps) {
  const headingId = useId();
  const musts = countMusts(checks);
  return (
    <section className="month-checks" aria-labelledby={headingId}>
      <h3 id={headingId}>{MONTH_SCREEN.checks}</h3>
      <p className="month-checks-summary">{MONTH_SCREEN.summary(musts, checks.length - musts)}</p>
      {checks.length > 0 && (
        <ul className="month-checks-list">
          {checks.map((check) => (
            <li key={check.key}>
              <button
                type="button"
                className="month-check"
                data-severity={check.finding.severity}
                data-strong={check.finding.strong || undefined}
                aria-pressed={check.key === picked}
                onClick={() => onPick(check.key)}
              >
                {check.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
