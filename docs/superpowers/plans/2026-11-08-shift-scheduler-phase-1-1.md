# Shift Scheduler, Phase 1.1: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Phase 1 app in line with the team lead's feedback, in time to plan January–March 2027 in the second half of December 2026. The feedback brings new and changed rules, doctor's notes, per-person limits, and fairness that carries from month to month.

**Architecture:**
- The rule engine (`src/domain/rules`) gains new musts, a strong-wish tier and a doctor wish. The generator picks them up unchanged, because it scores through the same `evaluatePerson`.
- The data model and the save file move to version 2.
- The month context (`buildMonthGrid`) carries per-person limits, claimed holidays, doctor's notes and history from earlier months.
- The screens add the new inputs and lines.

**Tech Stack:** TypeScript (strict), React, Vite (single-file build), Vitest + jsdom + Testing Library, Playwright (Chromium).

**Spec:** `docs/superpowers/specs/2026-11-07-shift-scheduler-phase-1-1-design.md`. It builds on `docs/superpowers/specs/2026-11-04-shift-scheduler-design.md`, and the Phase 1 rulings are in `docs/superpowers/plans/2026-11-04-shift-scheduler-phase-1-notes.md`.

## Global Constraints

- **Delivery.** One self-contained `dist/index.html`. It works offline from disk in current Edge, Chrome and Firefox, and makes no network request of any kind at runtime.
- **Privacy.** No real names or team data anywhere in the repo. Tests use the made-up team in `src/test/team.ts` (Operátor A…H).
- **Language.** UI text is Czech. Code, comments, docs and commit messages are English.
- **Wording addressed to the user.** Gender-neutral, formal imperative forms ("Klikněte na…"). No gendered past-tense forms.
- **Dates.** Dates are `YYYY-MM-DD` and months `YYYY-MM`. All date arithmetic is in UTC. Hours are shown with a decimal comma (`157,5`).
- **Storage.** The save file is the real store. Files saved by Phase 1 (`schemaVersion: 1`) must open.
- **Generator tests.** After any scoring change, compare the scenario pass rates over many seeds before and after (`SCENARIO_SEEDS`). Never weaken an assertion or re-seed a test to make it pass (Phase 1 ruling R26).
- **Git.**
  - Work on branch `phase-1.1`. Never push and never merge.
  - Each commit message is a conventional subject, a blank line, then your own model's `Co-Authored-By:` line. It ends with exactly `Claude-Session: https://claude.ai/code/session_01BG2nLPWd5JMtPVcJi9dMV3`.
- **Deadline:** ready by mid-December 2026.

## Penalty tiers (all tasks)

`src/domain/rules/weights.ts` holds these values. Each tier must outweigh everything below it.

| Constant | Value | Meaning |
|---|---|---|
| `HARD` | `1e9` (unchanged) | one broken hard must: M2–M5, M8, M9, M10, M11, M13, or an extra person on a shift (M1) |
| `GAP` | **`1e7`** (was `1e6`) | one missing person on a shift (M1) |
| `STRONG` | **`2e6`** (new) | one night for a person whose night preference is `never` (S1). Above `11.5 × BELOW_FPD`, so hours never buy such a night; below `GAP`, so coverage does |
| `WEEKEND_SHORT` | **`1e6`** (new) | each weekend shift below the minimum (M12) |
| `BELOW_FPD` | `1e5` per hour (unchanged) | hours below FPD (M6) |
| wishes | base weight × level factor (unchanged scheme) | W1–W10 |

`BASE_WEIGHTS.W10 = 10`.

## Review Focus

