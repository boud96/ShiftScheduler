// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newAppData } from '../domain/defaults';
import type { AppData } from '../domain/types';
import { memoryStorage } from '../storage/adapter';
import type { StorageAdapter } from '../storage/adapter';
import { SaveFileError, serialize } from '../storage/saveFile';
import { inProcessRunner } from '../worker/runner';
import { AppProvider, useApp } from './store';

/** The latest value of `useApp()`, refreshed whenever the probe renders. */
let app: ReturnType<typeof useApp>;

function Probe() {
  app = useApp();
  return null;
}

function mount(storage: StorageAdapter, strict = false) {
  const tree = (
    <AppProvider storage={storage} runner={inProcessRunner}>
      <Probe />
    </AppProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const NOW = new Date('2027-01-04T08:05:00.000Z');

// The provider debounces with timers and stamps saves with the time, so both are in the test's
// hands. The other timers stay real: React's `act` and user-event rely on them.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Lets `ms` of the fake clock pass, and the promises that settle meanwhile. */
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** A promise to settle by hand, to hold a storage call in flight. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Changes the data in a way that is easy to see: the hours of rest between shifts. */
const setRest = (hours: number) =>
  act(() => {
    app.dispatch({ type: 'updateSettings', patch: { minRestHours: hours } });
  });

const rest = (): number | undefined => app.data?.settings.minRestHours;

const abortError = () => new DOMException('The user aborted a request.', 'AbortError');

/** A plan that differs from `newAppData()` by the first name. */
function otherPlan(): AppData {
  const data = newAppData();
  data.people[0].name = 'Jiný plán';
  return data;
}

/**
 * The storage of a browser with File System Access, once the user has picked a file: opening
 * gives a plan and turns auto-saving on. The page starts without data, then opens the file.
 */
async function mountWithOpenFile() {
  const storage = memoryStorage(null);
  let auto = false;
  storage.openFile = async () => {
    auto = true;
    return newAppData();
  };
  storage.canAutoSave = () => auto;
  storage.fileName = () => (auto ? 'plan.json' : null);
  const autoSave = vi.spyOn(storage, 'autoSave');
  mount(storage);
  await act(() => app.openFile());
  return { storage, autoSave, setAuto: (on: boolean) => void (auto = on) };
}

describe('the start of the store', () => {
  it('starts with the cached data, which may not be in any file', () => {
    const cached = otherPlan();
    mount(memoryStorage(cached));
    expect(app.data).toEqual(cached);
    expect(app.file).toEqual({ name: null, savedAt: null, dirty: true, auto: false });
    expect(app.error).toBeNull();
  });

  it('starts without data when the cache is empty', () => {
    mount(memoryStorage(null));
    expect(app.data).toBeNull();
    expect(app.file.dirty).toBe(false);
  });

  it('takes the name of the file and whether it saves by itself from the storage', () => {
    const storage = memoryStorage(newAppData());
    storage.fileName = () => 'plan.json';
    storage.canAutoSave = () => true;
    mount(storage);
    expect(app.file).toMatchObject({ name: 'plan.json', auto: true });
  });

  it('hands out the runner it was given', () => {
    mount(memoryStorage(null));
    expect(app.runner).toBe(inProcessRunner);
  });

  it('refuses to be used outside the provider', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/AppProvider/);
    quiet.mockRestore();
  });
});

