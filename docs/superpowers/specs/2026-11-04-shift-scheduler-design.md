# Shift Scheduler: design

- **Date:** 2026-11-04
- **Status:** draft, awaiting review
- **Language:** the product's UI is Czech. This document is in English and quotes Czech UI labels with English glosses; see the glossary at the end.
- **Privacy:** this repository never contains the real team's names or data. Where an example needs people, they are OP1–OP8.

## 1. Why this exists

A 24/7 monitoring team has eight operators. One team lead plans their shifts every month, by hand, in an Excel workbook he built himself. He then types the result into the company's own system, which holds the official schedule.

Planning by hand is slow, and the rules pull against each other: coverage every day, rest between shifts, long runs of the same shift, night-shift rhythm, whole weekends, everyone's monthly hours, fairness across months, and the preferences each operator gave in a survey. A broken rule is easy to miss, and fairness across months is impossible to keep in one's head.

The tool generates a draft month that follows the rules and leans towards everyone's preferences. The team lead adjusts it, with every change checked on the spot, and copies the result into his Excel. It must work for any month, not only the first one it will be used for (January 2027).

## 2. Who uses it

- **One user: the team lead.** Czech speaker, works in Excel daily, not a developer. Operators ask him for vacation and days off; he approves the requests and writes them down.
- Operators never use the tool.
- The developer (repo owner) builds and maintains it.

## 3. Goals, non-goals, anti-goals

### Goals

1. Generate a complete draft for any month. It breaks no must (§6.1) whenever that is possible and scores well on the wishes (§6.2).
2. Let the team lead change anything, pin what he wants kept, regenerate around it, and see instantly what each change breaks and why.
3. Keep hours, coverage and fairness visible: per-person totals against FPD, per-day coverage, running counts across months.
4. Track each person's yearly vacation (DOV) and MyDay (MD) usage against their allowance.
5. Let preferences, rule settings and the team itself change over time without code changes, within the rule types defined here.
6. Make getting the result into his Excel quick and safe.

### What success looks like

- He plans a whole month in the page, from requests to generating, adjusting and copying into his Excel, without installing anything or asking for help.
- Drafts need only a few swaps, and break no must whenever that is possible.
- Every flagged problem explains itself in one line.
- Nothing about the team leaves his computer, and the repository holds no names.

### Non-goals

- Not the official schedule, and no connection to the company system. He keeps typing the schedule in there.
- Does not replace his Excel workbook. The workbook stays his master record, including things the tool ignores: activity and note rows, home office (HO), training, doctor's visits.
- No self-service for operators: they don't submit requests through the tool.
- No payroll or attendance. Overtime is shown, not processed.
- No multi-user, sync, server, database or login.
- Not a general-purpose rostering product. The rule *types* are this team's; their numbers are settings.
- Not designed for phones.

### Anti-goals (failure even if everything "works")

- Any name or team data reaching the repository, a server, or anywhere outside his computer.
- A black box: a draft he can't understand or trust. Every flagged problem explains itself, and the checks he sees are exactly the rules the generator works with.
- Silent loss of his data (browser storage cleared, file never saved).
- Needing installation, admin rights or an internet connection.
- A schedule that breaks a must without saying so.
- Costing him more time than planning by hand, for example through double entry or a fiddly copy into Excel.

## 4. Constraints

- **Runs in a desktop browser** (current Edge, Chrome, Firefox) from **one self-contained HTML file**, offline, with nothing installed. **It is delivered as a file; nothing is hosted for now** (decided). The same file could be hosted later, unchanged.
- **No network access at runtime**: no CDNs, no analytics, no requests of any kind.
- **Data stays on his computer**: browser storage as the working copy, plus a save file he keeps (§8).
- **No names or real data in the repository.** Tests and examples use a made-up team.
- **UI in Czech**; code, comments and docs in English.
- **His Excel** (§7.5): desktop Excel. One block per person with three rows (směna = shift, činnost = activity, pozn. = notes), days as columns, people in a fixed order.
- **Timing:** there is no fixed date for the tool ("when it's done, it's done"); §14 orders the work. For context: § 84 of the Labour Code normally requires a schedule to be announced 2 weeks before the period it covers, unless agreed otherwise, so January 2027 must be out by 18 Dec 2026.

