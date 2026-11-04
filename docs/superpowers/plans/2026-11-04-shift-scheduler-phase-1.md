# Shift Scheduler, Phase 1: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single offline HTML page in which the team lead enters requests, generates a month's shift draft that follows the musts and leans towards the wishes, adjusts it with instant checks, copies rows into his Excel, and saves everything to a file. That is enough to plan January 2027.

**Architecture:** A pure TypeScript domain layer covers the calendar, codes and a rule engine. The rule engine scores a month and explains every problem. The same engine drives both the live checks and a local-search generator, which runs in an inline Web Worker. A React UI keeps the app data in a reducer. A save file is the real store, and browser storage only caches it. Vite builds everything into one self-contained `dist/index.html`.

**Tech Stack:** TypeScript (strict), React, Vite, vite-plugin-singlefile, Vitest (+ jsdom, Testing Library), Playwright (Chromium), npm.

**Spec:** `docs/superpowers/specs/2026-11-04-shift-scheduler-design.md`. Phase 1 scope is §14 of the spec. Phase 2 (closing months, Přehled, yearly DOV/MD, paste-back, whole-team copy, full Pravidla, weekly-rest warning) gets its own plan.

## Global Constraints

- One self-contained `dist/index.html`. It works offline from disk in current Edge, Chrome and Firefox. No network request of any kind at runtime, and no CDN.
- No real names or team data anywhere in the repo. Tests use the made-up team in `src/test/team.ts`.
- UI text is Czech. Code, comments, docs and commit messages are English.
- Default shifts: R1 06:00–14:00, R2 08:00–16:00, O20 12:00–20:00, O 14:00–22:00 and N 22:00–06:00 count 7.5 h. R12 06:00–18:00 and N12 18:00–06:00 count 11.5 h. DOV, MD, OP and NEM count 7.5 h; x counts 0 h.
- A night shift belongs to the day it starts.
- FPD = number of Mon–Fri days in the month (holidays included) × 7.5.
- Czech public holidays: 1 Jan, Good Friday, Easter Monday, 1 May, 8 May, 5 Jul, 6 Jul, 28 Sep, 28 Oct, 17 Nov, 24 Dec, 25 Dec, 26 Dec. Saturdays, Sundays and holidays are 12-hour days.
- Musts (defaults):
  - weekday coverage: R1, O20, O and N exactly 1, R2 at least 1;
  - 12-hour day coverage: R12 and N12 exactly 1;
  - rest between shifts ≥ 12 h;
  - ≤ 3 twelve-hour shifts per person per month;
  - hours ≥ FPD;
  - no nights for "never".
- The generator never changes requests (x), absences, pinned cells or previous-month (tail) cells. It may leave coverage gaps (M1), and leave someone below FPD (M6) only when that is forced. It never breaks M2, M3, M4, M5, M7 or M8.
- The default generation time budget is 20 s (the spec's target is ≤ 30 s).
- Dates are `YYYY-MM-DD` strings and months are `YYYY-MM`. All date arithmetic is done in UTC.
- Hours are shown with a Czech decimal comma: `157,5`.
- The save file is the real store; browser storage (`localStorage`) is only a cache.
- Git: work on branch `phase-1`. Commit at the end of a task only if the user has approved per-task commits. Never push or merge unless the user asks.

## Review Focus

1. **Date maths across DST and month or year boundaries** (the DST switch on 28 Mar 2027, the Dec 2026 tail of Jan 2027). Expected: consecutive dates, correct weekdays. Tested in Task 2 and Task 3.
2. **Shifts in the previous month's tail that constrain day 1** (a night on the 31st, a stretch running into the month). Expected: rest, night and stretch rules see them. Tested in Task 4 and Task 5.
3. **Excel paste quirks**: CRLF line endings, a trailing tab or newline, a lowercase or uppercase x, a leading names column, a totals row of numbers. Expected: codes land on the right person and day, and everything else is listed as ignored. Tested in Task 11.
4. **Opening a broken, foreign or newer-version save file.** Expected: a Czech error message, and the current data stays untouched. Tested in Task 10 and Task 12.
5. **Pins or requests that themselves break musts or make the month impossible.** Expected: the generator finishes, keeps them, shows them red, and leaves gaps rather than bending limits. Tested in Task 8 and Task 9.

---

## File Structure

```
index.html                      Czech page shell, <html lang="cs">, title "Plánování směn"
vite.config.ts                  React + singlefile + build-only CSP plugin; Vitest config
playwright.config.ts            Chromium, testDir tests/e2e
tests/e2e/*.spec.ts             Playwright tests against dist/index.html (file://)
src/main.tsx                    React entry
src/domain/types.ts             app data types (Person, Settings, AppData, …)
src/domain/codes.ts             numeric codes + name mapping + predicates
src/domain/calendar.ts          holidays, Easter, month/tail days, FPD, date helpers
src/domain/defaults.ts          defaultSettings(), newPerson(), newAppData()
src/domain/format.ts            fmtH(), days() Czech formatting helpers
src/domain/context.ts           MonthContext, buildMonthGrid(), applyRows()
src/domain/rules/types.ts       RuleId, Finding, PersonStats, DayStats
src/domain/rules/weights.ts     HARD/GAP/BELOW_FPD, BASE_WEIGHTS, LEVEL_MULT, effectiveWeights()
src/domain/rules/personMusts.ts M2–M8 (per person)
src/domain/rules/personWishes.ts W1–W6 (per person)
src/domain/rules/person.ts      evaluatePerson(): stats + musts + wishes
src/domain/rules/day.ts         evaluateDay(): M1
src/domain/rules/global.ts      evaluateGlobal(): W7–W9
src/domain/rules/evaluate.ts    evaluateMonth()
src/generator/rng.ts            mulberry32()
src/generator/state.ts          SearchState (incremental scoring)
src/generator/moves.ts          Move, proposeMove()
src/generator/construct.ts      construct() greedy start
src/generator/search.ts         search() simulated annealing
src/worker/protocol.ts          worker message types
src/worker/generator.worker.ts  worker entry
src/worker/runner.ts            GeneratorRunner, workerRunner, inProcessRunner
src/storage/saveFile.ts         serialize(), parseSaveFile(), SaveFileError
src/storage/adapter.ts          StorageAdapter, memoryStorage(), browserStorage()
src/clipboard/tsv.ts            personRowTsv(), parseTsv(), planPaste(), applyPaste()
src/ui/text.ts                  Czech labels (months, weekdays, prefs, wishes)
src/ui/reducer.ts               Action, reduce()
src/ui/store.tsx                AppProvider, useApp()
src/ui/App.tsx, StartScreen.tsx, SaveBar.tsx
src/ui/month/{MonthScreen,Grid,CellMenu,ChecksPanel,PasteDialog}.tsx, useGenerator.ts
src/ui/team/{TeamScreen,PersonCard}.tsx
src/ui/rules/RulesScreen.tsx
src/ui/styles.css
src/test/setup.ts               jest-dom matchers
src/test/team.ts                syntheticTeam()
src/test/rulekit.ts             ctxFor(), rowsOf(), run(), rules(), units()
src/test/scenarios.ts           scenario()
README.md                       build and delivery instructions
```

Unit tests sit next to their source as `*.test.ts(x)`. UI tests start with `// @vitest-environment jsdom`.

---

### Task 1: Scaffold that builds to one offline file

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `index.html`, `.gitignore`, `src/main.tsx`, `src/test/setup.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: npm scripts `dev`, `build` (`tsc --noEmit && vite build`), `test` (`vitest run`), `test:e2e` (`npm run build && playwright test`), `typecheck`. Build output `dist/index.html`.

- [ ] **Step 1: Create the project files**

Install the dependencies:
- `npm install react react-dom`
- `npm install -D vite @vitejs/plugin-react typescript vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @types/react @types/react-dom vite-plugin-singlefile @playwright/test`
- `npx playwright install chromium`. If the browser can't run on this OS, point `use.launchOptions.executablePath` in `playwright.config.ts` at a locally installed Chromium or Chrome, read from `PLAYWRIGHT_CHROMIUM` when set.

Project settings:
- `tsconfig.json`: `"strict": true`, `"jsx": "react-jsx"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"types": ["vite/client", "vitest/globals"]`.
- `.gitignore`: `node_modules/ dist/ test-results/ playwright-report/ coverage/`.
- `index.html`: `<html lang="cs">` with `<title>Plánování směn</title>`.
- `src/main.tsx`: renders `<h1>Plánování směn</h1>` for now.
- Vitest: `include: ['src/**/*.test.{ts,tsx}']`, `environment: 'node'`, `setupFiles: ['src/test/setup.ts']`. `setup.ts` imports `@testing-library/jest-dom/vitest`.
- `vite.config.ts`: plugins are `react()`, `viteSingleFile()` and a build-only plugin. That plugin adds this meta tag right after `<head>`:

```
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'">
```

- [ ] **Step 2: Write the smoke test** in `tests/e2e/smoke.spec.ts`

```ts
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const fileUrl = 'file://' + path.resolve('dist/index.html');

test('built file opens from disk without any network request', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
  await page.goto(fileUrl);
  await expect(page).toHaveTitle('Plánování směn');
  await expect(page.getByRole('heading', { name: 'Plánování směn' })).toBeVisible();
  expect(requests).toEqual([]);
});

