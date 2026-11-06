// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { Code } from '../../domain/codes';
import { buildMonthGrid } from '../../domain/context';
import type { AppData, CodeName, ISODate, MonthKey, PersonId } from '../../domain/types';
import type { SearchProgress, SearchResult } from '../../generator/search';
import { memoryStorage } from '../../storage/adapter';
import type { StorageAdapter } from '../../storage/adapter';
import { scenario } from '../../test/scenarios';
import { inProcessRunner } from '../../worker/runner';
import type { GeneratorInput, GeneratorRunner } from '../../worker/runner';
import { AppProvider, useApp } from '../store';
import { MonthScreen } from './MonthScreen';
import { useGenerator } from './useGenerator';
import type { GeneratorControls } from './useGenerator';

// A warning from React, or an error from jsdom, would end up in the output: the tests fail on it.
let errors: MockInstance;

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  const calls = [...errors.mock.calls];
  vi.restoreAllMocks(); // the spies
  vi.useRealTimers(); // the clock that a test has set
  expect(calls).toEqual([]);
});

/** The latest value of `useApp()`: a test reads what the screen stored through it. */
let app: ReturnType<typeof useApp>;

function Probe() {
  app = useApp();
  return null;
}

const stored = () => app.data as AppData;

/** One run that a test holds in its hands: the test reports progress and ends it. */
interface Run {
  input: GeneratorInput;
  /** How many times the screen asked it to stop. */
  stops: number;
  report(progress?: Partial<SearchProgress>): void;
  /** Ends it with a result: by default the rows it was given, as they were. */
  finish(result?: Partial<SearchResult>): void;
  fail(error: unknown): void;
}

/** A runner that searches nothing. `runs` holds each run it was asked for, in order. */
function controlledRunner() {
  const runs: Run[] = [];
  const runner: GeneratorRunner = (input, onProgress) => {
    let resolve!: (result: SearchResult) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<SearchResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const run: Run = {
      input,
      stops: 0,
      report: (progress) =>
        onProgress({
          iteration: 20_000,
          bestScore: 100,
          bestMustUnits: 0,
          elapsedMs: 0,
          temperature: 40,
          ...progress,
        }),
      finish: (found) =>
        resolve({ rows: input.rows, score: 0, mustUnits: 0, iterations: 20_000, ...found }),
      fail: (error) => reject(error),
    };
    runs.push(run);
    return {
      result,
      stop() {
        run.stops++;
      },
    };
  };
  return { runner, runs };
}

interface RenderOptions {
  month?: MonthKey;
  /** Where the data comes from: by default a memory storage holding `data`. */
  storage?: StorageAdapter;
  strict?: boolean;
}