## 5. Domain facts

### 5.1 Shifts

| Code | Days | Time | Counts as |
|---|---|---|---|
| R1 | Mon–Fri | 06:00–14:00 | 7.5 h |
| R2 | Mon–Fri | 08:00–16:00 | 7.5 h |
| O20 | Mon–Fri | 12:00–20:00 | 7.5 h |
| O | Mon–Fri | 14:00–22:00 | 7.5 h |
| N | Mon–Fri | 22:00–06:00 | 7.5 h |
| R12 | weekends, public holidays | 06:00–18:00 | 11.5 h |
| N12 | weekends, public holidays | 18:00–06:00 | 11.5 h |

Each shift includes an unpaid 0.5 h lunch break, so an 8-hour shift counts 7.5 h and a 12-hour shift 11.5 h. Times and counted hours are settings.

**A night shift belongs to the day it starts**, as in his Excel: N on Monday runs from Monday 22:00 to Tuesday 06:00.

### 5.2 Day types and public holidays

- **Weekday** (Mon–Fri, not a holiday): weekday shifts only.
- **12-hour day** (Saturday, Sunday, Czech public holiday): R12 and N12 only.
- The tool computes the Czech public holidays: 1 Jan, Good Friday, Easter Monday, 1 May, 8 May, 5 Jul, 6 Jul, 28 Sep, 28 Oct, 17 Nov, 24 Dec, 25 Dec, 26 Dec. A holiday on a weekday runs as a 12-hour day. The Sep–Nov 2026 schedules confirm this for 28 Sep, 28 Oct and 17 Nov. The team lead can override any day's type in the settings.

### 5.3 Absences and requests

| Code | Meaning | Counts as |
|---|---|---|
| DOV | vacation (dovolená) | 7.5 h |
| MD | MyDay, a personal day | 7.5 h |
| OP | personal reasons (osobní důvody) | 7.5 h |
| NEM | sick leave (neschopenka) | 7.5 h |
| x | request: "no shift that day" (not an absence) | 0 h |

HO (home office) appears in his Excel but changes nothing; the tool ignores it.
Yearly allowance: 25 DOV + 5 MD per person, editable per person and year.

### 5.4 FPD (working-time fund) and hours

FPD for a month = number of Mon–Fri days in the month × 7.5 h. **Holidays stay in the count**, and a holiday not worked earns nothing (from the November 2026 schedule).

Credited hours = 7.5 × (weekday shifts + absence days) + 11.5 × (12-hour shifts).

A 12-hour shift counts 4 h more than a weekday shift, so FPD usually can't be hit exactly. The nearest results by number of 12-hour shifts:

| 12-hour shifts | One working day more | One working day fewer |
|---|---|---|
| 1 | +4.0 h | −3.5 h |
| 2 | +0.5 h | −7.0 h |
| 3 | +4.5 h | −3.0 h |
| 4 | +1.0 h | −6.5 h |

**Hours never go below FPD. Overtime is paid out every month**, and everyone usually ends slightly over. In November 2026, people with two 12-hour shifts ended at +0.5 h and people with three at +4.5 h. Carrying hours into another month is possible but almost never done, so the tool only offers an optional per-person, per-month hours adjustment (default 0) that shifts that person's target.

For someone who joins or leaves mid-month, FPD covers only the weekdays they are active.

### 5.5 Worked example: January 2027

- 21 Mon–Fri days → FPD 157.5 h.
- 12-hour days: 1 Jan (Friday, a holiday) + 5 weekends = 11 days → 22 twelve-hour shifts.
- Weekday shifts on 20 days (4–29 Jan). Each needs R1, O20, O and N, and at least one R2.
- With at most 3 twelve-hour shifts per person, six people work 3 and two work 2.
- Requests: four people are unavailable on 1–3 Jan, so the six 12-hour shifts of those days fall on the other four.

