import type {
  AfterWeekend,
  Level,
  NightsPref,
  Rating,
  WeekendStyle,
  WishId,
} from '../domain/types';

// The Czech wording of the UI. Each screen that needs labels adds its own here.

/** The months, January first: the name of month `YYYY-MM` is `MONTH_NAMES[MM - 1]`. */
export const MONTH_NAMES: readonly string[] = [
  'Leden',
  'Únor',
  'Březen',
  'Duben',
  'Květen',
  'Červen',
  'Červenec',
  'Srpen',
  'Září',
  'Říjen',
  'Listopad',
  'Prosinec',
];

/** The days of the week, Monday first like `DayInfo.weekday`. */
export const WEEKDAY_ABBREVIATIONS: readonly string[] = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'];

export const APP_TITLE = 'Plánování směn';

export const TABS_LABEL = 'Sekce';

export const TAB_LABELS = {
  month: 'Měsíc',
  team: 'Tým',
  rules: 'Pravidla',
} as const;

/** What a tab panel shows until its screen is built. */
export const TAB_PANEL_SOON = 'Připravuje se…';

export const START_SCREEN = {
  intro: 'Všechna data zůstávají jen na tomto počítači, nikam se neodesílají.',
  open: 'Otevřít soubor',
  create: 'Začít nový',
};

/**
 * What the page says when it cannot draw the plan. The ways out are the buttons of the start
 * screen, `START_SCREEN`.
 */
export const PLAN_ERROR = {
  title: 'Plán se nepodařilo zobrazit.',
  hint: 'Otevřete soubor s plánem, nebo začněte nový plán.',
};

export const SAVE_BAR = {
  save: 'Uložit do souboru',
  open: 'Otevřít soubor',
  unsaved: 'Změny nejsou uložené do souboru',
  /** The dialog that asks before another file is opened while changes are not in a file. */
  confirmTitle: 'Neuložené změny',
  confirmOpen: 'Změny, které nejsou uložené do souboru, se ztratí. Otevřít jiný soubor?',
  confirmYes: 'Otevřít jiný soubor',
  confirmNo: 'Zrušit',
  auto: (fileName: string | null): string =>
    `Ukládá se automaticky do ${fileName ?? 'souboru'}`,
  /** `time` is the local time as `H:MM`. */
  saved: (time: string): string => `Uloženo do souboru ${time}`,
};

export const FILE_ERRORS = {
  open: 'Soubor se nepodařilo otevřít.',
  save: 'Soubor se nepodařilo uložit.',
  dismiss: 'Zavřít',
};

/** The Team screen: the labels on the card of a person. */
export const TEAM_SCREEN = {
  add: 'Přidat člověka',
  name: 'Jméno',
  moveUp: 'Posunout nahoru',
  moveDown: 'Posunout dolů',
  remove: 'Odebrat',
  /** Asked before a person is removed. Their shifts, requests and doctor's visits go with them. */
  confirmRemove: (name: string): string =>
    `Odebrat ${name} z týmu? Smažou se i všechny směny, žádosti a návštěvy lékaře této osoby.`,
  activeFrom: 'V týmu od',
  activeTo: 'V týmu do',
  nights: 'Noční',
  weekends: 'Víkendy',
  afterWeekend: 'Po víkendu',
  afterNights: 'Po posledním nočním (po 1 dni volna) může přijít',
  notes: 'Poznámka',
  /** The yearly days of each absence. */
  allowance: { DOV: 'Dovolená / rok', MD: 'MyDay / rok' },
  /** The limits of a person (spec 3.6). Each may be left empty. */
  maxTwelve: 'Max. 12h směn měsíčně',
  /** In the empty box of the 12h limit: the general maximum, as the Rules screen has it. */
  maxTwelveGeneral: (general: number): string => `obecně ${general}`,
  maxNights: 'Max. nočních měsíčně',
  /** In the empty box of the nights limit. */
  maxNightsNone: 'bez limitu',
  /**
   * The counts before the first planned month, i.e. the first month with a record in the file: the
   * months after it count on from these (spec 3.7).
   */
  startingCounts: 'Počáteční počty (před prvním naplánovaným měsícem)',
  /** The counts a person starts with, by what is counted. */
  counts: {
    twelve: '12h směny',
    nights: 'Noční směny',
    holidayTwelve: 'Svátky',
    festive: 'Vánoce',
  },
};

