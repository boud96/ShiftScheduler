import { useEffect, useRef, useState } from 'react';
import { Code } from '../../domain/codes';
import { buildMonthGrid } from '../../domain/context';
import type { MonthGrid } from '../../domain/context';
import type { MonthKey } from '../../domain/types';
import type { SearchProgress } from '../../generator/search';
import type { GeneratorRunner } from '../../worker/runner';
import { useApp } from '../store';

/** The most iterations a run may do. The time budget ends it long before. */
const MAX_ITERATIONS = 50_000_000;

/** How the last run ended, and which month it was for. */
export type GeneratorOutcome =
  | { kind: 'done'; month: MonthKey; mustUnits: number }
  | { kind: 'failed'; month: MonthKey; message: string };

export interface Generator {
  /** True from `start` until the run has ended and its draft is in the data. */
  running: boolean;
  /** The latest report of the run, or null before the first. */
  progress: SearchProgress | null;
  /** How much of the time given to the run has gone, 0 to 100. It is 0 before the first report. */
  percent: number;
  /** How the last run ended, until the next one starts. Null when there is none to tell of. */
  outcome: GeneratorOutcome | null;
  /**
   * Starts a run for `month` on a draft of its own. It does nothing while a run goes on, and for a
   * month with nobody in the team. The draft goes to `month`, whichever month is shown by then.
   */
  start(month: MonthKey): void;
  /** Asks the run to end now. It still ends as any run does, with the best month found so far. */
  stop(): void;
}

/** A run that is going on, as far as the hook has to deal with it. */
interface ActiveRun {
  /** `loads` when the run began: the count of replacements of the data that it belongs to. */
  loads: number;
  stop(): void;
  /** Stops the search, has whatever it reports or ends with from now on ignored, and lets go. */
  discard(): void;
}

/** What the screen shows of the generator. It belongs to the data that was there at the start. */
interface Shown {
  loads: number;
  running: boolean;
  /** The time given to the run, in ms. */
  budgetMs: number;
  progress: SearchProgress | null;
  outcome: GeneratorOutcome | null;
}

const NOTHING: Shown = { loads: 0, running: false, budgetMs: 0, progress: null, outcome: null };

/** A seed for the search: a random whole number from 0 to 2^32 - 1. */
const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0];

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Empties the cells of the month that the search may change, so that it builds a fresh draft. */
function clearFreeCells({ ctx, rows, fixed }: MonthGrid): void {
  rows.forEach((row, p) => {
    for (let i = ctx.first; i < row.length; i++) {
      if (fixed[p][i] === 0) row[i] = Code.EMPTY;
    }
  });
}

/** The share of `budgetMs` that the run has used by its latest report, from 0 to 100. */
function percentOf(progress: SearchProgress | null, budgetMs: number): number {
  if (progress === null) return 0;
  const percent = Math.round((progress.elapsedMs / budgetMs) * 100);
  return Number.isNaN(percent) ? 0 : Math.min(100, Math.max(0, percent));
}

/**
 * Runs the generator for the Month screen, one run at a time. A run gets a month as
 * `buildMonthGrid` gives it, with the cells that are free emptied, a random seed and the time that
 * the settings allow, and its draft is stored for the month it began on. What the run found is
 * matched to people by id and written only into cells that were free at the start and still are,
 * so edits made while it goes on are kept.
 *
 * A run belongs to the data it began on. When the data is replaced (a file is opened, a new plan is
 * started), or the screen goes away, the search is stopped and nothing it ends with is used.
 */
export function useGenerator(): Generator {
  const { data, dispatch, runner, loads } = useApp();
  const [shown, setShown] = useState(NOTHING);
  const active = useRef<ActiveRun | null>(null);

  // A run belongs to the data it began on. Once that has been replaced there is nowhere for its
  // draft to go, so the search is stopped and nothing it ends with is used. A run that began after
  // the replacement, but before this effect ran, has the current count and is left alone.
  useEffect(() => {
    if (active.current !== null && active.current.loads !== loads) active.current.discard();
  }, [loads]);

  // With the screen gone, there is nobody to show the run to.
  useEffect(
    () => () => {
      active.current?.discard();
    },
    [],
  );

  const start = (month: MonthKey): void => {
    if (data === null || active.current !== null) return;
    const grid = buildMonthGrid(data, month);
    if (grid.rows.length === 0) return;
    clearFreeCells(grid);
    const { ctx, rows, fixed, personIds } = grid;
    const seed = randomSeed();
    const budgetMs = data.settings.generatorTimeBudgetSec * 1000;
    const began = loads;
    const end = (outcome: GeneratorOutcome): void =>
      setShown({ loads: began, running: false, budgetMs, progress: null, outcome });

    let discarded = false;
    let handle: ReturnType<GeneratorRunner>;
    try {
      handle = runner(
        { ctx, rows, fixed, seed, maxIterations: MAX_ITERATIONS, timeBudgetMs: budgetMs },
        (progress) => {
          if (!discarded) setShown((was) => ({ ...was, progress }));
        },
      );
    } catch (e) {
      end({ kind: 'failed', month, message: messageOf(e) });
      return;
    }

    /** The run is over, or dropped: no run goes on now. */
    const release = (): void => {
      active.current = null;
    };
    const run: ActiveRun = {
      loads: began,
      stop: () => handle.stop(),
      discard() {
        discarded = true;
        release();
        handle.stop();
      },
    };
    active.current = run;
    setShown({ loads: began, running: true, budgetMs, progress: null, outcome: null });

    handle.result
      .then((result) => {
        if (discarded) return;
        release();
        // The count says which data the draft is for: if that has been replaced, it is dropped.
        dispatch(
          {
            type: 'applyGenerated',
            month,
            rows: result.rows,
            fixed,
            seed,
            personIds,
            generatedAt: new Date().toISOString(),
          },
          began,
        );
        end({ kind: 'done', month, mustUnits: result.mustUnits });
      })
      .catch((e: unknown) => {
        if (discarded) return;
        release();
        end({ kind: 'failed', month, message: messageOf(e) });
      });
  };

  const stop = (): void => active.current?.stop();

  const current = shown.loads === loads ? shown : NOTHING;
  return {
    running: current.running,
    progress: current.progress,
    percent: percentOf(current.progress, current.budgetMs),
    outcome: current.outcome,
    start,
    stop,
  };
}
