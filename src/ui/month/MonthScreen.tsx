import { useEffect, useMemo, useRef, useState } from 'react';
import { copyText } from '../../clipboard/copy';
import { personRowTsv } from '../../clipboard/tsv';
import type { PastePlan } from '../../clipboard/tsv';
import { addMonths, fpdForMonth, weekdayCount } from '../../domain/calendar';
import { isShift, nameOf } from '../../domain/codes';
import type { CodeInt } from '../../domain/codes';
import { buildMonthGrid } from '../../domain/context';
import type { MonthGrid } from '../../domain/context';
import { fmtH } from '../../domain/format';
import { evaluateMonth } from '../../domain/rules/evaluate';
import type { MonthEval } from '../../domain/rules/evaluate';
import type { AppData, CodeName, MonthKey, PersonId, StoredCell } from '../../domain/types';
import { useApp } from '../store';
import { MONTH_NAMES, MONTH_SCREEN } from '../text';
import type { MenuChoice } from './CellMenu';
import { ChecksPanel, checksOf, countMusts, marksOf } from './ChecksPanel';
import type { Check } from './ChecksPanel';
import { Grid } from './Grid';
import type { CellRef } from './Grid';
import { PasteDialog } from './PasteDialog';
import type { PasteStart } from './PasteDialog';
import { useGenerator } from './useGenerator';
import type { GeneratorControls, GeneratorOutcome } from './useGenerator';

/** The month after the one that today is in, by the local date: the one that is still to plan. */
function defaultMonth(): MonthKey {
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return addMonths(current, 1);
}

/** The month as the screen shows it: the grid made of the data, and what the rules say of it. */
interface MonthView {
  cells: AppData['cells'];
  doctor: AppData['doctor'];
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
    doctor: data.doctor,
    grid,
    evaluation,
    names,
    checks: checksOf(evaluation.findings, grid.ctx, names),
    info: MONTH_SCREEN.info(fpd, weekdayCount(month), twelveDays.length),
    // A month with nothing of its own stored is one that holds requests and nothing more.
    status: data.months[month]?.status ?? 'requests',
  };
}

interface GenerateControlsProps {
  generator: GeneratorControls;
  /** The month that is shown. */
  month: MonthKey;
  /** Whether the month has anybody to plan: with nobody there is nothing to generate. */
  hasPeople: boolean;
  /** The broken musts that Kontrola lists for the month now: what a finished run says it left. */
  musts: number;
}

/** The line that tells how a run ended: empty while there is nothing to tell. */
function outcomeLine(outcome: GeneratorOutcome | null, musts: number): string {
  const { generate } = MONTH_SCREEN;
  if (outcome === null) return '';
  return outcome.kind === 'done' ? generate.done(musts) : generate.failed;
}

/**
 * The button that starts the generator and what goes with a run: the time spent and the button
 * that stops it, then how it ended. The run is the screen's, whichever month is shown, but how it
 * ended is told only with the month it was for. A finished run says how many musts Kontrola of
 * the month lists now, not what the search counted when it ended: the same number as `Musí: N`,
 * whatever has been edited since the run began.
 */
function GenerateControls({ generator, month, hasPeople, musts }: GenerateControlsProps) {
  const { generate } = MONTH_SCREEN;
  const told = generator.outcome?.month === month ? generator.outcome : null;
  return (
    <div className="month-generate">
      <button
        type="button"
        className="button button-primary"
        disabled={generator.running || !hasPeople}
        onClick={() => generator.start(month)}
      >
        {generate.start}
      </button>
      {generator.running && (
        <>
          <span className="month-generate-progress">{generate.running(generator.percent)}</span>
          <button type="button" className="button" onClick={generator.stop}>
            {generate.stop}
          </button>
        </>
      )}
      {/* A live region, so that how a run ended is read out; the progress is left out of it. */}
      <span
        className="month-generate-outcome"
        role="status"
        data-failed={told?.kind === 'failed' || undefined}
      >
        {outcomeLine(told, musts)}
      </span>
    </div>
  );
}

/** What a pick from the menu stores. A shift is pinned: a manual edit means "keep this". */
function storedCell(code: CodeInt): StoredCell {
  const name = nameOf(code) as CodeName;
  return isShift(code) ? { code: name, pinned: true } : { code: name };
}

/**
 * Where a paste from Excel starts: at the selected cell, a day of the previous month included, or
 * else at the first person of the grid on day 1 of the month. A selected cell of a person who is no
 * longer in the grid counts for nothing. Null for a month with nobody in the team.
 */