describe('changing the data', () => {
  it('applies the actions through the reducer', async () => {
    mount(memoryStorage(newAppData()));
    await setRest(10);
    expect(rest()).toBe(10);
    act(() => app.dispatch({ type: 'addPerson', id: 'new-id' }));
    expect(app.data?.people).toHaveLength(9);
  });

  it('ignores every action but load while there is no data', () => {
    mount(memoryStorage(null));
    act(() => app.dispatch({ type: 'addPerson', id: 'new-id' }));
    expect(app.data).toBeNull();
    expect(app.file.dirty).toBe(false);

    const loaded = newAppData();
    act(() => app.dispatch({ type: 'load', data: loaded }));
    expect(app.data).toBe(loaded);
    expect(app.file.dirty).toBe(true);
  });

  it('starts a new plan on newData(), which is not in a file yet', () => {
    mount(memoryStorage(null));
    act(() => app.newData());
    expect(app.data).toEqual(newAppData());
    expect(app.file.dirty).toBe(true);
  });

  it('does not count an action that changes nothing as a change', async () => {
    const storage = memoryStorage(null);
    storage.openFile = async () => newAppData();
    const saveCache = vi.spyOn(storage, 'saveCache');
    mount(storage);
    await act(() => app.openFile());
    await advance(300);
    expect(saveCache).toHaveBeenCalledTimes(1); // the opened data

    act(() => app.dispatch({ type: 'togglePin', date: '2027-01-04', personId: 'p1' }));
    await advance(5000);
    expect(app.file.dirty).toBe(false);
    expect(saveCache).toHaveBeenCalledTimes(1);
  });
});

describe('the cache', () => {
  it('is written 300 ms after the last change, once, with the latest data', async () => {
    const storage = memoryStorage(newAppData());
    const saveCache = vi.spyOn(storage, 'saveCache');
    mount(storage);

    await setRest(11);
    await advance(299);
    expect(saveCache).not.toHaveBeenCalled();
    await setRest(10);
    await advance(299);
    expect(saveCache).not.toHaveBeenCalled();
    await advance(1);
    expect(saveCache).toHaveBeenCalledTimes(1);
    expect(saveCache.mock.calls[0][0].settings.minRestHours).toBe(10);
    expect(storage.loadCache()?.settings.minRestHours).toBe(10);
  });

  it('is left alone when nothing has changed', async () => {
    const storage = memoryStorage(newAppData());
    const saveCache = vi.spyOn(storage, 'saveCache');
    mount(storage);
    await advance(5000);
    expect(saveCache).not.toHaveBeenCalled();
  });

  it('is written at once when the page is hidden, and not again later', async () => {
    const storage = memoryStorage(newAppData());
    const saveCache = vi.spyOn(storage, 'saveCache');
    mount(storage);

    await setRest(11);
    expect(saveCache).not.toHaveBeenCalled();
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(saveCache).toHaveBeenCalledTimes(1);
    expect(storage.loadCache()?.settings.minRestHours).toBe(11);
    await advance(5000);
    expect(saveCache).toHaveBeenCalledTimes(1);
  });

  it('is not written on pagehide when nothing is waiting', async () => {
    const storage = memoryStorage(newAppData());
    const saveCache = vi.spyOn(storage, 'saveCache');
    mount(storage);
    await setRest(11);
    await advance(300);
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(saveCache).toHaveBeenCalledTimes(1);
  });

  it('is written when the provider goes away with a change waiting', async () => {
    const storage = memoryStorage(newAppData());
    const { unmount } = mount(storage);
    await setRest(11);
    unmount();
    expect(storage.loadCache()?.settings.minRestHours).toBe(11);
  });

  it('is written once per change in strict mode too', async () => {
    const storage = memoryStorage(newAppData());
    const saveCache = vi.spyOn(storage, 'saveCache');
    mount(storage, true);
    await setRest(11);
    await advance(300);
    expect(saveCache).toHaveBeenCalledTimes(1);
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(saveCache).toHaveBeenCalledTimes(1);
  });
});