function renderMonth(
  data: AppData,
  runner: GeneratorRunner = inProcessRunner,
  { month = '2027-01', storage = memoryStorage(data), strict = false }: RenderOptions = {},
) {
  const tree = (
    <AppProvider storage={storage} runner={runner}>
      <MonthScreen initialMonth={month} />
      <Probe />
    </AppProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** January 2027 with the made-up team, a draft run of `seconds` long. */
function january(seconds = 20): AppData {
  const { data } = scenario('jan2027');
  data.settings.generatorTimeBudgetSec = seconds;
  return data;
}

/** Stores `code` for `person` on `date`. */
function put(data: AppData, date: ISODate, person: PersonId, code: CodeName, pinned = false) {
  (data.cells[date] ??= {})[person] = pinned ? { code, pinned } : { code };
}

const generate = () => screen.getByRole('button', { name: 'Vygenerovat' });
const stopButton = () => screen.queryByRole('button', { name: 'Zastavit' });
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
const cell = (person: PersonId, date: ISODate) => screen.getByTestId(`cell-${person}-${date}`);
const next = () => userEvent.click(screen.getByText('▶'));
const previous = () => userEvent.click(screen.getByText('◀'));
const click = (button: HTMLElement) => userEvent.click(button);

/** The number of broken musts that Kontrola of the shown month states, as `Musí: N`. */
const kontrolaMusts = (): number =>
  Number(/^Musí: (\d+)/.exec(screen.getByText(/^Musí: \d+/).textContent ?? '')?.[1]);

/**
 * The line that tells a run is done, with the number that it states. That number is the one of
 * Kontrola, `Musí: N`, as it stands now: the test checks they are one.
 */
function doneLine(): { line: HTMLElement; musts: number } {
  const line = screen.getByText(/^Hotovo\. Porušená pravidla: \d+$/);
  const musts = Number(/(\d+)$/.exec(line.textContent ?? '')?.[1]);
  expect(musts).toBe(kontrolaMusts());
  return { line, musts };
}

/** What a failed run says. What went wrong is in the console (the `errors` spy), not on the page. */
const FAILED = 'Generování se nepodařilo.';

/** The index in a row of `ctx.days` of `date`, for the run that was started. */
const dayIndex = (input: GeneratorInput, date: ISODate) =>
  input.ctx.days.findIndex((day) => day.date === date);

/** Rows as a run gives them back, with the cell of `person` on `date` set to `code`. */
function withCell(input: GeneratorInput, person: PersonId, date: ISODate, code: number) {
  const rows = input.rows.map((row) => row.slice());
  const p = input.ctx.people.findIndex((who) => who.id === person);
  rows[p][dayIndex(input, date)] = code;
  return rows;
}

// --- The brief's test --------------------------------------------------------------------------

describe('the brief', () => {
  it('generates a draft in a run of its own, keeping the requests', async () => {
    renderMonth(january(1));
    await click(generate());
    await screen.findByText(/Hotovo/, {}, { timeout: 15_000 });
    expect(screen.getByText('Návrh')).toHaveClass('month-status');
    expect(screen.getByTestId('coverage-2027-01-04')).toHaveTextContent('✓');
    expect(cell('A', '2027-01-01')).toHaveTextContent('x');
    expect(generate()).toBeEnabled();
    expect(stopButton()).toBeNull();
  }, 30_000);
});

// --- Starting a run --------------------------------------------------------------------------

describe('starting a run', () => {
  it('offers Vygenerovat, enabled, and no progress or result before there is a run', () => {
    renderMonth(january());
    expect(generate()).toBeEnabled();
    expect(stopButton()).toBeNull();
    expect(screen.queryByText(/Generuji/)).toBeNull();
    expect(screen.queryByText(/Hotovo/)).toBeNull();
  });

  it('hands the runner the month as it is: a draft built around what is fixed', async () => {
    const data = january(7);
    put(data, '2027-01-05', 'C', 'R1'); // a shift that is not pinned: the run starts it afresh
    put(data, '2027-01-06', 'D', 'O', true); // pinned
    put(data, '2027-01-07', 'E', 'DOV');
    const { runner, runs } = controlledRunner();
    renderMonth(data, runner);
    await click(generate());

    expect(runs).toHaveLength(1);
    const { input } = runs[0];
    const grid = buildMonthGrid(data, '2027-01');
    expect(input.ctx).toEqual(grid.ctx);
    expect(input.fixed).toEqual(grid.fixed);
    expect(input.maxIterations).toBe(50_000_000);
    expect(input.timeBudgetMs).toBe(7000);

    const at = (person: PersonId, date: ISODate) =>
      input.rows[grid.personIds.indexOf(person)][dayIndex(input, date)];
    expect(at('C', '2027-01-05')).toBe(Code.EMPTY); // cleared
    expect(at('D', '2027-01-06')).toBe(Code.O); // the pin stays
    expect(at('E', '2027-01-07')).toBe(Code.DOV);
    expect(at('A', '2027-01-01')).toBe(Code.X);
    expect(at('C', '2026-12-29')).toBe(Code.O); // the tail stays, as does everything fixed
    // Nothing is left in a cell that is free, and every cell that is fixed is as it was.
    input.rows.forEach((row, p) =>
      row.forEach((code, i) => {
        if (i >= input.ctx.first && grid.fixed[p][i] === 0) expect(code).toBe(Code.EMPTY);
        else expect(code).toBe(grid.rows[p][i]);
      }),
    );
  });

  it('seeds the run with a random 32-bit number from the browser', async () => {
    const fill = (values: Uint32Array) => {
      values[0] = 0xdeadbeef; // above 2^31: a signed read would turn it negative
      return values;
    };
    const random = vi
      .spyOn(crypto, 'getRandomValues')
      .mockImplementation(fill as typeof crypto.getRandomValues);
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    await click(generate());
    expect(random).toHaveBeenCalled();
    expect(runs[0].input.seed).toBe(0xdeadbeef);
  });

  it('takes the time of the run from the settings', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(12), runner);
    await click(generate());
    expect(runs[0].input.timeBudgetMs).toBe(12_000);
  });

  it('runs one at a time: Vygenerovat is off, here and on every other month', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    await click(generate());
    expect(generate()).toBeDisabled();
    await click(generate());
    await next();
    expect(heading()).toBe('Únor 2027');
    expect(generate()).toBeDisabled();
    await click(generate());
    expect(runs).toHaveLength(1);
  });

  it('starts the run for the month that is shown, and puts the draft there', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    await next();
    expect(heading()).toBe('Únor 2027');
    await click(generate());
    expect(runs[0].input.ctx.month).toBe('2027-02');
    const rows = withCell(runs[0].input, 'C', '2027-02-02', Code.R1);
    await act(async () => runs[0].finish({ rows }));
    expect(stored().cells['2027-02-02']?.C).toEqual({ code: 'R1' });
    expect(stored().months['2027-02']?.status).toBe('draft');
    expect(stored().months['2027-01']).toBeUndefined();
    expect(screen.getByText(/^Hotovo/)).toBeInTheDocument();
  });

  it('is off for a month with nobody in the team, and starts nothing', async () => {
    const data = january();
    data.people = [];
    const { runner, runs } = controlledRunner();
    renderMonth(data, runner);
    expect(generate()).toBeDisabled();
    await click(generate());
    expect(runs).toHaveLength(0);
  });

  it('is off for a month that everybody has left, on again for one they are in', async () => {
    const data = january();
    for (const person of data.people) person.activeTo = '2027-01-31';
    const { runner } = controlledRunner();
    renderMonth(data, runner);
    expect(generate()).toBeEnabled();
    await next();
    expect(generate()).toBeDisabled();
    await previous();
    expect(generate()).toBeEnabled();
  });
});