function pasteStart(view: MonthView, selected: CellRef | null): PasteStart | null {
  const { personIds, ctx } = view.grid;
  const at = selected === null ? -1 : personIds.indexOf(selected.personId);
  if (selected !== null && at >= 0) {
    return { personId: selected.personId, name: view.names[at], date: selected.date };
  }
  if (personIds.length === 0) return null;
  return { personId: personIds[0], name: view.names[0], date: ctx.days[ctx.first].date };
}

/** How long the note after a copy stays, in ms. */
const NOTE_MS = 4000;

/** What the note after a copy says. `id` is new for each, so that the same words are read again. */
interface CopyNote {
  id: number;
  text: string;
  failed: boolean;
}

interface MonthScreenProps {
  /** The month to show first. The page leaves it out and gets the month after this one. */
  initialMonth?: MonthKey;
}

/**
 * The main screen: one month as a grid of people and days, with the checks of the rules under it.
 * An edit goes to the data, and the checks and totals follow it at once. The month, the selected
 * cell and the selected check are the screen's own state, and so are the paste dialog (`Vložit z
 * Excelu`, which starts at the selected cell) and the note that tells how the last copy of a row
 * went.
 */
export function MonthScreen({ initialMonth }: MonthScreenProps) {
  const { data, dispatch } = useApp();
  const generator = useGenerator();
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
  /** Whether the dialog that pastes from Excel is open, and the button that opened it. */
  const [pasting, setPasting] = useState(false);
  const pasteButton = useRef<HTMLButtonElement>(null);
  /** How the last copy of a row went, until NOTE_MS have passed or the next one replaces it. */
  const [copyNote, setCopyNote] = useState<CopyNote | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(noteTimer.current), []);

  // Building and evaluating a month is the work of the screen: only the data and the month are
  // allowed to start it, not a click that selects something.
  const view = useMemo(() => (data === null ? null : buildView(data, month)), [data, month]);
  const marks = useMemo(() => marksOf(view?.checks ?? [], picked), [view, picked]);
  if (view === null || data === null) return null;

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
    if (choice.type === 'doctor') {
      dispatch({ type: 'setDoctor', date, personId, note: choice.note });
      return;
    }
    const cell = choice.type === 'clear' ? null : storedCell(choice.code);
    dispatch({ type: 'setCell', date, personId, cell });
  };

  const closePaste = () => {
    setPasting(false);
    pasteButton.current?.focus();
  };

  const onPaste = (plan: PastePlan) => {
    dispatch({ type: 'applyPaste', plan });
    closePaste();
  };

  /** Copies the row of a person as the page shows it, and tells how that went. */
  const onCopyRow = (personId: PersonId) => {
    const { copied, failed } = MONTH_SCREEN.copyRow;
    // The copy starts here, within the click: a browser lets it through only for a fresh click.
    void copyText(personRowTsv(data, month, personId)).then((ok) => {
      setCopyNote((was) => ({ id: (was?.id ?? 0) + 1, text: ok ? copied : failed, failed: !ok }));
      clearTimeout(noteTimer.current);
      noteTimer.current = setTimeout(() => setCopyNote(null), NOTE_MS);
    });
  };

  const start = pasting ? pasteStart(view, selected) : null;
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
        <div className="month-actions">
          <button
            type="button"
            className="button"
            ref={pasteButton}
            disabled={view.grid.rows.length === 0}
            onClick={() => setPasting(true)}
          >
            {MONTH_SCREEN.paste.open}
          </button>
          <GenerateControls
            generator={generator}
            month={month}
            hasPeople={view.grid.rows.length > 0}
            musts={countMusts(view.checks)}
          />
        </div>
      </div>
      <Grid
        grid={view.grid}
        evaluation={view.evaluation}
        names={view.names}
        cells={view.cells}
        doctor={view.doctor}
        marks={marks}
        selected={selected}
        menuOpen={menuOpen}
        onCell={onCell}
        onChoose={onChoose}
        onCloseMenu={closeMenu}
        onCopyRow={onCopyRow}
      />
      <ChecksPanel
        checks={view.checks}
        picked={picked}
        onPick={(key) => setPicked(picked === key ? null : key)}
      />
      {start !== null && (
        <PasteDialog
          data={data}
          month={month}
          start={start}
          onApply={onPaste}
          onClose={closePaste}
        />
      )}
      {/* A live region that is always there, so that what is put into it is read out. */}
      <div className="month-note" role="status">
        {copyNote !== null && (
          <span key={copyNote.id} data-failed={copyNote.failed || undefined}>
            {copyNote.text}
          </span>
        )}
      </div>
    </section>
  );
}
