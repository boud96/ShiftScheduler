import { useMemo, useState } from 'react';
import { addMonths, fpdForMonth, weekdayCount } from '../../domain/calendar';
import { isShift, nameOf } from '../../domain/codes';
import type { CodeInt } from '../../domain/codes';
import { buildMonthGrid } from '../../domain/context';
import type { MonthGrid } from '../../domain/context';
import { fmtH } from '../../domain/format';
import { evaluateMonth } from '../../domain/rules/evaluate';
import type { MonthEval } from '../../domain/rules/evaluate';
import type { AppData, CodeName, MonthKey, StoredCell } from '../../domain/types';
import { useApp } from '../store';
import { MONTH_NAMES, MONTH_SCREEN } from '../text';
import type { MenuChoice } from './CellMenu';
import { ChecksPanel, checksOf, marksOf } from './ChecksPanel';
import type { Check } from './ChecksPanel';
import { Grid } from './Grid';
import type { CellRef } from './Grid';

/** The month after the one that today is in, by the local date: the one that is still to plan. */
function defaultMonth(): MonthKey {
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return addMonths(current, 1);
}

/** The month as the screen shows it: the grid made of the data, and what the rules say of it. */
interface MonthView {
  cells: AppData['cells'];
  grid: MonthGrid;
  evaluation: MonthEval;
  /** The name of each person of the grid, in its order. */
  names: string[];
  /** The lines of Kontrola. */
  checks: Check[];
  /** The line under the heading: FPD, working days, days with 12-hour shifts. */
  info: string;
  status: keyof typeof MONTH_SCREEN.status;
}

function buildView(data: AppData, month: MonthKey): MonthView {
  const grid = buildMonthGrid(data, month);
  const evaluation = evaluateMonth(grid.ctx, grid.rows, true);
  const byId = new Map(data.people.map((person) => [person.id, person.name]));
  const names = grid.personIds.map((id) => byId.get(id) ?? id);
  const twelveDays = grid.ctx.days.filter((day) => day.inMonth && day.dayType === 'twelve');
  const fpd = fmtH(fpdForMonth(month, data.settings));
  return {
    cells: data.cells,
    grid,
    evaluation,
    names,
    checks: checksOf(evaluation.findings, grid.ctx, names),
    info: MONTH_SCREEN.info(fpd, weekdayCount(month), twelveDays.length),
    // A month with nothing of its own stored is one that holds requests and nothing more.
    status: data.months[month]?.status ?? 'requests',
  };
}

/** What a pick from the menu stores. A shift is pinned: a manual edit means "keep this". */
function storedCell(code: CodeInt): StoredCell {
  const name = nameOf(code) as CodeName;
  return isShift(code) ? { code: name, pinned: true } : { code: name };
}

interface MonthScreenProps {
  /** The month to show first. The page leaves it out and gets the month after this one. */
  initialMonth?: MonthKey;
}

/**
 * The main screen: one month as a grid of people and days, with the checks of the rules under it.
 * An edit goes to the data, and the checks and totals follow it at once. The month, the selected
 * cell and the selected check are the screen's own state.
 */
export function MonthScreen({ initialMonth }: MonthScreenProps) {
  const { data, dispatch } = useApp();
  const [month, setMonth] = useState<MonthKey>(() => initialMonth ?? defaultMonth());
  /**
   * The cell that was clicked last, and whether its menu is open. The cell stays selected when the
   * menu closes. One state for both, so that a menu cannot be open on a cell that is not selected.
   */
  const [selection, setSelection] = useState<{ cell: CellRef; menuOpen: boolean } | null>(null);
  const selected = selection?.cell ?? null;
  const menuOpen = selection?.menuOpen ?? false;
  /** The key of the line of Kontrola that was clicked. */
  const [picked, setPicked] = useState<string | null>(null);

  // Building and evaluating a month is the work of the screen: only the data and the month are
  // allowed to start it, not a click that selects something.
  const view = useMemo(() => (data === null ? null : buildView(data, month)), [data, month]);
  const marks = useMemo(() => marksOf(view?.checks ?? [], picked), [view, picked]);
  if (view === null) return null;

  const show = (to: MonthKey) => {
    setMonth(to);
    setSelection(null);
    setPicked(null);
  };

  /** A click on a cell selects it and opens its menu; a click on the one that is open closes it. */
  const onCell = (cell: CellRef) => {
    const again = selected?.personId === cell.personId && selected.date === cell.date;
    setSelection({ cell, menuOpen: !(again && menuOpen) });
  };

  const closeMenu = () => setSelection((s) => (s === null ? null : { ...s, menuOpen: false }));

  const onChoose = (choice: MenuChoice) => {
    if (selected === null) return;
    const { date, personId } = selected;
    if (choice.type === 'pin') {
      dispatch({ type: 'togglePin', date, personId });
      return;
    }
    const cell = choice.type === 'clear' ? null : storedCell(choice.code);
    dispatch({ type: 'setCell', date, personId, cell });
  };

  const title = `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
  return (
    <section className="month-screen">
      <div className="month-head">
        <div className="month-nav">
          <button
            type="button"
            className="button"
            title={MONTH_SCREEN.previous}
            onClick={() => show(addMonths(month, -1))}
          >
            ◀
          </button>
          <h2>{title}</h2>
          <button
            type="button"
            className="button"
            title={MONTH_SCREEN.next}
            onClick={() => show(addMonths(month, 1))}
          >
            ▶
          </button>
        </div>
        <span className="month-status" data-state={view.status}>
          {MONTH_SCREEN.status[view.status]}
        </span>
        <p className="month-info">{view.info}</p>
      </div>
      <Grid
        grid={view.grid}
        evaluation={view.evaluation}
        names={view.names}
        cells={view.cells}
        marks={marks}
        selected={selected}
        menuOpen={menuOpen}
        onCell={onCell}
        onChoose={onChoose}
        onCloseMenu={closeMenu}
      />
      <ChecksPanel
        checks={view.checks}
        picked={picked}
        onPick={(key) => setPicked(picked === key ? null : key)}
      />
    </section>
  );
}
