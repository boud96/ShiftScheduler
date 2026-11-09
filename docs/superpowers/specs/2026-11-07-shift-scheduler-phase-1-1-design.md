# Shift Scheduler, Phase 1.1: design

Phase 1.1 brings the Phase 1 app in line with the team lead's feedback of 7 November 2026, in time to plan the first quarter of 2027.

It builds on the main design, [`2026-11-04-shift-scheduler-design.md`](2026-11-04-shift-scheduler-design.md). Everything there still holds unless this document changes it. The Phase 1 decisions and rulings are in [`../plans/2026-11-04-shift-scheduler-phase-1-notes.md`](../plans/2026-11-04-shift-scheduler-phase-1-notes.md).

## 1. Why now

The team lead reviewed Phase 1 and answered the open questions. Several rules work differently from what Phase 1 built.

Shifts are planned **one quarter at a time**:
- Colleagues hand in their requests by the 15th of the last month of the current quarter.
- The team lead then has about two weeks to plan the next three months.
- So requests for January, February and March 2027 are due on **15 December 2026**, and the plan is made in the second half of December.

**Phase 1.1 must be ready by mid-December 2026.**

## 2. How the team lead plans a quarter

These are the team lead's own steps:

1. Open the app. Enter the team, each person's preferences and the settings.
2. Enter the colleagues' requests for all three months, by clicking cells or pasting from Excel.
3. For January: click `Vygenerovat` (Generate), study the draft and `Kontrola` (Checks), and change cells by hand where needed.
4. Repeat for February and March.
5. Save to the file.
6. Publish the plan (a screenshot or similar; no feature needed), or type it into the company's official Excel by hand.

There is no "generate the whole quarter" button. Months are generated one after another, and each month must take the earlier ones into account (§3.7).

## 3. Changes

Each item says whether it is a **must** (the generator never breaks it), a **strong wish** or a **wish**, and what the team lead decided. Items marked *(builder's call)* or *(my call)* were not decided by the team lead.

### 3.1 Days in a row

A **working day** is a day on which a shift starts:
- A night counts on the day it starts. The morning it ends is free, so nights Mon–Fri are 5 days in a row.
- An absence (DOV, MD, OP, NEM) or an `x` request breaks a run: those days count as days off.
- A doctor's note (§3.5) does not decide anything by itself. The day counts as working if it has a shift and as free if it doesn't.

The rules:

| Rule | Kind |
|---|---|
| At most **6** working days in a row | must |
| After a block of 6 working days, at least **2 days off in a row** | must |
| Ideally at most **5** working days in a row | wish |
| After a block of 5 working days, ideally 2 days off in a row (1 is allowed) | wish |
| In general, days off come in pairs rather than as single days scattered over the month | wish |

The team lead put it this way: "We want to give people as much meaningful time off as possible, ideally two days at a time, not scattered single days during the month."

The team lead's own examples:
- R1 Mon–Fri, then R12 on Saturday, makes 6 days. Sunday and Monday are then off, and R1 may follow on Tuesday. This is right.
- R1 Mon–Sat with only Sunday off, then R1 on Monday, is not allowed: 6 days must be followed by 2 days off.

These replace the parts of wish W3 they overlap. W3's 6-day cap becomes the must, and its other parts are kept or reshaped as wishes *(builder's call)*. Windows that cross a month boundary use the 7 days before the month and the 1st of the next month, as the engine does today.

### 3.2 Weekly rest

**Must:** in every period of 7 consecutive calendar days, a person has at least **35 hours** of uninterrupted rest. It is never shortened.

- **Source.** § 92 of the Labour Code, as amended by Act 281/2023 Sb. and in force since 1 January 2024. It requires weekly rest "within the week". § 350a defines a week as 7 consecutive days, and the rest is at least 24 h straight after the daily rest, 35 h in total.
- **What the team lead decided:**
  - **Any 7 consecutive days.** Every window counts, not only calendar weeks.
  - **35 h, never shortened.**
  - **The ordinary week must pass:** R1 Mon–Fri with the weekend off is fine.
