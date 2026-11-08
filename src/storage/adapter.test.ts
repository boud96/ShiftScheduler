// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserStorage, memoryStorage } from './adapter';
import type { StorageAdapter } from './adapter';
import { SaveFileError, parseSaveFile, serialize } from './saveFile';
import { newAppData, newPerson } from '../domain/defaults';
import type { AppData } from '../domain/types';

const CACHE_KEY = 'shift-scheduler/v1';
const FILE_NAME = 'plan-smen.json';

/** Things to undo after a test: event listeners and the like. */
const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((undo) => undo());
  vi.unstubAllGlobals(); // showOpenFilePicker and showSaveFilePicker
  vi.restoreAllMocks(); // spies on Storage and URL
  vi.useRealTimers();
  localStorage.clear();
  document.body.replaceChildren();
});

/** A plan that differs from the others by the first name, so that plans can be told apart. */
function plan(n: number): AppData {
  const d = newAppData();
  d.people[0].name = `Operátor ${n}`;
  return d;
}

const abortError = () => new DOMException('The user aborted a request.', 'AbortError');

// --- The brief's tests ---------------------------------------------------------------------

describe('storage adapters (brief)', () => {
  it('browserStorage() round-trips through localStorage', () => {
    const s = browserStorage();
    const d = newAppData();
    s.saveCache(d);
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull();
    expect(s.loadCache()).toEqual(d);
  });

  it('a corrupt cache value gives null from loadCache() and stays in place', () => {
    localStorage.setItem(CACHE_KEY, '{"app":"shift-scheduler","schemaVersion":1,');
    expect(browserStorage().loadCache()).toBeNull();
    expect(localStorage.getItem(CACHE_KEY)).toBe('{"app":"shift-scheduler","schemaVersion":1,');
  });

  it('memoryStorage().saveFile(d) records the serialized text', async () => {
    const s = memoryStorage();
    const d = newAppData();
    await s.saveFile(d);
    expect(s.saved).toEqual([serialize(d)]);
  });
});

// --- A stand-in for the File System Access API ---------------------------------------------

type Permission = 'granted' | 'prompt' | 'denied';

/**
 * A stand-in for a FileSystemFileHandle. A test steers and reads it through `state`: the
 * permission, the file's content, what each finished write left in it, and the errors to throw.
 */
function fakeHandle(
  name: string,
  init: { content?: string; permission?: Permission; answer?: Permission } = {},
) {
  const state = {
    content: init.content ?? '',
    permission: init.permission ?? ('granted' as Permission),
    /** What the permission becomes when the user answers a prompt. */
    answer: init.answer ?? ('granted' as Permission),
    requestError: undefined as unknown,
    writeError: undefined as unknown,
    /** The content each finished (closed) write left in the file. */
    writes: [] as string[],
    writers: [] as Array<{ abort: ReturnType<typeof vi.fn> }>,
  };
  const handle = {
    name,
    getFile: vi.fn(async () => ({ text: async () => state.content })),
    queryPermission: vi.fn(async (_options: unknown) => state.permission),
    requestPermission: vi.fn(async (_options: unknown) => {
      if (state.requestError) throw state.requestError;
      if (state.permission === 'prompt') state.permission = state.answer;
      return state.permission;
    }),
    createWritable: vi.fn(async () => {
      if (state.permission !== 'granted') throw new DOMException('Not allowed.', 'NotAllowedError');
      let pending = '';
      const writer = {
        write: vi.fn(async (data: string) => {
          if (state.writeError) throw state.writeError;
          pending += data;
        }),
        close: vi.fn(async () => {
          state.content = pending;
          state.writes.push(pending);
        }),
        abort: vi.fn(async () => undefined),
      };
      state.writers.push(writer);
      return writer;
    }),
  };
  return { handle, state };
}

type Fake = ReturnType<typeof fakeHandle>;

/** Puts stubs for both pickers on `window`; afterEach takes them off again. */
function stubPickers() {
  const open = vi.fn<(options?: unknown) => Promise<unknown>>();
  const save = vi.fn<(options?: unknown) => Promise<unknown>>();
  vi.stubGlobal('showOpenFilePicker', open);
  vi.stubGlobal('showSaveFilePicker', save);
  return { open, save };
}

/** A fake file holding `data`, as a save file. */
const fileOf = (name: string, data: AppData, init: Parameters<typeof fakeHandle>[1] = {}) =>
  fakeHandle(name, { content: serialize(data), ...init });