## 6. Rules

There are two kinds of rule:

- **Musts.** The generator never breaks them. When a month can't be fully covered, it leaves a visible gap instead (§6.4). The team lead can still break any must by hand; the tool then shows it in red.
- **Wishes.** Weighed against each other. Each has a weight ("how much it matters") in the settings.

All numbers below are settings, with these defaults.

### 6.1 Musts

| # | Must | Default |
|---|---|---|
| M1 | **Coverage.** Each weekday: R1, O20, O and N exactly once, R2 at least once. Each 12-hour day: R12 and N12 exactly once. | as stated |
| M2 | **Rest between shifts** of at least 12 h. Czech law has required 11 h for adults since 2024; the team keeps 12 h. | 12 h |
| M3 | At most one shift per person per day, and no shift on an absence day. | — |
| M4 | **x requests** respected: no shift starting that day, and no night shift starting the evening before (it would end that morning). | — |
| M5 | At most 3 twelve-hour shifts per person per month. | 3 |
| M6 | **Hours ≥ FPD**, plus the person's optional adjustment. | — |
| M7 | **No night shifts (N, N12)** for people whose night preference is "never". | — |
| M8 | Weekday shifts only on weekdays; R12 and N12 only on 12-hour days. | structural |

M2 forbids these pairs on consecutive days (rest under 12 h): O → R1, O → R2, O20 → R1, O or O20 on Friday → R12 on Saturday, and after N or N12 anything except another N or N12. R12 → R1 and O20 → R2 leave exactly 12 h and are allowed.

Absence days also block the night shift that would end on their morning, like M4.

**Weekly rest: proposed, not yet a must.** § 92 of the Czech Labour Code requires a continuous weekly rest of 35 h within each 7 consecutive days. A 2024 amendment reworded it, including how it may be shortened. The tool shows a *warning* when a person lacks it. Before implementing, the builder verifies the current wording and its interpretation (rolling 7-day windows or calendar weeks). The team lead then decides whether it becomes a must.

### 6.2 Wishes

Each wish is evaluated per person (or per day) and adds a weighted penalty. The definitions say what to aim for; exact penalty shapes are left to the builder.

**W1: little overtime.** Hours as close above FPD as possible.

**W2: same shift for 4–5 working days.** Within a stretch of working days, keep one weekday shift type for 4–5 days. Avoid changing type inside a stretch and avoid runs shorter than 4, unless requests or the month's edges force it. A weekend's 12-hour shifts inside a stretch don't count as a change when W5d holds.

**W3: days off.** After 5–6 working days in a row, at least 2 days off in a row. Avoid stretches longer than 6 days. Strongly avoid long work periods broken only by single days off, such as 12 or more working days with one free day in between.

**W4: nights.**
- (a) **Runs.** Someone with more than 5 nights in a month gets them in long runs (around 5) rather than scattered. The brief's example: nights Sat–Wed, off Thu–Sun, nights Mon–Fri.
- (b) **Before a run:** at least 1 day off, and the shift before that day off is R2, O20 or O, not R1.
- (c) **After a run:** ideally 2 days off, **counting the day the last night ends** (home at 06:00) as the first. Fallback: 1 day off, then O20 or O. The person's "after the last night" answer (§6.3) widens or narrows what may follow.
- (d) **Who works nights:** first people with "extra", then "normal", then "if needed"; never people with "never" (M7).

**W5: weekends and 12-hour days.**
- (a) **How many:** target 2 twelve-hour shifts per person per month. Months with more slots give some people 3 (the maximum is M5), chosen by the running counts (W7); for them: one whole weekend plus one extra day.
- (b) **Whole weekends** for people who prefer them: both Saturday and Sunday, with the same shift type.
- (c) **Shape around a weekend**, per person:
  - wants days off after a weekend → work Wed–Sun, then 2–3 days off;
  - prefers no automatic days off → work Sat–Wed, then 2 days off (4 if the next weekend is free);
  - no preference → either.