// --- While it runs -------------------------------------------------------------------------

describe('while a run goes on', () => {
  it('shows 0 % with a Zastavit button, before the first report', async () => {
    const { runner } = controlledRunner();
    renderMonth(january(), runner);
    await click(generate());
    expect(screen.getByText('Generuji… 0 %')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zastavit' })).toBeEnabled();
    expect(screen.queryByText(/Hotovo/)).toBeNull();
  });

  it.each([
    { elapsedMs: 0, percent: 0 },
    { elapsedMs: 5_000, percent: 25 },
    { elapsedMs: 1_234, percent: 6 },
    { elapsedMs: 1_299, percent: 6 },
    { elapsedMs: 1_300, percent: 7 }, // 6.5 rounds up
    { elapsedMs: 20_000, percent: 100 },
    { elapsedMs: 31_000, percent: 100 }, // the time is over, the run is still ending
    { elapsedMs: -5_000, percent: 0 }, // a clock that went back
  ])('counts $elapsedMs ms of 20 s as $percent per cent', async ({ elapsedMs, percent }) => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(20), runner);
    await click(generate());
    act(() => runs[0].report({ elapsedMs }));
    expect(screen.getByText(`Generuji… ${percent} %`)).toBeInTheDocument();
  });

  it('counts the time against the budget the run began with, not the one set since', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(20), runner);
    await click(generate());
    act(() => app.dispatch({ type: 'updateSettings', patch: { generatorTimeBudgetSec: 10 } }));
    act(() => runs[0].report({ elapsedMs: 5_000 }));
    expect(screen.getByText('Generuji… 25 %')).toBeInTheDocument();
  });

  it('shows the run on every month, and keeps it when the month changes', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    await click(generate());
    act(() => runs[0].report({ elapsedMs: 10_000 }));
    await next();
    expect(screen.getByText('Generuji… 50 %')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zastavit' })).toBeInTheDocument();
  });

  it('asks the run to stop on Zastavit, and goes on showing it until the run answers', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    await click(generate());
    await click(screen.getByRole('button', { name: 'Zastavit' }));
    expect(runs[0].stops).toBe(1);
    expect(screen.getByText(/Generuji/)).toBeInTheDocument();
    expect(generate()).toBeDisabled();
  });

  it('applies the best month so far when the run answers a stop, like a run that finished', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    await click(generate());
    await click(screen.getByRole('button', { name: 'Zastavit' }));
    const rows = withCell(runs[0].input, 'C', '2027-01-04', Code.R1);
    await act(async () => runs[0].finish({ rows, mustUnits: 4 }));
    expect(doneLine().musts).not.toBe(4); // Kontrola's count, not the search's
    expect(cell('C', '2027-01-04')).toHaveTextContent(/^R1$/);
    expect(generate()).toBeEnabled();
    expect(stopButton()).toBeNull();
  });
});