/** The Month screen: the head, the grid, the menu of a cell and the list of checks. */
export const MONTH_SCREEN = {
  /** The tooltips of ◀ and ▶: the buttons themselves show the arrows only. */
  previous: 'Předchozí měsíc',
  next: 'Další měsíc',
  /** What the month is: `requests` while it holds nothing but requests, then a draft or closed. */
  status: { requests: 'Žádosti', draft: 'Návrh', closed: 'Uzavřeno' },
  /** `fpd` is the month's hours, formatted; the days are those of the month as a whole. */
  info: (fpd: string, workdays: number, twelveDays: number): string =>
    `FPD ${fpd} h · ${workdays} pracovních dní · ${twelveDays} dnů s 12h směnami`,
  coverage: 'Obsazeno',
  covered: '✓',
  /**
   * The columns of the totals of a person. A person with claimed holiday shifts has `twelveClaimed`
   * for the title of the 12h figure: `claimed` of the shifts are extra, and count toward nothing.
   */
  totals: {
    hours: 'Hodiny / FPD',
    overtime: 'Přesčas',
    twelve: '12h',
    twelveClaimed: (claimed: number): string =>
      `12h (z toho navíc zamluvené svátky: ${claimed})`,
    nights: 'Noci',
  },
  menu: { clear: 'Vymazat', pin: 'Připnout', unpin: 'Odepnout', doctor: 'Lékař…' },
  pinned: '📌',
  /** A doctor's appointment (code L): the marker in a cell, and the form that the menu opens. */
  doctor: {
    marker: 'L',
    /** What the title of a cell appends for a note; `from` and `to` are times as `H:MM`. */
    title: (from: string, to: string): string => `lékař ${from}–${to}`,
    from: 'od',
    to: 'do',
    save: 'Uložit lékaře',
    remove: 'Odebrat lékaře',
    /** Above the buttons, when the times cannot be stored. */
    missing: 'Vyplňte čas od i čas do.',
    order: 'Čas od musí být dřív než čas do.',
  },
  checks: 'Kontrola',
  summary: (musts: number, wishes: number): string => `Musí: ${musts} · Přání: ${wishes}`,
  /** The generator's controls in the head: the button, the time spent, and how a run ended. */
  generate: {
    start: 'Vygenerovat',
    stop: 'Zastavit',
    /** `percent` is the share of the run's time that has gone, 0 to 100. */
    running: (percent: number): string => `Generuji… ${percent} %`,
    /**
     * `musts` is the number of broken musts that Kontrola lists for the month now, the number of
     * `Musí: N`. It is not the search's count of must units: that is the draft as the run found
     * it, and it counts units, not findings. Edits made during the run, or after it, change this
     * one.
     */
    done: (musts: number): string => `Hotovo. Porušená pravidla: ${musts}`,
    /** What went wrong is not for this line: the error is written to the console. */
    failed: 'Generování se nepodařilo.',
  },
  /** The dialog that takes cells pasted from Excel, and the button in the head that opens it. */
  paste: {
    open: 'Vložit z Excelu',
    title: 'Vložit z Excelu',
    /** `name` is the person of the first pasted row, `date` the first pasted day as `D. M.`. */
    start: (name: string, date: string): string => `Začátek: ${name}, ${date}`,
    area: 'Sem vložte buňky z Excelu (Ctrl+V)',
    /** `recognised` cells would be stored, `ignored` values would not. */
    summary: (recognised: number, ignored: number): string =>
      `Rozpoznáno: ${recognised} · Ignorováno: ${ignored}`,
    /** `row` and `column` count from 1, in the text as it was pasted. */
    ignoredValue: (value: string, row: number, column: number): string =>
      `${value} (řádek ${row}, sloupec ${column})`,
    namesColumn: 'První sloupec vypadá jako jména, vynechá se.',
    apply: 'Použít',
    cancel: 'Zrušit',
  },
  /** The button in the name cell that copies a row for Excel, and the note after the copy. */
  copyRow: {
    glyph: '📋',
    label: (name: string): string => `Kopírovat řádek ${name}`,
    copied: 'Zkopírováno – vložte do řádku směna v Excelu',
    failed: 'Kopírování se nepodařilo.',
  },
};

