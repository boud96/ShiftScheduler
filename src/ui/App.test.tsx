// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProvider, useApp } from './store';
import { App } from './App';
import { browserStorage, memoryStorage } from '../storage/adapter';
import type { StorageAdapter } from '../storage/adapter';
import { inProcessRunner } from '../worker/runner';
import { newAppData } from '../domain/defaults';
import type { AppData } from '../domain/types';
import { SaveFileError, serialize } from '../storage/saveFile';
import { PLAN_ERROR, TAB_PANEL_SOON } from './text';

afterEach(() => {
  vi.restoreAllMocks(); // the spies
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

/** A screen with state of its own, as the real ones have: it counts clicks on its button. */
function Counter() {
  const [clicks, setClicks] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setClicks(clicks + 1)}>
        Klik
      </button>
      <p>{`Kliknuto: ${clicks}`}</p>
    </>
  );
}

/**
 * The panel that a tab controls. A hidden panel has no accessible name, so it cannot be found by
 * name; it is found by the id that its tab names.
 */
const panelOf = (tab: HTMLElement): HTMLElement =>
  document.getElementById(tab.getAttribute('aria-controls') ?? '') as HTMLElement;

/**
 * What a tab shows in these tests, unless a test puts in a screen: a placeholder. They are about
 * the shell, so they do not walk the month grid or the cards, which would make them slow.
 */
function Stub() {
  return <p>{TAB_PANEL_SOON}</p>;
}

const STUBS = { month: Stub, team: Stub, rules: Stub };