/** Opens `file` through the stubbed open picker; resolves with what openFile() resolves with. */
function openThrough(
  s: StorageAdapter,
  picker: ReturnType<typeof stubPickers>['open'],
  file: Fake,
): Promise<AppData | null> {
  picker.mockResolvedValueOnce([file.handle]);
  return s.openFile();
}

// --- browserStorage: the cache -------------------------------------------------------------

describe('browserStorage: the cache', () => {
  it('keeps the data as the text of a save file under shift-scheduler/v1', () => {
    const d = plan(1);
    browserStorage().saveCache(d);
    expect(parseSaveFile(localStorage.getItem(CACHE_KEY) as string)).toEqual(d);
  });

  it('gives back the last data cached, also to a new adapter', () => {
    const s = browserStorage();
    s.saveCache(plan(1));
    s.saveCache(plan(2));
    expect(s.loadCache()).toEqual(plan(2));
    expect(browserStorage().loadCache()).toEqual(plan(2));
  });

  it('returns null when nothing is cached', () => {
    expect(browserStorage().loadCache()).toBeNull();
  });

  it.each([
    ['broken JSON', '{'],
    ['an empty string', ''],
    ['JSON that is not a plan', '[]'],
    ['another app', '{"app":"other"}'],
    ['a newer version', '{"app":"shift-scheduler","schemaVersion":3}'],
    ['a damaged plan', '{"app":"shift-scheduler","schemaVersion":1,"people":[]}'],
  ])('returns null for %s and leaves the stored value alone', (_what, stored) => {
    localStorage.setItem(CACHE_KEY, stored);
    expect(browserStorage().loadCache()).toBeNull();
    expect(localStorage.getItem(CACHE_KEY)).toBe(stored);
  });

  it('completes a person that has only an id and a name, so that a reload can draw the page', () => {
    // Once such a person came back as it was, without prefs, and every reload drew a blank page.
    const damaged = {
      app: 'shift-scheduler',
      schemaVersion: 1,
      people: [{ id: 'p1', name: 'Operátor 1' }],
      settings: {},
      cells: {},
      months: {},
    };
    const text = JSON.stringify(damaged);
    localStorage.setItem(CACHE_KEY, text);
    const loaded = browserStorage().loadCache();
    expect(loaded?.people).toEqual([newPerson('p1', 'Operátor 1')]);
    expect(loaded?.people[0].prefs.ratings).toEqual({});
    expect(localStorage.getItem(CACHE_KEY)).toBe(text); // the stored value is left alone
  });

  it('returns null when localStorage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access is denied.', 'SecurityError');
    });
    expect(browserStorage().loadCache()).toBeNull();
  });

  it('ignores a cache write that fails, and keeps what was cached before', () => {
    const s = browserStorage();
    s.saveCache(plan(1));
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    expect(() => s.saveCache(plan(2))).not.toThrow();
    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
    expect(s.loadCache()).toEqual(plan(1));
  });

  it('ignores a cache write that the browser refuses', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Access is denied.', 'SecurityError');
    });
    expect(() => browserStorage().saveCache(plan(1))).not.toThrow();
  });

  it('has no file and cannot auto-save before one is opened or saved', () => {
    const s = browserStorage();
    expect(s.fileName()).toBeNull();
    expect(s.canAutoSave()).toBe(false);
  });
});

// --- browserStorage with File System Access -------------------------------------------------