describe('saving to the file by itself', () => {
  it('writes the latest data 1 s after the last change, once, and stays clean', async () => {
    const { autoSave } = await mountWithOpenFile();
    expect(app.file).toMatchObject({ dirty: false, auto: true });

    await setRest(11);
    await advance(999);
    expect(autoSave).not.toHaveBeenCalled();
    await setRest(10);
    await advance(999);
    expect(autoSave).not.toHaveBeenCalled();
    await advance(1);
    expect(autoSave).toHaveBeenCalledTimes(1);
    expect(autoSave.mock.calls[0][0].settings.minRestHours).toBe(10);
    expect(app.file).toMatchObject({ dirty: false, auto: true });
  });

  it('leaves the file alone when the storage cannot save by itself, and says so', async () => {
    const storage = memoryStorage(newAppData());
    const autoSave = vi.spyOn(storage, 'autoSave');
    mount(storage);
    await setRest(11);
    await advance(5000);
    expect(autoSave).not.toHaveBeenCalled();
    expect(app.file.dirty).toBe(true);
  });

  it('marks the data unsaved at a change once saving by itself is not possible', async () => {
    const { setAuto } = await mountWithOpenFile();
    setAuto(false);
    await setRest(11);
    expect(app.file).toMatchObject({ dirty: true, auto: false });
  });

  it('marks the data unsaved when a write falls due after auto-saving has stopped', async () => {
    const { autoSave, setAuto } = await mountWithOpenFile();
    await setRest(11); // at this moment the file can still take it
    setAuto(false);
    await advance(1000);
    expect(autoSave).not.toHaveBeenCalled();
    expect(app.file).toMatchObject({ dirty: true, auto: false });
  });

  it('writes one change at a time, the later ones with the latest data', async () => {
    const { autoSave } = await mountWithOpenFile();
    const first = deferred();
    autoSave.mockImplementationOnce(() => first.promise); // the first write hangs

    await setRest(11);
    await advance(1000);
    expect(autoSave).toHaveBeenCalledTimes(1);
    expect(autoSave.mock.calls[0][0].settings.minRestHours).toBe(11);

    // While it is in flight, more changes come in, each with a timer of its own.
    await setRest(10);
    await advance(1000);
    await setRest(9);
    await advance(1000);
    expect(autoSave).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve());
    expect(autoSave).toHaveBeenCalledTimes(2);
    expect(autoSave.mock.calls[1][0].settings.minRestHours).toBe(9);

    await advance(5000);
    expect(autoSave).toHaveBeenCalledTimes(2);
  });

  it('keeps the data and shows the unsaved status when a write fails', async () => {
    const { autoSave, setAuto } = await mountWithOpenFile();
    autoSave.mockImplementationOnce(async () => {
      setAuto(false); // the adapter stops saving by itself after a failure
      throw new Error('The disk is full.');
    });

    await setRest(11);
    await advance(1000);
    expect(rest()).toBe(11);
    expect(app.file).toMatchObject({ dirty: true, auto: false });
    expect(app.error).toBeNull();

    await setRest(10);
    await advance(5000);
    expect(autoSave).toHaveBeenCalledTimes(1);
    expect(app.file.dirty).toBe(true);
  });

  it('is not tried again by a write that waited when the first one has failed', async () => {
    const { autoSave, setAuto } = await mountWithOpenFile();
    const first = deferred();
    autoSave.mockImplementationOnce(() => first.promise);
    await setRest(11);
    await advance(1000); // in flight
    await setRest(10);
    await advance(1000); // waiting for the first

    setAuto(false); // the adapter stops saving by itself after a failure
    await act(async () => first.reject(new Error('The disk is full.')));
    await advance(5000);
    expect(autoSave).toHaveBeenCalledTimes(1);
    expect(app.file).toMatchObject({ dirty: true, auto: false });
  });

  it('is not repeated for the data of a file that has just been opened', async () => {
    const { storage, autoSave } = await mountWithOpenFile();
    await setRest(11); // a write now waits for its second
    storage.openFile = async () => otherPlan();
    await act(() => app.openFile());
    await advance(5000);
    expect(autoSave).not.toHaveBeenCalled();
    expect(app.data?.people[0].name).toBe('Jiný plán');
    expect(app.file.dirty).toBe(false);
  });

  it('writes the data of a file opened meanwhile, never the old data, when it waited', async () => {
    const { storage, autoSave } = await mountWithOpenFile();
    const first = deferred();
    autoSave.mockImplementationOnce(() => first.promise);
    await setRest(11);
    await advance(1000); // in flight
    await setRest(10);
    await advance(1000); // waiting for the first
    storage.openFile = async () => otherPlan();
    await act(() => app.openFile());

    await act(async () => first.resolve());
    expect(autoSave).toHaveBeenCalledTimes(2);
    const written = autoSave.mock.calls[1][0];
    expect(written.people[0].name).toBe('Jiný plán');
    expect(written.settings.minRestHours).toBe(newAppData().settings.minRestHours);
  });

  it('writes a change made to a new file after the write that was in flight', async () => {
    const { storage, autoSave } = await mountWithOpenFile();
    const first = deferred();
    autoSave.mockImplementationOnce(() => first.promise);
    await setRest(11);
    await advance(1000); // in flight
    await setRest(10);
    await advance(1000); // waiting for the first
    storage.openFile = async () => otherPlan();
    await act(() => app.openFile());
    await setRest(9); // a change to the new file
    await advance(1000);

    await act(async () => first.resolve());
    await advance(5000);
    const last = autoSave.mock.calls[autoSave.mock.calls.length - 1][0];
    expect(last.people[0].name).toBe('Jiný plán');
    expect(last.settings.minRestHours).toBe(9);
  });

  it('ignores the failure of a write to a file that has been left', async () => {
    const { storage, autoSave } = await mountWithOpenFile();
    const first = deferred();
    autoSave.mockImplementationOnce(() => first.promise);
    await setRest(11);
    await advance(1000);
    storage.openFile = async () => otherPlan();
    await act(() => app.openFile());

    await act(async () => first.reject(new Error('The file is gone.')));
    expect(app.file).toMatchObject({ dirty: false, auto: true });
  });
});

