# Shift scheduler

A single HTML page that plans a team's shifts one month at a time. It generates a draft that follows the rules (every shift covered on every day, rest between shifts, a limit on 12-hour shifts, monthly hours against the norm) and leans toward each person's preferences. The planner then adjusts the draft by hand. Every change is checked on the spot against the same rules the generator works with, and the result is copied into Excel.

The page runs in the browser, offline, from a file on disk. It needs no server, no account and no install, and it never makes a network request. The build adds a Content-Security-Policy that makes the browser refuse connections, so this is enforced and not only promised.

The page is in Czech. This README quotes its labels in Czech with an English gloss in parentheses. Code, comments and docs are in English.

The design is in [`docs/superpowers/specs/2026-11-04-shift-scheduler-design.md`](docs/superpowers/specs/2026-11-04-shift-scheduler-design.md) and the plan for the first phase in [`docs/superpowers/plans/2026-11-04-shift-scheduler-phase-1.md`](docs/superpowers/plans/2026-11-04-shift-scheduler-phase-1.md).

## Develop

You need Node.js `^22.22.2 || ^24.15.0 || >=26`: 22.22.2 or newer on the 22 line, 24.15.0 or newer on the 24 line, or 26 and later. That is what jsdom, which runs the unit tests, asks for; Vite and Vitest accept less.

| Command | What it does |
|---|---|
| `npm ci` | Installs the exact dependencies of `package-lock.json`. |
| `npm run dev` | Starts the dev server. The Content-Security-Policy is added by the build only, so the dev server does not enforce it. |
| `npm run typecheck` | Type-checks the code, the tests and the configs. |
| `npm test` | Runs the unit tests (Vitest). |
| `npm run build` | Type-checks, then writes the whole page to `dist/index.html`. |
| `npm run test:e2e` | Builds, then runs the end-to-end tests (Playwright) against `dist/index.html` opened from disk. |

The end-to-end tests run in headless Chromium only. Install it once with `npx playwright install chromium`. If the browser that Playwright downloads cannot run on your system, set `PLAYWRIGHT_CHROMIUM` to a Chromium or Chrome that you have installed.

The end-to-end specs are in `tests/e2e`:

- `smoke.spec.ts`: the built file is a single file and opens from disk without any request.
- `csp.spec.ts`: the built page carries the Content-Security-Policy, and the browser enforces it. A `fetch` from the page is blocked and nothing leaves.
- `grid-colours.spec.ts`: in a new plan, the gaps in the coverage row are red on the grey weekend columns too, and the hours below FPD are red. Only a browser tells which of two style rules wins, so jsdom cannot do this.
- `plan-january.spec.ts`: starts a new plan and plans January 2027 with the real generator, in its worker, from the built file. Every day must be covered, `Kontrola` (Checks) must report no broken must, no request may leave, and no policy violation may show on the page (the spec sees only the page's own violations: one inside the generator's worker is blocked all the same, but not reported to it). It takes a few seconds, since the run has a time budget of 5 s.

## Deliver a build

1. Run `npm ci` and `npm run build`.
2. Send `dist/index.html`. That one file is the whole tool.
3. The user opens it from disk in current Edge or Chrome. Saving to the file, with auto-save, works there.
4. Firefox works too, but cannot write to a file by itself: `Uložit do souboru` (Save to file) downloads a copy each time.