// --- When it ends ----------------------------------------------------------------------------

describe('when a run ends', () => {
  it('stores the draft: the cells, the status, the seed and the time of the end', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-04T08:00:00.000Z'));
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    await click(generate());
    vi.setSystemTime(new Date('2027-01-04T08:00:20.000Z'));
    const rows = withCell(runs[0].input, 'C', '2027-01-04', Code.R1);
    await act(async () => runs[0].finish({ rows, mustUnits: 3 }));

    expect(stored().cells['2027-01-04']?.C).toEqual({ code: 'R1' }); // a shift that is not pinned
    expect(stored().months['2027-01']).toEqual({
      status: 'draft',
      seed: runs[0].input.seed,
      generatedAt: '2027-01-04T08:00:20.000Z',
    });
    expect(screen.getByText('Návrh')).toBeInTheDocument();
    expect(doneLine().line).not.toHaveAttribute('data-failed');
    expect(generate()).toBeEnabled();
  });

  it('keeps the requests, the absences and the pins of the month', async () => {
    const data = january();
    put(data, '2027-01-06', 'D', 'O', true);
    const { runner, runs } = controlledRunner();
    renderMonth(data, runner);
    await click(generate());
    await act(async () => runs[0].finish());
    expect(stored().cells['2027-01-01']?.A).toEqual({ code: 'x' });
    expect(stored().cells['2027-01-01']?.B).toEqual({ code: 'DOV' });
    expect(stored().cells['2027-01-06']?.D).toEqual({ code: 'O', pinned: true });
  });

  it('puts the draft on the month it was started on, even when another is shown by then', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    await click(generate());
    await next();
    expect(runs[0].input.ctx.month).toBe('2027-01');
    const rows = withCell(runs[0].input, 'C', '2027-01-04', Code.R1);
    await act(async () => runs[0].finish({ rows, mustUnits: 1 }));

    expect(stored().cells['2027-01-04']?.C).toEqual({ code: 'R1' });
    expect(stored().months['2027-01']?.status).toBe('draft');
    expect(stored().months['2027-02']).toBeUndefined();
    expect(heading()).toBe('Únor 2027');
    expect(screen.getByText('Žádosti')).toBeInTheDocument(); // February is still only requests
    expect(screen.queryByText(/Hotovo/)).toBeNull();
    expect(generate()).toBeEnabled();
  });

  it('shows the result with its month, and until the next run starts', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    await click(generate());
    await act(async () => runs[0].finish({ mustUnits: 2 }));
    const { musts } = doneLine();

    await next();
    expect(screen.queryByText(/Hotovo/)).toBeNull();
    await previous();
    expect(doneLine().musts).toBe(musts);

    await click(generate());
    expect(screen.queryByText(/Hotovo/)).toBeNull();
    expect(screen.getByText(/Generuji/)).toBeInTheDocument();
    await act(async () => runs[1].finish({ mustUnits: 0 }));
    expect(doneLine().musts).toBeGreaterThan(0); // the search's 0 is not what it says
  });

  describe('the number of broken musts that it states', () => {
    it('is the number of Kontrola for the month, not the count of the search', async () => {
      const { runner, runs } = controlledRunner();
      renderMonth(january(), runner);
      await click(generate());
      // The search reports 3 units of musts. Kontrola lists a gap for each shift of each day.
      await act(async () => runs[0].finish({ mustUnits: 3 }));
      const { musts } = doneLine();
      expect(musts).not.toBe(3);
      expect(musts).toBeGreaterThan(100);
    });

    it('counts the data as it is when the run ends, with the edits made during the run', async () => {
      const { runner, runs } = controlledRunner();
      renderMonth(january(), runner);
      await click(generate());
      const atStart = kontrolaMusts();
      // R12 on a Monday and a Tuesday, pinned as the menu of a cell pins: each is a must broken
      // (M8). The run keeps these cells.
      const pinned = { code: 'R12', pinned: true } as const;
      act(() => app.dispatch({ type: 'setCell', date: '2027-01-04', personId: 'C', cell: pinned }));
      act(() => app.dispatch({ type: 'setCell', date: '2027-01-05', personId: 'D', cell: pinned }));
      await act(async () => runs[0].finish({ mustUnits: atStart }));
      expect(stored().cells['2027-01-04']?.C).toEqual(pinned);
      expect(doneLine().musts).toBe(kontrolaMusts());
      expect(kontrolaMusts()).not.toBe(atStart);
    });

    it('follows Kontrola when the plan is edited after the run, and is the number of its month', async () => {
      const { runner, runs } = controlledRunner();
      renderMonth(january(), runner);
      await click(generate());
      await act(async () => runs[0].finish());
      const { musts } = doneLine();

      act(() => app.dispatch({ type: 'setCell', date: '2027-01-04', personId: 'C', cell: { code: 'R12' } }));
      expect(doneLine().musts).toBe(musts + 1); // M8, and nothing else changes
      await next(); // February has its own count, and the line is not shown there
      expect(screen.queryByText(/Hotovo/)).toBeNull();
      await previous();
      expect(doneLine().musts).toBe(musts + 1);
    });

    it('is 0 when Kontrola lists no broken must', async () => {
      const data = january();
      data.settings.fpdHoursPerWeekday = 0; // nobody is short of hours
      for (const range of Object.values(data.settings.coverage)) {
        range.min = 0;
        range.max = null;
      }
      const { runner, runs } = controlledRunner();
      renderMonth(data, runner);
      await click(generate());
      await act(async () => runs[0].finish({ mustUnits: 7 }));
      expect(screen.getByText('Hotovo. Porušená pravidla: 0')).toBeInTheDocument();
      expect(kontrolaMusts()).toBe(0);
    });
  });

  it('can run again, each time with a seed of its own and a fresh draft', async () => {
    const random = vi.spyOn(crypto, 'getRandomValues');
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    await click(generate());
    const rows = withCell(runs[0].input, 'C', '2027-01-04', Code.R1);
    await act(async () => runs[0].finish({ rows }));
    expect(stored().cells['2027-01-04']?.C).toEqual({ code: 'R1' });

    await click(generate());
    expect(runs).toHaveLength(2);
    expect(random).toHaveBeenCalledTimes(2);
    // The second run does not start from the first draft: the cell it wrote is empty again.
    expect(runs[1].input.rows[2][dayIndex(runs[1].input, '2027-01-04')]).toBe(Code.EMPTY);
  });

  it('applies nothing, says that it failed and allows a new run when the run fails', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    const before = stored();
    await click(generate());
    const error = new Error('boom');
    await act(async () => runs[0].fail(error));

    const failure = screen.getByText(FAILED);
    expect(failure).toHaveAttribute('data-failed'); // the red of a failure
    expect(screen.queryByText(/boom/)).toBeNull(); // what went wrong is for the console
    expect(errors.mock.calls).toEqual([[expect.stringContaining('generator'), error]]); // in the console
    errors.mockClear();
    expect(stored()).toBe(before);
    expect(screen.queryByText(/Hotovo/)).toBeNull();
    expect(screen.queryByText(/Generuji/)).toBeNull();
    expect(stopButton()).toBeNull();
    expect(generate()).toBeEnabled();

    await click(generate());
    expect(screen.queryByText(FAILED)).toBeNull(); // gone with the next run
    expect(runs).toHaveLength(2);
  });

  it('says the same, in Czech, for a failure that is not an Error or has an English message', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    await click(generate());
    await act(async () => runs[0].fail('no luck'));
    expect(screen.getByText(FAILED)).toBeInTheDocument();
    expect(screen.queryByText(/no luck/)).toBeNull();
    expect(errors.mock.calls).toEqual([[expect.any(String), 'no luck']]); // in the console
    errors.mockClear();

    await click(generate());
    await act(async () => runs[1].fail(new Error('The generator worker stopped unexpectedly.')));
    expect(screen.getByText(FAILED)).toBeInTheDocument();
    expect(screen.queryByText(/worker/)).toBeNull();
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockClear();
  });

  it('fails the same way when the runner cannot start a run at all', async () => {
    const error = new DOMException('Blocked by policy.', 'SecurityError');
    const runner: GeneratorRunner = () => {
      throw error;
    };
    renderMonth(january(), runner);
    const before = stored();
    await click(generate());
    expect(screen.getByText(FAILED)).toBeInTheDocument();
    expect(screen.queryByText(/Blocked/)).toBeNull();
    expect(errors.mock.calls).toEqual([[expect.any(String), error]]);
    errors.mockClear();
    expect(generate()).toBeEnabled();
    expect(stored()).toBe(before);
  });
});