- **Rest** is the whole time between the end of one shift and the start of the next, taken from the shift times in the settings.
- **The check.** A window passes when some rest of at least 35 h **overlaps** it. That rest counts **whole**, even when it starts before the window or ends after it.

  Rest is not cut off at the window's edges. If it were, the ordinary Mon–Fri week above would fail in the window from Sunday to Saturday, because the weekend rest would split into 30 h and 34 h. The reviewer tried that cut-off reading on a copy of the app: the generator then left people below FPD in every month tested. With rest counted whole, no test month broke a must.
- **Examples:**
  - O ends at 22:00, one day off, then R1 starts at 06:00. That leaves 32 h of rest: if no longer rest touches that window, the rule is broken.
  - R1 (ends 14:00), one day off, then R1 leaves 40 h, which is fine.
- **Breaking it.** The generator never breaks it. The team lead may break it by hand, and Kontrola then shows it in red like any other must.
- **Month boundaries.** Windows that reach into the previous month use its last 7 days. The rest that began before those 7 days counts too: the app also reads the 7 days before them and starts the rest before the first shift of the row from the end of the person's last shift there (`restBefore`). Without it, a short rest that began just before the tail, such as 24 h after a night on the Sunday before it, would pass on an assumed long rest and show only in the previous month's Kontrola. Only when no shift is stored in that week is the time before the first shift unknown, and then it counts as rest. Windows that reach beyond the 1st of the next month are checked when that month is planned.

### 3.3 Nights for people who don't want them

