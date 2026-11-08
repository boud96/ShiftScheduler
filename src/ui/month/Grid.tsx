import { useRef } from 'react';
import type { DayInfo } from '../../domain/calendar';
import { CODE_NAMES, Code, WEEKDAY_CODES, isShift } from '../../domain/codes';
import type { MonthContext, MonthGrid } from '../../domain/context';
import { clock, fmtH, shortDate } from '../../domain/format';
import type { MonthEval } from '../../domain/rules/evaluate';
import { FPD_TOLERANCE } from '../../domain/rules/personMusts';
import type { Finding, PersonStats } from '../../domain/rules/types';
import type { AppData, ISODate, PersonId } from '../../domain/types';
import { MONTH_SCREEN, WEEKDAY_ABBREVIATIONS } from '../text';
import { CellMenu } from './CellMenu';
import type { MenuChoice } from './CellMenu';
import { cellId } from './ChecksPanel';
import type { Marks } from './ChecksPanel';

/** A cell of the grid: a person on a day. */
export interface CellRef {
  personId: PersonId;
  date: ISODate;
}

/** The class names that are set, as one `className`. */
function classes(...names: (string | false)[]): string {
  return names.filter(Boolean).join(' ');
}

/**
 * What is wrong with the days of the month, for the coverage row: the messages of rule M1 for each
 * day that has any, joined. The key is the day's index in `ctx.days`; a day that is not in the map
 * is covered.
 */
function problemsOf(findings: readonly Finding[]): Map<number, string> {
  const said = new Map<number, string[]>();
  for (const finding of findings) {
    if (finding.rule !== 'M1') continue;
    for (const day of finding.days) said.set(day, [...(said.get(day) ?? []), finding.message]);
  }
  return new Map([...said].map(([day, messages]) => [day, messages.join(', ')]));
}

/** The classes that the head, the cells and the coverage of a day share. */
function dayClasses(day: DayInfo): (string | false)[] {
  return [!day.inMonth && 'tail', day.dayType === 'twelve' && 'twelve'];
}

/**
 * The totals of a person: hours against FPD, overtime, 12-hour shifts, nights, each shift. The
 * hours are red when they are below FPD: the finding of that (M6) names no day, so it marks no
 * cell, and this figure is where it shows. It is below as M6 judges it, not by a rounding error.
 */
function Totals({ id, stats, fpd }: { id: PersonId; stats: PersonStats; fpd: number }) {
  const { totals } = MONTH_SCREEN;
  const shifts = WEEKDAY_CODES.map((code, k) => `${CODE_NAMES[code]} ${stats.perShift[k]}`);
  const below = fpd - stats.hours > FPD_TOLERANCE;
  return (
    <td className="month-totals" data-testid={`totals-${id}`}>
      <div className="month-totals-grid">
        <span title={totals.hours} className={classes(below && 'below-fpd')}>
          {`${fmtH(stats.hours)} / ${fmtH(fpd)}`}
        </span>{' '}
        <span title={totals.overtime}>{fmtH(stats.hours - fpd)}</span>{' '}
        <span title={totals.twelve}>{stats.twelve}</span>{' '}
        <span title={totals.nights}>{stats.nights}</span>{' '}
        <small className="month-totals-shifts">{shifts.join(' · ')}</small>
      </div>
    </td>
  );
}

interface GridProps {
  grid: MonthGrid;
  evaluation: MonthEval;
  /** The name of each person of `grid`, in its order. */
  names: readonly string[];
  /** What is stored: a pin is not part of the grid's rows. */
  cells: AppData['cells'];
  /** The doctor's notes: a note sits beside a cell and is not part of the grid's rows either. */
  doctor: AppData['doctor'];
  marks: Marks;
  /** The selected cell, and whether its menu is open. */
  selected: CellRef | null;
  menuOpen: boolean;
  onCell(cell: CellRef): void;
  onChoose(choice: MenuChoice): void;
  onCloseMenu(): void;
  /** The button in the name cell of a person was pressed: copy their row. */
  onCopyRow(personId: PersonId): void;
}

/**
 * The people and the days of the month as a table: a row for each person and a column for each
 * day, the last days of the previous month first. Each cell is a button that opens its menu. A
 * cell with a doctor's note has a small `L`, and the time of the note in its title. A cell with a
 * red outline is part of a broken must, one with an amber outline of the finding that is selected
 * in Kontrola. The totals of a person follow their row, and under the rows is the coverage of
 * each day. The name cell of a person holds a button that copies their row.
 */