test('build is a single file with a CSP that blocks connections', () => {
  expect(fs.readdirSync('dist')).toEqual(['index.html']);
  expect(fs.readFileSync('dist/index.html', 'utf8')).toContain("connect-src 'none'");
});
```

- [ ] **Step 3: Run it.** Command: `npm run test:e2e`. Expected: 2 passed. If it fails, fix the config, not the test.
- [ ] **Step 4: Typecheck.** Command: `npm run typecheck`. Expected: no errors.
- [ ] **Step 5: Commit** (only if approved): `git add -A && git commit -m "chore: scaffold single-file Vite + React app"`

---

### Task 2: Codes, types, defaults, calendar

**Files:**
- Create: `src/domain/types.ts`, `src/domain/codes.ts`, `src/domain/defaults.ts`, `src/domain/format.ts`, `src/domain/calendar.ts`
- Test: `src/domain/calendar.test.ts`, `src/domain/codes.test.ts`, `src/domain/format.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  - `ISODate = string`, `MonthKey = string`, `PersonId = string`
  - `ShiftName = 'R1'|'R2'|'O20'|'O'|'N'|'R12'|'N12'`, `WeekdayShift = 'R1'|'R2'|'O20'|'O'|'N'`, `AbsenceName = 'DOV'|'MD'|'OP'|'NEM'`, `CodeName = ShiftName | AbsenceName | 'x'`
  - `Rating = 1|2|3|4|5`, `NightsPref = 'never'|'ifNeeded'|'normal'|'extra'`, `WeekendStyle = 'whole'|'single'|'any'`, `AfterWeekend = 'want'|'noAutomatic'|'any'`
  - `Preferences { ratings: Partial<Record<WeekdayShift, Rating>>; nights: NightsPref; weekendStyle: WeekendStyle; afterWeekend: AfterWeekend; afterNights: Array<'R1'|'R2'|'O'|'O20'>; notes: string }`
  - `FairnessCounts { twelve: number; nights: number; holidayTwelve: number; festive: number }`
  - `Person { id: PersonId; name: string; activeFrom: ISODate|null; activeTo: ISODate|null; prefs: Preferences; allowance: { DOV: number; MD: number }; startingCounts: FairnessCounts }`
  - `WishId = 'W1'|'W2'|'W3'|'W4a'|'W4b'|'W4c'|'W4d'|'W5a'|'W5b'|'W5c'|'W5d'|'W6'|'W7'|'W8'|'W9'`, `Level = 0|1|2|3|4|5`
  - `Range { min: number; max: number|null }`, `ShiftTime { start: number; end: number; hours: number }` (minutes from midnight of the start day; `end` may exceed 1440)
  - `Settings { shifts: Record<ShiftName, ShiftTime>; absenceHours: number; fpdHoursPerWeekday: number; coverage: Record<ShiftName, Range>; minRestHours: number; maxTwelvePerMonth: number; twelveTarget: number; wishLevels: Record<WishId, Level>; dayTypeOverrides: Record<ISODate, 'weekday'|'twelve'>; fairnessWindowMonths: number; festiveDays: string[]; generatorTimeBudgetSec: number }`
  - `StoredCell { code: CodeName; pinned?: boolean }`
  - `MonthMeta { status: 'draft'|'closed'; seed?: number; generatedAt?: string; hoursAdjust?: Record<PersonId, number> }`
  - `AppData { schemaVersion: 1; people: Person[]; settings: Settings; cells: Record<ISODate, Record<PersonId, StoredCell>>; months: Record<MonthKey, MonthMeta> }`
- Produces, in `codes.ts`:
  - `Code = { EMPTY:0, R1:1, R2:2, O20:3, O:4, N:5, R12:6, N12:7, DOV:8, MD:9, OP:10, NEM:11, X:12 } as const` and `CodeInt`
  - `CODE_NAMES: readonly string[]`, where index 0 is `''` and index 12 is `'x'`
  - `codeFromName(s: string): CodeInt | null`: trims, ignores case; `''` gives `Code.EMPTY`; anything unknown gives `null`
  - `nameOf(c: CodeInt): CodeName | null`
  - predicates `isShift`, `isNight` (N, N12), `isTwelveShift` (R12, N12), `isWeekdayShift` (R1..N), `isAbsence` (DOV..NEM), `isOff` (EMPTY, X or absence)
  - `WEEKDAY_CODES = [R1, R2, O20, O, N]`, `TWELVE_CODES = [R12, N12]`
- Produces, in `calendar.ts`:
  - `DayInfo { date: ISODate; weekday: number /* 0 = Monday */; dayType: 'weekday'|'twelve'; holiday: boolean; festive: boolean; inMonth: boolean }`
  - `TAIL_DAYS = 7`
  - `easterSunday(year): ISODate`, `czechHolidays(year): Set<ISODate>`
  - `monthDays(month, settings): DayInfo[]`, `tailDays(month, settings): DayInfo[]`
  - `weekdayCount(month): number`, `fpdForMonth(month, settings): number`
  - `addDays(date, n): ISODate`, `addMonths(month, n): MonthKey`, `monthOf(date): MonthKey`
- Produces, in `defaults.ts`:
  - `defaultSettings(): Settings`, with exactly the Global Constraints values plus: coverage max `null` for R2 and `1` for the others; `twelveTarget: 2`; every wish level `3`; `fairnessWindowMonths: 6`; `festiveDays: ['12-24','12-25','12-26','12-31','01-01']`; `generatorTimeBudgetSec: 20`
  - `newPerson(id, name): Person`, defaulting to: no ratings, nights `'normal'`, weekend `'whole'`, afterWeekend `'any'`, afterNights `[]`, allowance `{DOV:25, MD:5}`, zero starting counts
  - `newAppData(): AppData`, with 8 people `p1…p8` named `Operátor 1` … `Operátor 8`
- Produces, in `format.ts`:
  - `fmtH(h): string`: `8` gives `'8'`, `127.5` gives `'127,5'`
  - `days(n): string`: `1` gives `'1 den'`, `3` gives `'3 dny'`, `5` gives `'5 dní'`

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/calendar.test.ts
import { describe, it, expect } from 'vitest';
import { easterSunday, czechHolidays, monthDays, tailDays, fpdForMonth, addMonths } from './calendar';
import { defaultSettings } from './defaults';
const S = defaultSettings();

describe('calendar', () => {
  it('computes Easter Sunday', () => {
    expect([2026, 2027, 2028].map(easterSunday)).toEqual(['2026-04-05', '2027-03-28', '2028-04-16']);
  });
  it('lists Czech public holidays', () => {
    expect([...czechHolidays(2027)].sort()).toEqual(['2027-01-01','2027-03-26','2027-03-29','2027-05-01','2027-05-08',
      '2027-07-05','2027-07-06','2027-09-28','2027-10-28','2027-11-17','2027-12-24','2027-12-25','2027-12-26']);
  });
  it('January 2027: 11 twelve-hour days, FPD 157.5', () => {
    const d = monthDays('2027-01', S);
    expect(d).toHaveLength(31);
    expect(d.filter((x) => x.dayType === 'twelve').map((x) => x.date.slice(8)))
      .toEqual(['01','02','03','09','10','16','17','23','24','30','31']);
    expect(fpdForMonth('2027-01', S)).toBe(157.5);
  });
  it('FPD counts Mon–Fri including holidays', () => {
    expect(fpdForMonth('2026-11', S)).toBe(157.5);
    expect(fpdForMonth('2026-12', S)).toBe(172.5);
    expect(fpdForMonth('2027-02', S)).toBe(150);
  });
  it("tail = the previous month's last 7 days", () => {
    expect(tailDays('2027-01', S).map((x) => x.date)).toEqual(
      ['2026-12-25','2026-12-26','2026-12-27','2026-12-28','2026-12-29','2026-12-30','2026-12-31']);
    expect(tailDays('2027-01', S).every((x) => !x.inMonth)).toBe(true);
  });
  it('is DST-safe and Monday-based', () => {
    const m = monthDays('2027-03', S);
    expect(m.map((x) => x.date)).toEqual(Array.from({ length: 31 }, (_, i) => `2027-03-${String(i + 1).padStart(2, '0')}`));
    expect(m[0].weekday).toBe(0);
    expect(m[27].weekday).toBe(6);
  });
  it('marks festive days and applies day-type overrides', () => {
    expect(monthDays('2027-12', S).filter((x) => x.festive).map((x) => x.date.slice(8))).toEqual(['24','25','26','31']);
    expect(monthDays('2027-02', { ...S, dayTypeOverrides: { '2027-02-03': 'twelve' } })[2].dayType).toBe('twelve');
  });
  it('adds months across years', () => { expect(addMonths('2026-12', 1)).toBe('2027-01'); });
});
```

`codes.test.ts`:
- `codeFromName(' x ')` and `codeFromName('X')` both give `Code.X`;
- `codeFromName('dov')` gives `Code.DOV`;
- `codeFromName('Šk.')` gives `null`;
- `codeFromName('')` gives `Code.EMPTY`;
- `isOff(Code.DOV)` is true, and `isNight(Code.N12)` is true.

`format.test.ts` covers the four `fmtH` and `days` examples above.

- [ ] **Step 2: Run.** Command: `npx vitest run src/domain`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `types.ts`, `codes.ts`, `defaults.ts`, `format.ts`, `calendar.ts` as specified in Interfaces.
  - Use the anonymous Gregorian algorithm for Easter.
  - Build dates with `Date.UTC` and read them back with `getUTC*`.
  - A day is `'twelve'` when it is a Saturday, Sunday or holiday, unless `dayTypeOverrides` says otherwise.
  - `festive` means the date's `MM-DD` is in `settings.festiveDays`.
- [ ] **Step 4: Run.** Command: `npx vitest run src/domain`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: calendar, codes and defaults"` (add the new files first)

---

### Task 3: Month context, synthetic team, test kit