M7 changes from a must to a **strong wish**. It applies to people whose survey answer is "Noční směny nechci / preferuji jejich neplánování" (EN: I don't want nights / prefer them not planned), stored as *never*.

The generator gives such a person a night (N or N12) only when that night would otherwise stay uncovered, never just to make the month better in other ways. In Kontrola such a night is a wish line, not a must *(my call: amber, listed before the ordinary wishes)*.

### 3.4 Weekend shifts and public holidays

In this section a **weekend shift** means every twelve-hour shift: an R12 or N12. These only exist on 12-hour days, which are Saturdays, Sundays and public holidays. A holiday on a weekday counts, and so does a holiday on a weekend. The team lead said to count holidays the same as weekend shifts. The one exception is a claimed holiday shift (below), which counts toward nothing. For Q1 2027 this covers 1 January, Good Friday 26 March and Easter Monday 29 March.

| Rule | Kind |
|---|---|
| Everyone has at least **2** weekend shifts a month (any R12 or N12 except a claimed holiday shift) | must (see below) |
| At most **3** twelve-hour shifts a month (M5, unchanged); a per-person value may replace it (§3.6) | must |
| A **claimed holiday shift** is extra: it counts toward neither the minimum of 2 nor the maximum of 3 | rule |
| Unclaimed holiday shifts are given out fairly, like any weekend shift | wish (existing fairness, W7) |

**The minimum of 2.**
- It applies to everyone, including people who join or leave during the month.
- If someone has `x` on some weekends, they get their shifts on the other weekends.
- If a person's own requests make 2 impossible, the generator leaves it short and Kontrola shows it in red, as it does for hours below FPD. The generator never breaks a hard must to reach it.
- A maximum of 12-hour shifts below 2, the person's own (§3.6) or the general one, lowers the minimum to that maximum, because the hard maximum wins over a minimum that may be left short. A person at that maximum then gets no M12 line, where before they got a red line every month that nothing could clear; a person below it gets a line that quotes the lowered value (for example `min. 1`).

**Claiming a holiday.**
- Holiday shifts pay a bonus, so they are popular.
- Before each quarter, the team lead asks who wants which holiday. They then enter that shift for that person in the plan. A shift entered by hand is pinned 📌, and the generator never changes a pin. That pin is the reservation; no new marker is needed (the team lead confirmed this).
- A **claimed holiday shift** is an R12 or N12 on a public holiday that is pinned.
- Example: a person with 2 or 3 weekend shifts and one claimed holiday may have 3 or 4 twelve-hour shifts that month.
- *My reading:* a claimed holiday on a Saturday or Sunday is also extra. The team lead said a claimed holiday comes on top of the two mandatory weekend shifts, whatever day it falls on.

Wish W5a, which aims at 2 twelve-hour shifts per person, stays as it is. With the new minimum it mainly decides who gets a third weekend shift, by the running counts.

### 3.5 Doctor's appointments: code `L`

The team lead writes doctor's appointments in Excel as `L` with a time, for example `L 8-12`.

- **A note on the day, not an absence.** `L` is stored alongside the day's code, so a day can have both a shift and an `L` note.
- **Hours.** It adds no hours. If the day has a shift, the shift counts as normal; if not, the day counts 0 h.
- **Wish (quiet).** The day is off, or its shift does not overlap the appointment and leaves at least **1 hour** between them *(my call for the 1 hour)*.
  - For an appointment 8:00–12:00 that means O (14:00), not O20 (12:00), which is the team lead's answer.
  - For an afternoon appointment, a morning shift that ends an hour before it is fine.
  - If no such shift fits, nothing is reported as broken: the team lead said shifts overlap and one person missing for a while usually doesn't matter. The wish counts in the score but shows no Kontrola line, like the other quiet findings.
- **Entering it.**
  - The cell menu offers `L` with a from–to time.
  - Pasting from Excel recognises the common forms: `L 8-12`, `L 8:00-12:00`, `L8-12`, and an en dash in place of the hyphen.
  - In the grid, a cell with a note shows a small `L` marker; the time is in its tooltip *(builder's call on the look)*.
- **Copying a row to Excel** *(my call)*. A day with a shift copies its shift code. A day with only an `L` note copies `L` and its time, as the team lead writes it.

### 3.6 Limits per person

Each person's card on the Tým (Team) screen gets two optional numbers:

- **"max. 12h směn za měsíc"** (EN: max 12-hour shifts per month). It replaces the general maximum of 3 for that person. Claimed holiday shifts still don't count toward it.
- **"max. nočních za měsíc"** (EN: max nights per month). It limits that person's nights (N and N12) per month. Without it there is no limit.

Both are musts when set. The numbers come later: two colleagues have offered to take extra nights, and the team lead is waiting for them to say how many nights a month and whether more than 2 weekends a month.

### 3.7 Fairness across the months of a quarter

Fairness across months (W7) balances running counts: 12-hour shifts, nights, holiday shifts and festive days. Today those counts are only the starting counts typed on each Tým card. So February would not know what January's draft gave each person.

From Phase 1.1:
- **Running counts** for a month = the starting counts plus the counts of every earlier month in the file within the fairness window (default 6 months). That includes drafts, so no month has to be closed first.
- **Starting counts** now mean "before the first month this file contains", so nothing is counted twice. The Tým card's label or help text should say so *(builder's call on the wording)*.
- **Editing an earlier month.** If January is changed after February was generated, February is not regenerated by itself. February's Kontrola updates at once for anything at the boundary, and its fairness catches up the next time February is generated.

Closing months (`Uzavřít měsíc`) stays in Phase 2.

### 3.8 Priority order

When rules pull against each other, the generator settles them in this order:

1. **Hard musts, never broken by the generator:**
   - M2: rest between shifts;
   - M3: one shift a day, none on an absence;
   - M4: `x`;
   - M5: maximum 12-hour shifts, per person where set;
   - M8: day types;
   - max nights per person (§3.6);
   - at most 6 days in a row;
   - 2 days off after 6;
   - weekly rest of 35 h.
2. **Coverage (M1).** A shift is left uncovered only when every way to cover it breaks a hard must.
3. **Strong wish:** no nights for *never* people. Broken only to avoid an uncovered night.
4. **Musts that can be left short when forced:** hours ≥ FPD (M6) and the minimum of 2 weekend shifts.
5. **Wishes:** W1–W9 as reshaped above, and the doctor wish.

The penalty values that produce this order are left to the builder, with tests that show the order holds.

### 3.9 Text addressed to the user

Text the app addresses to its user uses gender-neutral, formal imperative forms, such as "Klikněte na tlačítko…" (EN: Click the button…). This applies to buttons, messages and help text in the app. No past-tense forms that would need a gender ("uložil jste").

Phase 1.1 delivers no manual. The repository has none, and the short Czech manual in the project report (outside the repository) already follows this rule.

## 4. Already right, no change

- **Absences on a weekend** count 7,5 h toward the hours, like on any other day. The fund (FPD) stays Mon–Fri days × 7,5 h. The team lead confirmed this reading ("variant A").
- **Vacation over a weekend** is the colleague's choice, and both ways already work:
  - DOV on all seven days: 7 × 7,5 h, using 7 vacation days;
  - DOV Mon–Fri plus `x` on the weekend: 5 × 7,5 h.

  When yearly vacation tracking comes (Phase 2), it must count weekend DOV days too.
- **Sick leave (NEM)** goes only on days that had a planned shift, and other days stay empty. The team lead does this by hand.
- **`x`** stays a must (M4).
- **Every public holiday** is a 12-hour day.
- **Only R2** is ever doubled on a day.

## 5. Goals, non-goals, anti-goals

**Goals**
- Plan January–March 2027 in late December with the rules above.
- Each month's draft meets every hard must and covers every shift whenever that is possible.

**Non-goals for Phase 1.1**
- Generating a whole quarter with one click.
- Colleagues entering their own requests. The team lead wants this, but it needs a way for colleagues to hand in requests without a server, so it is designed in Phase 2. For Q1 2027, requests reach the team lead as today and are pasted from Excel.
- Publishing or sharing the plan from the app.
- Phase 2: closing months, Přehled (EN: Overview), yearly DOV/MD tracking, paste-back, whole-team copy, full Pravidla (EN: Rules).

**Anti-goals** (a failure even if everything else works)
- A 7th working day in a row, or a 6-day block followed by a single day off, produced by the generator.
- Weekly rest under 35 h produced by the generator.
- A *never* person on a night that someone else could have covered.
- Single days off scattered over the month when pairs were possible.
- A must broken without Kontrola showing it.
- A file saved by Phase 1 that Phase 1.1 cannot open.

## 6. Constraints

- **Phase 1's global constraints still apply.** Among them:
  - one offline HTML file, with no network request at runtime;
  - Czech UI, with code and docs in English;
  - no real names or team data in the repository;
  - UTC date arithmetic;
  - the save file is the real store.
- **Save files.** The new data (the `L` note, per-person limits, new settings) means a new save-file version. Files saved by Phase 1 open with sensible defaults.
- **Generator quality.** Scoring changes affect the generator's results. Compare pass rates with the scenario seed sweep before and after, and never weaken an assertion or re-seed a test to make it pass (Phase 1 ruling R26). The new rules need scenario months that exercise them: a quarter in a row, claimed holidays, `L` notes, and a person whose `x` requests block weekends.
- **Deadline:** mid-December 2026.

## 7. Left to the builder

- **Penalty values and wish shapes**, within the priority order of §3.8. That includes:
  - how the paired-days-off wish is scored;
  - how the reshaped W3 fits with the new musts.
- **Which numbers become settings in Pravidla.** *My call:*
  - settings: the maximum days in a row (6), the minimum weekend shifts (2) and the weekly rest (35 h);
  - fixed: the ideal 5 days and the 2 days off after 6.
- **Czech wording** of the new Kontrola lines, labels and help text, following §3.9.
- **UI details:** how `L` is entered and shown, and how the per-person limits look on the card.
- **The save-file migration**, and the tests and scenario months.
- **Generator speed.** The new hard musts may need the generator's pre-filters, like the rest pre-filter for M2, so drafts stay good within the time budget.