- (d) **Next to an R12:** the working day directly before and after an R12 is R1 or R2.

**W6: shift preferences.** Each person's rating of 1 to 5 per weekday shift type (R1, R2, O20, O, N) pulls their shifts towards higher ratings. A person without ratings gets an even spread of R1, R2, O20, O and N.

**W7: fairness across months.** Running counts per person over a window of past closed months (default 6):
- 12-hour shifts;
- nights, for people with "if needed";
- 12-hour shifts on public holidays;
- festive days (default 24, 25, 26 and 31 Dec, and 1 Jan).

Whoever is ahead gets fewer this month.

**W8: unloved shifts shared fairly.** When most people dislike a shift type, its days are spread across those who don't like it rather than piled on one person. O is the likely case: in the real survey, six of eight rated it 1 or 2.

**W9: even days.** Extra people on a weekday go on R2, the filler shift, spread evenly across the month's weekdays.

### 6.3 Person preferences (the survey, as settings)

The team answered a survey. The Tým (team) screen has one preference card per person, using the survey's wording, so the team lead can copy the answers over.

| Setting | Survey wording → setting |
|---|---|
| Rating per shift: R1, R2, O20, O, N | nejvíce preferuji → 5 · spíše preferuji → 4 · neutrální → 3 · spíše nepreferuji → 2 · nejméně preferuji → 1 · (not given) |
| Nights | "Noční směny nechci / preferuji jejich neplánování." → **never** · "Noční směny spíše nechci, ale v případě potřeby je mohu sloužit." → **if needed** · "Noční směny mi nevadí a mohu je standardně sloužit." → **normal** · "Rád budu brát noční směny i za mé kolegy, pokud je to možné." → **extra** |
| Weekend style | one whole weekend (Sat + Sun) a month → **whole** · single days spread over more weekends → **single days** · doesn't matter → **any** |
| Days off after a weekend | "Preferuji mít po víkendové směně naplánované volné dny." → **want** · "Preferuji nerozdávat automaticky volné dny po víkendové směně." → **no automatic** · "Je mi jedno, zda jsou po víkendové směně volné dny či nikoliv." or "…výhodou, ale nejsou podmínkou." → **any** |
| After the last night | multi-select: Volný den (day off), R1, R2, O, O20 |
| Notes | free text on the card, not used by the generator (e.g. "school on some weekends": he enters those days as x) |

Each person also has a display name (stored only with his data), a position in his Excel's order, active from/to dates, and a yearly DOV/MD allowance.

### 6.4 Months that can't satisfy every must

The generator never changes requests, absences or his pins. If no schedule meets every must, for example because too many people asked for the same days, it still returns its best attempt. The policy (decided) is **leave a visible gap rather than bend anyone's limits**:

- It may leave a required shift uncovered (M1), as few as possible. The empty cell shows in red, and he fills it by talking to people.
- A person whose own requests and absences make FPD unreachable is shown in red (M6). Nothing else is bent to fix it.
- It never breaks M2 (rest), M3, M4, M5 (maximum 12-hour shifts), M7 (no nights for "never") or M8 on its own.

He can still do any of those by hand, and the checks then show them in red. It never drops a must silently, and it never returns nothing.

## 7. How he uses it

### 7.1 The monthly routine

1. **Any time:** when he approves a request, he marks it in the page on its date (x, DOV, MD, OP, NEM), months ahead if needed.
2. **Planning:** he opens the month and presses **Vygenerovat** (generate). Requests, absences and pinned cells stay fixed. The last 7 days of the previous month are shown faded, so the rest and rhythm rules work across the boundary.
3. **Adjusting:** he clicks any cell to change it. Nothing is ever blocked, only flagged. He can pin cells (📌) and generate again; each run gives a different draft around the pins.
4. **Into his Excel:** **Kopírovat do Excelu** (copy to Excel), see §7.5.
5. **Closing:** **Uzavřít měsíc** (close month) stores the final version. Closed months feed the running counts and the overview, and can be reopened. If the month later changes in his Excel, he can paste the real rows back (§7.5).