describe('browserStorage with File System Access: openFile', () => {
  it('reads the picked file, returns its data and keeps its handle', async () => {
    const { open } = stubPickers();
    const file = fileOf('moje-smeny.json', plan(1));
    const s = browserStorage();
    expect(await openThrough(s, open, file)).toEqual(plan(1));
    expect(s.fileName()).toBe('moje-smeny.json');
    expect(document.querySelector('input')).toBeNull(); // no fallback input
  });

  it('offers JSON files in the picker', async () => {
    const { open } = stubPickers();
    await openThrough(browserStorage(), open, fileOf('a.json', plan(1)));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        types: [expect.objectContaining({ accept: { 'application/json': ['.json'] } })],
      }),
    );
  });

  it.each([
    ['is already granted', 'granted', 'granted', true, 0],
    ['is granted when asked', 'prompt', 'granted', true, 1],
    ['is refused when asked', 'prompt', 'denied', false, 1],
    ['was denied before', 'denied', 'granted', false, 1],
  ] as const)(
    'write permission that %s: auto-save follows the answer',
    async (_what, permission, answer, canAutoSave, requests) => {
      const { open } = stubPickers();
      const file = fileOf('a.json', plan(1), { permission, answer });
      const s = browserStorage();
      await openThrough(s, open, file);
      expect(s.canAutoSave()).toBe(canAutoSave);
      expect(file.handle.requestPermission).toHaveBeenCalledTimes(requests);
      if (requests) {
        expect(file.handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
      }
      expect(s.fileName()).toBe('a.json'); // the handle is kept either way
    },
  );

  it('still opens the file when the permission request throws', async () => {
    const { open } = stubPickers();
    const file = fileOf('a.json', plan(1), { permission: 'prompt' });
    file.state.requestError = new DOMException('No user activation.', 'SecurityError');
    const s = browserStorage();
    expect(await openThrough(s, open, file)).toEqual(plan(1));
    expect(s.fileName()).toBe('a.json');
    expect(s.canAutoSave()).toBe(false);
  });

  it('resolves null when the picker is cancelled, and keeps the handle held before', async () => {
    const { open } = stubPickers();
    const a = fileOf('a.json', plan(1));
    const s = browserStorage();
    await openThrough(s, open, a);
    open.mockRejectedValueOnce(abortError());
    expect(await s.openFile()).toBeNull();
    expect(s.fileName()).toBe('a.json');
    expect(s.canAutoSave()).toBe(true);
  });

  it('resolves null for a cancelled picker even when nothing was opened yet', async () => {
    const { open } = stubPickers();
    open.mockRejectedValueOnce(abortError());
    const s = browserStorage();
    expect(await s.openFile()).toBeNull();
    expect(s.fileName()).toBeNull();
    expect(s.canAutoSave()).toBe(false);
  });

  it('resolves null when the picker gives no file', async () => {
    const { open } = stubPickers();
    open.mockResolvedValueOnce([]);
    expect(await browserStorage().openFile()).toBeNull();
  });

  it('passes on any picker error that is not a cancel', async () => {
    const { open } = stubPickers();
    const blocked = new DOMException('Blocked.', 'SecurityError');
    open.mockRejectedValueOnce(blocked);
    await expect(browserStorage().openFile()).rejects.toBe(blocked);
  });

  it.each([
    ['not a plan', 'Tohle není soubor s plánem směn.', '{'],
    ['from a newer version', 'Soubor je z novější verze aplikace.',
      '{"app":"shift-scheduler","schemaVersion":3}'],
    ['damaged', 'Soubor je poškozený.', '{"app":"shift-scheduler","schemaVersion":1}'],
  ])('rejects a file that is %s, and keeps the handle held before', async (_w, message, bad) => {
    const { open } = stubPickers();
    const a = fileOf('a.json', plan(1));
    const s = browserStorage();
    await openThrough(s, open, a);

    const b = fakeHandle('b.json', { content: bad, permission: 'prompt' });
    open.mockResolvedValueOnce([b.handle]);
    const failure = await s.openFile().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SaveFileError);
    expect((failure as SaveFileError).message).toBe(message);

    // Nothing of b was taken on, not even a question about its permission.
    expect(b.handle.queryPermission).not.toHaveBeenCalled();
    expect(b.handle.requestPermission).not.toHaveBeenCalled();
    expect(s.fileName()).toBe('a.json');
    expect(s.canAutoSave()).toBe(true);
    await s.autoSave(plan(2));
    expect(a.state.writes).toEqual([serialize(plan(2))]);
    expect(b.state.writes).toEqual([]);
  });

  it('holds nothing after a bad first file', async () => {
    const { open } = stubPickers();
    const s = browserStorage();
    await expect(openThrough(s, open, fakeHandle('b.json', { content: 'nope' }))).rejects.toThrow(
      SaveFileError,
    );
    expect(s.fileName()).toBeNull();
    expect(s.canAutoSave()).toBe(false);
  });

  it('lets the new file decide about auto-save, not the one held before', async () => {
    const { open } = stubPickers();
    const s = browserStorage();
    await openThrough(s, open, fileOf('a.json', plan(1)));
    expect(s.canAutoSave()).toBe(true);

    const b = fileOf('b.json', plan(2), { permission: 'prompt', answer: 'denied' });
    await openThrough(s, open, b);
    expect(s.fileName()).toBe('b.json');
    expect(s.canAutoSave()).toBe(false);
    await expect(s.autoSave(plan(3))).rejects.toThrow();
    expect(b.handle.createWritable).not.toHaveBeenCalled();
  });

  it('never sends old data to the new file while its permission is still asked', async () => {
    const { open } = stubPickers();
    const s = browserStorage();
    const a = fileOf('a.json', plan(1));
    await openThrough(s, open, a);

    // The user has not answered the prompt for b yet.
    const b = fileOf('b.json', plan(2), { permission: 'prompt' });
    let asked: () => void = () => undefined;
    const wasAsked = new Promise<void>((resolve) => { asked = resolve; });
    let answer: (permission: Permission) => void = () => undefined;
    b.handle.requestPermission.mockImplementationOnce(() => {
      asked();
      return new Promise<Permission>((resolve) => { answer = resolve; });
    });
    const opening = openThrough(s, open, b);
    await wasAsked;

    // A debounced auto-save of the old data fires meanwhile: a is still the file held, so it goes
    // to a, and b must not get it.
    await s.autoSave(plan(3));
    expect(a.state.writes).toEqual([serialize(plan(3))]);
    expect(b.state.writes).toEqual([]);
    expect(b.handle.createWritable).not.toHaveBeenCalled();

    b.state.permission = 'granted';
    answer('granted');
    expect(await opening).toEqual(plan(2));
    expect(s.fileName()).toBe('b.json');
    expect(s.canAutoSave()).toBe(true);
  });
});

