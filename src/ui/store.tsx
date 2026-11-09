import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { newAppData } from '../domain/defaults';
import type { AppData } from '../domain/types';
import type { StorageAdapter } from '../storage/adapter';
import { SaveFileError } from '../storage/saveFile';
import type { GeneratorRunner } from '../worker/runner';
import { reduce } from './reducer';
import type { Action } from './reducer';
import { FILE_ERRORS } from './text';

/** How long a change waits for the next one before it goes to the file. */
const FILE_DELAY_MS = 1000;

type Timer = ReturnType<typeof setTimeout>;

export interface FileStatus {
  /** The name of the file the data goes to, if there is one. */
  name: string | null;
  /** When the data was last saved to the file, or opened from it, as an ISO time. */
  savedAt: string | null;
  /**
   * True when the file may lack changes. It is true for a new plan, and for data the page started
   * with, since nothing says that a file holds them. It is not true while changes are written to
   * the file by themselves.
   */
  dirty: boolean;
  /** True when changes are written to the file by themselves. */
  auto: boolean;
}

export interface AppStore {
  /** The plan, or null until the user opens a file or starts a new one. */
  data: AppData | null;
  /**
   * Applies the action. Given `ifLoads` (the `loads` that the store had when the work that the
   * action belongs to began), it does so only while the data has not been replaced since: an action
   * for data that is gone is dropped, so a late result never lands in another file.
   */
  dispatch(action: Action, ifLoads?: number): void;
  /**
   * How many times the data has been replaced since the page started: by every file that is opened,
   * every new plan and any other `load`. Work begun on some data that ends later, such as a run of
   * the generator, reads it at its start and treats a change as "my data is gone". It starts at 0.
   */
  loads: number;
  file: FileStatus;
  /** Lets the user pick a save file and replaces the data with it. Never rejects. */
  openFile(): Promise<void>;
  /** Saves to the file, or downloads it where the browser cannot write to one. Never rejects. */
  saveFile(): Promise<void>;
  /**
   * Lets the user pick a file, saves to it and keeps saving there; the file before stays as it
   * was. Downloads where the browser cannot write to a file. Never rejects.
   */
  saveFileAs(): Promise<void>;
  /** Starts a new plan with placeholder people. */
  newData(): void;
  /** What went wrong with the last open or save, in Czech, or null. */
  error: string | null;
  dismissError(): void;
  runner: GeneratorRunner;
}

const AppContext = createContext<AppStore | null>(null);

export function useApp(): AppStore {
  const store = useContext(AppContext);
  if (store === null) throw new Error('useApp() needs an AppProvider above it.');
  return store;
}

/** A cancelled picker: the browser rejects it with an AbortError. */
function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError';
}

/** What to tell the user about a failed open or save, or null if they only cancelled. */
function messageFor(e: unknown, fallback: string): string | null {
  if (isAbort(e)) return null;
  return e instanceof SaveFileError ? e.message : fallback;
}

interface AppProviderProps {
  storage: StorageAdapter;
  runner: GeneratorRunner;
  children: ReactNode;
}

/**
 * Holds the plan and where it is saved. The save file is the only store: where the file can be
 * written to without asking, every change goes to it after 1 s. Elsewhere the changes are marked
 * as not in the file. At most one write to the file runs at a time; a change that comes in during
 * one is written after it, with the latest data.
 *
 * A page that holds changes made since it was opened (or since the data last matched a file) that
 * no file has yet asks the browser to confirm before it is closed or reloaded. Data the page
 * started with (`storage.startData`, which only tests hand in) is marked as not in a file too, but
 * it is no change of this session: that alone does not ask.
 */