// --- Edits during the run ---------------------------------------------------------------------

describe('edits made while a run goes on', () => {
  it('keeps a cell that was edited meanwhile', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    await click(generate());
    const pinned = { code: 'O', pinned: true } as const;
    act(() => app.dispatch({ type: 'setCell', date: '2027-01-04', personId: 'C', cell: pinned }));
    const rows = withCell(runs[0].input, 'C', '2027-01-04', Code.R1);
    await act(async () => runs[0].finish({ rows }));
    expect(stored().cells['2027-01-04']?.C).toEqual({ code: 'O', pinned: true });
  });

  it('does not bring back a request that was cleared meanwhile', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    await click(generate());
    act(() => app.dispatch({ type: 'setCell', date: '2027-01-01', personId: 'A', cell: null }));
    await act(async () => runs[0].finish()); // its rows still hold the x
    expect(stored().cells['2027-01-01']?.A).toBeUndefined();
  });

  it('matches the draft to the people it was made for, not to the team as it is by then', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner);
    await click(generate());
    act(() => app.dispatch({ type: 'removePerson', personId: 'A' })); // every row moves up
    const rows = withCell(runs[0].input, 'B', '2027-01-05', Code.R2);
    await act(async () => runs[0].finish({ rows }));
    expect(stored().cells['2027-01-05']?.B).toEqual({ code: 'R2' });
    expect(cell('B', '2027-01-05')).toHaveTextContent(/^R2$/);
  });
});