1. **A Phase 1 save file** (`schemaVersion: 1`) opens with every new field at its default, and the next save writes version 2. Tested in Task 1.
2. **Doctor's notes pasted in other forms** (`L 8-12`, `L8–12`, `l 8:00 - 12:00`), or onto a day that already holds a shift, become notes and keep the shift. Tested in Task 9.
3. **A person with `x` on every 12-hour day but one.** The minimum of 2 is impossible, so Kontrola shows M12 in red. The generator breaks no hard must and leaves no shift uncovered because of it. Tested in Task 6.
4. **January with December's last week empty or partly filled.** Weekly rest and days in a row raise no false alarms. A run of days that crosses the boundary is counted whole. Tested in Task 3.
5. **Clearing a per-person limit.** An empty field goes back to the general value. Max nights `0` means no nights at all. Tested in Tasks 4 and 8.

---

### Task 1: Data model, defaults and save file version 2

**Files:**
- Modify: `src/domain/types.ts`, `src/domain/defaults.ts`, `src/domain/rules/weights.ts` (`BASE_WEIGHTS.W10` only), `src/storage/saveFile.ts`, `src/ui/text.ts` (`WISH_LABELS.W10` only, so the exhaustive record compiles)
- Test: `src/storage/saveFile.test.ts`, `src/domain/defaults.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  - `export interface DoctorNote { from: number; to: number }`: minutes from midnight, `0 <= from < to <= 1440`.
  - `Settings` gains `maxDaysInRow: number`, `minWeekendShifts: number` and `weeklyRestHours: number`.
  - `Person` gains `maxTwelve: number | null` and `maxNights: number | null`. `null` means the general value, or no limit for nights.
  - `AppData` becomes `schemaVersion: 2` and gains `doctor: Record<ISODate, Record<PersonId, DoctorNote>>`.
  - `WishId` gains `'W10'`.
- Produces, in `defaults.ts`:
  - settings: `maxDaysInRow: 6`, `minWeekendShifts: 2`, `weeklyRestHours: 35`, `wishLevels.W10: 3`;
  - `newPerson`: `maxTwelve: null`, `maxNights: null`;
  - `newAppData`: `schemaVersion: 2`, `doctor: {}`.
- Produces, in `saveFile.ts`: `SCHEMA_VERSION = 2`. `parseSaveFile` accepts versions 1 and 2. Version 1 gets `doctor: {}` and the new person fields as `null`, and missing settings keys come from the defaults as today. A version above 2 gets the existing "Soubor je z novější verze aplikace." message.
- Produces, in `text.ts`: `WISH_LABELS.W10 = 'Směna mimo návštěvu lékaře'`.

- [ ] **Step 1: Write the failing tests** in `saveFile.test.ts`:
  - `opens a version 1 file with the new fields at their defaults`. A v1 file without `doctor`, without person limits and without the new settings parses to `doctor: {}`, `maxTwelve: null`, `maxNights: null`, `maxDaysInRow: 6`, `minWeekendShifts: 2`, `weeklyRestHours: 35`, `wishLevels.W10: 3` and `schemaVersion: 2`.
  - `round-trips a version 2 file`. `parseSaveFile(serialize(data))` deep-equals `data`, where `data` has doctor notes and limits.
  - `refuses a broken doctor note`. A note with `from >= to`, a non-integer, a value outside 0–1440, an unreal date or an unknown person id is refused with "Soubor je poškozený.".
  - `takes a wrong-typed person limit as null`. `maxTwelve: "x"` becomes `null`, as `completePerson` does for other leaves.
  - `refuses version 3` with the newer-version message.

  In `defaults.test.ts`, assert the new defaults.
- [ ] **Step 2: Run** `npx vitest run src/storage src/domain/defaults.test.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the types, defaults, `BASE_WEIGHTS.W10`, `WISH_LABELS.W10` and the parser changes. Then fix the compile errors that the new required fields cause in fixtures, e.g. in `src/test/team.ts`, by using the defaults.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: save file version 2 with doctor's notes, person limits and new settings`

---

### Task 2: Month context: limits, claimed holidays, doctor's notes, history

**Files:**
- Create: `src/domain/history.ts`
- Modify: `src/domain/context.ts`
- Test: `src/domain/history.test.ts`, `src/domain/context.test.ts`