describe('browserStorage with File System Access: saveFile', () => {
  it('without a file held, shows the save picker, writes and keeps the handle', async () => {
    const { save, open } = stubPickers();
    const target = fakeHandle('vybrany.json');
    save.mockResolvedValueOnce(target.handle);
    const s = browserStorage();

    expect(await s.saveFile(plan(1))).toBe('vybrany.json');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: FILE_NAME }));
    expect(save.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        types: [expect.objectContaining({ accept: { 'application/json': ['.json'] } })],
      }),
    );
    expect(target.state.writes).toEqual([serialize(plan(1))]);
    expect(target.state.writers[0].abort).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(s.fileName()).toBe('vybrany.json');
    expect(s.canAutoSave()).toBe(true);

    // The handle is kept: the next save goes to the same file without a picker.
    expect(await s.saveFile(plan(2))).toBe('vybrany.json');
    expect(save).toHaveBeenCalledTimes(1);
    expect(target.state.writes).toEqual([serialize(plan(1)), serialize(plan(2))]);
  });

  it('writes to the file that was opened, without a picker', async () => {
    const { open, save } = stubPickers();
    const a = fileOf('a.json', plan(1));
    const s = browserStorage();
    await openThrough(s, open, a);

    expect(await s.saveFile(plan(2))).toBe('a.json');
    expect(a.state.writes).toEqual([serialize(plan(2))]);
    expect(save).not.toHaveBeenCalled();
  });

  it('asks for write permission when the file lacks it, and then writes', async () => {
    const { open } = stubPickers();
    const a = fileOf('a.json', plan(1), { permission: 'prompt', answer: 'denied' });
    const s = browserStorage();
    await openThrough(s, open, a); // refused at open
    expect(s.canAutoSave()).toBe(false);

    a.state.permission = 'prompt'; // asked again in the click of the next save
    a.state.answer = 'granted';
    a.handle.requestPermission.mockClear();
    expect(await s.saveFile(plan(2))).toBe('a.json');
    expect(a.handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(a.state.writes).toEqual([serialize(plan(2))]);
    expect(s.canAutoSave()).toBe(true);
  });

  describe('when the file held refuses write access or cannot be written to', () => {
    /** Opens a file with the permission `permission` and `answer` to a question, then picks `next`. */
    async function heldFile(init: { permission?: Permission; answer?: Permission } = {}) {
      const pickers = stubPickers();
      const a = fileOf('a.json', plan(1), init);
      const s = browserStorage();
      await openThrough(s, pickers.open, a);
      return { ...pickers, a, s };
    }

    it('forgets the file and shows the save picker when the user refuses access', async () => {
      const { save, a, s } = await heldFile({ permission: 'denied' });
      const b = fakeHandle('druhy.json');
      save.mockResolvedValueOnce(b.handle);

      expect(await s.saveFile(plan(2))).toBe('druhy.json');
      expect(a.handle.createWritable).not.toHaveBeenCalled();
      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: FILE_NAME }));
      expect(b.state.writes).toEqual([serialize(plan(2))]);
      expect(s.fileName()).toBe('druhy.json');
      expect(s.canAutoSave()).toBe(true);
      await s.autoSave(plan(3)); // the new file is the one auto-saved to
      expect(b.state.writes).toEqual([serialize(plan(2)), serialize(plan(3))]);
      expect(a.state.writes).toEqual([]);
    });

    it('asks for the permission first, and the picker is for a refusal only', async () => {
      const { save, a, s } = await heldFile({ permission: 'prompt', answer: 'granted' });
      a.state.permission = 'prompt'; // lost since the open
      a.handle.requestPermission.mockClear();
      expect(await s.saveFile(plan(2))).toBe('a.json');
      expect(a.handle.requestPermission).toHaveBeenCalledTimes(1);
      expect(save).not.toHaveBeenCalled();
    });

    it('drops the file before the picker opens, not after it', async () => {
      const { save, s } = await heldFile({ permission: 'denied' });
      let held: { name: string | null; auto: boolean } | undefined;
      save.mockImplementationOnce(async () => {
        held = { name: s.fileName(), auto: s.canAutoSave() }; // as the picker opens
        return fakeHandle('druhy.json').handle;
      });
      await s.saveFile(plan(2));
      expect(held).toEqual({ name: null, auto: false });
    });

    it('rejects with the AbortError of a cancelled picker, holding no file, and asks nothing next time', async () => {
      const { save, a, s } = await heldFile({ permission: 'denied' });
      const cancelled = abortError();
      save.mockRejectedValueOnce(cancelled);
      await expect(s.saveFile(plan(2))).rejects.toBe(cancelled);
      expect(s.fileName()).toBeNull();
      expect(s.canAutoSave()).toBe(false);

      // The next click goes straight to the picker: a is not asked about again.
      a.handle.queryPermission.mockClear();
      a.handle.requestPermission.mockClear();
      const b = fakeHandle('druhy.json');
      save.mockResolvedValueOnce(b.handle);
      expect(await s.saveFile(plan(3))).toBe('druhy.json');
      expect(save).toHaveBeenCalledTimes(2);
      expect(a.handle.queryPermission).not.toHaveBeenCalled();
      expect(a.handle.requestPermission).not.toHaveBeenCalled();
      expect(b.state.writes).toEqual([serialize(plan(3))]);
    });

    it('goes to the picker after a slow answer too, and the click that follows is the picker alone', async () => {
      // The user took long to answer the question, so the click was spent when the picker was
      // called, and the browser refused it. The file is forgotten all the same.
      const { save, a, s } = await heldFile({ permission: 'prompt', answer: 'denied' });
      a.state.permission = 'prompt';
      let answer: (permission: Permission) => void = () => undefined;
      a.handle.requestPermission.mockImplementationOnce(
        () => new Promise<Permission>((resolve) => { answer = resolve; }),
      );
      const refused = new DOMException('Must be handling a user gesture.', 'SecurityError');
      save.mockRejectedValueOnce(refused);

      const saving = s.saveFile(plan(2));
      const outcome = saving.catch((e: unknown) => e);
      await Promise.resolve(); // the question is on the screen
      expect(save).not.toHaveBeenCalled();
      answer('denied'); // a long time later
      expect(await outcome).toBe(refused);
      expect(s.fileName()).toBeNull();

      a.handle.requestPermission.mockClear();
      save.mockResolvedValueOnce(fakeHandle('druhy.json').handle);
      expect(await s.saveFile(plan(3))).toBe('druhy.json');
      expect(a.handle.requestPermission).not.toHaveBeenCalled();
    });

    it('goes to the picker when the permission cannot be asked for', async () => {
      const { save, a, s } = await heldFile({ permission: 'prompt' });
      a.state.permission = 'prompt';
      a.state.requestError = new DOMException('Needs a click.', 'SecurityError');
      save.mockResolvedValueOnce(fakeHandle('druhy.json').handle);
      expect(await s.saveFile(plan(2))).toBe('druhy.json');
      expect(a.handle.createWritable).not.toHaveBeenCalled();
    });

    it('goes to the picker when the file cannot be written to, and lets go of the writer', async () => {
      const { save, a, s } = await heldFile();
      a.state.writeError = new DOMException('The file is gone.', 'NotFoundError');
      const b = fakeHandle('druhy.json');
      save.mockResolvedValueOnce(b.handle);

      expect(await s.saveFile(plan(2))).toBe('druhy.json');
      expect(a.state.writers).toHaveLength(1);
      expect(a.state.writers[0].abort).toHaveBeenCalledTimes(1);
      expect(a.state.writes).toEqual([]);
      expect(b.state.writes).toEqual([serialize(plan(2))]);
      expect(s.fileName()).toBe('druhy.json');
      expect(s.canAutoSave()).toBe(true);
    });

    it('forgets a file that cannot be written to, also when the picker is cancelled', async () => {
      const { save, a, s } = await heldFile();
      a.state.writeError = new DOMException('The file is gone.', 'NotFoundError');
      const cancelled = abortError();
      save.mockRejectedValueOnce(cancelled);
      await expect(s.saveFile(plan(2))).rejects.toBe(cancelled);
      expect(s.fileName()).toBeNull();
      expect(s.canAutoSave()).toBe(false);

      a.handle.createWritable.mockClear();
      save.mockResolvedValueOnce(fakeHandle('druhy.json').handle);
      expect(await s.saveFile(plan(3))).toBe('druhy.json');
      expect(a.handle.createWritable).not.toHaveBeenCalled(); // not even tried
    });

    it('holds nothing when the file picked in its place cannot be written to either', async () => {
      const { save, s } = await heldFile({ permission: 'denied' });
      const b = fakeHandle('druhy.json');
      b.state.writeError = new DOMException('Disk full.', 'QuotaExceededError');
      save.mockResolvedValueOnce(b.handle);
      await expect(s.saveFile(plan(2))).rejects.toBe(b.state.writeError);
      expect(s.fileName()).toBeNull();
      expect(s.canAutoSave()).toBe(false);
    });

    it('leaves auto-saving off, until a save puts a file back', async () => {
      const { save, s } = await heldFile({ permission: 'denied' });
      save.mockRejectedValueOnce(abortError());
      await s.saveFile(plan(2)).catch(() => undefined);
      await expect(s.autoSave(plan(3))).rejects.toThrow();
      const b = fakeHandle('druhy.json');
      save.mockResolvedValueOnce(b.handle);
      await s.saveFile(plan(4));
      await s.autoSave(plan(5));
      expect(b.state.writes).toEqual([serialize(plan(4)), serialize(plan(5))]);
    });

    it('does not let go of a file that was opened meanwhile', async () => {
      const { open, save, a, s } = await heldFile({ permission: 'prompt', answer: 'denied' });
      a.state.permission = 'prompt';
      let answer: (permission: Permission) => void = () => undefined;
      a.handle.requestPermission.mockImplementationOnce(
        () => new Promise<Permission>((resolve) => { answer = resolve; }),
      );
      const saving = s.saveFile(plan(2)).catch((e: unknown) => e);
      await Promise.resolve();

      await openThrough(s, open, fileOf('b.json', plan(3))); // while the question is open
      expect(s.fileName()).toBe('b.json');
      const cancelled = abortError();
      save.mockRejectedValueOnce(cancelled);
      answer('denied');
      expect(await saving).toBe(cancelled);
      // b is the file held, and the refusal of a was not about it
      expect(s.fileName()).toBe('b.json');
      expect(s.canAutoSave()).toBe(true);
    });
  });

  it('rejects with the very AbortError of a cancelled picker, and saves nothing', async () => {
    const { save } = stubPickers();
    const cancelled = abortError();
    save.mockRejectedValueOnce(cancelled);
    const s = browserStorage();
    await expect(s.saveFile(plan(1))).rejects.toBe(cancelled);
    expect(s.fileName()).toBeNull();
    expect(s.canAutoSave()).toBe(false);
  });

  it('keeps no handle when the first write fails', async () => {
    const { save } = stubPickers();
    const target = fakeHandle('vybrany.json');
    target.state.writeError = new DOMException('Disk full.', 'QuotaExceededError');
    save.mockResolvedValueOnce(target.handle);
    const s = browserStorage();
    await expect(s.saveFile(plan(1))).rejects.toBe(target.state.writeError);
    expect(target.state.writers[0].abort).toHaveBeenCalledTimes(1);
    expect(s.fileName()).toBeNull();
    expect(s.canAutoSave()).toBe(false);
  });
});

