import type { AppData } from '../domain/types';
import { parseSaveFile, serialize } from './saveFile';

/**
 * Where the app keeps its data. The save file is the real store; browser storage is only a cache
 * of it. The app always calls these through the object, so a test may replace any of them.
 *
 * Which file the data goes to is the adapter's state: the one opened or saved to last. Only a click
 * of the user may make a browser show a picker or ask for write permission, so `openFile` and
 * `saveFile` are to be called from one.
 */
export interface StorageAdapter {
  /** The cached data, or null when there is none or it is no good. Never changes the cache. */
  loadCache(): AppData | null;
  /** Keeps the data in the cache. Never throws. */
  saveCache(d: AppData): void;
  /**
   * The name of the file the data goes to: the file held, else the last one opened or downloaded
   * (Firefox, which holds no file), else null.
   */
  fileName(): string | null;
  /**
   * Whether `autoSave` can write to the file now without asking the user: a file is held and it
   * was last found writable. It turns false when a write to the file fails, and when `saveFile`
   * gives the file up; a `saveFile` or an `openFile` that gets write access turns it on again.
   */
  canAutoSave(): boolean;
  /**
   * Lets the user pick a save file and resolves with its data. From then on `fileName` and
   * `autoSave` are for that file, and it is asked for write access at once. Resolves null, and
   * changes nothing, when the user cancels. Rejects with a `SaveFileError` for a file that is not
   * a plan (the file held before stays), or with the browser's error when the picker or reading
   * fails.
   */
  openFile(): Promise<AppData | null>;
  /**
   * Saves to the file held, asking for write access if it has none, or lets the user pick a file
   * (Edge, Chrome), or downloads one (Firefox). Resolves with the name of the file.
   *
   * When access to the file held is refused, or writing to it fails (it was moved, deleted, the
   * disk is full), the file is given up and the picker opens in its place, as if none were held.
   * It is given up before the picker opens: the question about access can take so long that the
   * click is spent and the browser refuses the picker, and the click after that must find no file
   * held and go straight to the picker.
   *
   * Rejects with an `AbortError` when the user cancels the picker (nothing is saved, and the file
   * given up stays given up), and with the browser's error when the picker or the write to the
   * file picked fails. Nothing in the error is for the user to read: the caller words it.
   */
  saveFile(d: AppData): Promise<string>;
  /**
   * Writes to the file held without asking. Rejects when no file can be written to by itself; on a
   * failed write it rejects with the error and `canAutoSave` turns false, until a `saveFile`.
   */
  autoSave(d: AppData): Promise<void>;
}

/** The localStorage key of the cache. */
const CACHE_KEY = 'shift-scheduler/v1';

/** The name suggested for the save file, and the name of the download. */
const FILE_NAME = 'plan-smen.json';

/** How long a download's link and Blob URL are kept after the click. */
const CLEAN_UP_AFTER_MS = 1000;

// The File System Access API (Edge, Chrome) is missing from Firefox and from some TypeScript DOM
// libs, so the small part of it used here is declared locally and looked for at run time.

interface Writer {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface FileHandle {
  readonly name: string;
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<Writer>;
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<string>;
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<string>;
}

interface PickerOptions {
  types: Array<{ description: string; accept: Record<string, string[]> }>;
  suggestedName?: string;
}

interface PickerWindow {
  showOpenFilePicker?(options: PickerOptions): Promise<FileHandle[]>;
  showSaveFilePicker?(options: PickerOptions): Promise<FileHandle>;
}

/** Only browsers with File System Access have the pickers, so ask at the time of each use. */
const pickers = (): PickerWindow => window as unknown as PickerWindow;

const FILE_TYPES: PickerOptions['types'] = [
  { description: 'Plán směn', accept: { 'application/json': ['.json'] } },
];

const READWRITE = { mode: 'readwrite' } as const;

/** Whether a picker was cancelled: the browser rejects it with an AbortError. */
function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError';
}

/**
 * Whether the file may be written to, asking the user if need be. A question needs a click, so
 * call this from one. It is best effort: any failure means no.
 */
async function hasWriteAccess(handle: FileHandle): Promise<boolean> {
  try {
    if ((await handle.queryPermission?.(READWRITE)) === 'granted') return true;
    return (await handle.requestPermission?.(READWRITE)) === 'granted';
  } catch {
    return false;
  }
}

/** Replaces the content of the file. It is swapped in on close, so a failed write loses nothing. */
async function writeTo(handle: FileHandle, text: string): Promise<void> {
  const writer = await handle.createWritable();
  try {
    await writer.write(text);
    await writer.close();
  } catch (e) {
    await writer.abort().catch(() => undefined);
    throw e;
  }
}

/** Shows a hidden file input for JSON, straight from the click. Null if the user cancels. */
function pickViaInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    const done = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.append(input);
    input.click();
  });
}