**Interfaces:**
- Consumes: Task 1's types.
- Produces, in `history.ts`:
  - `export function monthCounts(data: AppData, month: MonthKey, personId: PersonId): FairnessCounts`. It counts over the days of `month`:
    - `twelve`: R12/N12 that are **not** claimed;
    - `nights`: N/N12;
    - `holidayTwelve`: R12/N12 on a holiday, claimed or not;
    - `festive`: shifts on a festive day.
  - `export function historyCounts(data: AppData, month: MonthKey, personId: PersonId): FairnessCounts`: the sum of `monthCounts` over the `settings.fairnessWindowMonths` months before `month`, drafts included.
  - `export function isClaimed(cell: StoredCell | undefined, day: DayInfo): boolean`: true for a pinned R12 or N12 on a public holiday (`day.holiday`).
- Produces: `EnginePerson` gains these fields:
  - `maxTwelve: number`: `person.maxTwelve ?? settings.maxTwelvePerMonth`;
  - `maxNights: number | null`;
  - `claimed: Uint8Array`: 1 on each day of `ctx.days` where `isClaimed`;
  - `doctorFrom: Int16Array` and `doctorTo: Int16Array`: minutes, or `-1` where there is no note, per day of `ctx.days`.

  `history` becomes `startingCounts + historyCounts(...)`, field by field.

- [ ] **Step 1: Write the failing tests:**
  - `history.test.ts`:
    - `counts January when February is built`: two R12 and three N in January give `twelve: 2, nights: 3` in `historyCounts(data, '2027-02', id)`.
    - `leaves out months beyond the fairness window`: with window 1, December 2026 is not counted for February 2027.
    - `does not count a claimed holiday shift as twelve`: a pinned R12 on 1 Jan gives `twelve: 0, holidayTwelve: 1`.
  - `context.test.ts`:
    - `resolves maxTwelve from the person, else the settings`;
    - `marks claimed holiday shifts`: pinned R12 on 1 Jan → 1; unpinned → 0; pinned R12 on a plain Saturday → 0;
    - `carries doctor's notes`: `L 8-12` gives 480/720, and other days are -1;
    - `history adds starting counts and earlier months`.
- [ ] **Step 2: Run** `npx vitest run src/domain/history.test.ts src/domain/context.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `history.ts` and the context fields.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: month context with person limits, claimed holidays, doctor's notes and history`

---

### Task 3: Days in a row and weekly rest (M9, M10, M11) and the reshaped W3

**Files:**
- Create: `src/domain/rules/restMusts.ts`
- Modify: `src/domain/rules/types.ts` (MustId), `src/domain/rules/person.ts` (call the new rules), `src/domain/rules/personWishes.ts` (`rhythm`), `src/domain/format.ts` (if a plural helper is missing)
- Test: `src/domain/rules/musts-rows.test.ts` (new), `src/domain/rules/wishes-rhythm.test.ts`

**Interfaces:**
- Produces: `MustId` adds `'M9' | 'M10' | 'M11'`.
- Produces: `export function runMusts(ctx: MonthContext, p: number, row: Uint8Array, stats: PersonStats, sink?: Sink): number`.
  - A **working day** is a day where `isShift(row[i])`; the day a night ends is free unless a shift starts on it.
  - Runs are read over the tail, the month and `nextDay`. A run counts when it reaches into the month.
  - **M9:** a run longer than `settings.maxDaysInRow` costs `HARD × (length − max)`. Message `${days(length)} v kuse (max. ${max})`.
  - **M10:** a run of **6 or more** working days (a fixed threshold, `LONG_RUN = 6`; the design keeps it out of the settings) followed by exactly one day off and then work costs `HARD`. Message `po ${length} dnech práce jen 1 den volna (min. 2 dny)`. Each adds 1 to `stats.mustUnits`.