describe('browserStorage with File System Access: autoSave and canAutoSave', () => {
  it('writes the data to the held file', async () => {
    const { open } = stubPickers();
    const a = fileOf('a.json', plan(1));
    const s = browserStorage();
    await openThrough(s, open, a);
    await s.autoSave(plan(2));
    await s.autoSave(plan(3));
    expect(a.state.writes).toEqual([serialize(plan(2)), serialize(plan(3))]);
    expect(parseSaveFile(a.state.content)).toEqual(plan(3));
  });

  it('on failure turns auto-save off, rejects, and stays off until the next saveFile', async () => {
    const { open } = stubPickers();
    const a = fileOf('a.json', plan(1));
    const s = browserStorage();
    await openThrough(s, open, a);
    expect(s.canAutoSave()).toBe(true);

    const failure = new DOMException('The file is gone.', 'NotFoundError');
    a.state.writeError = failure;
    await expect(s.autoSave(plan(2))).rejects.toBe(failure);
    expect(a.state.writers[0].abort).toHaveBeenCalledTimes(1);
    expect(s.canAutoSave()).toBe(false);
    expect(s.fileName()).toBe('a.json');

    // Off means off: no further attempt on the file.
    a.handle.createWritable.mockClear();
    await expect(s.autoSave(plan(3))).rejects.toThrow();
    expect(a.handle.createWritable).not.toHaveBeenCalled();

    // The next saveFile (a click) brings it back.
    a.state.writeError = undefined;
    expect(await s.saveFile(plan(4))).toBe('a.json');
    expect(s.canAutoSave()).toBe(true);
    await s.autoSave(plan(5));
    expect(a.state.writes).toEqual([serialize(plan(4)), serialize(plan(5))]);
  });

  it('a failed write to a file no longer held leaves auto-save of the new file on', async () => {
    const { open } = stubPickers();
    const s = browserStorage();
    const a = fileOf('a.json', plan(1));
    await openThrough(s, open, a);

    // a's write hangs; meanwhile b is opened and becomes the held file; then a's write fails.
    let failWrite: (e: unknown) => void = () => undefined;
    const hanging = new Promise<void>((_resolve, reject) => { failWrite = reject; });
    a.handle.createWritable.mockImplementationOnce(async () => ({
      write: vi.fn(async (_data: string) => hanging),
      close: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    }));
    const slow = s.autoSave(plan(2)).catch((e: unknown) => e);
    await openThrough(s, open, fileOf('b.json', plan(3)));
    expect(s.fileName()).toBe('b.json');

    failWrite(new DOMException('Gone.', 'NotFoundError'));
    expect(((await slow) as DOMException).name).toBe('NotFoundError');
    expect(s.canAutoSave()).toBe(true);
  });

  it('rejects without a file that can be written to', async () => {
    stubPickers();
    const s = browserStorage();
    await expect(s.autoSave(plan(1))).rejects.toThrow();
  });
});