export function Grid(props: GridProps) {
  const { grid, evaluation, names, cells, doctor, marks, selected, menuOpen } = props;
  const { onCell, onChoose, onCloseMenu, onCopyRow } = props;
  const { ctx } = grid;
  const problems = problemsOf(evaluation.findings);
  /** The button of the cell whose menu is open. */
  const anchor = useRef<HTMLButtonElement>(null);

  const isSelected = (personId: PersonId, date: ISODate) =>
    selected?.personId === personId && selected.date === date;

  const closeMenu = (restoreFocus: boolean) => {
    if (restoreFocus) anchor.current?.focus();
    onCloseMenu();
  };

  const renderCell = (p: number, i: number) => {
    const day = ctx.days[i];
    const personId = grid.personIds[p];
    const code = grid.rows[p][i];
    const pinned = isShift(code) && cells[day.date]?.[personId]?.pinned === true;
    const here = isSelected(personId, day.date);
    const open = here && menuOpen;
    const id = cellId(p, i);
    const note = doctor[day.date]?.[personId];
    const name = `${names[p]} · ${shortDate(day.date)}`;
    const title =
      note === undefined
        ? name
        : `${name} · ${MONTH_SCREEN.doctor.title(clock(note.from), clock(note.to))}`;
    return (
      <td key={day.date}>
        <button
          type="button"
          ref={open ? anchor : undefined}
          data-testid={`cell-${personId}-${day.date}`}
          data-code={code === Code.EMPTY ? undefined : CODE_NAMES[code]}
          title={title}
          aria-haspopup="menu"
          aria-expanded={open}
          className={classes(
            'month-cell',
            ...dayClasses(day),
            ctx.people[p].active[i] === 0 && 'inactive',
            marks.must.has(id) && 'must',
            marks.picked.has(id) && 'flagged',
            here && 'selected',
          )}
          onClick={() => onCell({ personId, date: day.date })}
        >
          {code === Code.EMPTY ? null : CODE_NAMES[code]}
          {pinned && <span className="month-pin">{MONTH_SCREEN.pinned}</span>}
          {note !== undefined && (
            <span className="month-doctor-marker">{MONTH_SCREEN.doctor.marker}</span>
          )}
        </button>
        {open && (
          <CellMenu
            anchor={anchor}
            label={name}
            dayType={day.dayType}
            pin={isShift(code) ? (pinned ? 'unpin' : 'pin') : null}
            doctor={note ?? null}
            onChoose={onChoose}
            onClose={closeMenu}
          />
        )}
      </td>
    );
  };

  const { totals, copyRow } = MONTH_SCREEN;
  return (
    <div className="month-grid-scroll">
      <table className="month-grid">
        <thead>
          <tr>
            <td className="month-person" />
            {ctx.days.map((day) => (
              <th
                key={day.date}
                scope="col"
                title={shortDate(day.date)}
                className={classes('month-day', ...dayClasses(day))}
              >
                <span className="month-weekday">{WEEKDAY_ABBREVIATIONS[day.weekday]}</span>{' '}
                <span className="month-daynum">{Number(day.date.slice(8))}</span>
              </th>
            ))}
            <th scope="col" className="month-totals">
              <div className="month-totals-grid">
                <span>{totals.hours}</span> <span>{totals.overtime}</span>{' '}
                <span>{totals.twelve}</span> <span>{totals.nights}</span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {grid.personIds.map((personId, p) => (
            <tr key={personId}>
              {/* The row is called after the person alone, not after the button inside it. */}
              <th
                scope="row"
                aria-label={names[p]}
                className={classes('month-person', marks.pickedPerson === p && 'flagged')}
              >
                <div className="month-person-box">
                  <span>{names[p]}</span>
                  <button
                    type="button"
                    className="month-copy"
                    title={copyRow.label(names[p])}
                    aria-label={copyRow.label(names[p])}
                    onClick={() => onCopyRow(personId)}
                  >
                    {copyRow.glyph}
                  </button>
                </div>
              </th>
              {ctx.days.map((_, i) => renderCell(p, i))}
              <Totals id={personId} stats={evaluation.persons[p]} fpd={ctx.people[p].fpd} />
            </tr>
          ))}
          <tr className="month-coverage">
            <th scope="row" className="month-person">
              {MONTH_SCREEN.coverage}
            </th>
            {ctx.days.map((day, i) => {
              const problem = problems.get(i);
              return (
                <td
                  key={day.date}
                  data-testid={`coverage-${day.date}`}
                  className={classes(
                    ...dayClasses(day),
                    problem !== undefined && 'short',
                    marks.pickedDays.has(i) && 'flagged',
                  )}
                >
                  {i < ctx.first ? null : (problem ?? MONTH_SCREEN.covered)}
                </td>
              );
            })}
            <td className="month-totals" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