- Produces: `export function weeklyRest(ctx: MonthContext, p: number, row: Uint8Array, stats: PersonStats, sink?: Sink): number` (**M11**). It works in absolute minutes from the start of `ctx.days[0]`:
  - Build the person's shift intervals from `settings.shifts` over the tail, the month and `nextDay`. The time before the first known shift and after the end of the `nextDay` day counts as rest: unknown, so no alarm.
  - Rests are the gaps between consecutive intervals.
  - A window `[w·1440, (w+7)·1440)` passes when some rest of at least `weeklyRestHours·60` minutes **overlaps** it. The rest counts whole, even when it starts before the window or ends after it.
  - Check every window with `w >= 0` that contains a day of the month and ends by the end of the `nextDay` day.
  - Failing windows cost `HARD` each and add 1 unit each.
  - Report one finding per maximal run of consecutive failing windows. Its days are the month days of those windows, and its message is `jen ${fmtH(longestH)} h volna v kuse za 7 dní (min. ${fmtH(min)} h)`, where `longestH` is the longest rest that overlaps the first failing window.
- Produces: the reshaped W3 in `rhythm`:
  - **Drop** the "> 6 days" part (now M9).
  - **Add:** a run of exactly 6 costs `W3`, message `6 dní v kuse (ideálně nejvýš 5)`.
  - **Keep:** "after ≥5 days only 1 day off" (`W3`) and "12+ days with one day off" (`3 × W3`).
  - **Add:** every single day off between two working days in the month costs `0.5 × W3`, as a **quiet** finding (message `jen 1 den volna`). This is the "days off in pairs" wish, kept quiet so that Kontrola is not flooded.