// --- browserStorage without File System Access ----------------------------------------------

const fileInput = () => document.querySelector<HTMLInputElement>('input[type=file]');

/** Makes the file input hold `file` and tells it, as the browser does when the user picks. */
function choose(input: HTMLInputElement, file: File | null): void {
  Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
  input.dispatchEvent(new Event('change'));
}

/**
 * Catches the clicks on links, as jsdom would try to navigate to the Blob URL otherwise, and
 * records what the link looked like at the click.
 */
function captureLinkClicks() {
  const clicks: Array<{ href: string; download: string; attached: boolean }> = [];
  const onClick = (event: Event) => {
    event.preventDefault();
    const link = event.target as HTMLAnchorElement;
    clicks.push({ href: link.href, download: link.download, attached: link.isConnected });
  };
  document.addEventListener('click', onClick, true);
  cleanups.push(() => document.removeEventListener('click', onClick, true));
  return clicks;
}

describe('browserStorage without File System Access', () => {
  it('opens a file through a hidden file input for JSON', async () => {
    const s = browserStorage();
    const opening = s.openFile();
    const input = fileInput() as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.accept).toBe('.json,application/json');
    expect(input.hidden).toBe(true);

    choose(input, new File([serialize(plan(1))], 'moje-smeny.json'));
    expect(await opening).toEqual(plan(1));
    expect(s.fileName()).toBe('moje-smeny.json');
    expect(s.canAutoSave()).toBe(false);
    expect(fileInput()).toBeNull(); // tidied away
  });

  it('resolves null when the input is cancelled, and keeps the name of the last file', async () => {
    const s = browserStorage();
    const first = s.openFile();
    choose(fileInput() as HTMLInputElement, new File([serialize(plan(1))], 'a.json'));
    await first;

    const second = s.openFile();
    (fileInput() as HTMLInputElement).dispatchEvent(new Event('cancel'));
    expect(await second).toBeNull();
    expect(s.fileName()).toBe('a.json');
    expect(fileInput()).toBeNull();
  });

  it('resolves null when the input changes to no file at all', async () => {
    const s = browserStorage();
    const opening = s.openFile();
    choose(fileInput() as HTMLInputElement, null);
    expect(await opening).toBeNull();
    expect(s.fileName()).toBeNull();
  });

  it('rejects a bad file with its message and keeps the name of the last file', async () => {
    const s = browserStorage();
    const first = s.openFile();
    choose(fileInput() as HTMLInputElement, new File([serialize(plan(1))], 'a.json'));
    await first;

    const second = s.openFile();
    choose(fileInput() as HTMLInputElement, new File(['{"app":"other"}'], 'b.json'));
    await expect(second).rejects.toThrow(SaveFileError);
    await expect(second).rejects.toThrow('Tohle není soubor s plánem směn.');
    expect(s.fileName()).toBe('a.json');
    expect(fileInput()).toBeNull();
  });

  it('downloads plan-smen.json through a link with a Blob URL, revoked afterwards', async () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:plan-smen');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clicks = captureLinkClicks();
    const s = browserStorage();

    expect(await s.saveFile(plan(1))).toBe(FILE_NAME);
    expect(clicks).toEqual([{ href: 'blob:plan-smen', download: FILE_NAME, attached: true }]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled(); // the browser may still be starting the download

    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:plan-smen');
    expect(document.querySelector('a')).toBeNull();
    vi.useRealTimers();

    const blob = create.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe(serialize(plan(1)));
    expect(s.fileName()).toBe(FILE_NAME);
    expect(s.canAutoSave()).toBe(false);
  });

  it('never auto-saves', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    captureLinkClicks();
    const s = browserStorage();
    await s.saveFile(plan(1));
    expect(s.canAutoSave()).toBe(false);
    await expect(s.autoSave(plan(2))).rejects.toThrow();
  });
});