**Files:**
- Create: `src/domain/context.ts`, `src/domain/rules/weights.ts`, `src/test/team.ts`, `src/test/rulekit.ts`
- Test: `src/domain/context.test.ts`, `src/domain/rules/weights.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces, in `rules/weights.ts`:
  - `HARD = 1e9`, `GAP = 1e6`, `BELOW_FPD = 1e5` (per hour)
  - `BASE_WEIGHTS: Record<WishId, number> = { W1: 10, W2: 20, W3: 40, W4a: 30, W4b: 30, W4c: 40, W4d: 15, W5a: 30, W5b: 40, W5c: 15, W5d: 20, W6: 8, W7: 20, W8: 10, W9: 5 }` (starting values; Task 9 may tune them)
  - `LEVEL_MULT = [0, 0.25, 0.5, 1, 2, 4]`
  - `effectiveWeights(levels: Record<WishId, Level>): Record<WishId, number>` = base × `LEVEL_MULT[level]`
- Produces, in `context.ts`:
  - `EnginePerson { id: PersonId; prefs: Preferences; fpd: number; active: Uint8Array /* per ctx day */; history: FairnessCounts }`
  - `MonthContext { month: MonthKey; days: DayInfo[] /* 7 tail + month */; first: number /* = TAIL_DAYS */; people: EnginePerson[]; settings: Settings; weights: Record<WishId, number> }`
  - `MonthGrid { ctx: MonthContext; rows: Uint8Array[]; fixed: Uint8Array[]; personIds: PersonId[] }`
  - `buildMonthGrid(data: AppData, month: MonthKey): MonthGrid`. It includes people active on at least one month day.
    - A cell is **fixed** when it is a tail day, holds x or an absence, is a pinned shift, or falls outside the person's active period (stored as EMPTY).
    - `fpd` = active Mon–Fri days × `fpdHoursPerWeekday` + `months[month].hoursAdjust[id] ?? 0`.
    - `history` = `startingCounts` in Phase 1.
    - `weights` = `effectiveWeights(settings.wishLevels)`.
  - `applyRows(data, month, rows, fixed): AppData`. It returns new data in which every non-fixed month cell equals `rows`: a shift is stored as `{ code }` without a pin, EMPTY deletes the cell, and empty date maps are removed.
- Produces, in `src/test/team.ts`, `syntheticTeam(): Person[]`, with ids `A`–`H` named `Operátor A`… This exact made-up data must be used, never real answers:

| id | ratings R1/R2/O20/O/N | nights | weekend | afterWeekend | afterNights |
|---|---|---|---|---|---|
| A | 4/5/2/2/1 | never | whole | noAutomatic | – |
| B | 5/4/3/1/2 | ifNeeded | whole | any | O, O20 |
| C | 1/3/4/5/3 | normal | whole | any | O, O20 |
| D | 3/4/2/2/5 | extra | whole | want | – |
| E | 2/5/3/2/4 | normal | whole | noAutomatic | – |
| F | 4/4/1/3/5 | extra | any | noAutomatic | R2 |
| G | 5/5/3/1/1 | never | whole | any | – |
| H | 3/4/3/3/2 | ifNeeded | whole | any | – |

- Produces, in `src/test/rulekit.ts`:
  - `PersonPatch { prefs?: Partial<Preferences>; activeFrom?: ISODate|null; activeTo?: ISODate|null; startingCounts?: Partial<FairnessCounts> }`
  - `ctxFor(month, people: number | PersonPatch[], settings?: Partial<Settings>): MonthContext`, built from `newPerson` data via `buildMonthGrid`
  - `rowsOf(ctx, month: string[], tail?: string[]): Uint8Array[]`. One strip per person, made of space-separated codes. A month strip starts at the month's day 1 and a tail strip covers the 7 tail days. `-` means empty and `|` is ignored. Missing positions are empty.

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/context.test.ts
import { describe, it, expect } from 'vitest';
import { newAppData } from './defaults';
import { buildMonthGrid, applyRows } from './context';
import { Code } from './codes';
import { ctxFor, rowsOf } from '../test/rulekit';

describe('buildMonthGrid', () => {
  it('puts the tail first and marks fixed cells', () => {
    const data = newAppData(); const [a, b] = data.people;
    data.cells['2026-12-31'] = { [a.id]: { code: 'N' } };
    data.cells['2027-01-02'] = { [a.id]: { code: 'x' }, [b.id]: { code: 'R12', pinned: true } };
    data.cells['2027-01-04'] = { [b.id]: { code: 'R1' } };
    const g = buildMonthGrid(data, '2027-01');
    expect(g.ctx.first).toBe(7);
    expect(g.rows[0][6]).toBe(Code.N);
    expect(g.rows[0][8]).toBe(Code.X);
    expect([g.fixed[0][6], g.fixed[0][8], g.fixed[1][8], g.fixed[1][10]]).toEqual([1, 1, 1, 0]);
  });
  it('prorates FPD, applies the hours adjustment, fixes inactive days', () => {
    const data = newAppData();
    data.people[0].activeFrom = '2027-01-18';
    data.months['2027-01'] = { status: 'draft', hoursAdjust: { [data.people[1].id]: -4.5 } };
    const g = buildMonthGrid(data, '2027-01');
    expect(g.ctx.people[0].fpd).toBe(75);
    expect(g.ctx.people[1].fpd).toBe(153);
    expect(g.fixed[0][7 + 16]).toBe(1);
  });
  it('skips people not active in the month', () => {
    const data = newAppData(); data.people[7].activeTo = '2026-12-31';
    expect(buildMonthGrid(data, '2027-01').personIds).toHaveLength(7);
  });
});

describe('applyRows', () => {
  it('writes only free month cells', () => {
    const data = newAppData(); const id = data.people[0].id;
    data.cells['2027-01-05'] = { [id]: { code: 'DOV' } };
    data.cells['2027-01-06'] = { [id]: { code: 'R2' } };
    const g = buildMonthGrid(data, '2027-01');
    g.rows[0][7 + 3] = Code.R1; g.rows[0][7 + 4] = Code.R1; g.rows[0][7 + 5] = Code.EMPTY;
    const out = applyRows(data, '2027-01', g.rows, g.fixed);
    expect(out.cells['2027-01-04'][id]).toEqual({ code: 'R1' });
    expect(out.cells['2027-01-05'][id]).toEqual({ code: 'DOV' });
    expect(out.cells['2027-01-06']?.[id]).toBeUndefined();
    expect(data.cells['2027-01-06'][id]).toEqual({ code: 'R2' }); // input not mutated
  });
});

describe('rulekit.rowsOf', () => {
  it('parses strips with tail, gaps and separators', () => {
    const c = ctxFor('2027-02', 1);
    const [r] = rowsOf(c, ['R1 - | O20'], ['- - - - - - N']);
    expect([r[6], r[7], r[8], r[9], r[10]]).toEqual([Code.N, Code.R1, Code.EMPTY, Code.O20, Code.EMPTY]);
  });
});
```

```ts
// src/domain/rules/weights.test.ts
import { it, expect } from 'vitest';
import { effectiveWeights, BASE_WEIGHTS } from './weights';
import { defaultSettings } from '../defaults';

it('wish levels scale the base weights', () => {
  const w = effectiveWeights({ ...defaultSettings().wishLevels, W6: 5, W9: 0 });
  expect(w.W6).toBe(BASE_WEIGHTS.W6 * 4); expect(w.W9).toBe(0); expect(w.W1).toBe(BASE_WEIGHTS.W1);
});
```

- [ ] **Step 2: Run.** Command: `npx vitest run src/domain/context.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `context.ts`, `rules/weights.ts`, `src/test/team.ts` and `src/test/rulekit.ts` per Interfaces.
- [ ] **Step 4: Run.** Command: `npx vitest run src/domain`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: month context and test kit`

---

### Task 4: Rule engine, the musts

**Files:**
- Create: `src/domain/rules/types.ts`, `src/domain/rules/personMusts.ts`, `src/domain/rules/person.ts`, `src/domain/rules/day.ts`, `src/domain/rules/evaluate.ts`
- Modify: `src/test/rulekit.ts`, adding `run`, `rules`, `units`
- Test: `src/domain/rules/musts.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  - `MustId = 'M1'|…|'M8'`, `RuleId = MustId | WishId`
  - `Finding { rule: RuleId; severity: 'must'|'wish'; person: number|null; days: number[] /* ctx.days indices */; message: string; penalty: number }`
  - `Sink = (f: Finding) => void`
  - `PersonStats { hours: number; twelve: number; nights: number; holidayTwelve: number; festive: number; perShift: [number, number, number, number, number] /* R1,R2,O20,O,N */; mustUnits: number }`
  - `DayStats { r2: number; mustUnits: number }`
- Consumes: `HARD`, `GAP` and `BELOW_FPD` from `rules/weights.ts` (Task 3).
- Produces:
  - `evaluatePerson(ctx, p: number, row: Uint8Array, sink?: Sink): { score: number; stats: PersonStats }`
  - `evaluateDay(ctx, d: number /* ≥ ctx.first */, rows: Uint8Array[], sink?: Sink): { score: number; stats: DayStats }`
  - `MonthEval { score: number; mustUnits: number; findings: Finding[]; persons: PersonStats[]; days: DayStats[] /* month days only */ }`
  - `evaluateMonth(ctx, rows, explain = false): MonthEval`, which sums person, day and (from Task 7) global scores. Findings are sorted musts first, then by first day.
- Produces, in rulekit:
  - `run(ctx, rows) = evaluateMonth(ctx, rows, true)`
  - `rules(ev, id)` gives the findings of that rule
  - `units(ev, ctx, id)` gives Σ penalty / `ctx.weights[id]` for a wish, or the finding count for a must

**Semantics.** Stats count month days only. Rules spanning days look into the tail, but report only findings that touch a month day. With no `sink`, the scoring path must not allocate, because the generator calls it millions of times.

| Rule | Unit and score | Message (exact Czech) |
|---|---|---|
| M1 (day) | Each code below `coverage.min` → GAP per missing person. Each code above `coverage.max` → HARD per extra person. Weekday codes are checked on weekdays, R12 and N12 on twelve days. | `chybí ${code}` / `${code} ${n}×` |
| M2 | Consecutive days a, b both holding shifts: rest = 1440 + start(b) − end(a) minutes. Below `minRestHours`·60 → HARD | `${b} hned po ${a}: jen ${fmtH(rest/60)} h odpočinku (min. ${fmtH(min)} h)` |
| M3 | A shift on a day the person is inactive → HARD | `${code} mimo období, kdy je v týmu` |
| M4 | N or N12 on day i, with day i+1 holding x or an absence → HARD | `noční ${a} končí ráno v den, kdy je ${b}` |
| M5 | twelve > `maxTwelvePerMonth` → HARD per excess | `${n} dvanáctihodinových směn (max. ${max})` |
| M6 | hours < fpd → BELOW_FPD × (fpd − hours) | `${fmtH(h)} h z ${fmtH(fpd)} h: chybí ${fmtH(fpd − h)} h do FPD` |
| M7 | Each N or N12 for `nights:'never'` → HARD | `noční směna, ale noční nechce` |
| M8 | Weekday code on a twelve day, or twelve code on a weekday → HARD | `${code} nepatří na všední den` / `${code} nepatří na víkend ani svátek` |

`mustUnits` counts every HARD unit, every missing person (GAP) and every person below FPD.

- [ ] **Step 1: Write the failing tests.** February 2027 starts on a Monday, so index i is weekday i mod 7, and the weekends are indices 5–6, 12–13, 19–20 and 26–27.

```ts
// src/domain/rules/musts.test.ts
import { describe, it, expect } from 'vitest';
import { ctxFor, rowsOf, run, rules } from '../../test/rulekit';
import { HARD } from './weights';
const c = ctxFor('2027-02', 1);
const n = (strip: string, id: Parameters<typeof rules>[1], tail?: string) =>
  rules(run(c, rowsOf(c, [strip], tail ? [tail] : [])), id).length;