// --- The data is replaced -----------------------------------------------------------------------

describe('when the data is replaced during a run', () => {
  /** The run's draft, to tell it apart in the data if it were ever written. */
  const draft = (input: GeneratorInput) => withCell(input, 'C', '2027-01-04', Code.R1);

  /** A storage whose file picker gives `opened`. */
  function storageOpening(opened: AppData): StorageAdapter {
    const storage = memoryStorage(january());
    storage.openFile = async () => opened;
    return storage;
  }

  /** Starts a run, replaces the data with `replace`, and has the dropped search answer anyway. */
  async function dropRun(storage: StorageAdapter, replace: () => Promise<void> | void) {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner, { storage });
    await click(generate());
    expect(runs[0].stops).toBe(0);

    await act(async () => {
      await replace();
    });
    expect(runs[0].stops).toBe(1);
    expect(screen.queryByText(/Generuji/)).toBeNull();
    expect(stopButton()).toBeNull();
    expect(generate()).toBeEnabled();

    // A search that is stopped still answers with its best month. It goes nowhere.
    const replacement = stored();
    await act(async () => runs[0].finish({ rows: draft(runs[0].input), mustUnits: 1 }));
    expect(stored()).toBe(replacement);
    expect(screen.queryByText(/Hotovo/)).toBeNull();
    expect(screen.queryByText('Návrh')).toBeNull();
  }

  it('drops the run when a file is opened: the search is stopped and nothing is applied', async () => {
    await dropRun(storageOpening(january()), () => app.openFile());
  });

  it('drops the run when a new plan is started, too', async () => {
    await dropRun(memoryStorage(january()), () => app.newData());
  });

  it('drops a result that arrives before the screen has seen the new data', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner, { storage: storageOpening(january()) });
    await click(generate());

    await act(async () => {
      await app.openFile();
      runs[0].finish({ rows: draft(runs[0].input), mustUnits: 1 }); // before React draws again
    });
    expect(stored().cells['2027-01-04']?.C).toBeUndefined();
    expect(stored().months['2027-01']).toBeUndefined();
    expect(screen.queryByText(/Hotovo/)).toBeNull();
    expect(generate()).toBeEnabled();
  });

  it('forgets the result of an earlier run', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner, { storage: storageOpening(january()) });
    await click(generate());
    await act(async () => runs[0].finish({ mustUnits: 2 }));
    expect(doneLine().line).toBeInTheDocument();
    await act(() => app.openFile());
    expect(screen.queryByText(/Hotovo/)).toBeNull();
  });

  it('starts a run on the new data as on any other', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner, { storage: storageOpening(january(9)) });
    await click(generate());
    await act(() => app.openFile());
    await click(generate());
    expect(runs).toHaveLength(2);
    expect(runs[1].input.timeBudgetMs).toBe(9000);
    await act(async () => runs[1].finish({ rows: draft(runs[1].input), mustUnits: 5 }));
    expect(doneLine().line).toBeInTheDocument();
    expect(stored().cells['2027-01-04']?.C).toEqual({ code: 'R1' });
  });

  describe('and another run has started since', () => {
    /** Drops a run, starts another, and lets the dropped search report once, as it stops. */
    async function secondRun() {
      const { runner, runs } = controlledRunner();
      renderMonth(january(), runner, { storage: storageOpening(january()) });
      await click(generate());
      await act(() => app.openFile());
      await click(generate());
      expect(runs).toHaveLength(2);
      act(() => runs[0].report({ elapsedMs: 15_000 }));
      expect(screen.getByText('Generuji… 0 %')).toBeInTheDocument();
      return runs;
    }

    /** The second run goes on as if the first had not been heard from: it can still be stopped. */
    async function expectSecondRunIntact(runs: Awaited<ReturnType<typeof secondRun>>) {
      expect(screen.queryByText(/Hotovo/)).toBeNull();
      expect(screen.queryByText(/Generování se nepodařilo/)).toBeNull();
      expect(stored().cells['2027-01-04']?.C).toBeUndefined();
      act(() => runs[1].report({ elapsedMs: 4_000 }));
      expect(screen.getByText('Generuji… 20 %')).toBeInTheDocument();
      expect(generate()).toBeDisabled();
      await click(screen.getByRole('button', { name: 'Zastavit' }));
      expect(runs[1].stops).toBe(1);
    }

    it('takes nothing more from the dropped run when it ends', async () => {
      const runs = await secondRun();
      await act(async () => runs[0].finish({ rows: draft(runs[0].input), mustUnits: 9 }));
      await expectSecondRunIntact(runs);
    });

    it('takes nothing more from the dropped run when it fails', async () => {
      const runs = await secondRun();
      await act(async () => runs[0].fail(new Error('late')));
      await expectSecondRunIntact(runs);
    });
  });

  it('does not touch a run that started after the new data came in', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner, { storage: storageOpening(january()) });
    await act(() => app.openFile());
    await click(generate());
    expect(runs[0].stops).toBe(0);
    expect(screen.getByText(/Generuji/)).toBeInTheDocument();
  });
});

