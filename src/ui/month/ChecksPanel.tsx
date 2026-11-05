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

/**
 * The text of the line of a finding: the date of the first of its days that lies in the month (a
 * tail day is not shown as the date), then the message. A finding about a person has their name
 * before the date, and one about the whole team has no name. A finding with no day in the month
 * has no date: its line is the name and the message, or for the whole team the message alone.
 */
function lineOf(finding: Finding, ctx: MonthContext, names: readonly string[]): string {
  const day = finding.days.find((d) => d >= ctx.first);
  const date = day === undefined ? null : shortDate(ctx.days[day].date);
  if (finding.person === null) {
    return date === null ? finding.message : `${date}: ${finding.message}`;
  }
  const name = names[finding.person];
  return date === null ? `${name}: ${finding.message}` : `${name} · ${date}: ${finding.message}`;
}

/**
 * The lines of the list for the findings of a month: those that are not quiet, the musts first,
 * then the wishes, each group in the order of `findings`. `names` are the people of `ctx`.
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
  return [
    ...checks.filter((c) => c.finding.severity === 'must'),
    ...checks.filter((c) => c.finding.severity === 'wish'),
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

interface ChecksPanelProps {
  checks: readonly Check[];
  /** The key of the check that is selected, if one is. */
  picked: string | null;
  onPick(key: string): void;
}

/** What the rules say about the month: the number of musts and of wishes, and a line for each. */
export function ChecksPanel({ checks, picked, onPick }: ChecksPanelProps) {
  const headingId = useId();
  const musts = checks.filter((c) => c.finding.severity === 'must').length;
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