Before you hand a build out, go through [Manual checks before handing out a build](#manual-checks-before-handing-out-a-build).

## The data

**The save file is the real data.** It is one JSON file that holds everything: the team with its names and preferences, the settings, the requests, the months and the starting counts. The default name is `plan-smen.json`. Keep it with your other work files, in a folder that is backed up.

**Browser storage only caches it.** The page also keeps every change in the browser's storage, so that a reload loses nothing. A browser may clear that storage (a managed browser may do so each time it closes), and a new copy of the HTML file may count as a new site with an empty cache. Then the page shows its start screen, and you open the save file with `Otevřít soubor` (Open file).

- In Edge and Chrome, once you have opened a file or saved to one, every change is written to it by itself, about a second after the change. The bar at the top says so: `Ukládá se automaticky do …` (Saving automatically to …). The page forgets which file it was saving to when it is reloaded, so auto-save is off in every new session until you pick the file again, in one of two ways:
  - `Uložit do souboru` (Save to file) writes what the page shows to the file you pick, and from then on resumes auto-saving to it. Use it after a reload to carry on with the plan on the page.
  - `Otevřít soubor` (Open file) replaces the page's data with the file's, and auto-saves to that file from then on. Use it to go back to what the file holds. Changes on the page that are not in a file are lost, so the page asks first (`Neuložené změny`, Unsaved changes).
- The browser asks you to confirm before the page is closed or reloaded while it holds changes made in this session that are not in a file. A page that was only reloaded and not changed since does not ask, although the bar says that its data is not saved to a file: it holds what it held before the reload.
- In Firefox, `Uložit do souboru` downloads the file, and `Otevřít soubor` opens it through a file chooser. The bar says `Změny nejsou uložené do souboru` (Changes are not saved to the file) until you save.
- Clearing the browser's data loses the changes made since the last save to the file.

**No team data is in this repository.** Names, preferences and requests exist only in the user's save file and browser cache. Tests and examples use a made-up team of eight people, A to H, in `src/test/team.ts`. Never commit a save file, a screenshot of a real plan or a real name. `.gitignore` helps: it ignores `plan-smen*.json` anywhere, and every JSON file at the root except `package.json`, `package-lock.json` and `tsconfig.json`, so a new JSON file of the project at the root needs an exception line there.

## Manual checks before handing out a build

The automated tests cannot cover other browsers, the operating system's dialogs or a Czech browser locale. Check the following by hand, with the freshly built `dist/index.html` opened from disk (not from the dev server).

**Firefox**

- The page opens from disk.
- Generating works in its blob worker: `Vygenerovat` (Generate) runs and ends with `Hotovo` (Done).
- Opening and saving work through the download fallback: `Uložit do souboru` downloads `plan-smen.json`, and `Otevřít soubor` loads it again.
- Cancelling the file picker of `Otevřít soubor` changes nothing. This relies on the file input's `cancel` event.
- Copying a row works: the `📋` button in a person's name cell, then paste into Excel.

**Edge and Chrome, in a normal (headed) window**

- Copying a row works through the Clipboard API.
- Saving to a file and auto-save work: `Uložit do souboru` writes the file you picked, and later changes reach it by themselves.
- That includes `requestPermission` after a slow file pick. Open a file and take more than 5 s in the picker, so that the click is no longer fresh when the page asks for write access. Check that the page can still write to the file, or says plainly that it cannot.
- A file that refuses write access, or cannot be written to, is given up: move or delete the file you are saving to, or refuse the question about write access, and press `Uložit do souboru` (Save to file). The page opens the save picker in its place, and if you cancel it, the next press opens the picker at once. Answering the question very slowly may make the browser refuse the picker: the message `Soubor se nepodařilo uložit.` (The file could not be saved.) shows, and the next press works.

**Czech decimal comma**

- In Czech Edge, Chrome and Firefox, type `10,5` into `Odpočinek mezi směnami (h)` (Rest between shifts, h) on the `Pravidla` (Rules) tab.
- `Kontrola` should then use 10,5 h. For example, an `O` followed by an `R2` on the next day leaves 10 h of rest, so its line must end `(min. 10,5 h)`.

**`Přidat člověka`** (Add person)

- It works from disk: on the `Tým` tab the button adds a new card at the end of the list. It needs `crypto.randomUUID`, which a page opened from `file://` may not have in every browser.

**Focus**

- The focus stays sensible after the ↑ and ↓ buttons (`Posunout nahoru`, `Posunout dolů`: Move up, Move down) on the `Tým` (Team) tab.
- The focus stays sensible after closing the dialogs: `Vložit z Excelu` (Paste from Excel), and the question `Neuložené změny` (Unsaved changes) that comes before another file is opened.