/** Downloads the text as `plan-smen.json`, through a link to a Blob URL. */
function download(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = FILE_NAME;
  link.hidden = true;
  document.body.append(link);
  link.click();
  // A browser may begin the download only after this task, so the link and URL stay a moment.
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, CLEAN_UP_AFTER_MS);
}

/**
 * The adapter for the real page. Data lives in `localStorage` as a cache. The save file is read
 * and written through File System Access where the browser has it (Edge, Chrome), with the handle
 * kept in memory only. Elsewhere (Firefox) a file is opened through a file input and saved by
 * download, and `canAutoSave` is never true.
 */
export function browserStorage(): StorageAdapter {
  // The file saved to, and whether it may be written to without asking. `writable` is changed in
  // place, by the calls that learn of it. Each of them keeps the object it started with and writes
  // `writable` there, so that a late answer about an earlier file cannot change the permission of
  // the file held by then, which is another object.
  let held: { handle: FileHandle; writable: boolean } | null = null;
  // The last file opened or downloaded, for where there is no handle: no File System Access.
  let lastName: string | null = null;

  return {
    loadCache() {
      try {
        const text = localStorage.getItem(CACHE_KEY);
        return text === null ? null : parseSaveFile(text);
      } catch {
        // Storage is off, or the value is no good (a SaveFileError): carry on without a cache.
        // The stored value stays as it is.
        return null;
      }
    },

    saveCache(d) {
      try {
        localStorage.setItem(CACHE_KEY, serialize(d));
      } catch {
        // Ignored on purpose: a full or disabled storage must not get in the way of the work. The
        // save file is the real store, and the cache is optional.
      }
    },

    fileName: () => held?.handle.name ?? lastName,

    canAutoSave: () => held !== null && held.writable,

    async openFile() {
      const w = pickers();
      if (typeof w.showOpenFilePicker !== 'function') {
        const file = await pickViaInput();
        if (!file) return null;
        const data = parseSaveFile(await file.text());
        lastName = file.name;
        return data;
      }

      let picked: FileHandle[];
      try {
        picked = await w.showOpenFilePicker({ types: FILE_TYPES });
      } catch (e) {
        if (isAbort(e)) return null;
        throw e;
      }
      const handle = picked[0];
      if (!handle) return null;
      // A bad file rejects here, with the file held so far left as it was.
      const data = parseSaveFile(await (await handle.getFile()).text());
      // Best effort, and still inside the click. The old file stays the current one until the
      // answer is in, so nothing meant for it can reach this one meanwhile.
      held = { handle, writable: await hasWriteAccess(handle) };
      return data;
    },

    async saveFile(d) {
      const text = serialize(d);
      const target = held;
      if (target) {
        if (await hasWriteAccess(target.handle)) {
          try {
            await writeTo(target.handle, text);
            target.writable = true;
            return target.handle.name;
          } catch {
            // The file cannot be written to: it is dealt with as a refusal is.
          }
        }
        // The file is given up. Before the picker opens, not after: the question about access
        // may have taken so long that this click is spent, and the picker then fails. The click
        // after it has to find no file held and open the picker at once. A file that was opened
        // while the question was open is not this one, and stays.
        if (held === target) held = null;
      }

      const w = pickers();
      if (typeof w.showSaveFilePicker === 'function') {
        // A cancel rejects with the browser's AbortError: nothing was saved.
        const handle = await w.showSaveFilePicker({ suggestedName: FILE_NAME, types: FILE_TYPES });
        await writeTo(handle, text);
        held = { handle, writable: true };
        return handle.name;
      }

      download(text);
      lastName = FILE_NAME;
      return FILE_NAME;
    },

    async autoSave(d) {
      const target = held;
      if (!target?.writable) throw new Error('There is no file to save to automatically.');
      try {
        await writeTo(target.handle, serialize(d));
      } catch (e) {
        // The file needs the user now: only the next saveFile, from a click, can turn this on.
        target.writable = false;
        throw e;
      }
    },
  };
}

/**
 * An adapter for tests: it keeps the cache in memory, opens nothing, cannot auto-save, and
 * collects the text of every save in `saved`.
 */
export function memoryStorage(
  initial: AppData | null = null,
): StorageAdapter & { saved: string[] } {
  let cached = initial === null ? null : structuredClone(initial);
  let name: string | null = null;
  const saved: string[] = [];

  return {
    saved,
    // Copies both ways, like a real storage, which holds text.
    loadCache: () => (cached === null ? null : structuredClone(cached)),
    saveCache(d) {
      cached = structuredClone(d);
    },
    fileName: () => name,
    canAutoSave: () => false,
    openFile: async () => null,
    async saveFile(d) {
      saved.push(serialize(d));
      name = FILE_NAME;
      return FILE_NAME;
    },
    async autoSave(d) {
      saved.push(serialize(d));
    },
  };
}