- [ ] **Step 1: Write the failing tests** in `musts-rows.test.ts`. Use the test kit's row builders and January 2027. The team lead's examples:
  - `R1 Mon–Fri with the weekend off breaks nothing`: two weeks in a row; no M9, M10 or M11.
  - `six days then two days off is fine`: R1 Mon–Fri, R12 Sat, Sun and Mon off, R1 Tue → no M10.
  - `six days then one day off breaks M10`: R1 Mon–Sat, Sun off, R1 Mon → one M10.
  - `seven days breaks M9`: one finding, penalty `HARD`.
  - `nights Mon–Fri are five days`: N Mon–Fri, nothing Sat and Sun (Friday's night ends Saturday 06:00), R1 the next Monday → no M9, M10 or M11.
  - `weekly rest counts a rest that crosses the window`: R1 Mon–Fri across 3 weeks → no M11 in any window.
  - `only short rests break M11`: repeat the 4-day pattern O, off, R1, R1 over 14 days in the month. The longest rest is 32 h, so every window inside the pattern fails → at least one M11, whose message contains `32 h`, and no M2, M9 or M10.
  - Review Focus 4:
    - `an empty December raises no alarm in early January`: January starts with work days and the tail is empty → no M9/M10/M11 on 1–7 Jan.
    - `a run crossing the turn of the month counts whole`: 4 working days at the end of December plus 3 in January → one M9.

  In `wishes-rhythm.test.ts`:
  - `six days costs W3`;
  - `a single day off is a quiet W3`;
  - `seven days is no W3 but M9`.
- [ ] **Step 2: Run** `npx vitest run src/domain/rules`. Expected: the new tests fail.
- [ ] **Step 3: Implement** `restMusts.ts`, call both functions from `evaluatePerson`, and reshape `rhythm`.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. The engine/state equivalence test (`search.test.ts`) must still pass, since the state scores through `evaluatePerson`. Update other tests only where they asserted the dropped "> 6 days" W3 line.
- [ ] **Step 5: Commit** `feat: musts for days in a row and weekly rest; W3 favours days off in pairs`

---

### Task 4: Tiers, the strong wish, the weekend minimum and person limits

**Files:**
- Modify: `src/domain/rules/weights.ts`, `src/domain/rules/types.ts`, `src/domain/rules/person.ts` (`countMonth`), `src/domain/rules/personMusts.ts`, `src/domain/rules/weekendWishes.ts` (W5a), `src/domain/rules/global.ts` (W7 `twelve`), `src/domain/rules/evaluate.ts` (sort), `src/domain/format.ts`
- Test: `src/domain/rules/musts.test.ts`, `src/domain/rules/weights.test.ts`, `src/domain/rules/wishes-weekend.test.ts`, `src/domain/rules/global.test.ts`, `src/domain/rules/evaluate.test.ts`

**Interfaces:**
- Consumes: Task 2's `EnginePerson.maxTwelve`, `maxNights` and `claimed`.
- Produces:
  - `GAP = 1e7`, `STRONG = 2e6`, `WEEKEND_SHORT = 1e6`.
  - `MustId` drops `'M7'` and adds `'M12' | 'M13'`. `RuleId` adds `'S1'`.
  - `Finding` gains `strong?: boolean`.
  - `PersonStats` gains `claimedTwelve: number`.
  - `format.ts` gains `weekendShifts(n: number): string` ("1 víkendová směna", "2 víkendové směny", "5 víkendových směn") and `nightShifts(n: number): string` ("1 noční", "3 noční", "5 nočních").
- Rules:
  - **S1** replaces M7: each N/N12 of a `never` person costs `STRONG`, as a finding with `severity: 'wish'` and `strong: true`. The message is unchanged: `noční směna, ale noční nechce`. No must unit.
  - **M5** uses `person.maxTwelve` and `stats.twelve − stats.claimedTwelve`.
  - **M12:** `short = settings.minWeekendShifts − (stats.twelve − stats.claimedTwelve)`; if `short > 0`, it costs `WEEKEND_SHORT × short`, adds 1 must unit, and has no days. Message `${weekendShifts(n)} (min. ${min})`.
  - **M13:** when `maxNights !== null` and `stats.nights > maxNights`, it costs `HARD × excess`. Message `${nightShifts(n)} (max. ${max})`, with the person's nights as days.
  - **W5a** measures `twelve − claimedTwelve` against `twelveTarget`. **W7** `twelve` uses `history.twelve + stats.twelve − stats.claimedTwelve`.
  - `evaluateMonth` sorts musts first, then strong wishes, then wishes, each by first day.

- [ ] **Step 1: Write the failing tests:**
  - `weights.test.ts`: `the tiers keep their order`: `HARD/2 > GAP > STRONG > 11.5 * BELOW_FPD` and `STRONG > WEEKEND_SHORT > 4 * max(BASE_WEIGHTS)`.
  - `musts.test.ts`:
    - `a night for a never person is a strong wish, not a must`: rule `S1`, `severity 'wish'`, `strong: true`, penalty `STRONG`, `mustUnits` 0.
    - `a claimed holiday shift is extra`: 3 weekend R12 plus a pinned R12 on 1 Jan → no M5. A 4th unclaimed one → M5.
    - `the weekend minimum`: 1 weekend shift → M12 with penalty `WEEKEND_SHORT`; 2 → none; a claimed holiday does not count.
    - `a person's own maximum replaces the general one`.
    - `max nights`: `maxNights 2` with 3 nights → M13. `maxNights 0` with 1 night → M13 (Review Focus 5). `null` → none.
  - `evaluate.test.ts`: `lists musts, then strong wishes, then wishes`.
  - Update the existing M7 tests to S1.
- [ ] **Step 2: Run** `npx vitest run src/domain`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the changes above.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Generator scenario tests may move because of the GAP change. Do not touch their assertions: record the pass rates for Task 6.
- [ ] **Step 5: Commit** `feat: strong wish for nights, weekend minimum, person limits and claimed holidays`

---

### Task 5: Doctor wish W10

**Files:**
- Create: `src/domain/rules/doctorWish.ts`
- Modify: `src/domain/rules/person.ts` (call it)
- Test: `src/domain/rules/wishes-doctor.test.ts`

**Interfaces:**
- Consumes: Task 2's `doctorFrom` and `doctorTo`.
- Produces: `export function doctorWish(ctx: MonthContext, p: number, row: Uint8Array, sink?: Sink): number`.
  - For each month day `i` with `doctorFrom[i] >= 0`, the appointment is `[from − 60, to + 60]` minutes. A shift **collides** with it when its interval overlaps that range. The shift may be on day `i` (`[start, end]`) or a night of day `i−1` that ends on day `i` (`[start − 1440, end − 1440]`).
  - Each collision costs `ctx.weights.W10` as a **quiet** finding. Message `${code} se kryje s lékařem ${hh:mm}–${hh:mm}`.

- [ ] **Step 1: Write the failing tests:**
  - `O after L 8–12 is fine`;
  - `O20 after L 8–12 collides` (starts at 12:00, inside the hour after);
  - `R1 collides with L 8–12`;
  - `no shift is fine`;
  - `R1 before L 15–16 is fine` (ends 14:00, exactly one hour before);
  - `a night ending at 06:00 before L 6:30–7 collides`;
  - `the finding is quiet and costs W10`.
- [ ] **Step 2: Run** `npx vitest run src/domain/rules/wishes-doctor.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the wish and call it from `evaluatePerson`.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: doctor's appointment wish`

---

### Task 6: Generator quality with the new rules, and scenario months

**Files:**
- Modify: `src/test/scenarios.ts`, `src/generator/scenarios.test.ts`; `src/generator/moves.ts` only if Step 4 shows the need.
- Test: `src/generator/scenarios.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5. The generator needs no API change.
- Produces: new scenarios `scenario(name)`:
  - `'q1-2027'`: January, February and March 2027 for the synthetic team. Each month's requests sit in the data, and the months are generated one after another, so later months carry history.
  - `'claimed-holiday'`: January 2027, with C's R12 on 1 January pinned.
  - `'x-weekends'`: January 2027, where D has `x` on every 12-hour day except one Saturday. That includes 1 January, a holiday, so at most 1 weekend shift is possible.
  - `'doctor'`: January 2027 with `L` notes on several weekdays.

- [ ] **Step 1: Record the baseline.** On the commit before this task's changes, run the scenario sweep (`SCENARIO_SEEDS=1-24`, the parallel command in the file's header comment) and save the pass rates for the report.
- [ ] **Step 2: Write the scenario tests.** Use the file's conventions (300k iterations, the seeds as configured). For each scenario and seed:
  - no hard must, i.e. `mustUnits` from HARD rules is 0;
  - no M1 gap (each of the four scenarios allows full coverage);
  - no run longer than 6 days, and no M10 or M11;
  - in `q1-2027`: generate each month in order and apply it to the data before building the next. February's fairness then sees January. Assert that twelve-hour shift counts over the quarter differ by at most 2 between any two people active all quarter;
  - in `claimed-holiday`: C keeps the pinned R12 and may have up to 4 twelve-hour shifts;
  - in `x-weekends` (Review Focus 3): D has at most 1 weekend shift, and Kontrola reports M12 for D. No hard must is broken, and no shift is uncovered;
  - in `doctor`: no hard must, and at least half of the `L` days with a shift avoid a collision. The wish is quiet, so assert it on the rows.
- [ ] **Step 3: Run** the scenario file and the sweep again. If pass rates fall against the baseline or the new tests fail, go to Step 4. Otherwise skip it.
- [ ] **Step 4 (only if needed): Tune.** Add move pre-filters for M9, M10 and M11 in `moves.ts`, like the rest pre-filter (`leavesTooLittleRest`), and/or adjust W3 shapes. Keep every assertion and seed. Report before/after tables.
- [ ] **Step 5: Measure.** Measure the bundled search speed (iterations/s) on `q1-2027` January in Node and report it. The new weekly-rest check runs on every evaluation.
- [ ] **Step 6: Run** `npm run typecheck && npm test`. Expected: all pass.
- [ ] **Step 7: Commit** `test: scenario months for the Phase 1.1 rules` (plus `perf:` commits if Step 4 ran)

---

### Task 7: Month screen: Kontrola, doctor's notes in the grid and cell menu

**Files:**
- Modify: `src/ui/reducer.ts`, `src/ui/month/CellMenu.tsx`, `src/ui/month/Grid.tsx`, `src/ui/month/MonthScreen.tsx`, `src/ui/month/ChecksPanel.tsx`, `src/ui/text.ts`, `src/ui/styles.css`
- Test: `src/ui/reducer.test.ts`, `src/ui/month/MonthScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1's `DoctorNote` and `AppData.doctor`; Task 4's `Finding.strong`.
- Produces:
  - Reducer action `{ type: 'setDoctor'; date: ISODate; personId: PersonId; note: DoctorNote | null }`. A null note deletes it. `removePerson` also deletes that person's doctor's notes.
  - `MenuChoice` gains `{ type: 'doctor'; note: DoctorNote | null }`.
  - Copy in `text.ts`:
    - menu item `Lékař…`, time inputs `od` and `do`, buttons `Uložit lékaře` and `Odebrat lékaře`;
    - the cell marker `L`, whose title appends `lékař 8:00–12:00`.
  - Kontrola: strong-wish lines are amber and listed after the musts and before the other wishes. The summary is unchanged: `Musí: N · Přání: M`, and strong wishes count as wishes.

- [ ] **Step 1: Write the failing tests:**
  - `reducer.test.ts`:
    - `setDoctor stores and deletes a note`;
    - `removePerson deletes the person's doctor's notes`.
  - `MonthScreen.test.tsx`:
    - `the menu stores a doctor's note`: open a cell, choose `Lékař…`, type 08:00 and 12:00, then `Uložit lékaře`. The cell shows `L`, and its title contains `lékař 8:00–12:00`.
    - `a note and a shift share a cell`: an R1 with a note shows both.
    - `a strong wish is listed before the wishes`: a never person on N shows the line `noční směna, ale noční nechce` in amber, before any W line and after the musts.
- [ ] **Step 2: Run** `npx vitest run src/ui`. Expected: FAIL.
- [ ] **Step 3: Implement** the changes. The time inputs are `<input type="time">`, and a note needs `from < to`.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: doctor's notes and strong wishes on the month screen`

---

### Task 8: Team and Rules screens

**Files:**
- Modify: `src/ui/form.tsx`, `src/ui/team/PersonCard.tsx`, `src/ui/rules/RulesScreen.tsx`, `src/ui/text.ts`
- Test: `src/ui/form.test.ts`, `src/ui/team/TeamScreen.test.tsx`, `src/ui/rules/RulesScreen.test.tsx`

**Interfaces:**
- Produces: `OptionalNumberField(props: { label: string; value: number | null; min: number; max: number; placeholder: string; onChange(value: number | null): void })` in `form.tsx`. An empty box stores `null`; otherwise it follows `NumberField`'s rules.
- Team card:
  - `Max. 12h směn za měsíc` (0–10; placeholder `obecně ${maxTwelvePerMonth}`);
  - `Max. nočních za měsíc` (0–31; placeholder `bez limitu`);
  - the starting-counts group title becomes `Počáteční počty (před prvním měsícem v souboru)`.
- Rules screen:
  - `Max. dní v kuse` (4–7);
  - `Min. víkendových směn za měsíc` (0–5);
  - `Týdenní odpočinek (h)` (24–48, step 0.5);
  - the W10 select labelled `Směna mimo návštěvu lékaře`;
  - `WISH_IDS` includes `W10`, or is derived from `WISH_LABELS` (Phase 1 minor).
- Wording: check `text.ts` for forms addressed to the user that carry a gender, and make them neutral.

- [ ] **Step 1: Write the failing tests:**
  - `form.test.ts`: `an empty optional number stores null`.
  - `TeamScreen.test.tsx`:
    - `clearing the 12-hour limit goes back to the general value` (Review Focus 5);
    - `max nights 0 is stored as 0`;
    - `the starting counts say they are before the first month in the file`.
  - `RulesScreen.test.tsx`: the three new numbers dispatch `updateSettings` with only their key; the W10 select stores its level.
- [ ] **Step 2: Run** `npx vitest run src/ui`. Expected: FAIL.
- [ ] **Step 3: Implement** the changes.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: person limits and the new rules on the Team and Rules screens`

---

### Task 9: Excel paste and copy of doctor's notes

**Files:**
- Modify: `src/clipboard/tsv.ts`, `src/ui/month/PasteDialog.tsx` (counts)
- Test: `src/clipboard/tsv.test.ts`, `src/ui/month/paste.test.tsx`

**Interfaces:**
- Produces:
  - `export function parseDoctor(value: string): DoctorNote | null`. It accepts `L` (any case) with optional spaces, then `H[:MM]`, a hyphen or en dash, and `H[:MM]`, where from < to. It returns null for anything else, including a bare `L`.
  - `export function formatDoctor(note: DoctorNote): string` → `L 8-12` or `L 8:30-12`.
  - `PastePlan` gains `doctorWrites: Array<{ personId: PersonId; date: ISODate; note: DoctorNote }>`. A recognised `L` cell becomes a doctor write, not an ignored value.
  - `applyPaste` stores the doctor writes.
  - `personRowTsv`: a day with a shift → the shift; a day without a shift but with a note → `formatDoctor(note)`; otherwise as today.
  - The paste preview's `Rozpoznáno` counts code writes plus doctor writes.

- [ ] **Step 1: Write the failing tests** (`tsv.test.ts`, Review Focus 2):
  - `parses doctor's notes in the usual forms`: `L 8-12`, `L8-12`, `l 8:00 - 12:00` and `L 8–12` → `{from: 480, to: 720}`. `L 8:30-12` → `{510, 720}`. `L`, `L 12-8` and `L 8` → null.
  - `pasting L onto a day with a shift keeps the shift and adds the note`.
  - `copying a row writes the shift, or the note on a day without one`.

  In `paste.test.tsx`: `the preview counts doctor's notes as recognised`.
- [ ] **Step 2: Run** `npx vitest run src/clipboard src/ui/month/paste.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the changes.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: doctor's notes in Excel paste and row copy`

---

### Task 10: End to end: a quarter in a row

**Files:**
- Create: `tests/e2e/plan-quarter.spec.ts`
- Modify: `README.md` (one paragraph on planning a quarter month by month)
- Test: the new spec

**Interfaces:**
- Consumes: the whole app, built.

- [ ] **Step 1: Write the spec**, following `plan-january.spec.ts`: recorders, tabpanel-scoped queries, a heading-driven month loop.
  - Start a new plan, set `Čas na generování (s)` to 5, then go to `Leden 2027`.
  - For January, February and March: click `Vygenerovat` and wait up to 30 s for `Hotovo`. Assert that every `coverage-*` cell of the month reads `✓` and that the Kontrola summary starts with `Musí: 0`. Then click `▶`.
  - Assert that no request and no CSP message was recorded.
- [ ] **Step 2: Run** `npm run test:e2e`. Expected: all specs pass, the existing four included.
- [ ] **Step 3: Run** `npx playwright test plan-quarter --repeat-each=5` and report the pass rate. Never loosen an assertion.
- [ ] **Step 4: Update README** with a short paragraph: plan a quarter by generating January, February and March in turn; fairness carries over; save the file.
- [ ] **Step 5: Run** `npm run typecheck && npm test && npm run test:e2e`. Expected: all pass.
- [ ] **Step 6: Commit** `test: plan a quarter end to end; docs: quarterly planning`