function renderApp(storage: StorageAdapter, screens?: ComponentProps<typeof App>['screens']) {
  return render(
    <AppProvider storage={storage} runner={inProcessRunner}>
      <App screens={{ ...STUBS, ...screens }} />
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

/** Opens another file over changes that are not in a file: asks, then answers yes. */
async function openAnyway() {
  await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
  await userEvent.click(screen.getByRole('button', { name: 'Otevřít jiný soubor' }));
}

// --- The brief's tests -----------------------------------------------------------------------

it('shows the start screen when there is no plan yet, then the app', async () => {
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

it('always opens at the start screen, whatever an older version left in the browser', () => {
  // Phase 1.1 and older kept a copy of the plan in localStorage and opened it by themselves.
  localStorage.setItem('shift-scheduler/v1', serialize(newAppData()));
  try {
    renderApp(browserStorage());
    expect(screen.getByRole('button', { name: 'Začít nový' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Otevřít soubor' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
  } finally {
    localStorage.clear();
  }
});

it('goes straight to the app when the storage hands in a plan, as the tests do', () => {
  render(
    <AppProvider storage={memoryStorage(newAppData())} runner={inProcessRunner}>
      <App />
    </AppProvider>,
  );
  expect(screen.queryByRole('button', { name: 'Začít nový' })).toBeNull();
});

it('keeps data and shows the error when a file is broken', async () => {
  // Ruled deviation: the data the test starts with is not known to be in a file, so
  // opening another file asks first, in a dialog on the page (R33, R38). The test says yes.
  const s = memoryStorage(newAppData());
  s.openFile = async () => {
    throw new SaveFileError('Soubor je poškozený.');
  };
  render(
    <AppProvider storage={s} runner={inProcessRunner}>
      <App />
    </AppProvider>,
  );
  await openAnyway();
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
    expect(screen.queryByRole('alertdialog')).toBeNull();
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
    for (const name of ['Uložit', 'Uložit jako…', 'Otevřít soubor']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Měsíc',
      'Tým',
      'Pravidla',
    ]);
  });

  it('has a panel for each tab, labelled by it, all of them in the page', () => {
    renderApp(memoryStorage(newAppData()));
    expect(screen.getAllByText('Připravuje se…')).toHaveLength(3);
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(3);
    for (const name of ['Měsíc', 'Tým', 'Pravidla']) {
      const tab = screen.getByRole('tab', { name });
      const panel = panelOf(tab);
      expect(panel).toHaveAttribute('role', 'tabpanel');
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
      expect(panel).toHaveTextContent('Připravuje se…');
    }
  });

  it('shows only the panel of the selected tab, and hides the other two', async () => {
    renderApp(memoryStorage(newAppData()));
    expect(screen.getByRole('tab', { name: 'Měsíc' })).toHaveAttribute('aria-selected', 'true');

    for (const name of ['Tým', 'Pravidla', 'Měsíc']) {
      await userEvent.click(screen.getByRole('tab', { name }));
      expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);

      // A role query reaches the visible panel alone, and that is the one of the selected tab.
      const visible = screen.getAllByRole('tabpanel');
      expect(visible).toHaveLength(1);
      expect(visible[0]).toBe(screen.getByRole('tabpanel', { name }));
      expect(visible[0]).toBeVisible();
      const panels = screen.getAllByRole('tabpanel', { hidden: true });
      expect(panels.filter((panel) => panel.hidden)).toHaveLength(2);
    }
  });

  it('keeps the state of a screen while another tab is open', async () => {
    renderApp(memoryStorage(newAppData()), { month: Counter });
    const month = () => panelOf(screen.getByRole('tab', { name: 'Měsíc' }));
    await userEvent.click(within(month()).getByRole('button', { name: 'Klik' }));
    await userEvent.click(within(month()).getByRole('button', { name: 'Klik' }));
    expect(within(month()).getByText('Kliknuto: 2')).toBeVisible();

    await userEvent.click(screen.getByRole('tab', { name: 'Tým' }));
    expect(within(month()).getByText('Kliknuto: 2')).not.toBeVisible(); // still there, unseen

    await userEvent.click(screen.getByRole('tab', { name: 'Měsíc' }));
    expect(within(month()).getByText('Kliknuto: 2')).toBeVisible();
  });

  it('gives each panel a state of its own, and a role query one panel at a time', async () => {
    renderApp(memoryStorage(newAppData()), { month: Counter, team: Counter, rules: Counter });
    expect(screen.getAllByRole('button', { name: 'Klik', hidden: true })).toHaveLength(3);

    await userEvent.click(screen.getByRole('button', { name: 'Klik' })); // the month's
    await userEvent.click(screen.getByRole('tab', { name: 'Pravidla' }));
    await userEvent.click(screen.getByRole('button', { name: 'Klik' })); // the rules'
    await userEvent.click(screen.getByRole('button', { name: 'Klik' }));

    const count = (name: string) =>
      within(panelOf(screen.getByRole('tab', { name }))).getByText(/^Kliknuto/);
    expect(count('Měsíc')).toHaveTextContent('Kliknuto: 1');
    expect(count('Tým')).toHaveTextContent('Kliknuto: 0');
    expect(count('Pravidla')).toHaveTextContent('Kliknuto: 2');
  });
});

// --- The save bar -----------------------------------------------------------------------------

describe('the save bar', () => {
  it('says that the changes are not in a file when the data is in no file yet', () => {
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

    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByText(`Uloženo do souboru ${shown}`)).toBeInTheDocument();
    expect(storage.saved).toHaveLength(1);
    expect(screen.queryByText('Změny nejsou uložené do souboru')).toBeNull();
  });

  it('goes back to unsaved after a change', async () => {
    renderApp(memoryStorage(newAppData()));
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
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

  it('saves into a new file on Uložit jako…, and from then on names that file', async () => {
    const storage = memoryStorage(null);
    storage.openFile = async () => {
      storage.fileName = () => 'plan.json';
      storage.canAutoSave = () => true;
      return newAppData();
    };
    storage.saveFileAs = async (d) => {
      storage.saved.push(serialize(d));
      storage.fileName = () => 'novy.json';
      return 'novy.json';
    };
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
    await screen.findByText('Ukládá se automaticky do plan.json');

    await userEvent.click(screen.getByRole('button', { name: 'Uložit jako…' }));
    expect(await screen.findByText('Ukládá se automaticky do novy.json')).toBeInTheDocument();
    expect(storage.saved).toHaveLength(1);
  });

  it('stays as it was when Uložit jako… is cancelled', async () => {
    const storage = memoryStorage(newAppData());
    storage.saveFileAs = async () => {
      throw abortError();
    };
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Uložit jako…' }));
    expect(screen.getByText('Změny nejsou uložené do souboru')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// --- The question before another file is opened -----------------------------------------------

describe('the question before another file is opened', () => {
  const ask = () => userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
  const dialog = () => screen.getByRole('alertdialog', { name: 'Neuložené změny' });
  const button = (name: string) => within(dialog()).getByRole('button', { name });

  it('is a dialog on the page, named and described, with the focus on Zrušit', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    renderApp(memoryStorage(newAppData()));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await ask();
    expect(dialog()).toHaveAccessibleDescription(CONFIRM_OPEN);
    expect(within(dialog()).getByText(CONFIRM_OPEN)).toBeVisible();
    expect(dialog()).toHaveAttribute('aria-modal', 'true');
    const buttons = within(dialog()).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Otevřít jiný soubor', 'Zrušit']);
    expect(button('Zrušit')).toHaveFocus();
    expect(confirm).not.toHaveBeenCalled(); // the browser's own box is never used
  });

  it('opens the file on Otevřít jiný soubor, and the question goes away', async () => {
    const storage = memoryStorage(newAppData());
    const openFile = vi.fn(async () => otherPlan());
    storage.openFile = openFile;
    renderApp(storage);

    await openAnyway();
    expect(openFile).toHaveBeenCalledOnce();
    expect(await screen.findByText(/^Uloženo do souboru/)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('opens the picker straight from the click on Otevřít jiný soubor', async () => {
    // A browser opens a file picker only for a click that is fresh, so nothing may be awaited, and
    // no box may stay open, between that click and the call that opens it.
    const storage = memoryStorage(newAppData());
    const openFile = vi.fn(async () => otherPlan());
    storage.openFile = openFile;
    renderApp(storage);
    await ask();
    expect(openFile).not.toHaveBeenCalled();

    fireEvent.click(button('Otevřít jiný soubor'));
    expect(openFile).toHaveBeenCalledOnce(); // within the click, not after it
    await screen.findByText(/^Uloženo do souboru/);
  });

  it('opens nothing and keeps the data on Zrušit', async () => {
    const storage = memoryStorage(newAppData());
    const openFile = vi.fn(async () => otherPlan());
    storage.openFile = openFile;
    renderApp(storage);

    await ask();
    await userEvent.click(button('Zrušit'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(openFile).not.toHaveBeenCalled();
    expect(screen.getByText('Změny nejsou uložené do souboru')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Měsíc' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Otevřít soubor' })).toHaveFocus();
  });

  it('opens nothing and keeps the data on Escape', async () => {
    const storage = memoryStorage(newAppData());
    const openFile = vi.fn(async () => otherPlan());
    storage.openFile = openFile;
    renderApp(storage);

    await ask();
    expect(dialog()).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(openFile).not.toHaveBeenCalled();
    expect(screen.getByText('Změny nejsou uložené do souboru')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Otevřít soubor' })).toHaveFocus();
  });

  it('keeps the focus on its two buttons', async () => {
    renderApp(memoryStorage(newAppData()));
    await ask();
    expect(button('Zrušit')).toHaveFocus();

    await userEvent.tab();
    expect(button('Otevřít jiný soubor')).toHaveFocus();
    await userEvent.tab();
    expect(button('Zrušit')).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(button('Otevřít jiný soubor')).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(button('Zrušit')).toHaveFocus();
  });

  it('keeps the focus when its text or the page behind is clicked, so Escape works', async () => {
    renderApp(memoryStorage(newAppData()));
    await ask();
    await userEvent.click(within(dialog()).getByText(CONFIRM_OPEN));
    expect(button('Zrušit')).toHaveFocus();
    await userEvent.click(dialog().parentElement as HTMLElement); // the dimmed page behind it
    expect(button('Zrušit')).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('is not asked when everything is in the file', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const storage = memoryStorage(newAppData());
    const openFile = vi.fn(async () => null);
    storage.openFile = openFile;
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    await screen.findByText(/^Uloženo do souboru/);

    await ask();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    expect(openFile).toHaveBeenCalledOnce();
  });

  it('is asked again after the next change', async () => {
    renderApp(memoryStorage(newAppData()));
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    await screen.findByText(/^Uloženo do souboru/);
    await userEvent.click(screen.getByRole('button', { name: 'Změnit' }));

    await ask();
    expect(dialog()).toBeVisible();
  });
});

// --- Errors -----------------------------------------------------------------------------------

describe('errors', () => {
  it('shows a general message when the file cannot be opened for another reason', async () => {
    const storage = memoryStorage(newAppData());
    storage.openFile = async () => {
      throw new Error('boom');
    };
    renderApp(storage);
    await openAnyway();
    expect(await screen.findByRole('alert')).toHaveTextContent('Soubor se nepodařilo otevřít.');
  });

  it('shows a general message when the file cannot be saved', async () => {
    const storage = memoryStorage(newAppData());
    storage.saveFile = async () => {
      throw new DOMException('Write access to the file was refused.', 'NotAllowedError');
    };
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Soubor se nepodařilo uložit.');
    expect(screen.getByText('Změny nejsou uložené do souboru')).toBeInTheDocument();
  });

  it('shows nothing when the user cancels a picker', async () => {
    const storage = memoryStorage(newAppData());
    storage.openFile = async () => {
      throw abortError();
    };
    storage.saveFile = async () => {
      throw abortError();
    };
    renderApp(storage);
    await openAnyway();
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Měsíc' })).toBeInTheDocument();
  });

  it('is dismissed with Zavřít', async () => {
    const storage = memoryStorage(newAppData());
    storage.saveFile = async () => {
      throw new Error('boom');
    };
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Zavřít' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('goes away when the next save works', async () => {
    const storage = memoryStorage(newAppData());
    const saveFile = vi.spyOn(storage, 'saveFile');
    saveFile.mockRejectedValueOnce(new Error('boom'));
    renderApp(storage);
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(await screen.findByText(/^Uloženo do souboru/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// --- A page that cannot be drawn -----------------------------------------------------------------

describe('a page that cannot be drawn', () => {
  const BROKEN = 'Rozbitý plán';

  /** A screen that fails to draw while the first person has the broken name, as a bug would. */
  function Fragile() {
    const { data } = useApp();
    if (data?.people[0].name === BROKEN) throw new Error('The plan cannot be drawn.');
    return <p>Plán je vidět</p>;
  }

  function brokenPlan(): AppData {
    const data = newAppData();
    data.people[0].name = BROKEN;
    return data;
  }

  /** The console, so that React's report of the caught error does not clutter the output. */
  const quietConsole = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const openButton = () => screen.getByRole('button', { name: 'Otevřít soubor' });
  const newButton = () => screen.getByRole('button', { name: 'Začít nový' });

  it('shows a message and the two ways out instead of a blank page', () => {
    quietConsole();
    renderApp(memoryStorage(brokenPlan()), { month: Fragile });
    expect(screen.getByRole('alert')).toHaveTextContent(PLAN_ERROR.title);
    expect(screen.getByText('Plán se nepodařilo zobrazit.')).toBeInTheDocument();
    expect(screen.getByText(/Otevřete soubor s plánem, nebo začněte nový plán\./)).toBeInTheDocument();
    expect(openButton()).toBeEnabled();
    expect(newButton()).toBeEnabled();
    expect(screen.getByRole('heading', { level: 1, name: 'Plánování směn' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByText('Plán je vidět')).toBeNull();
  });

  it('logs the error to the console', () => {
    const log = quietConsole();
    renderApp(memoryStorage(brokenPlan()), { month: Fragile });
    const ours = log.mock.calls.filter(
      ([first]) => typeof first === 'string' && first.startsWith('The plan could not be shown'),
    );
    expect(ours).toHaveLength(1);
    expect(ours[0][1]).toEqual(new Error('The plan cannot be drawn.'));
  });

  it('draws the page again with a new plan: Začít nový', async () => {
    quietConsole();
    renderApp(memoryStorage(brokenPlan()), { month: Fragile });
    await userEvent.click(newButton());
    expect(screen.getByText('Plán je vidět')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Měsíc' })).toBeInTheDocument();
  });

  it('draws the page again with the plan of a file: Otevřít soubor', async () => {
    quietConsole();
    const storage = memoryStorage(brokenPlan());
    storage.openFile = async () => otherPlan();
    renderApp(storage, { month: Fragile });
    await userEvent.click(openButton());
    expect(await screen.findByText('Plán je vidět')).toBeInTheDocument();
    expect(screen.queryByText('Plán se nepodařilo zobrazit.')).toBeNull();
  });

  it('stays on the message when the file is not opened or is no good', async () => {
    quietConsole();
    const storage = memoryStorage(brokenPlan());
    renderApp(storage, { month: Fragile });
    await userEvent.click(openButton()); // memoryStorage opens nothing, as for a cancel
    expect(screen.getByText('Plán se nepodařilo zobrazit.')).toBeInTheDocument();

    storage.openFile = async () => {
      throw new SaveFileError('Soubor je poškozený.');
    };
    await userEvent.click(openButton());
    expect(await screen.findByText('Soubor je poškozený.')).toBeInTheDocument(); // the banner above
    expect(screen.getByText('Plán se nepodařilo zobrazit.')).toBeInTheDocument();
  });

  it('draws the page again only when the data is replaced, not when it is changed', async () => {
    quietConsole();
    renderApp(memoryStorage(brokenPlan()), { month: Fragile });
    await userEvent.click(screen.getByRole('button', { name: 'Změnit' })); // a change, no new data
    expect(screen.getByText('Plán se nepodařilo zobrazit.')).toBeInTheDocument();
    await userEvent.click(newButton());
    expect(screen.getByText('Plán je vidět')).toBeInTheDocument();
  });

  it('can fail again after it has been put right, and offers the same ways out', async () => {
    quietConsole();
    const storage = memoryStorage(brokenPlan());
    storage.openFile = async () => brokenPlan(); // a file that is just as broken
    renderApp(storage, { month: Fragile });
    await userEvent.click(openButton());
    expect(await screen.findByText('Plán se nepodařilo zobrazit.')).toBeInTheDocument();
    await userEvent.click(newButton());
    expect(screen.getByText('Plán je vidět')).toBeInTheDocument();
  });

  it('catches a screen that is not the first, hidden or not', async () => {
    quietConsole();
    renderApp(memoryStorage(brokenPlan()), { rules: Fragile }); // the Pravidla panel is hidden
    expect(screen.getByText('Plán se nepodařilo zobrazit.')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Pravidla' })).toBeNull();
  });

  it('leaves a page that draws well alone', () => {
    const log = quietConsole();
    renderApp(memoryStorage(newAppData()), { month: Fragile });
    expect(screen.getByText('Plán je vidět')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });
});
