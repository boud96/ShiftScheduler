// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProvider, useApp } from './store';
import { App } from './App';
import { memoryStorage } from '../storage/adapter';
import type { StorageAdapter } from '../storage/adapter';
import { inProcessRunner } from '../worker/runner';
import { newAppData } from '../domain/defaults';
import type { AppData } from '../domain/types';
import { SaveFileError } from '../storage/saveFile';

afterEach(() => {
  vi.restoreAllMocks(); // the confirm spies
  vi.useRealTimers(); // the clock
});

const CONFIRM_OPEN = 'Změny, které nejsou uložené do souboru, se ztratí. Otevřít jiný soubor?';

/** A button that changes the data, since the screens that do are not here yet. */
function EditButton() {
  const { dispatch } = useApp();
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'updateSettings', patch: { minRestHours: 10 } })}
    >
      Změnit
    </button>
  );
}

function renderApp(storage: StorageAdapter) {
  return render(
    <AppProvider storage={storage} runner={inProcessRunner}>
      <App />
      <EditButton />
    </AppProvider>,
  );
}

/** A plan that differs from the others by the first name. */
function otherPlan(): AppData {
  const data = newAppData();
  data.people[0].name = 'Jiný plán';
  return data;
}

const abortError = () => new DOMException('The user aborted a request.', 'AbortError');

// --- The brief's tests -----------------------------------------------------------------------