describe('musts', () => {
  it.each([['O R1', 1], ['O R2', 1], ['O20 R1', 1], ['O20 R2', 0], ['N R1', 1], ['N N', 0], ['R1 R1', 0]])
    ('M2 %s → %i', (s, k) => expect(n(s as string, 'M2')).toBe(k));
  it('M2 around weekends', () => {
    expect(n('- - - - O20 R12', 'M2')).toBe(1);
    expect(n('- - - - - - R12 R1', 'M2')).toBe(0);
    expect(n('- - - - - N12 R12', 'M2')).toBe(1);
    expect(n('- - - - N N12 N12 N', 'M2')).toBe(0);
  });
  it('M2 sees the previous month', () => {
    const j = ctxFor('2027-01', 1);
    expect(rules(run(j, rowsOf(j, ['R12'], ['- - - - - - N'])), 'M2')).toHaveLength(1);
  });
  it('M2 message', () => {
    expect(rules(run(c, rowsOf(c, ['O R1'])), 'M2')[0].message).toBe('R1 hned po O: jen 8 h odpočinku (min. 12 h)');
  });
  it('M4: x or absence blocks the night ending that morning', () => {
    expect(n('N x', 'M4')).toBe(1); expect(n('N DOV', 'M4')).toBe(1); expect(n('O x', 'M4')).toBe(0);
  });
  it('M5: at most 3 twelve-hour shifts', () => {
    expect(n('- - - - - R12 R12 | - - - - - R12 R12', 'M5')).toBe(1);
  });
  it('M6: below FPD is a must, with the shortfall in the message', () => {
    const f = rules(run(c, rowsOf(c, ['R1 R1 R1'])), 'M6');
    expect(f).toHaveLength(1);
    expect(f[0].message).toBe('22,5 h z 150 h: chybí 127,5 h do FPD');
  });
  it('M7: never nights', () => {
    const v = ctxFor('2027-02', [{ prefs: { nights: 'never' } }]);
    expect(rules(run(v, rowsOf(v, ['N N - - - N12'])), 'M7')).toHaveLength(3);
  });
  it('M8: day type', () => { expect(n('R12 - - - - R1', 'M8')).toBe(2); });
  it('M3: outside the active period', () => {
    const v = ctxFor('2027-02', [{ activeFrom: '2027-02-08' }]);
    expect(rules(run(v, rowsOf(v, ['R1'])), 'M3')).toHaveLength(1);
  });
  it('M1: coverage on a weekday', () => {
    const t = ctxFor('2027-02', 6);
    const mon = (ev: ReturnType<typeof run>) => rules(ev, 'M1').filter((f) => f.days.includes(t.first)).map((f) => f.message);
    expect(mon(run(t, rowsOf(t, ['R1', 'R2', 'O20', 'O', 'N', 'R2'])))).toEqual([]);
    expect(mon(run(t, rowsOf(t, ['R1', 'R1', 'O20', 'O', '-', 'R2'])))).toEqual(expect.arrayContaining(['chybí N', 'R1 2×']));
  });
  it('M1: coverage on a 12-hour day', () => {
    const t = ctxFor('2027-02', 2);
    const sat = rules(run(t, rowsOf(t, ['- - - - - R12', '- - - - - R12'])), 'M1').filter((f) => f.days.includes(t.first + 5));
    expect(sat.map((f) => f.message).sort()).toEqual(['R12 2×', 'chybí N12']);
  });
  it('scores hard violations above everything else', () => {
    expect(run(c, rowsOf(c, ['O R1'])).score).toBeGreaterThanOrEqual(HARD);
  });
});
```

- [ ] **Step 2: Run.** Command: `npx vitest run src/domain/rules`. Expected: FAIL.
- [ ] **Step 3: Implement** the files listed, per the table. `evaluateMonth` keeps a `globalScore` term of `0` until Task 7.
- [ ] **Step 4: Run.** Command: `npx vitest run src/domain`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: rule engine musts`

---

### Task 5: Per-person wishes W1–W4 (overtime, runs, days off, nights)

**Files:**
- Create: `src/domain/rules/personWishes.ts`
- Modify: `src/domain/rules/person.ts`, which calls the wishes
- Test: `src/domain/rules/wishes-rhythm.test.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces: `evaluatePerson` now also adds W1–W4. Penalty = units × `ctx.weights[id]`.

**Semantics.** A *stretch* is a maximal run of days holding shifts; absences, x and empty days are off. A *night run* is a maximal run of N or N12. Rows include the tail, so stretches and runs that start in the previous month count their tail days.

| Rule | Units | Message (exact Czech) |
|---|---|---|
| W1 | max(0, hours − fpd), in hours | `přesčas ${fmtH(x)} h` |
| W2 | In each stretch, take only its R1/R2/O20/O codes, in order. Add 1 per neighbouring pair that differs. Then, per block (maximal equal run in that list) shorter than 4 that doesn't reach the month's last day, add 4 − length. N, R12 and N12 are ignored here. | `změna směny uprostřed bloku (${a} → ${b})` / `krátký blok ${code} (jen ${days(len)})` |
| W3 | Add len − 6 for a stretch longer than 6. Add 1 when a stretch of ≥ 5 is followed by exactly 1 off day and then work. Add 3 for each single off day between stretches A and B with len(A) + len(B) ≥ 12. | `${days(len)} v kuse` / `po ${days(len)} práce jen 1 den volna` / `${total} pracovních dní jen s jedním dnem volna` |
| W4a | Add 3 − length for a night run shorter than 3 that doesn't reach the month's last day. If the month's nights exceed 5, add (runs − ceil(nights/5)) when that is positive. | `krátký blok nočních (${days(len)})` / `noční rozdělené do ${runs} bloků` |
| W4b | For a run starting at s: add 2 if day s−1 holds a shift. Otherwise, if day s−2 holds a shift that isn't R2, O20 or O, add 1. | `před nočními chybí den volna` / `před nočními ${code} (lépe R2, O20 nebo O)` |
| W4c | For a run ending at e, let k be the off days from e+1 to the next shift. If there is no next shift in the row, or k ≥ 2, add 0. If k = 1, the next code being in {O20, O} ∪ `afterNights` adds 1; any other code adds 2. | `po nočních jen 1 den volna` / `po nočních jen 1 den volna a pak ${code}` |
| W4d | Per month night: `extra` 0, `normal` 1, `ifNeeded` 4. Findings only for `ifNeeded`. | `${n}× noční, i když je bere jen v nouzi` |

- [ ] **Step 1: Write the failing tests** (February 2027, one person, FPD 150)

```ts
// src/domain/rules/wishes-rhythm.test.ts
import { describe, it, expect } from 'vitest';
import { ctxFor, rowsOf, run, units } from '../../test/rulekit';
const c = ctxFor('2027-02', 1);
const u = (strip: string, id: Parameters<typeof units>[2], ctx = c) => units(run(ctx, rowsOf(ctx, [strip])), ctx, id);

describe('rhythm wishes', () => {
  it('W1: overtime above FPD', () => {
    const s = 'R2 R2 R2 R2 R2 R12 R12 | - R2 R2 R2 R2 - - | R2 R2 R2 R2 R2 - - | R2 R2 R2';
    const ev = run(c, rowsOf(c, [s]));
    expect(ev.persons[0].hours).toBe(150.5);
    expect(units(ev, c, 'W1')).toBeCloseTo(0.5);
  });
  it('W2: changes and short blocks', () => {
    expect(u('R1 R1 R1 R1 R1 - - | O20 O20 O20 O20 O20', 'W2')).toBe(0);
    expect(u('R1 R2 O20 R2 R1', 'W2')).toBe(4 + 5 * 3);
    expect(u('- - - - - - - | - - - - - - - | - - - - - - - | - - - - R1 - -', 'W2')).toBe(3);
  });
  it('W3: long stretches and lone free days', () => {
    expect(u('- - R2 R2 R2 R12 R12 | - - R1 R1 R1', 'W3')).toBe(0);
    expect(u('R1 R1 R1 R1 R1 R12 R12 | - O O O O N12', 'W3')).toBe(1 + 1 + 3);
  });
  it('W3 counts a stretch that started last month', () => {
    const j = ctxFor('2027-01', 1);
    // Dec 26 – Jan 2 is an 8-day stretch: 8 − 6 = 2
    expect(units(run(j, rowsOf(j, ['R12 R12'], ['- R12 R12 R1 R1 R1 R1'])), j, 'W3')).toBe(2);
  });
  it('W4a: runs', () => {
    const x = ctxFor('2027-02', [{ prefs: { nights: 'extra' } }]);
    expect(u('- - - - - N12 N12 | N N N - - - - | N N N N N', 'W4a', x)).toBe(0);
    expect(u('N N - - - - - | N N', 'W4a', x)).toBe(2);
    expect(u('N N N - - - - | N N N - - - - | N N N', 'W4a', x)).toBe(1);
  });
  it('W4b: before nights', () => {
    expect(u('R1 - N N N', 'W4b')).toBe(1);
    expect(u('R2 N N', 'W4b')).toBe(2);
    expect(u('R2 - N N N', 'W4b')).toBe(0);
  });
  it('W4c: after nights', () => {
    expect(u('N N N - R1', 'W4c')).toBe(2);
    expect(u('N N N - O20', 'W4c')).toBe(1);
    expect(u('N N N - - R1', 'W4c')).toBe(0);
    const f = ctxFor('2027-02', [{ prefs: { afterNights: ['R2'] } }]);
    expect(u('N N N - R2', 'W4c', f)).toBe(1);
  });
  it('W4d: by willingness', () => {
    const k = (nights: 'extra' | 'normal' | 'ifNeeded') => { const x = ctxFor('2027-02', [{ prefs: { nights } }]); return u('N N N', 'W4d', x); };
    expect([k('extra'), k('normal'), k('ifNeeded')]).toEqual([0, 3, 12]);
  });
});
```

- [ ] **Step 2: Run.** Command: `npx vitest run src/domain/rules/wishes-rhythm.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `personWishes.ts` (W1–W4) per the table, and wire it into `evaluatePerson`.
- [ ] **Step 4: Run.** Command: `npx vitest run src/domain`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: rhythm and night wishes`

---

### Task 6: Per-person wishes W5–W6 (weekends, preferences)

**Files:**
- Modify: `src/domain/rules/personWishes.ts`
- Test: `src/domain/rules/wishes-weekend.test.ts`

**Interfaces:**
- Produces: `evaluatePerson` now also adds W5a–W5d and W6.

**Semantics.**

| Rule | Units | Message (exact Czech) |
|---|---|---|
| W5a | (twelve − `twelveTarget`)² | `${n} dvanáctihodinových směn (cíl ${t})` |
| W5b | Per month weekend (Sat and Sun both twelve days in the month). For `whole`: 1 if exactly one day is worked, 1 if both are worked with different codes. For `single`: 1 if both are worked. For `any`: 0. | `rozdělený víkend` / `víkend R12 + N12` / `celý víkend, i když chce jednotlivé dny` |
| W5c | Only weekends with R12 on both days, where the next Monday is a weekday in the month. For `want`: 1 if Monday holds a shift. For `noAutomatic`: 1 if Monday is off. For `any`: 0. | `po víkendu nemá volno` / `po víkendu volno, i když ho nechce` |
| W5d | For each R12, each neighbouring day holding a weekday shift other than R1 or R2 adds 1 | `vedle R12 je ${code} (lépe R1 nebo R2)` |
| W6 | Per month weekday shift, the rating (missing counts as 3) gives 5→0, 4→1, 3→2, 2→4, 1→6. For a person with no ratings at all, use Σ over R1, R2, O20, O, N of \|count − total/5\| instead. Findings only for ratings ≤ 2. | `${n}× ${code}, kterou má nerad(a)` |

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/rules/wishes-weekend.test.ts
import { describe, it, expect } from 'vitest';
import { ctxFor, rowsOf, run, units } from '../../test/rulekit';
import type { PersonPatch } from '../../test/rulekit';
const u = (p: PersonPatch, strip: string, id: Parameters<typeof units>[2]) => {
  const c = ctxFor('2027-02', [p]); return units(run(c, rowsOf(c, [strip])), c, id);
};

describe('weekend and preference wishes', () => {
  it('W5a: distance from 2', () => {
    expect(u({}, '- - - - - R12', 'W5a')).toBe(1);
    expect(u({}, '- - - - - R12 R12', 'W5a')).toBe(0);
    expect(u({}, '- - - - - R12 R12 | - - - - - R12', 'W5a')).toBe(1);
  });
  it('W5b: whole weekends', () => {
    expect(u({ prefs: { weekendStyle: 'whole' } }, '- - - - - R12', 'W5b')).toBe(1);
    expect(u({ prefs: { weekendStyle: 'whole' } }, '- - - - - R12 N12', 'W5b')).toBe(1);
    expect(u({ prefs: { weekendStyle: 'whole' } }, '- - - - - R12 R12', 'W5b')).toBe(0);
    expect(u({ prefs: { weekendStyle: 'single' } }, '- - - - - R12 R12', 'W5b')).toBe(1);
  });
  it('W5c: days off after a weekend', () => {
    expect(u({ prefs: { afterWeekend: 'want' } }, '- - R2 R2 R2 R12 R12 | R1', 'W5c')).toBe(1);
    expect(u({ prefs: { afterWeekend: 'want' } }, '- - R2 R2 R2 R12 R12 | - -', 'W5c')).toBe(0);
    expect(u({ prefs: { afterWeekend: 'noAutomatic' } }, '- - R2 R2 R2 R12 R12 | - -', 'W5c')).toBe(1);
    expect(u({ prefs: { afterWeekend: 'noAutomatic' } }, '- - - - - R12 R12 | R1 R1 R1', 'W5c')).toBe(0);
  });
  it('W5d: R12 neighbours', () => {
    expect(u({}, '- - - - - R12 R12 | O', 'W5d')).toBe(1);
    expect(u({}, '- - - - R1 R12 R12 | R2', 'W5d')).toBe(0);
  });
  it('W6: ratings and even spread', () => {
    expect(u({ prefs: { ratings: { O: 1 } } }, 'O O O', 'W6')).toBe(18);
    expect(u({ prefs: { ratings: { R1: 5 } } }, 'R1 R1', 'W6')).toBe(0);
    expect(u({ prefs: { ratings: {} } }, 'R1 R1 R1 R1 R1', 'W6')).toBe(8);
  });
});
```