/** The Rules screen: its two sections, and the numbers of the first, in the order of the screen. */
export const RULES_SCREEN = {
  settings: 'Nastavení',
  wishes: 'Důležitost přání',
  minRest: 'Odpočinek mezi směnami (h)',
  weeklyRest: 'Týdenní odpočinek (h)',
  maxDaysInRow: 'Max. dní v kuse',
  maxTwelve: 'Max. 12h směn za měsíc',
  minWeekendShifts: 'Min. víkendových směn měsíčně',
  twelveTarget: 'Cíl 12h směn za měsíc',
  timeBudget: 'Čas na generování (s)',
};

/**
 * What each wish is called on the Rules screen, in the order of the screen: it lists the wishes in
 * the order of these keys. W5a is not `Cíl 12h směn za měsíc`, as the plan has it: the number of
 * 12-hour shifts is called that, and two controls must not share a name. W3 is named after what
 * it charges: two days off after six working days is the must M10, not the wish.
 */
export const WISH_LABELS: Record<WishId, string> = {
  W1: 'Co nejméně přesčasů',
  W2: 'Stejná směna 4–5 dní v řadě',
  W3: 'Nejvýš 5 dní v kuse, pak 2 dny volna',
  W4a: 'Noční v delších blocích',
  W4b: 'Před nočními volno (a předtím R2, O20 nebo O)',
  W4c: 'Po nočních 2 dny volna',
  W4d: 'Noční podle ochoty',
  W5a: 'Držet se cíle 12h směn',
  W5b: 'Celé víkendy podle přání',
  W5c: 'Volno po víkendu podle přání',
  W5d: 'Vedle R12 jen R1 nebo R2',
  W6: 'Oblíbené směny',
  W7: 'Férovost napříč měsíci',
  W8: 'Neoblíbené směny rovnoměrně',
  W9: 'Vyrovnané dny (R2)',
  W10: 'Směna mimo návštěvu lékaře',
};

/** An option of a select, and the value that it stands for. */
export interface Choice<T> {
  value: T;
  label: string;
}

// The options of the survey (spec 6.3), in its order. The wording is the survey's, so that the
// team lead can copy the answers over; the value is what the generator reads.

/** How much a shift is preferred, the most preferred first. No answer is `null`. */
export const RATING_CHOICES: readonly Choice<Rating | null>[] = [
  { value: null, label: '—' },
  { value: 5, label: 'nejvíce preferuji' },
  { value: 4, label: 'spíše preferuji' },
  { value: 3, label: 'neutrální' },
  { value: 2, label: 'spíše nepreferuji' },
  { value: 1, label: 'nejméně preferuji' },
];

export const NIGHTS_CHOICES: readonly Choice<NightsPref>[] = [
  { value: 'never', label: 'Noční směny nechci / preferuji jejich neplánování.' },
  {
    value: 'ifNeeded',
    label: 'Noční směny spíše nechci, ale v případě potřeby je mohu sloužit.',
  },
  { value: 'normal', label: 'Noční směny mi nevadí a mohu je standardně sloužit.' },
  { value: 'extra', label: 'Rád budu brát noční směny i za mé kolegy, pokud je to možné.' },
];

export const WEEKEND_CHOICES: readonly Choice<WeekendStyle>[] = [
  { value: 'whole', label: 'Jeden celý víkend (so + ne) v měsíci' },
  { value: 'single', label: 'Jednotlivé dny ve více víkendech' },
  { value: 'any', label: 'Je mi to jedno' },
];

export const AFTER_WEEKEND_CHOICES: readonly Choice<AfterWeekend>[] = [
  { value: 'want', label: 'Chci po víkendu volné dny' },
  { value: 'noAutomatic', label: 'Nerozdávat automaticky volné dny po víkendu' },
  { value: 'any', label: 'Je mi to jedno' },
];

/** How much a wish matters, from 0 (off) to 5 (the strongest); 3 is the usual. */
export const LEVEL_CHOICES: readonly Choice<Level>[] = [
  { value: 0, label: '0 – vypnuto' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3 – běžně' },
  { value: 4, label: '4' },
  { value: 5, label: '5 – hodně' },
];