it('shows the start screen when nothing is cached, then the app', async () => {
  render(
    <AppProvider storage={memoryStorage(null)} runner={inProcessRunner}>
      <App />
    </AppProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Začít nový' }));
  for (const name of ['Měsíc', 'Tým', 'Pravidla']) {
    expect(screen.getByRole('tab', { name })).toBeInTheDocument();
  }
  expect(screen.getByText('Změny nejsou uložené do souboru')).toBeInTheDocument();
});

it('opens the app directly from the cache', () => {
  render(
    <AppProvider storage={memoryStorage(newAppData())} runner={inProcessRunner}>
      <App />
    </AppProvider>,
  );
  expect(screen.queryByRole('button', { name: 'Začít nový' })).toBeNull();
});

it('keeps data and shows the error when a file is broken', async () => {
  // Ruled deviation: the data comes from the cache, so it is not known to be in a file, and
  // opening another file asks first.
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const s = memoryStorage(newAppData());
  s.openFile = async () => {
    throw new SaveFileError('Soubor je poškozený.');
  };
  render(
    <AppProvider storage={s} runner={inProcessRunner}>
      <App />
    </AppProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
  expect(await screen.findByText('Soubor je poškozený.')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Měsíc' })).toBeInTheDocument();
});

// --- The start screen -------------------------------------------------------------------------

describe('the start screen', () => {
  it('has the title, a sentence about the data, and the two buttons', () => {
    renderApp(memoryStorage(null));
    expect(screen.getByRole('heading', { level: 1, name: 'Plánování směn' })).toBeInTheDocument();
    expect(
      screen.getByText('Všechna data zůstávají jen na tomto počítači, nikam se neodesílají.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Otevřít soubor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Začít nový' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('opens a file without asking, and then says when it was saved', async () => {
    vi.setSystemTime(new Date('2027-01-04T08:05:00Z')); // 9:05 in Prague
    const confirm = vi.spyOn(window, 'confirm');
    const storage = memoryStorage(null);
    storage.openFile = async () => otherPlan();
    renderApp(storage);

    await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
    expect(await screen.findByRole('tab', { name: 'Měsíc' })).toBeInTheDocument();
    expect(screen.getByText('Uloženo do souboru 9:05')).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('stays when the user cancels the picker', async () => {
    const storage = memoryStorage(null);
    storage.openFile = async () => null;
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
    expect(screen.getByRole('button', { name: 'Začít nový' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error on the start screen when the file is broken', async () => {
    const storage = memoryStorage(null);
    storage.openFile = async () => {
      throw new SaveFileError('Tohle není soubor s plánem směn.');
    };
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
    expect(await screen.findByText('Tohle není soubor s plánem směn.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Začít nový' })).toBeInTheDocument();
  });

  it('clears the error when a new plan is started', async () => {
    const storage = memoryStorage(null);
    storage.openFile = async () => {
      throw new SaveFileError('Soubor je poškozený.');
    };
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
    await screen.findByText('Soubor je poškozený.');
    await userEvent.click(screen.getByRole('button', { name: 'Začít nový' }));
    expect(screen.queryByText('Soubor je poškozený.')).toBeNull();
  });
});

// --- The shell --------------------------------------------------------------------------------

describe('the shell', () => {
  it('has the title, the save bar and the three tabs', () => {
    renderApp(memoryStorage(newAppData()));
    expect(screen.getByRole('heading', { level: 1, name: 'Plánování směn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uložit do souboru' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Měsíc',
      'Tým',
      'Pravidla',
    ]);
  });

  it('shows one tab panel at a time, each still being prepared', async () => {
    renderApp(memoryStorage(newAppData()));
    expect(screen.getByRole('tab', { name: 'Měsíc' })).toHaveAttribute('aria-selected', 'true');

    for (const name of ['Tým', 'Pravidla', 'Měsíc']) {
      await userEvent.click(screen.getByRole('tab', { name }));
      expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
      const panel = screen.getByRole('tabpanel', { name });
      expect(panel).toHaveTextContent('Připravuje se…');
    }
  });
});

// --- The save bar -----------------------------------------------------------------------------

describe('the save bar', () => {
  it('says that the changes are not in a file when the data came from the cache', () => {
    renderApp(memoryStorage(newAppData()));
    expect(screen.getByText('Změny nejsou uložené do souboru')).toBeInTheDocument();
  });

  it.each([
    ['2027-01-04T08:05:00Z', '9:05'],
    ['2027-07-05T12:03:00Z', '14:03'],
    ['2027-01-04T23:00:00Z', '0:00'],
  ])('says when it saved to the file, in local time: %s is %s', async (when, shown) => {
    vi.setSystemTime(new Date(when));
    const storage = memoryStorage(newAppData());
    renderApp(storage);

    await userEvent.click(screen.getByRole('button', { name: 'Uložit do souboru' }));
    expect(await screen.findByText(`Uloženo do souboru ${shown}`)).toBeInTheDocument();
    expect(storage.saved).toHaveLength(1);
    expect(screen.queryByText('Změny nejsou uložené do souboru')).toBeNull();
  });

  it('goes back to unsaved after a change', async () => {
    renderApp(memoryStorage(newAppData()));
    await userEvent.click(screen.getByRole('button', { name: 'Uložit do souboru' }));
    await screen.findByText(/^Uloženo do souboru/);

    await userEvent.click(screen.getByRole('button', { name: 'Změnit' }));
    expect(screen.getByText('Změny nejsou uložené do souboru')).toBeInTheDocument();
  });

  it('says that it saves by itself, and where, when it can', async () => {
    const storage = memoryStorage(null);
    storage.openFile = async () => {
      storage.fileName = () => 'plan.json';
      storage.canAutoSave = () => true;
      return newAppData();
    };
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
    expect(await screen.findByText('Ukládá se automaticky do plan.json')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Změnit' }));
    expect(screen.getByText('Ukládá se automaticky do plan.json')).toBeInTheDocument();
  });

  it('asks before opening another file while changes are not in a file', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const storage = memoryStorage(newAppData());
    storage.openFile = async () => otherPlan();
    renderApp(storage);

    await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
    expect(confirm).toHaveBeenCalledExactlyOnceWith(CONFIRM_OPEN);
    expect(await screen.findByText(/^Uloženo do souboru/)).toBeInTheDocument();
  });

  it('opens nothing and keeps the data when the question is declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const storage = memoryStorage(newAppData());
    const openFile = vi.fn(async () => otherPlan());
    storage.openFile = openFile;
    renderApp(storage);

    await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
    expect(confirm).toHaveBeenCalledExactlyOnceWith(CONFIRM_OPEN);
    expect(openFile).not.toHaveBeenCalled();
    expect(screen.getByText('Změny nejsou uložené do souboru')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Měsíc' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(storage.loadCache()).toEqual(newAppData());
  });

  it('does not ask when everything is in the file', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const storage = memoryStorage(newAppData());
    const openFile = vi.fn(async () => null);
    storage.openFile = openFile;
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Uložit do souboru' }));
    await screen.findByText(/^Uloženo do souboru/);

    await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(openFile).toHaveBeenCalledOnce();
  });

  it('asks again after the next change', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderApp(memoryStorage(newAppData()));
    await userEvent.click(screen.getByRole('button', { name: 'Uložit do souboru' }));
    await screen.findByText(/^Uloženo do souboru/);
    await userEvent.click(screen.getByRole('button', { name: 'Změnit' }));

    await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
    expect(confirm).toHaveBeenCalledOnce();
  });
});

// --- Errors -----------------------------------------------------------------------------------

describe('errors', () => {
  it('shows a general message when the file cannot be opened for another reason', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const storage = memoryStorage(newAppData());
    storage.openFile = async () => {
      throw new Error('boom');
    };
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Soubor se nepodařilo otevřít.');
  });

  it('shows a general message when the file cannot be saved', async () => {
    const storage = memoryStorage(newAppData());
    storage.saveFile = async () => {
      throw new DOMException('Write access to the file was refused.', 'NotAllowedError');
    };
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Uložit do souboru' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Soubor se nepodařilo uložit.');
    expect(screen.getByText('Změny nejsou uložené do souboru')).toBeInTheDocument();
  });

  it('shows nothing when the user cancels a picker', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const storage = memoryStorage(newAppData());
    storage.openFile = async () => {
      throw abortError();
    };
    storage.saveFile = async () => {
      throw abortError();
    };
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
    await userEvent.click(screen.getByRole('button', { name: 'Uložit do souboru' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Měsíc' })).toBeInTheDocument();
  });

  it('is dismissed with Zavřít', async () => {
    const storage = memoryStorage(newAppData());
    storage.saveFile = async () => {
      throw new Error('boom');
    };
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Uložit do souboru' }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Zavřít' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('goes away when the next save works', async () => {
    const storage = memoryStorage(newAppData());
    const saveFile = vi.spyOn(storage, 'saveFile');
    saveFile.mockRejectedValueOnce(new Error('boom'));
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Uložit do souboru' }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Uložit do souboru' }));
    expect(await screen.findByText(/^Uloženo do souboru/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