- [ ] **Step 2: Run.** Command: `npx vitest run src/domain/rules/wishes-weekend.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** W5a–W5d and W6 in `personWishes.ts`.
- [ ] **Step 4: Run.** Command: `npx vitest run src/domain`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: weekend and preference wishes`

---

### Task 7: Global wishes W7–W9

**Files:**
- Create: `src/domain/rules/global.ts`
- Modify: `src/domain/rules/evaluate.ts`
- Test: `src/domain/rules/global.test.ts`

**Interfaces:**
- Produces: `evaluateGlobal(ctx, persons: PersonStats[], days: DayStats[], sink?: Sink): number`, which `evaluateMonth` adds.

**Semantics.**

| Rule | Units | Message (exact Czech) |
|---|---|---|
| W7 | Categories, each with the people it applies to: `twelve` (everyone), `nights` (`ifNeeded` people only), `holidayTwelve` (everyone), `festive` (everyone; any shift on a festive day). Each category with ≥ 2 people: T = history + month; add Σ (T − mean T)². A finding goes to each person with T − mean ≥ 1. | `víc ${label} než ostatní` with label `dvanáctihodinových směn` / `nočních` / `směn o svátcích` / `směn o Vánocích a Silvestru` |
| W8 | For each R1, R2, O20, O, N with ≥ 2 people rating it ≤ 2: add Σ over those people of (count − their mean)² | `${code} rozdělené nerovnoměrně mezi ty, kdo ji nemají rádi` |
| W9 | Over month weekdays: Σ (r2 − mean r2)². One finding, listing days with \|r2 − mean\| ≥ 2. | `nevyrovnaný počet R2: ${dates}` |

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/rules/global.test.ts
import { describe, it, expect } from 'vitest';
import { ctxFor, rowsOf, run, units } from '../../test/rulekit';

describe('global wishes', () => {
  it('W7: history decides who gets the extra 12-hour shifts', () => {
    const c = ctxFor('2027-02', [{ startingCounts: { twelve: 5 } }, {}]);
    const heavy = units(run(c, rowsOf(c, ['- - - - - R12 R12 | - - - - - R12', '- - - - - N12'])), c, 'W7');
    const light = units(run(c, rowsOf(c, ['- - - - - N12', '- - - - - R12 R12 | - - - - - R12'])), c, 'W7');
    expect(heavy).toBeCloseTo(24.5);
    expect(light).toBeCloseTo(4.5);
  });
  it('W7: nights count only among "ifNeeded" people', () => {
    const c = ctxFor('2027-02', [{ prefs: { nights: 'ifNeeded' } }, { prefs: { nights: 'ifNeeded' } }, { prefs: { nights: 'extra' } }]);
    expect(units(run(c, rowsOf(c, ['N N', '-', 'N N N N'])), c, 'W7')).toBeCloseTo(2);
  });
  it('W8: disliked shifts spread evenly among those who dislike them', () => {
    const p = { prefs: { ratings: { O: 1 as const } } };
    const c = ctxFor('2027-02', [p, p, p]);
    const piled = units(run(c, rowsOf(c, ['O O O O', '-', '-'])), c, 'W8');
    const spread = units(run(c, rowsOf(c, ['O O', 'O', '- - O'])), c, 'W8');
    expect(spread).toBeLessThan(piled);
  });
  it('W9: R2 spread across weekdays', () => {
    const c = ctxFor('2027-02', 3);
    const lumpy = units(run(c, rowsOf(c, ['R2', 'R2', 'R2'])), c, 'W9');
    const even = units(run(c, rowsOf(c, ['R2', '- R2', '- - R2'])), c, 'W9');
    expect(even).toBeLessThan(lumpy);
  });
});
```

(W7 heavy: T = 8 and 1, so the mean is 4.5 and 2 · 3.5² = 24.5. Light: T = 6 and 3, so 2 · 1.5² = 4.5. Nights: T = 2 and 0, so 2 · 1² = 2.)

- [ ] **Step 2: Run.** Command: `npx vitest run src/domain/rules/global.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `global.ts`, and wire the global score into `evaluateMonth`.
- [ ] **Step 4: Run.** Command: `npx vitest run src/domain`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: fairness and global wishes`

---

### Task 8: Generator core (incremental state, moves, search)

**Files:**
- Create: `src/generator/rng.ts`, `src/generator/state.ts`, `src/generator/moves.ts`, `src/generator/construct.ts`, `src/generator/search.ts`
- Test: `src/generator/search.test.ts`

**Interfaces:**
- Consumes: `MonthContext`, `evaluatePerson`, `evaluateDay`, `evaluateGlobal`, `evaluateMonth`, `HARD`.
- Produces:
  - `mulberry32(seed: number): () => number`
  - `Move` = `{kind:'swapDay'; d; p; q}` | `{kind:'set'; p; d; code: CodeInt}` | `{kind:'swapRange'; p; q; d; len}` | `{kind:'shiftMove'; p; from; to}`. Day indices are `ctx.days` indices ≥ `ctx.first`.
  - `class SearchState`:
    - `constructor(ctx, rows, fixed)` (it copies `rows`)
    - fields `rows`, `score`, `mustUnits`
    - `tryMove(m): number` returns the delta
    - `commit()`, `revert()`, `reset(rows)`, `snapshot(): Uint8Array[]`
  - `proposeMove(st, rnd): Move | null`. Kind probabilities: swapDay 0.4, set 0.2, swapRange 0.2, shiftMove 0.2. A move only touches non-fixed month cells, only places codes valid for each day type (weekday: R1, R2, O20, O, N or EMPTY; twelve: R12, N12 or EMPTY), and is never a no-op.
  - `construct(st, rnd): void`
  - `SearchOptions { seed: number; maxIterations: number; timeBudgetMs?: number; restarts?: number /* 4 */; progressEvery?: number /* 2000 */; shouldStop?: () => boolean }`
  - `SearchProgress { iteration: number; bestScore: number; bestMustUnits: number; elapsedMs: number }`
  - `SearchResult { rows: Uint8Array[]; score: number; mustUnits: number; iterations: number }`
  - `search(ctx, rows, fixed, opts, onProgress?): Promise<SearchResult>`

**Decisions:**
- **Incremental scoring.** `SearchState` caches per-person scores and stats, per-day scores and stats, and the global score. `tryMove` applies the cell changes, re-evaluates only the touched people and days, then re-runs `evaluateGlobal` (O(people + days)). `score` is always re-summed from the cached parts, never accumulated, so it can't drift.
- **`construct`.**
  1. Walk the month days in order and fill each required slot from people whose cell is free and empty. The order of slots: weekday R1, O20, O, N, R2; twelve-hour day R12, N12. Pick the smallest `tryMove` delta, breaking ties with `rnd`. Skip any candidate whose delta ≥ HARD/2; if every candidate is skipped, leave the gap.
  2. While someone is below FPD, add R2 on the free weekday with the smallest delta (again skipping HARD).
- **`search`.** Simulated annealing.
  - `restarts` segments of `maxIterations/restarts` iterations each. Segment 1 starts from `construct`; later segments `reset` to the best so far.
  - Temperature per segment: `T = 60 · (0.3/60)^(i/len)`. Accept a move if delta ≤ 0 or `rnd() < exp(−delta/T)`, and snapshot on each new best.
  - Every `progressEvery` iterations: `await new Promise(r => setTimeout(r, 0))`, call `onProgress`, then stop if `shouldStop?.()` or the time budget has run out.

- [ ] **Step 1: Write the failing tests**

```ts
// src/generator/search.test.ts
import { describe, it, expect } from 'vitest';
import { newAppData } from '../domain/defaults';
import { buildMonthGrid } from '../domain/context';
import { evaluateMonth } from '../domain/rules/evaluate';
import { Code } from '../domain/codes';
import { syntheticTeam } from '../test/team';
import { SearchState } from './state';
import { proposeMove } from './moves';
import { construct } from './construct';
import { search } from './search';
import { mulberry32 } from './rng';

const jan = () => { const d = newAppData(); d.people = syntheticTeam(); return buildMonthGrid(d, '2027-01'); };