describe('saving to the file', () => {
  it('writes the data, then notes the time and the name of the file', async () => {
    const storage = memoryStorage(newAppData());
    mount(storage);
    await act(() => app.saveFile());
    expect(storage.saved).toEqual([serialize(app.data as AppData)]);
    expect(app.file).toEqual({
      name: 'plan-smen.json',
      savedAt: NOW.toISOString(),
      dirty: false,
      auto: false,
    });
  });

  it('takes the name and the state of auto-saving from the storage afterwards', async () => {
    const storage = memoryStorage(newAppData());
    storage.saveFile = async () => {
      storage.fileName = () => 'z-vyberu.json';
      storage.canAutoSave = () => true;
      return 'z-vyberu.json';
    };
    mount(storage);
    await act(() => app.saveFile());
    expect(app.file).toMatchObject({ name: 'z-vyberu.json', auto: true, dirty: false });
  });

  it('does nothing without data', async () => {
    const storage = memoryStorage(null);
    const saveFile = vi.spyOn(storage, 'saveFile');
    mount(storage);
    await act(() => app.saveFile());
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('waits for a write in flight, then saves the latest data', async () => {
    const { storage, autoSave } = await mountWithOpenFile();
    const write = deferred();
    autoSave.mockImplementationOnce(() => write.promise);
    const saveFile = vi.spyOn(storage, 'saveFile');

    await setRest(11);
    await advance(1000); // the auto-save is in flight
    let saved!: Promise<void>;
    await act(async () => {
      saved = app.saveFile();
    });
    await setRest(10); // while the save waits for its turn
    expect(saveFile).not.toHaveBeenCalled();

    await act(async () => {
      write.resolve();
      await saved;
    });
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile.mock.calls[0][0].settings.minRestHours).toBe(10);
  });

  it('leaves the status unsaved when the data changed while it was being saved', async () => {
    const storage = memoryStorage(newAppData());
    const write = deferred<string>();
    storage.saveFile = () => write.promise;
    mount(storage);
    let saved!: Promise<void>;
    await act(async () => {
      saved = app.saveFile();
    });

    await setRest(11); // the file is being written with the data from before
    await act(async () => {
      write.resolve('plan-smen.json');
      await saved;
    });
    expect(app.file.dirty).toBe(true);
  });

  it('writes a change made during a first save once saving by itself is on', async () => {
    const storage = memoryStorage(newAppData());
    let auto = false;
    storage.canAutoSave = () => auto;
    const write = deferred<string>();
    storage.saveFile = () => write.promise;
    const autoSave = vi.spyOn(storage, 'autoSave');
    mount(storage);
    let saved!: Promise<void>;
    await act(async () => {
      saved = app.saveFile();
    });

    await setRest(11); // dirty: nothing could save it by itself at that moment
    auto = true; // the picker has made the file the current one
    await act(async () => {
      write.resolve('plan.json');
      await saved;
    });
    expect(app.file).toMatchObject({ dirty: false, auto: true });
    expect(autoSave).not.toHaveBeenCalled();
    await advance(1000);
    expect(autoSave).toHaveBeenCalledTimes(1);
    expect(autoSave.mock.calls[0][0].settings.minRestHours).toBe(11);
  });

  it('changes nothing when the user cancels the picker', async () => {
    const storage = memoryStorage(newAppData());
    storage.saveFile = async () => {
      throw abortError();
    };
    mount(storage);
    const before = app.file;
    await act(() => app.saveFile());
    expect(app.error).toBeNull();
    expect(app.file).toEqual(before);
  });

  it.each([
    ['a file that is no good', new SaveFileError('Soubor je poškozený.'), 'Soubor je poškozený.'],
    ['a refused write', new DOMException('No.', 'NotAllowedError'), 'Soubor se nepodařilo uložit.'],
    ['a failed write', new Error('The disk is full.'), 'Soubor se nepodařilo uložit.'],
    ['something that is no error', 'boom', 'Soubor se nepodařilo uložit.'],
  ])('shows an error and keeps the data on %s', async (_, failure, message) => {
    const cached = newAppData();
    const storage = memoryStorage(cached);
    storage.saveFile = async () => {
      throw failure;
    };
    mount(storage);
    await act(() => app.saveFile());
    expect(app.error).toBe(message);
    expect(app.data).toEqual(cached);
    expect(app.file.dirty).toBe(true);
  });

  it('clears the error when the next save works', async () => {
    const storage = memoryStorage(newAppData());
    const saveFile = vi.spyOn(storage, 'saveFile');
    saveFile.mockRejectedValueOnce(new Error('The disk is full.'));
    mount(storage);
    await act(() => app.saveFile());
    expect(app.error).not.toBeNull();
    await act(() => app.saveFile());
    expect(app.error).toBeNull();
    expect(app.file.dirty).toBe(false);
  });
});

describe('opening a file', () => {
  it('replaces the data and says that the page now matches the file', async () => {
    const storage = memoryStorage(newAppData());
    const opened = otherPlan();
    storage.openFile = async () => {
      storage.fileName = () => 'jiny.json';
      storage.canAutoSave = () => true;
      return opened;
    };
    const autoSave = vi.spyOn(storage, 'autoSave');
    mount(storage);
    await act(() => app.openFile());

    expect(app.data).toEqual(opened);
    expect(app.file).toEqual({
      name: 'jiny.json',
      savedAt: NOW.toISOString(),
      dirty: false,
      auto: true,
    });
    await advance(300);
    expect(storage.loadCache()).toEqual(opened);
    await advance(5000);
    expect(autoSave).not.toHaveBeenCalled(); // the file has these data already
  });

  it('changes nothing when the user cancels the picker', async () => {
    const cached = newAppData();
    const storage = memoryStorage(cached);
    storage.openFile = async () => null;
    mount(storage);
    const before = app.file;
    await act(() => app.openFile());
    expect(app.data).toEqual(cached);
    expect(app.file).toEqual(before);
    expect(app.error).toBeNull();
  });

  it('changes nothing when the browser reports an aborted picker', async () => {
    const cached = newAppData();
    const storage = memoryStorage(cached);
    storage.openFile = async () => {
      throw abortError();
    };
    mount(storage);
    await act(() => app.openFile());
    expect(app.data).toEqual(cached);
    expect(app.error).toBeNull();
  });

  it.each([
    ['a file that is no good', new SaveFileError('Soubor je poškozený.'), 'Soubor je poškozený.'],
    ['a refused read', new DOMException('No.', 'NotAllowedError'), 'Soubor se nepodařilo otevřít.'],
    ['any other failure', new Error('boom'), 'Soubor se nepodařilo otevřít.'],
  ])('shows an error and keeps the data on %s', async (_, failure, message) => {
    const cached = newAppData();
    const storage = memoryStorage(cached);
    storage.openFile = async () => {
      throw failure;
    };
    mount(storage);
    await act(() => app.openFile());
    expect(app.error).toBe(message);
    expect(app.data).toEqual(cached);
    expect(app.file).toMatchObject({ dirty: true, savedAt: null });
  });

  it('clears the error when the next open works', async () => {
    const storage = memoryStorage(newAppData());
    storage.openFile = async () => {
      throw new SaveFileError('Soubor je poškozený.');
    };
    mount(storage);
    await act(() => app.openFile());
    expect(app.error).not.toBeNull();

    storage.openFile = async () => otherPlan();
    await act(() => app.openFile());
    expect(app.error).toBeNull();
    expect(app.data?.people[0].name).toBe('Jiný plán');
  });
});

describe('the error', () => {
  it('is dismissed on request', async () => {
    const storage = memoryStorage(newAppData());
    storage.openFile = async () => {
      throw new Error('boom');
    };
    mount(storage);
    await act(() => app.openFile());
    act(() => app.dismissError());
    expect(app.error).toBeNull();
  });

  it('is cleared by starting a new plan', async () => {
    const storage = memoryStorage(null);
    storage.openFile = async () => {
      throw new SaveFileError('Soubor je poškozený.');
    };
    mount(storage);
    await act(() => app.openFile());
    expect(app.error).toBe('Soubor je poškozený.');
    act(() => app.newData());
    expect(app.error).toBeNull();
  });
});

describe('loads, the count of times the data was replaced', () => {
  it('starts at 0, with cached data and without', () => {
    mount(memoryStorage(newAppData()));
    expect(app.loads).toBe(0);
    mount(memoryStorage(null));
    expect(app.loads).toBe(0);
  });

  it('goes up by one for each file that is opened', async () => {
    const storage = memoryStorage(newAppData());
    storage.openFile = async () => otherPlan();
    mount(storage);
    await act(() => app.openFile());
    expect(app.loads).toBe(1);
    await act(() => app.openFile());
    expect(app.loads).toBe(2);
  });

  it.each([
    ['a cancelled picker', async () => null],
    [
      'an aborted picker',
      async () => {
        throw abortError();
      },
    ],
    [
      'a file that is no good',
      async () => {
        throw new SaveFileError('Soubor je poškozený.');
      },
    ],
  ])('stays where it was after %s', async (_, open) => {
    const storage = memoryStorage(newAppData());
    storage.openFile = open;
    mount(storage);
    await act(() => app.openFile());
    expect(app.loads).toBe(0);
  });

  it('goes up by one for a new plan, and for any other load', () => {
    mount(memoryStorage(null));
    act(() => app.newData());
    expect(app.loads).toBe(1);
    act(() => app.dispatch({ type: 'load', data: otherPlan() }));
    expect(app.loads).toBe(2);
  });

  it('does not move for a change of the data, nor for a load of the data it already holds', async () => {
    const held = newAppData();
    mount(memoryStorage(held));
    await setRest(10);
    act(() => app.dispatch({ type: 'addPerson', id: 'new-id' }));
    act(() => app.dispatch({ type: 'load', data: app.data as AppData }));
    expect(app.loads).toBe(0);
  });

  it('is not moved by saving to the file', async () => {
    mount(memoryStorage(newAppData()));
    await act(() => app.saveFile());
    expect(app.loads).toBe(0);
  });
});

describe('an action stamped with loads', () => {
  const change = { type: 'updateSettings', patch: { minRestHours: 10 } } as const;

  it('is applied while the data is the one it was meant for', async () => {
    mount(memoryStorage(newAppData()));
    act(() => app.dispatch(change, app.loads));
    expect(rest()).toBe(10);
  });

  it('is dropped once the data has been replaced, even before the screen has caught up', async () => {
    const storage = memoryStorage(newAppData());
    storage.openFile = async () => otherPlan();
    mount(storage);
    const meant = app.loads;
    await act(async () => {
      await app.openFile();
      // Still the screen's old render: React has not drawn the new count yet.
      expect(app.loads).toBe(meant);
      app.dispatch(change, meant);
    });
    expect(app.loads).toBe(meant + 1);
    expect(rest()).toBe(12);
    expect(app.data?.people[0].name).toBe('Jiný plán');
  });

  it('is dropped after a new plan was started, too', () => {
    mount(memoryStorage(newAppData()));
    const meant = app.loads;
    act(() => {
      app.newData();
      app.dispatch(change, meant);
    });
    expect(rest()).toBe(12);
  });

  it('is applied when it carries the count of the data now held', async () => {
    const storage = memoryStorage(newAppData());
    storage.openFile = async () => otherPlan();
    mount(storage);
    await act(() => app.openFile());
    act(() => app.dispatch(change, app.loads));
    expect(rest()).toBe(10);
  });
});

describe('leaving the page', () => {
  /**
   * What the browser does when the page is about to go away: it fires `beforeunload`, and asks the
   * user to confirm if the handler objects. jsdom takes `returnValue = ''` on a plain event for a
   * cancel, and a BeforeUnloadEvent cannot be made there, so the event is given a `returnValue` of
   * its own, as the browser's has: the test sees both ways of objecting.
   */
  function leave() {
    const event = new Event('beforeunload', { cancelable: true });
    Object.defineProperty(event, 'returnValue', { value: undefined, writable: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    act(() => void window.dispatchEvent(event));
    return { objected: preventDefault.mock.calls.length > 0, returnValue: event.returnValue };
  }
  const objects = () => leave().objected;

  it('lets an untouched page go: cached data counts as unsaved, but it was not changed here', () => {
    mount(memoryStorage(newAppData()));
    expect(app.file.dirty).toBe(true);
    expect(leave()).toEqual({ objected: false, returnValue: undefined });
  });

  it('lets a page with no data go', () => {
    mount(memoryStorage(null));
    expect(objects()).toBe(false);
  });

  it('objects to a change made here, with a return value, as the browsers ask for', async () => {
    mount(memoryStorage(newAppData()));
    await setRest(11);
    expect(leave()).toEqual({ objected: true, returnValue: '' });
  });

  it('objects to a new plan that is not in a file', () => {
    mount(memoryStorage(null));
    act(() => app.newData());
    expect(objects()).toBe(true);
  });

  it('does not object to an action that changes nothing', async () => {
    mount(memoryStorage(newAppData()));
    act(() => app.dispatch({ type: 'togglePin', date: '2027-01-04', personId: 'p1' }));
    expect(objects()).toBe(false);
  });

  it('objects while the cache has the change but no file does, and after the cache is written', async () => {
    mount(memoryStorage(newAppData()));
    await setRest(11);
    await advance(300); // the cache has it
    expect(objects()).toBe(true);
  });

  it('stops objecting once the data has been saved to a file', async () => {
    const storage = memoryStorage(newAppData());
    mount(storage);
    await setRest(11);
    expect(objects()).toBe(true);
    await act(() => app.saveFile());
    expect(storage.saved).toHaveLength(1);
    expect(objects()).toBe(false);
    await setRest(10); // and it starts again with the next change
    expect(objects()).toBe(true);
  });

  it('goes on objecting when a change came in while the file was being saved', async () => {
    const storage = memoryStorage(newAppData());
    const write = deferred<string>();
    storage.saveFile = () => write.promise;
    mount(storage);
    await setRest(11);
    let saved!: Promise<void>;
    await act(async () => {
      saved = app.saveFile();
    });
    await setRest(10); // the file is being written with the data from before
    await act(async () => {
      write.resolve('plan-smen.json');
      await saved;
    });
    expect(objects()).toBe(true);
  });

  it('goes on objecting when the save fails or is cancelled', async () => {
    const storage = memoryStorage(newAppData());
    const saveFile = vi.spyOn(storage, 'saveFile');
    mount(storage);
    await setRest(11);
    saveFile.mockRejectedValueOnce(new Error('The disk is full.'));
    await act(() => app.saveFile());
    expect(objects()).toBe(true);
    saveFile.mockRejectedValueOnce(abortError());
    await act(() => app.saveFile());
    expect(objects()).toBe(true);
  });

  it('stops objecting once another file has replaced the data', async () => {
    const storage = memoryStorage(newAppData());
    storage.openFile = async () => otherPlan();
    mount(storage);
    await setRest(11);
    expect(objects()).toBe(true);
    await act(() => app.openFile());
    expect(app.data?.people[0].name).toBe('Jiný plán');
    expect(objects()).toBe(false);
  });

  it('goes on objecting when opening a file is cancelled or fails', async () => {
    const storage = memoryStorage(newAppData());
    mount(storage);
    await setRest(11);
    await act(() => app.openFile()); // memoryStorage opens nothing: null, as for a cancel
    expect(objects()).toBe(true);
    storage.openFile = async () => {
      throw new SaveFileError('Soubor je poškozený.');
    };
    await act(() => app.openFile());
    expect(objects()).toBe(true);
  });

  it('objects until auto-save has written the change to the file, and not after', async () => {
    const { autoSave } = await mountWithOpenFile();
    expect(objects()).toBe(false); // just opened: the page matches the file
    await setRest(11);
    expect(objects()).toBe(true); // the file has not got it yet
    await advance(999);
    expect(objects()).toBe(true);
    await advance(1);
    expect(autoSave).toHaveBeenCalledTimes(1);
    expect(objects()).toBe(false);
  });

  it('goes on objecting while an auto-save is in flight, and when it has not caught up', async () => {
    const { autoSave } = await mountWithOpenFile();
    const write = deferred();
    autoSave.mockImplementationOnce(() => write.promise);
    await setRest(11);
    await advance(1000); // in flight
    expect(objects()).toBe(true);
    await setRest(10); // while it is
    await act(async () => write.resolve());
    expect(objects()).toBe(true); // the file has the 11, not the 10
    await advance(1000);
    expect(autoSave).toHaveBeenCalledTimes(2);
    expect(objects()).toBe(false);
  });

  it('goes on objecting when auto-save fails', async () => {
    const { autoSave, setAuto } = await mountWithOpenFile();
    autoSave.mockImplementationOnce(async () => {
      setAuto(false);
      throw new Error('The disk is full.');
    });
    await setRest(11);
    await advance(1000);
    expect(app.file.dirty).toBe(true);
    expect(objects()).toBe(true);
  });

  it('goes on objecting when a change meets a file that can no longer be saved to by itself', async () => {
    const { setAuto } = await mountWithOpenFile();
    setAuto(false);
    await setRest(11);
    await advance(5000);
    expect(objects()).toBe(true);
  });

  it('is not fooled by a write to a file that has been left behind', async () => {
    const { autoSave } = await mountWithOpenFile();
    const first = deferred();
    autoSave.mockImplementationOnce(() => first.promise);
    await setRest(11);
    await advance(1000); // a write of the old data is in flight
    await act(() => app.openFile()); // another file, which matches the page
    expect(objects()).toBe(false);
    await act(async () => first.resolve());
    expect(objects()).toBe(false);
  });

  it('asks once, in strict mode too, and no longer after the provider is gone', async () => {
    const { unmount } = mount(memoryStorage(newAppData()), true);
    await setRest(11);
    const event = new Event('beforeunload', { cancelable: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    act(() => void window.dispatchEvent(event));
    expect(preventDefault).toHaveBeenCalledTimes(1);
    unmount();
    expect(objects()).toBe(false);
  });
});
