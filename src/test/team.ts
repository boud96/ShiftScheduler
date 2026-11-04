import { newPerson } from '../domain/defaults';
import type {
  AfterWeekend,
  NightsPref,
  Person,
  Preferences,
  Rating,
  WeekendStyle,
} from '../domain/types';

type Ratings = [r1: Rating, r2: Rating, o20: Rating, o: Rating, n: Rating];

// id, ratings R1/R2/O20/O/N, nights, weekend, afterWeekend, afterNights
const TEAM: Array<
  [string, Ratings, NightsPref, WeekendStyle, AfterWeekend, Preferences['afterNights']]
> = [
  ['A', [4, 5, 2, 2, 1], 'never', 'whole', 'noAutomatic', []],
  ['B', [5, 4, 3, 1, 2], 'ifNeeded', 'whole', 'any', ['O', 'O20']],
  ['C', [1, 3, 4, 5, 3], 'normal', 'whole', 'any', ['O', 'O20']],
  ['D', [3, 4, 2, 2, 5], 'extra', 'whole', 'want', []],
  ['E', [2, 5, 3, 2, 4], 'normal', 'whole', 'noAutomatic', []],
  ['F', [4, 4, 1, 3, 5], 'extra', 'any', 'noAutomatic', ['R2']],
  ['G', [5, 5, 3, 1, 1], 'never', 'whole', 'any', []],
  ['H', [3, 4, 3, 3, 2], 'ifNeeded', 'whole', 'any', []],
];

/**
 * Eight made-up operators, A to H, each with different preferences. All tests and scenarios use
 * this team: no real names or answers belong in the repository. Each call returns fresh objects.
 */
export function syntheticTeam(): Person[] {
  return TEAM.map(([id, [R1, R2, O20, O, N], nights, weekendStyle, afterWeekend, afterNights]) => {
    const person = newPerson(id, `Operátor ${id}`);
    person.prefs = {
      ...person.prefs,
      ratings: { R1, R2, O20, O, N },
      nights,
      weekendStyle,
      afterWeekend,
      afterNights: [...afterNights],
    };
    return person;
  });
}
