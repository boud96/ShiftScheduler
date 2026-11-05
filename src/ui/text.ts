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
  /** Asked before another file is opened while there are changes that are not in a file. */
  confirmOpen: 'Změny, které nejsou uložené do souboru, se ztratí. Otevřít jiný soubor?',
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