// --- The screen goes away -------------------------------------------------------------------

describe('when the screen goes away during a run', () => {
  function Hideable({ runner }: { runner: GeneratorRunner }) {
    const [shown, setShown] = useState(true);
    return (
      <AppProvider storage={memoryStorage(january())} runner={runner}>
        <button type="button" onClick={() => setShown(false)}>
          Skrýt
        </button>
        {shown && <MonthScreen initialMonth="2027-01" />}
        <Probe />
      </AppProvider>
    );
  }

  it('stops the search and applies nothing', async () => {
    const { runner, runs } = controlledRunner();
    render(<Hideable runner={runner} />);
    await click(generate());
    const before = stored();
    await click(screen.getByRole('button', { name: 'Skrýt' }));
    expect(runs[0].stops).toBe(1);

    const rows = withCell(runs[0].input, 'C', '2027-01-04', Code.R1);
    await act(async () => runs[0].finish({ rows }));
    expect(stored()).toBe(before);
  });

  it('takes no more progress and no failure either', async () => {
    const { runner, runs } = controlledRunner();
    render(<Hideable runner={runner} />);
    await click(generate());
    const before = stored();
    await click(screen.getByRole('button', { name: 'Skrýt' }));
    act(() => runs[0].report({ elapsedMs: 1000 }));
    await act(async () => runs[0].fail(new Error('late')));
    expect(stored()).toBe(before);
  });
});

// --- The hook by itself ---------------------------------------------------------------------