describe('generator core', () => {
  it('incremental score equals a full evaluation', () => {
    const g = jan(); const st = new SearchState(g.ctx, g.rows, g.fixed); const rnd = mulberry32(7);
    construct(st, rnd);
    for (let i = 0; i < 5000; i++) {
      const m = proposeMove(st, rnd); if (!m) continue;
      st.tryMove(m); if (rnd() < 0.5) st.commit(); else st.revert();
      if (i % 250 === 0) {
        const full = evaluateMonth(g.ctx, st.rows).score;
        expect(Math.abs(st.score - full) / Math.max(1, full)).toBeLessThan(1e-9);
      }
    }
  });
  it('never changes fixed cells', async () => {
    const d = newAppData(); d.people = syntheticTeam();
    d.cells['2027-01-05'] = { A: { code: 'DOV' } }; d.cells['2027-01-06'] = { B: { code: 'O', pinned: true } };
    const g = buildMonthGrid(d, '2027-01');
    const r = await search(g.ctx, g.rows, g.fixed, { seed: 1, maxIterations: 20000 });
    for (let p = 0; p < g.rows.length; p++) for (let i = 0; i < g.rows[p].length; i++)
      if (g.fixed[p][i]) expect(r.rows[p][i]).toBe(g.rows[p][i]);
  });
  it('is deterministic for a seed', async () => {
    const g = jan();
    const a = await search(g.ctx, g.rows, g.fixed, { seed: 3, maxIterations: 20000 });
    const b = await search(g.ctx, g.rows, g.fixed, { seed: 3, maxIterations: 20000 });
    expect(a.rows).toEqual(b.rows);
  });
  it('keeps pins that break a must, and still finishes', async () => {
    const d = newAppData(); d.people = syntheticTeam();
    d.cells['2027-01-07'] = { C: { code: 'O', pinned: true } }; d.cells['2027-01-08'] = { C: { code: 'R1', pinned: true } };
    const g = buildMonthGrid(d, '2027-01');
    const r = await search(g.ctx, g.rows, g.fixed, { seed: 1, maxIterations: 20000 });
    expect([r.rows[2][7 + 6], r.rows[2][7 + 7]]).toEqual([Code.O, Code.R1]);
    expect(evaluateMonth(g.ctx, r.rows, true).findings.filter((f) => f.rule === 'M2')).toHaveLength(1);
  });
  it('reports progress and honours shouldStop', async () => {
    const g = jan(); let calls = 0;
    const r = await search(g.ctx, g.rows, g.fixed, { seed: 1, maxIterations: 1e9, progressEvery: 1000, shouldStop: () => calls >= 3 }, () => { calls++; });
    expect(calls).toBe(3); expect(r.iterations).toBeLessThan(10000);
  });
});
```

- [ ] **Step 2: Run.** Command: `npx vitest run src/generator`. Expected: FAIL.
- [ ] **Step 3: Implement** the five files per the Interfaces and Decisions above.
- [ ] **Step 4: Run.** Command: `npx vitest run src/generator`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: local-search generator core`

---

### Task 9: Generator quality on scenario months (and tuning)

**Files:**
- Create: `src/test/scenarios.ts`, `src/generator/scenarios.test.ts`
- Modify (tuning only): `BASE_WEIGHTS` in `weights.ts`, the temperatures, move probabilities and restarts in `search.ts` / `moves.ts`

**Interfaces:**
- Produces: `scenario(name: 'jan2027'|'feb2027'|'mar2027'|'dec2027'|'jul2027'|'impossible'|'pins'): { data: AppData; month: MonthKey }`, all built on `syntheticTeam()`:
  - **`jan2027`**:
    - Tail strips (Dec 25–31), by person:

      | Person | Dec 25–31 |
      |---|---|
      | A | `R12 R12 - R1 R1 R1 -` |
      | B | `- - - R2 R2 R2 R2` |
      | C | `- - - O O O O` |
      | D | `N12 N12 - - N N N` |
      | E | `- - R12 O20 O20 O20 O20` |
      | F | `- - N12 - - - -` |
      | G | `- - - R2 R2 - -` |
      | H | `- - - N - R2 R1` |

    - Requests: A, G and H have x on Jan 1–3; B has DOV on Jan 1 and x on Jan 2–3.
  - **`feb2027`**: no requests.
  - **`mar2027`**: Easter; no requests.
  - **`dec2027`**: A and G have `startingCounts.festive = 4`.
  - **`jul2027`**: DOV for B on Jul 5–9 and 12–16, for D on Jul 12–16 and 19–23, and for G on Jul 19–23 and 26–30. At most two people are away on any day.
  - **`impossible`**: `feb2027`, plus x for A–G on Feb 13 and Feb 14.
  - **`pins`**: `jan2027`, plus D pinned to N on Jan 11–15.

- [ ] **Step 1: Write the scenario tests.** Run each scenario through `search` (seed 1, `maxIterations: 300_000`, timeout 120 s), plus `jan2027` with seeds 2 and 3. Then evaluate with `evaluateMonth(ctx, rows, true)` and assert:
  - Every scenario except `impossible`: `mustUnits === 0`.
  - `feb2027`: every person has `twelve === 2` and `hours − fpd === 0.5`.
  - `jan2027` (all three seeds):
    - the sorted twelve-hour counts are `[2,2,3,3,3,3,3,3]`;
    - every overtime is ≤ 4.5;
    - every `weekendStyle: 'whole'` person has at most 1 W5b finding;
    - everyone with more than 5 nights has at most ceil(n/5) + 1 night runs.
  - `mar2027`: the sorted twelve-hour counts are `[2,2,2,2,3,3,3,3]`.
  - `dec2027`: A and G have 0 shifts on Dec 24, 25 and 26. Dec 31 is a working weekday, which A and G may need for FPD, so it isn't asserted.
  - `impossible`:
    - no finding of M2, M3, M4, M5, M7 or M8;
    - M1 gap findings sum to exactly 2 missing people, all on Feb 13–14;
    - no other M1 findings.
  - `pins`: D's cells on Jan 11–15 are still N.
- [ ] **Step 2: Run.** Command: `npx vitest run src/generator/scenarios.test.ts`. Expected: some may FAIL at first.
- [ ] **Step 3: Tune until every assertion passes.**
  - Change only `BASE_WEIGHTS`, the temperatures, the move probabilities and restarts, and `construct`'s tie-breaking.
  - Never weaken an assertion or the rule semantics.
  - Keep the whole file under 3 minutes.
  - If a scenario still fails after reasonable tuning, stop and report it with the failing numbers.
- [ ] **Step 4: Run the full suite.** Command: `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `test: generator scenarios; tune weights`, listing the final weight changes in the body

---

### Task 10: Save file and storage adapters

**Files:**
- Create: `src/storage/saveFile.ts`, `src/storage/adapter.ts`
- Test: `src/storage/saveFile.test.ts`, `src/storage/adapter.test.ts` (jsdom)

**Interfaces:**
- Produces:
  - `SCHEMA_VERSION = 1`
  - `serialize(data): string`: pretty JSON, wrapped as `{ app: 'shift-scheduler', ...data }`
  - `class SaveFileError extends Error`
  - `parseSaveFile(text): AppData`. It throws `SaveFileError` with these Czech messages:
    - invalid JSON or the wrong `app`: `Tohle není soubor s plánem směn.`
    - `schemaVersion` > 1: `Soubor je z novější verze aplikace.`
    - missing `people`, `settings` or `cells`: `Soubor je poškozený.`

    Settings missing from older files are filled in from `defaultSettings()`.
  - `StorageAdapter { loadCache(): AppData|null; saveCache(d: AppData): void; fileName(): string|null; canAutoSave(): boolean; openFile(): Promise<AppData|null>; saveFile(d: AppData): Promise<string>; autoSave(d: AppData): Promise<void> }`
  - `memoryStorage(initial?: AppData|null): StorageAdapter & { saved: string[] }`
  - `browserStorage(): StorageAdapter`:
    - `localStorage` key `shift-scheduler/v1`;
    - File System Access (`showOpenFilePicker` / `showSaveFilePicker`, with the handle kept in memory) when available, otherwise `<input type=file>` and an `a[download]` download;
    - suggested file name `plan-smen.json`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/storage/saveFile.test.ts
import { describe, it, expect } from 'vitest';
import { serialize, parseSaveFile, SaveFileError } from './saveFile';
import { newAppData } from '../domain/defaults';

describe('save file', () => {
  it('round-trips', () => { const d = newAppData(); expect(parseSaveFile(serialize(d))).toEqual(d); });
  it.each([
    ['{', 'Tohle není soubor s plánem směn.'],
    ['{"app":"other"}', 'Tohle není soubor s plánem směn.'],
    ['{"app":"shift-scheduler","schemaVersion":2}', 'Soubor je z novější verze aplikace.'],
    ['{"app":"shift-scheduler","schemaVersion":1}', 'Soubor je poškozený.'],
  ])('rejects %s', (text, msg) => {
    expect(() => parseSaveFile(text)).toThrow(SaveFileError);
    expect(() => parseSaveFile(text)).toThrow(msg);
  });
  it('fills settings missing from older files', () => {
    const d = newAppData(); const raw = JSON.parse(serialize(d)); delete raw.settings.generatorTimeBudgetSec;
    expect(parseSaveFile(JSON.stringify(raw)).settings.generatorTimeBudgetSec).toBe(20);
  });
});
```

`adapter.test.ts` (jsdom):
- `browserStorage()` round-trips through `localStorage`;
- a corrupt cache value makes `loadCache()` return `null` and leaves the stored value in place;
- `memoryStorage().saveFile(d)` records the serialized text.

- [ ] **Step 2: Run.** Command: `npx vitest run src/storage`. Expected: FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run.** Command: `npx vitest run src/storage`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: save file and storage adapters`

---

### Task 11: Excel copy and paste (TSV)

**Files:**
- Create: `src/clipboard/tsv.ts`
- Test: `src/clipboard/tsv.test.ts`

**Interfaces:**
- Produces:
  - `personRowTsv(data, month, personId): string`: the month's days, one tab-separated row, holding each cell's code name (x and absences included) or `''`.
  - `parseTsv(text): string[][]`: splits on `\r?\n` and tabs, drops one trailing empty line, keeps empty cells.
  - `PastePlan { writes: Array<{ personId: PersonId; date: ISODate; code: CodeName }>; ignored: Array<{ row: number; col: number; value: string }> }`
  - `planPaste(data, month, start: { personId: PersonId; date: ISODate }, text): PastePlan`:
    - Rows map to people in order from `start.personId`; columns map to consecutive dates from `start.date`.
    - Only the 7 tail dates and the month's dates are valid.
    - Empty values write nothing.
    - Unknown values go to `ignored`, as do rows beyond the last person and dates out of range.
    - If every non-empty value in column 0 is unrecognised, column 0 is dropped (a names column) and its values are not listed.
  - `applyPaste(data, plan): AppData`: shifts are written pinned (`{code, pinned: true}`), absences and x as `{code}`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/clipboard/tsv.test.ts
import { describe, it, expect } from 'vitest';
import { newAppData } from '../domain/defaults';
import { personRowTsv, parseTsv, planPaste, applyPaste } from './tsv';

describe('tsv', () => {
  it('copies a person row with x and absences', () => {
    const d = newAppData(); const id = d.people[0].id;
    d.cells['2027-02-01'] = { [id]: { code: 'R1' } }; d.cells['2027-02-02'] = { [id]: { code: 'x' } };
    d.cells['2027-02-03'] = { [id]: { code: 'DOV' } };
    expect(personRowTsv(d, '2027-02', id)).toBe(['R1', 'x', 'DOV', ...Array(25).fill('')].join('\t'));
  });
  it('parses Excel text with CRLF and trailing newline', () => {
    expect(parseTsv('a\tb\r\n\tc\t\r\n')).toEqual([['a', 'b'], ['', 'c', '']]);
  });
  it('maps a requests block, dropping names and ignoring totals', () => {
    const d = newAppData(); const [p1, p2] = d.people;
    const text = 'Operátor 1\tX\tdov\t\r\nOperátor 2\t\tMD\tŠk.\r\nCelkem\t1\t2\t0';
    const plan = planPaste(d, '2027-01', { personId: p1.id, date: '2027-01-01' }, text);
    expect(plan.writes).toEqual([
      { personId: p1.id, date: '2027-01-01', code: 'x' }, { personId: p1.id, date: '2027-01-02', code: 'DOV' },
      { personId: p2.id, date: '2027-01-02', code: 'MD' }]);
    expect(plan.ignored.map((i) => i.value)).toEqual(['Šk.', '1', '2', '0']);
  });
  it('pins pasted shifts, not requests', () => {
    const d = newAppData(); const id = d.people[0].id;
    const out = applyPaste(d, { writes: [{ personId: id, date: '2026-12-31', code: 'N' }, { personId: id, date: '2027-01-02', code: 'x' }], ignored: [] });
    expect(out.cells['2026-12-31'][id]).toEqual({ code: 'N', pinned: true });
    expect(out.cells['2027-01-02'][id]).toEqual({ code: 'x' });
  });
});
```