// --- memoryStorage -------------------------------------------------------------------------

describe('memoryStorage', () => {
  it('starts with the initial data, or nothing', () => {
    expect(memoryStorage().loadCache()).toBeNull();
    expect(memoryStorage(null).loadCache()).toBeNull();
    expect(memoryStorage(plan(1)).loadCache()).toEqual(plan(1));
  });

  it('returns a copy of the cached data every time', () => {
    const initial = plan(1);
    const s = memoryStorage(initial);
    const first = s.loadCache() as AppData;
    expect(first).not.toBe(initial);
    first.people[0].name = 'Changed';
    initial.people[1].name = 'Changed too';
    expect(s.loadCache()).toEqual(plan(1));
    expect(s.loadCache()).not.toBe(s.loadCache());
  });

  it('gives back the last data cached, as a copy', () => {
    const s = memoryStorage(plan(1));
    const next = plan(2);
    s.saveCache(next);
    next.people[0].name = 'Changed after saving';
    expect(s.loadCache()).toEqual(plan(2));
  });

  it('cannot auto-save, has no file yet, and opens nothing', async () => {
    const s = memoryStorage(plan(1));
    expect(s.canAutoSave()).toBe(false);
    expect(s.fileName()).toBeNull();
    expect(await s.openFile()).toBeNull();
    expect(s.saved).toEqual([]);
  });

  it('saveFile and autoSave push the serialized text, saveFile gives the name', async () => {
    const s = memoryStorage();
    expect(await s.saveFile(plan(1))).toBe(FILE_NAME);
    expect(s.fileName()).toBe(FILE_NAME);
    await s.autoSave(plan(2));
    await s.saveFile(plan(3));
    expect(s.saved).toEqual([serialize(plan(1)), serialize(plan(2)), serialize(plan(3))]);
    expect(s.canAutoSave()).toBe(false);
  });

  it('is made of plain properties: a replaced method is used, a detached one works', async () => {
    const s = memoryStorage(plan(1));
    s.openFile = async () => { throw new SaveFileError('Soubor je poškozený.'); };
    await expect(s.openFile()).rejects.toThrow('Soubor je poškozený.');

    const { loadCache, saveFile, saved } = memoryStorage(plan(2));
    expect(loadCache()).toEqual(plan(2));
    await saveFile(plan(2));
    expect(saved).toEqual([serialize(plan(2))]);
  });
});