describe('useGenerator', () => {
  let generator: GeneratorControls;

  function GeneratorProbe() {
    generator = useGenerator();
    return null;
  }

  function renderHook(data: AppData, runner: GeneratorRunner) {
    return render(
      <AppProvider storage={memoryStorage(data)} runner={runner}>
        <GeneratorProbe />
        <Probe />
      </AppProvider>,
    );
  }

  it('is idle until a run starts', () => {
    const { runner } = controlledRunner();
    renderHook(january(), runner);
    expect(generator).toMatchObject({ running: false, progress: null, percent: 0, outcome: null });
  });

  it('gives the latest report as progress, and none once the run has ended', async () => {
    const { runner, runs } = controlledRunner();
    renderHook(january(20), runner);
    act(() => generator.start('2027-01'));
    expect(generator).toMatchObject({ running: true, progress: null, percent: 0 });
    act(() => runs[0].report({ iteration: 40_000, elapsedMs: 4_000, bestMustUnits: 2 }));
    expect(generator.progress).toMatchObject({ iteration: 40_000, elapsedMs: 4_000 });
    expect(generator.progress?.bestMustUnits).toBe(2);
    expect(generator.percent).toBe(20);
    await act(async () => runs[0].finish({ mustUnits: 1 }));
    expect(generator).toMatchObject({ running: false, progress: null });
    // how many musts are broken is for the screen to say, from the data as it is then
    expect(generator.outcome).toEqual({ kind: 'done', month: '2027-01' });
  });

  it('starts one run however often it is asked in a row', () => {
    const { runner, runs } = controlledRunner();
    renderHook(january(), runner);
    act(() => {
      generator.start('2027-01');
      generator.start('2027-01');
      generator.start('2027-02');
    });
    expect(runs).toHaveLength(1);
    expect(generator.running).toBe(true);
  });

  it('starts nothing for a month with nobody in the team', () => {
    const data = january();
    data.people = [];
    const { runner, runs } = controlledRunner();
    renderHook(data, runner);
    act(() => generator.start('2027-01'));
    expect(runs).toHaveLength(0);
    expect(generator.running).toBe(false);
  });

  it('does nothing on stop() when no run goes on', () => {
    const { runner, runs } = controlledRunner();
    renderHook(january(), runner);
    expect(() => act(() => generator.stop())).not.toThrow();
    expect(runs).toHaveLength(0);
  });

  it('works under StrictMode too: one run, one result', async () => {
    const { runner, runs } = controlledRunner();
    renderMonth(january(), runner, { strict: true });
    await click(generate());
    expect(runs).toHaveLength(1);
    const rows = withCell(runs[0].input, 'C', '2027-01-04', Code.R1);
    await act(async () => runs[0].finish({ rows }));
    expect(stored().cells['2027-01-04']?.C).toEqual({ code: 'R1' });
    expect(stored().months['2027-01']?.status).toBe('draft');
    expect(screen.getByText(/Hotovo/)).toBeInTheDocument();
  });

  it('stops the run on stop(), and only that run', async () => {
    const { runner, runs } = controlledRunner();
    renderHook(january(), runner);
    act(() => generator.start('2027-01'));
    act(() => generator.stop());
    expect(runs[0].stops).toBe(1);
    await act(async () => runs[0].finish());
    act(() => generator.stop()); // the run is over
    expect(runs[0].stops).toBe(1);
  });
});

// --- With the real search, in this page --------------------------------------------------------

describe('with the search itself', () => {
  it('stops on Zastavit with the best month so far, as if it had finished', async () => {
    renderMonth(january(20));
    await click(generate());
    await click(await screen.findByRole('button', { name: 'Zastavit' }));
    await screen.findByText(/Hotovo\. Porušená pravidla: \d+/, {}, { timeout: 15_000 });
    expect(screen.getByText('Návrh')).toBeInTheDocument();
    expect(generate()).toBeEnabled();
    expect(stopButton()).toBeNull();
    expect(cell('A', '2027-01-01')).toHaveTextContent('x');
  }, 30_000);

  it('shows the time spent rising while it searches', async () => {
    renderMonth(january(1));
    await click(generate());
    await screen.findByText(/Generuji… [1-9]\d* %/, {}, { timeout: 15_000 });
    await screen.findByText(/Hotovo/, {}, { timeout: 15_000 });
  }, 30_000);
});