(In the third test, row 3 lands on person 3. Its values `1 2 0` sit under dates, so they are ignored. Column 0 holds only names and `Celkem`, so it is dropped.)

- [ ] **Step 2: Run.** Command: `npx vitest run src/clipboard`. Expected: FAIL.
- [ ] **Step 3: Implement** `tsv.ts`.
- [ ] **Step 4: Run.** Command: `npx vitest run src/clipboard`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: Excel copy and paste`

---

### Task 12: App state, shell, start screen, save bar

**Files:**
- Create: `src/ui/text.ts`, `src/ui/reducer.ts`, `src/ui/store.tsx`, `src/ui/App.tsx`, `src/ui/StartScreen.tsx`, `src/ui/SaveBar.tsx`, `src/ui/styles.css`, `src/worker/runner.ts`
- Modify: `src/main.tsx` renders `<AppProvider storage={browserStorage()} runner={inProcessRunner}><App/></AppProvider>`. Task 15 switches this to `workerRunner`.
- Test: `src/ui/reducer.test.ts`, `src/ui/App.test.tsx`

**Interfaces:**
- Produces, in `reducer.ts`: `Action` =
  - `{type:'load'; data}`
  - `{type:'setCell'; date; personId; cell: StoredCell|null}`
  - `{type:'togglePin'; date; personId}` (shift cells only)
  - `{type:'applyPaste'; plan}`
  - `{type:'applyGenerated'; month; rows: Uint8Array[]; seed: number}`, which uses `buildMonthGrid` and `applyRows`, then sets `months[month] = {status:'draft', seed, generatedAt}`
  - `{type:'updatePerson'; person}`
  - `{type:'addPerson'}`, which gets the id `crypto.randomUUID()` and the name `Operátor ${n}`
  - `{type:'removePerson'; personId}`, which also deletes that person's cells
  - `{type:'movePerson'; personId; delta: -1|1}`
  - `{type:'updateSettings'; patch: Partial<Settings>}`

  `reduce(data: AppData, a: Action): AppData` is pure.
- Produces, in `store.tsx`: `AppProvider({ storage, runner, children })` and `useApp()`, which returns:
  - `data: AppData|null`;
  - `dispatch`;
  - `file: { name: string|null; savedAt: string|null; dirty: boolean; auto: boolean }`;
  - `openFile(): Promise<void>`, which on `SaveFileError` sets `error` and keeps the data;
  - `saveFile(): Promise<void>`;
  - `newData(): void`;
  - `error: string|null`;
  - `runner`.

  Every change to the data is saved to the cache (debounced 300 ms). When `storage.canAutoSave()` is true it is also auto-saved to the file (debounced 1 s); otherwise `file.dirty = true`.
- Produces, in `text.ts`: Czech month names (`Leden`…`Prosinec`), weekday abbreviations `po út st čt pá so ne`, and the preference and wish labels used in Tasks 13 and 17.
- UI copy:
  - Tabs: `Měsíc`, `Tým`, `Pravidla`. Until Tasks 13, 14 and 17 fill them, each tab panel shows `Připravuje se…`.
  - Start screen: heading `Plánování směn`, buttons `Otevřít soubor` and `Začít nový`, plus one sentence explaining that data stays on this computer.
  - Save bar: `Ukládá se automaticky do ${name}` when auto, `Uloženo do souboru ${time}` when saved, `Změny nejsou uložené do souboru` when dirty. Buttons `Uložit do souboru` and `Otevřít soubor`.

- [ ] **Step 1: Write the failing tests**
  - `reducer.test.ts`, one test per action:
    - `togglePin` ignores a cell holding x;
    - `removePerson` removes that person's cells;
    - `applyGenerated` sets the status `draft` and keeps fixed cells.
  - `App.test.tsx` (jsdom):

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { it, expect } from 'vitest';
import { AppProvider } from './store';
import { App } from './App';
import { memoryStorage } from '../storage/adapter';
import { inProcessRunner } from '../worker/runner';
import { newAppData } from '../domain/defaults';
import { SaveFileError } from '../storage/saveFile';

it('shows the start screen when nothing is cached, then the app', async () => {
  render(<AppProvider storage={memoryStorage(null)} runner={inProcessRunner}><App /></AppProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Začít nový' }));
  for (const name of ['Měsíc', 'Tým', 'Pravidla']) expect(screen.getByRole('tab', { name })).toBeInTheDocument();
  expect(screen.getByText('Změny nejsou uložené do souboru')).toBeInTheDocument();
});
it('opens the app directly from the cache', () => {
  render(<AppProvider storage={memoryStorage(newAppData())} runner={inProcessRunner}><App /></AppProvider>);
  expect(screen.queryByRole('button', { name: 'Začít nový' })).toBeNull();
});
it('keeps data and shows the error when a file is broken', async () => {
  const s = memoryStorage(newAppData());
  s.openFile = async () => { throw new SaveFileError('Soubor je poškozený.'); };
  render(<AppProvider storage={s} runner={inProcessRunner}><App /></AppProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Otevřít soubor' }));
  expect(await screen.findByText('Soubor je poškozený.')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Měsíc' })).toBeInTheDocument();
});
```

  `src/worker/runner.ts` is created in this task with the `GeneratorRunner` type and an `inProcessRunner` that calls `search` directly. Task 15 adds `workerRunner`.
- [ ] **Step 2: Run.** Command: `npx vitest run src/ui`. Expected: FAIL.
- [ ] **Step 3: Implement** the listed files, plus `runner.ts` with:
  - `GeneratorRunner = (input: { ctx; rows; fixed; seed; maxIterations; timeBudgetMs }, onProgress: (p: SearchProgress) => void) => { result: Promise<SearchResult>; stop(): void }`
  - `inProcessRunner`
- [ ] **Step 4: Run.** Command: `npx vitest run src/ui`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: app shell, start screen and save bar`

---

### Task 13: Team screen

**Files:**
- Create: `src/ui/team/TeamScreen.tsx`, `src/ui/team/PersonCard.tsx`
- Test: `src/ui/team/TeamScreen.test.tsx`

**Interfaces:**
- Consumes: `useApp()`, the actions `updatePerson`, `addPerson`, `removePerson`, `movePerson`, and the labels from `text.ts`.
- Each card holds:
  - name input (`aria-label="Jméno"`);
  - ↑/↓ buttons;
  - `V týmu od` / `do` date inputs;
  - five rating selects labelled `R1`…`N`, with options `—`, `nejvíce preferuji`, `spíše preferuji`, `neutrální`, `spíše nepreferuji`, `nejméně preferuji`;
  - nights select `Noční`, with the four survey sentences from spec §6.3;
  - `Víkendy`: `Jeden celý víkend (so + ne) v měsíci` / `Jednotlivé dny ve více víkendech` / `Je mi to jedno`;
  - `Po víkendu`: `Chci po víkendu volné dny` / `Nerozdávat automaticky volné dny po víkendu` / `Je mi to jedno`;
  - `Po posledním nočním (po 1 dni volna) může přijít` checkboxes for R1, R2, O and O20;
  - `Poznámka` textarea;
  - `Dovolená / rok` and `MyDay / rok` numbers;
  - `Výchozí počty` for 12h, nights, holidays and Christmas;
  - a `Odebrat` button behind `window.confirm`.
- The `Přidat člověka` button adds a person.

- [ ] **Step 1: Write the failing tests** (jsdom, with `memoryStorage(newAppData())`):
  - Typing a new name into the first `Jméno` updates the value shown.
  - Choosing `Rád budu brát noční směny i za mé kolegy, pokud je to možné.` in the first `Noční` select makes `useApp().data.people[0].prefs.nights === 'extra'`. Read it through a test probe component.
  - `Přidat člověka` gives 9 `Jméno` inputs.
  - `Odebrat` with `confirm` mocked to `true` gives 7.
  - ↓ on the first card makes the second name first.
- [ ] **Step 2: Run.** Command: `npx vitest run src/ui/team`. Expected: FAIL.
- [ ] **Step 3: Implement** `TeamScreen` and `PersonCard`, and wire the tab.
- [ ] **Step 4: Run.** Command: `npx vitest run src/ui`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: team screen with preference cards`

---

### Task 14: Month screen (grid, cell menu, totals, coverage, checks)

**Files:**
- Create: `src/ui/month/MonthScreen.tsx`, `Grid.tsx`, `CellMenu.tsx`, `ChecksPanel.tsx`
- Test: `src/ui/month/MonthScreen.test.tsx`