### 7.2 Screens

- **Měsíc (month)**, the main screen:
  - month picker and status: requests only, Návrh (draft) or Uzavřeno (closed);
  - grid of people × days, in the shift colours of his Excel, with the previous month's last days faded;
  - per-person totals: hours against FPD, overtime, 12-hour shifts, nights, count per shift type;
  - a coverage row;
  - the **Kontrola** (checks) panel: broken musts in red and wishes in amber, one line each; clicking a line highlights its cells;
  - buttons: Vygenerovat, Kopírovat do Excelu, Uzavřít měsíc.
- **Tým (team):** people in his Excel's order, a preference card each (§6.3), allowances, active dates, adding and removing people.
- **Pravidla (rules):** shift times and hours, coverage, the musts' numbers (rest hours, maximum 12-hour shifts), a weight per wish, day-type overrides, the fairness window and festive days.
- **Přehled (overview):** per person and month, the 12-hour shifts, nights, holiday shifts, festive days, overtime and DOV/MD; the year's DOV/MD used and left; the running counts behind fairness, with optional starting counts.
- **Save and open file** are always within reach, with the save status shown, e.g. "uloženo v prohlížeči · do souboru před 2 dny" (saved in the browser · to file 2 days ago).

The brainstorm mockups are kept locally, outside git, in `.superpowers/brainstorm/*/content/`. `workflow.html` shows the main screen; the `rules-*.html` files show the rules as day strips.

### 7.3 Codes and colours

The same codes as his Excel (R1, R2, O20, O, N, R12, N12, DOV, MD, OP, NEM), in colours close to his: R1 pale yellow, R2 light cyan, O20 white, O peach, N blue, N12 darker blue, R12 pink, absences green. Weekends and holidays are grey columns.

### 7.4 Requests in bulk

He keeps approved requests on a separate sheet of his workbook: one row per person in his order, one column per date, and a total row at the bottom. To spare him typing them twice, the month grid accepts a **paste** of that block. Recognised codes (x, DOV, MD, OP, NEM) become requests and absences. Everything else, including the total row and a name column if he selects one, is ignored and listed.

### 7.5 Copy into his Excel

His schedule sheet, as seen in the Sep–Nov screenshots:
- The team's block lists the 8 people back to back, three rows each (směna, činnost, pozn.).
- There is one column per date, with totals to the right.
- Other people and sections sit elsewhere on the same sheet.
- Only the směna row takes the schedule. Absences such as DOV, and occasionally x, are written there too.

Pasting must never wipe out the činnost and pozn. rows.

- **Must:** copy one person's month as one row of codes (tab-separated), to paste into that person's směna row. This works in any Excel.
- **Should:** copy the whole team in his three-rows-per-person layout, to paste in one go with "Paste Special → Skip blanks" in his desktop Excel. The builder verifies with him that text pasted from a browser honours "skip blanks". If it doesn't, offer an .xlsx download in the same layout instead (an Excel-to-Excel copy does honour it), with short instructions. If his block turns out to have spacer rows, rows-per-person becomes a setting.
- **Copies include everything in the směna row:** shifts, absences and x. His směna rows sometimes carry x, so copying it avoids wiping it. *(Reviewer-prompted call.)*
- **Paste back:** the same formats can be pasted back into a month, to bring the page in line with what really happened.

### 7.6 The first month

January 2027 is the first month planned with the tool. December 2026 isn't in the page, so he types or pastes December's last 7 days once. Optional starting counts per person (12-hour shifts, nights and holiday shifts over recent months) seed the fairness counts; without them, everyone starts at zero.

## 8. Data and storage

