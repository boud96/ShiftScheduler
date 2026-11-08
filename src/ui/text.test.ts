import { expect, it } from 'vitest';
import { monthDays } from '../domain/calendar';
import { defaultSettings } from '../domain/defaults';
import { MONTH_NAMES, WEEKDAY_ABBREVIATIONS, WISH_LABELS } from './text';

it('names the twelve months in Czech, January first', () => {
  expect(MONTH_NAMES).toEqual([
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
  ]);
});

it('abbreviates the weekdays in Czech, Monday first like DayInfo.weekday', () => {
  expect(WEEKDAY_ABBREVIATIONS).toEqual(['po', 'út', 'st', 'čt', 'pá', 'so', 'ne']);
  // 1 January 2027 is a Friday, and 3 January a Sunday.
  const [first, , third] = monthDays('2027-01', defaultSettings());
  expect(WEEKDAY_ABBREVIATIONS[first.weekday]).toBe('pá');
  expect(WEEKDAY_ABBREVIATIONS[third.weekday]).toBe('ne');
});

it('names the doctor wish W10 for the Rules screen', () => {
  expect(WISH_LABELS.W10).toBe('Směna mimo návštěvu lékaře');
});

it('names W3 after what it charges, not after the must M10', () => {
  // Since Phase 1.1 two days off after six working days is the must M10. The wish W3 charges a run
  // over five days, a lone day off, and one day off after five or more.
  expect(WISH_LABELS.W3).toBe('Nejvýš 5 dní v kuse, pak 2 dny volna');
});