**Interfaces:**
- Consumes: `buildMonthGrid`, `evaluateMonth(ctx, rows, true)` (memoized on data and month), `fmtH`, the actions `setCell` and `togglePin`.
- Decisions:
  - **Default month:** the month after today's month. ◀ ▶ buttons, and the heading `${Měsíc} ${rok}` (e.g. `Leden 2027`).
  - **Status badge:** `Žádosti` when there are no month meta, otherwise `Návrh` or `Uzavřeno`.
  - **Info line:** `FPD ${fmtH} h · ${n} pracovních dní · ${m} dnů s 12h směnami`.
  - **Cells** carry `data-testid="cell-${personId}-${date}"`.
    - Tail columns get the class `tail`; twelve-hour days get `twelve`.
    - Code colours: R1 `#fff2a8`, R2 `#a6ecf2`, O20 white with a border, O `#fcd5b4`, N `#33b5f0`, N12 `#1f78c8` with white text, R12 `#f9c6f0`, absences `#c6efce`; x is grey italic.
    - A pinned cell shows `📌`.
    - Cells involved in a must finding always get a red outline. Cells of the selected finding get an amber outline.
  - **Clicking a cell** selects it and opens `CellMenu`, a `role="menu"`. It offers the codes valid for the day type, `DOV MD OP NEM x`, `Vymazat` and `Připnout`/`Odepnout`.
    - Choosing a shift stores it pinned, because a manual edit means "keep this".
    - Choosing an absence or x stores it plain. `Vymazat` deletes the cell.
    - Escape closes the menu.
  - **Totals columns** per person, `data-testid="totals-${personId}"`: `Hodiny / FPD`, `Přesčas`, `12h`, `Noci`, and a small `R1 n · R2 n · O20 n · O n · N n`.
  - **Coverage row** `Obsazeno`, with `data-testid="coverage-${date}"`: `✓`, or the M1 messages joined with `, `.
  - **ChecksPanel** heading `Kontrola`, then the summary `Musí: ${mustCount} · Přání: ${wishCount}`. Musts are listed first (red), then wishes (amber). Each line reads `${name} · ${d. m.}: ${message}`, or just the message for global findings. Clicking a line selects it.

- [ ] **Step 1: Write the failing tests** (jsdom). Data: `newAppData()` with `syntheticTeam()`, viewing `2027-01`. Set the month with a `initialMonth` prop on `MonthScreen` (default: next month).

```tsx
it('edits a cell and reacts with checks and totals', async () => {
  // render MonthScreen initialMonth="2027-01" inside AppProvider with the synthetic team
  expect(screen.getByRole('heading', { name: 'Leden 2027' })).toBeInTheDocument();
  expect(screen.getByTestId('cell-A-2026-12-31')).toHaveClass('tail');
  await userEvent.click(screen.getByTestId('cell-C-2027-01-06'));
  await userEvent.click(screen.getByRole('menuitem', { name: 'O' }));
  await userEvent.click(screen.getByTestId('cell-C-2027-01-07'));
  await userEvent.click(screen.getByRole('menuitem', { name: 'R1' }));
  expect(screen.getByTestId('cell-C-2027-01-07')).toHaveTextContent('R1📌');
  expect(screen.getByText(/R1 hned po O: jen 8 h odpočinku/)).toBeInTheDocument();
  expect(screen.getByTestId('totals-C')).toHaveTextContent('15 / 157,5');
  expect(screen.getByTestId('coverage-2027-01-04')).toHaveTextContent('chybí R1');
});
it('offers only 12-hour shifts on a weekend', async () => {
  await userEvent.click(screen.getByTestId('cell-A-2027-01-09'));
  expect(screen.queryByRole('menuitem', { name: 'R1' })).toBeNull();
  expect(screen.getByRole('menuitem', { name: 'R12' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run.** Command: `npx vitest run src/ui/month`. Expected: FAIL.
- [ ] **Step 3: Implement** the four components and the styles.
- [ ] **Step 4: Run.** Command: `npx vitest run src/ui`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: month grid with live checks`

---

### Task 15: Generate from the UI (worker, progress, stop)

**Files:**
- Create: `src/worker/protocol.ts`, `src/worker/generator.worker.ts`, `src/ui/month/useGenerator.ts`
- Modify: `src/worker/runner.ts` (add `workerRunner`), `src/ui/month/MonthScreen.tsx`, `src/main.tsx` (use `workerRunner`)
- Test: `src/ui/month/generate.test.tsx`

**Interfaces:**
- Produces, in `protocol.ts`:
  - `ToWorker = {type:'run'; ctx; rows; fixed; seed; maxIterations; timeBudgetMs} | {type:'stop'}`
  - `FromWorker = {type:'progress'; progress: SearchProgress} | {type:'done'; result: SearchResult} | {type:'error'; message: string}`
- Produces: `workerRunner: GeneratorRunner`, which imports the worker with `?worker&inline` so it works from `file://` under the CSP.
- Produces: `useGenerator()`, returning `{ running: boolean; progress: SearchProgress|null; start(month): void; stop(): void }`:
  - the seed is a random uint32;
  - `maxIterations` is `50_000_000`;
  - `timeBudgetMs` is `settings.generatorTimeBudgetSec * 1000`;
  - on done it dispatches `applyGenerated`.
- UI:
  - The button `Vygenerovat` is disabled while generating.
  - While generating it shows `Generuji… ${Math.round(elapsed/budget*100)} %` and a `Zastavit` button.
  - When finished it shows `Hotovo. Porušená pravidla: ${mustUnits}`.

- [ ] **Step 1: Write the failing test** (jsdom; uses `inProcessRunner`). Data: `scenario('jan2027').data` with `generatorTimeBudgetSec: 1`. Steps:
  - click `Vygenerovat`;
  - await `Hotovo`;
  - assert that the status badge reads `Návrh`;
  - assert that `coverage-2027-01-04` reads `✓`;
  - assert that `cell-A-2027-01-01` still shows `x`.
- [ ] **Step 2: Run.** Command: `npx vitest run src/ui/month/generate.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the protocol, the worker (which runs `search` and handles `stop` through `shouldStop`), `workerRunner`, `useGenerator`, and the button area.
- [ ] **Step 4: Run.** Command: `npx vitest run src/ui`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: generate drafts in a worker`

---

### Task 16: Paste dialog and row copy in the month screen

**Files:**
- Create: `src/ui/month/PasteDialog.tsx`
- Modify: `src/ui/month/MonthScreen.tsx`, `src/ui/month/Grid.tsx`
- Test: `src/ui/month/paste.test.tsx`

**Interfaces:**
- Consumes: `planPaste`, `applyPaste` (via the `applyPaste` action), `personRowTsv`.
- UI:
  - **`Vložit z Excelu`** opens a `role="dialog"`:
    - the text `Začátek: ${name}, ${d. m.}`, using the selected cell, or else the first person on day 1;
    - a textarea labelled `Sem vložte buňky z Excelu (Ctrl+V)`;
    - a live preview: `Rozpoznáno: ${writes} · Ignorováno: ${ignored}`, listing the ignored values;
    - buttons `Použít` and `Zrušit`.
  - **Row copy button**, `aria-label="Kopírovat řádek ${name}"`, on each person row:
    - copies `personRowTsv` with `navigator.clipboard.writeText`;
    - falls back to a hidden textarea and `document.execCommand('copy')`;
    - then shows `Zkopírováno – vložte do řádku směna v Excelu`.

- [ ] **Step 1: Write the failing tests** (jsdom):
  - With the synthetic team and no cells: select `cell-A-2027-01-01`, open the dialog, type `x\tDOV\nMD` (B is the next row), click `Použít`. Expect A on Jan 1 to show `x`, A on Jan 2 `DOV`, and B on Jan 1 `MD`.
  - With `scenario('jan2027').data` and `navigator.clipboard.writeText` mocked: clicking `Kopírovat řádek Operátor A` calls it with a string that starts `x\tx\tx\t` and has 31 tab-separated fields.
- [ ] **Step 2: Run.** Command: `npx vitest run src/ui/month/paste.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the dialog, the copy button and the toast.
- [ ] **Step 4: Run.** Command: `npx vitest run src/ui`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: paste from and copy to Excel`

---

### Task 17: Rules screen (Phase 1 subset)

**Files:**
- Create: `src/ui/rules/RulesScreen.tsx`
- Test: `src/ui/rules/RulesScreen.test.tsx`

**Interfaces:**
- Fields:
  - `Odpočinek mezi směnami (h)`: 8–24, step 0.5;
  - `Max. 12h směn za měsíc`: 1–10;
  - `Cíl 12h směn za měsíc`: 0–10;
  - `Čas na generování (s)`: 3–120;
  - one select per wish with the options `0 – vypnuto`, `1`, `2`, `3 – běžně`, `4`, `5 – hodně`.
- Wish labels:

| Wish | Label |
|---|---|
| W1 | Co nejméně přesčasů |
| W2 | Stejná směna 4–5 dní v řadě |
| W3 | Po 5–6 dnech 2 dny volna |
| W4a | Noční v delších blocích |
| W4b | Před nočními volno (a předtím R2, O20 nebo O) |
| W4c | Po nočních 2 dny volna |
| W4d | Noční podle ochoty |
| W5a | Cíl 12h směn za měsíc |
| W5b | Celé víkendy podle přání |
| W5c | Volno po víkendu podle přání |
| W5d | Vedle R12 jen R1 nebo R2 |
| W6 | Oblíbené směny |
| W7 | Férovost napříč měsíci |
| W8 | Neoblíbené směny rovnoměrně |
| W9 | Vyrovnané dny (R2) |

- [ ] **Step 1: Write the failing tests** (jsdom, synthetic team):
  - O20 on Jan 6 followed by R1 on Jan 7 for C leaves 10 h of rest. With the default 12 h, `Kontrola` shows `R1 hned po O20`. After setting `Odpočinek mezi směnami (h)` to `10`, it no longer does.
  - Set the `Oblíbené směny` select to `0 – vypnuto` and expect `settings.wishLevels.W6 === 0`, read through a probe component that uses `useApp()`.
- [ ] **Step 2: Run.** Command: `npx vitest run src/ui/rules`. Expected: FAIL.
- [ ] **Step 3: Implement** `RulesScreen` and wire the tab.
- [ ] **Step 4: Run.** Command: `npx vitest run src/ui`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: rules screen`

---

### Task 18: End-to-end from the built file, and the README

**Files:**
- Create: `tests/e2e/plan-january.spec.ts`, `README.md`
- Test: the e2e spec

**Interfaces:**
- Consumes: the whole app.

- [ ] **Step 1: Write the e2e test** against `file://…/dist/index.html`. Record any `http(s)` requests, and any CSP violations: `page.on('console')` messages matching `/Content Security Policy/i`.
  - Click `Začít nový`.
  - Under `Pravidla`, set `Čas na generování (s)` to `5`.
  - Under `Měsíc`, click ▶ or ◀ until the heading is `Leden 2027`.
  - Click `Vygenerovat` and wait up to 30 s for `Hotovo`.
  - Expect every `coverage-2027-01-*` to read `✓`.
  - Expect the `Kontrola` summary to start with `Musí: 0`.
  - Expect no recorded requests and no CSP messages.
- [ ] **Step 2: Run.** Command: `npm run test:e2e`. Expected: PASS (both specs).
- [ ] **Step 3: Write `README.md`** in English, covering:
  - what the tool is;
  - `npm ci`, `npm test`, `npm run build`;
  - delivery: send `dist/index.html` and open it in Edge or Chrome, where auto-save to the file works;
  - that the save file is the real data and should be kept with his work files;
  - that no team data belongs in the repo.
- [ ] **Step 4: Full check.** Commands: `npm run typecheck && npm test && npm run test:e2e`. Expected: all green.
- [ ] **Step 5: Commit:** `test: end-to-end January plan; docs: README`