- **The save file is the real store; browser storage is only a cache.** A company-managed browser may clear site data on exit, and a new copy of the HTML file may count as a new site. So the page must never depend on browser storage alone. *(Reviewer-prompted call.)*
- **Save file:** one JSON file with everything: the team including names, preferences, settings, requests, months and starting counts. It carries a schema version, so later versions can migrate older files.
- **Start screen:** when the cache is empty (first use, cleared browser, new version of the page), the page asks him to open his file or start a new one.
- **Automatic saving to the file** where the browser allows it (Edge, Chrome). Once he has opened or saved his file, every change is written to it. Elsewhere (Firefox), "Uložit do souboru" (save to file) downloads it, and the reminders below apply.
- "Otevřít soubor" (open file) loads a file, after confirmation.
- **Cache:** every change is also kept in browser storage, so a reload doesn't lose work.
- **Reminders:** where saving isn't automatic, the unsaved-to-file status is always visible, with a reminder when he closes a month and when the file is more than a few days old.
- **Names exist only in this data.** The code knows people by stable internal IDs.
- **Nothing is ever sent anywhere.** Consider a Content-Security-Policy that blocks network connections, to make this enforceable.
- Clearing browser data loses changes since the last file save. The UI says so where it matters.

## 9. Technical approach (the developer's delegated calls)

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript, strict | type safety for the rule engine and data model |
| UI | React, plain CSS, no component library | mainstream and easy to maintain; the UI is one interactive grid plus forms |
| Build | Vite, producing one self-contained HTML file (JS, CSS and worker inlined) | he gets it as a file and opens it from disk, offline |
| Generator | local search (e.g. simulated annealing with restarts) in a Web Worker, over a **single rule engine** that also powers the live checks | one source of truth: what he sees flagged is exactly what the generator optimises. Pattern wishes (runs, weekend shapes, night rhythm) are easy to express, the month is small (8 people × ~31 days), and "best attempt with red musts" comes naturally |
| Randomness | seeded | same inputs + seed → same draft, for tests; Vygenerovat again uses a new seed |
| Time budget | target ≤ 30 s per month on an ordinary laptop, with progress shown and "stop and keep the best" | his patience |
| Holidays | computed: fixed dates + Easter | no data to maintain |
| Clipboard | tab-separated text (plus an HTML table if useful) | what Excel pastes natively |
| Tests | Vitest for the logic; one Playwright smoke test that opens the built file from disk and generates a month | the single-file constraint is critical for delivery |

Considered and rejected for the generator: a MIP solver compiled to WebAssembly (e.g. HiGHS). It gives stronger guarantees, but the rules would live twice (as solver constraints and as checks), the pattern wishes are awkward to model, and it adds a few MB to the file.

## 10. Testing and quality bar

- **Rule engine:** every must and wish is tested with small day-strip cases, like the ✓/✗ examples in the brief and the mockups.
- **Calendar:** holidays including Easter over several years; FPD for November 2026 (157.5 h), January 2027 (157.5 h) and February 2027 (150 h).
- **Generator scenarios**, on a made-up team of 8 shaped like the real one (a similar spread of shift ratings and night attitudes, but not the real answers):
  - January 2027: a holiday plus 5 weekends, with four people unavailable on 1–3 Jan;
  - a plain 4-weekend month (February 2027);
  - an Easter month, and a December with Christmas;
  - a month with heavy vacation;
  - a deliberately impossible month: gaps shown in red, and no rest, 12-hour or night limit bent;
  - pinned cells, regenerating around them.

  Every scenario that has a feasible schedule must come out with zero broken musts. Wish quality is checked with scenario-specific assertions: night runs not scattered, whole weekends for people who want them, nobody below FPD, minimal overtime.
- **Determinism:** the same seed gives the same result.
- **Delivery:** the built file works from disk with the network unplugged.
- **Repository hygiene:** no real names or data anywhere; fixtures are synthetic.

## 11. Decisions

**Decided by the developer, speaking for the team lead:**
- A web page that runs in the browser: no app, no server, no database.
- General: any month, not only January 2027.
- Names can be typed in and shown in the page, but never appear in the project.
- Preferences are editable per person, since people change their minds.
- Yearly vacation (DOV) and MyDay tracking.
- The page does not take over his Excel; the Excel stays his main record.
- He enters approved requests himself.
- Overtime is paid out monthly: always at or above FPD, never below. Carrying hours over is rare (hence the optional adjustment).
- The rules played back in the brainstorm (parts 1, 2a, 2b) and the workflow mockup were confirmed.
- Technical choices were delegated.
- Delivered as a file; no hosting for now. He uses desktop Excel.
- Months that can't be fully covered: leave visible gaps, never bend anyone's limits (§6.4).
- No fixed deadline: "when it's done, it's done".