export function AppProvider({ storage, runner, children }: AppProviderProps) {
  const [initial] = useState(() => {
    const data = storage.startData();
    const file: FileStatus = {
      name: storage.fileName(),
      savedAt: null,
      dirty: data !== null,
      auto: storage.canAutoSave(),
    };
    return { data, file };
  });
  const [data, setData] = useState(initial.data);
  const [file, setFile] = useState(initial.file);
  const [error, setError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);

  // Timers and writes outlive the render that started them, so they read from these.
  const latest = useRef(initial.data);
  /** The count of replacements as of now, where `loads` is as of the last render. */
  const replacements = useRef(0);
  /** Whether changes made in this session are not in a file: what leaving the page would lose. */
  const unsaved = useRef(false);
  const timers = useRef<{ file?: Timer }>({});
  const writes = useRef({
    /** Ends when every write so far has. */
    last: Promise.resolve() as Promise<unknown>,
    /** Whether a write to the file is already waiting its turn. */
    waiting: false,
    /** Counts the files opened, so that a failed write can tell that its file was left behind. */
    fileNo: 0,
  });

  const actions = useMemo(() => {
    /** Reads what the storage knows now: the name of the file, and whether it saves by itself. */
    const syncFile = (patch: Partial<FileStatus> = {}) =>
      setFile((f) => ({ ...f, name: storage.fileName(), auto: storage.canAutoSave(), ...patch }));

    /** Runs the write once every earlier one has ended, so that no two overlap. */
    const inTurn = <T,>(write: () => Promise<T>): Promise<T> => {
      const run = writes.current.last.then(write);
      writes.current.last = run.catch(() => undefined);
      return run;
    };

    const autoSave = () => {
      if (writes.current.waiting) return; // that one will write the latest data too
      writes.current.waiting = true;
      void inTurn(async () => {
        writes.current.waiting = false;
        const current = latest.current; // the latest, whatever file it was meant for
        if (current === null) return;
        if (!storage.canAutoSave()) {
          syncFile({ dirty: true }); // a write was due, and it cannot be made
          return;
        }
        const fileNo = writes.current.fileNo;
        try {
          await storage.autoSave(current);
          if (latest.current === current) unsaved.current = false; // the file has all of it
        } catch {
          // The data stays. The adapter no longer saves by itself, so the user's next save is
          // what puts it back on, and until then the status says that the file is behind.
          if (fileNo === writes.current.fileNo) syncFile({ dirty: true }); // not a file left behind
        }
      });
    };

    const scheduleAutoSave = () => {
      clearTimeout(timers.current.file);
      timers.current.file = setTimeout(autoSave, FILE_DELAY_MS);
    };

    /** The data changed, other than by opening a file. */
    const changed = () => {
      unsaved.current = true;
      if (storage.canAutoSave()) scheduleAutoSave();
      else setFile((f) => (f.dirty && !f.auto ? f : { ...f, dirty: true, auto: false }));
    };

    /** The data was replaced, by a file that was opened or by a load. */
    const replaced = () => {
      replacements.current++;
      setLoads(replacements.current);
    };

    const dispatch = (action: Action, ifLoads?: number) => {
      if (ifLoads !== undefined && ifLoads !== replacements.current) return; // its data is gone
      const before = latest.current;
      let after: AppData;
      if (action.type === 'load') after = action.data;
      else if (before === null) return; // nothing to change yet
      else after = reduce(before, action);
      if (after === before) return;
      latest.current = after;
      setData(after);
      if (action.type === 'load') replaced();
      changed();
    };

    const fail = (e: unknown, fallback: string) => {
      syncFile();
      const message = messageFor(e, fallback);
      if (message !== null) setError(message);
    };

    const openFile = async () => {
      let opened: AppData | null;
      try {
        opened = await storage.openFile();
      } catch (e) {
        fail(e, FILE_ERRORS.open);
        return;
      }
      if (opened === null) {
        syncFile();
        return;
      }
      // The adapter has switched to the new file, so from here on only its data may go there.
      writes.current.fileNo++;
      clearTimeout(timers.current.file);
      latest.current = opened;
      unsaved.current = false; // the page matches the file it was read from
      setData(opened);
      replaced();
      setFile({
        name: storage.fileName(),
        savedAt: new Date().toISOString(),
        dirty: false,
        auto: storage.canAutoSave(),
      });
      setError(null);
    };

    /**
     * Saves through `write`, the adapter's `saveFile` or `saveFileAs`, in turn with the other
     * writes, and shows where the data went. Either may switch the adapter to another file, which
     * the status then names, and which takes the changes from then on.
     */
    const saveWith = async (write: (d: AppData) => Promise<string>) => {
      if (latest.current === null) return;
      let saved: AppData;
      try {
        saved = await inTurn(async () => {
          const current = latest.current as AppData; // the latest when this write begins
          await write(current);
          return current;
        });
      } catch (e) {
        fail(e, FILE_ERRORS.save);
        return;
      }
      const auto = storage.canAutoSave();
      // The file has what was saved, not what came in during the write.
      const behind = latest.current !== saved;
      unsaved.current = behind;
      setFile({
        name: storage.fileName(),
        savedAt: new Date().toISOString(),
        dirty: behind && !auto,
        auto,
      });
      setError(null);
      if (behind && auto) scheduleAutoSave(); // the file can take it now
    };

    const saveFile = () => saveWith((d) => storage.saveFile(d));
    const saveFileAs = () => saveWith((d) => storage.saveFileAs(d));

    const newData = () => {
      setError(null);
      dispatch({ type: 'load', data: newAppData() });
    };

    const dismissError = () => setError(null);

    return { dispatch, openFile, saveFile, saveFileAs, newData, dismissError };
  }, [storage]);

  // A write that is still due when the provider goes away has no page to report to.
  useEffect(() => {
    const pending = timers.current;
    return () => clearTimeout(pending.file);
  }, []);

  // Closing or reloading the page with changes that are not in a file loses them from the file's
  // point of view: the browser is asked to confirm. It shows a text of its own; the empty
  // `returnValue` is what older browsers want in order to ask at all.
  useEffect(() => {
    const confirmLeaving = (event: BeforeUnloadEvent) => {
      if (!unsaved.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', confirmLeaving);
    return () => window.removeEventListener('beforeunload', confirmLeaving);
  }, []);

  const store = useMemo<AppStore>(
    () => ({
      data,
      dispatch: actions.dispatch,
      loads,
      file,
      openFile: actions.openFile,
      saveFile: actions.saveFile,
      saveFileAs: actions.saveFileAs,
      newData: actions.newData,
      error,
      dismissError: actions.dismissError,
      runner,
    }),
    [data, loads, file, error, actions, runner],
  );

  return <AppContext value={store}>{children}</AppContext>;
}
