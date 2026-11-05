import type { AfterWeekend, NightsPref, Rating, WeekendStyle } from '../domain/types';

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
  /** Asked before a person is removed. Their shifts and requests go with them. */
  confirmRemove: (name: string): string =>
    `Odebrat ${name} z týmu? Smažou se i všechny směny a žádosti této osoby.`,
  activeFrom: 'V týmu od',
  activeTo: 'V týmu do',
  nights: 'Noční',
  weekends: 'Víkendy',
  afterWeekend: 'Po víkendu',
  afterNights: 'Po posledním nočním (po 1 dni volna) může přijít',
  notes: 'Poznámka',
  /** The yearly days of each absence. */
  allowance: { DOV: 'Dovolená / rok', MD: 'MyDay / rok' },
  startingCounts: 'Výchozí počty',
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
  /** The columns of the totals of a person. */
  totals: { hours: 'Hodiny / FPD', overtime: 'Přesčas', twelve: '12h', nights: 'Noci' },
  menu: { clear: 'Vymazat', pin: 'Připnout', unpin: 'Odepnout' },
  pinned: '📌',
  checks: 'Kontrola',
  summary: (musts: number, wishes: number): string => `Musí: ${musts} · Přání: ${wishes}`,
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