**From the team lead's brief:** shifts, hours, FPD, coverage, the 12-hour rest, the 4–5-day runs, the days-off rules, the night rules, the weekend rules and shapes, the R12-neighbour rule, the 2–3 twelve-hour days per month, and the survey.

**Delegated calls, open to veto:**
- the split into musts and wishes;
- x requests and absences also block the night shift ending on their morning;
- weekly rest as a warning until verified;
- the mapping of the two weekend shapes to the survey;
- running counts instead of "3 this month → 1–2 next month";
- the festive-day count, and sharing unloved shifts;
- best attempt with red musts; manual edits never blocked;
- the per-person hours adjustment;
- pasting requests in; the copy formats;
- the single-file build;
- the file-first storage and start screen (§8);
- the phase split (§14);
- Czech UI with English code; synthetic test data;
- the whole technical approach in §9.

## 12. Left to the builder

- Component structure, state management, the exact data schema and its migrations.
- Local search internals: moves, cooling schedule, restarts, incremental evaluation.
- Penalty shapes and default weights for each wish, tuned on the scenarios.
- Natural Czech wording of labels and check messages.
- Clipboard formats, after testing in Excel (and LibreOffice).
- Progress display, keyboard shortcuts, error handling.
- How to treat the end of a month, with no knowledge of the next one.
- Build order, except that the rule engine and checks come first, since everything rests on them.

## 13. Open points for the team lead (not blocking the build)

- Can an absence fall on a weekend day, and does it then also count 7.5 h? One November row suggests it can.
- Does every public holiday run as a 12-hour day? Seen for 28 Sep, 28 Oct and 17 Nov.
- Is R1, O20, O or N ever doubled on a day, or is R2 always the only filler?
- Should the weekly-rest check become a must?
- The festive-day list for the fairness count.

## 14. Phases (the developer's delegated call)

There is no fixed date. The phases only order the work.

**Phase 1: enough to plan January 2027,** the first real use:
- calendar, FPD, the rule engine and Kontrola;
- the Měsíc grid with requests, pins and the previous month's tail;
- Vygenerovat, including fairness from optional starting counts (who works three 12-hour shifts in January depends on December);
- Tým preference cards, with the starting counts entered there for now;
- Pravidla limited to the key numbers and wish weights;
- requests paste, the per-person copy, and the file-first save and open.

**Phase 2: before February is planned** (February needs January closed):
- Uzavřít měsíc and running counts from closed months;
- Přehled, and yearly DOV/MD tracking;
- paste-back, the whole-team copy or .xlsx;
- full Pravidla editing;
- the weekly-rest warning.

**Tuning:** default wish weights are guesses until he reacts to a real draft. If possible, he tries Phase 1 on a past or current month (replaying November, or December alongside his usual method) before January. Otherwise a tuning round follows his first real use.

## Glossary

| Czech | English |
|---|---|
| FPD (fond pracovní doby) | working-time fund: the month's target hours |
| směna | shift |
| činnost | activity (a row in his Excel) |
| pozn. (poznámka) | note (a row in his Excel) |
| DOV (dovolená) | vacation day |
| MD | MyDay, a personal day off |
| OP (osobní důvody) | personal reasons |
| NEM (neschopenka) | sick leave |
| HO | home office |
| x | request: "no shift that day" |
| Měsíc · Tým · Pravidla · Přehled | Month · Team · Rules · Overview (screens) |
| Vygenerovat | Generate |
| Kopírovat do Excelu | Copy to Excel |
| Uzavřít měsíc | Close month |
| Návrh · Uzavřeno | Draft · Closed |
| Kontrola | Checks |
| Uložit do souboru · Otevřít soubor | Save to file · Open file |
