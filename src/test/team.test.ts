import { describe, it, expect } from 'vitest';
import { newPerson } from '../domain/defaults';
import { syntheticTeam } from './team';

// The team as the table of the task brief gives it: id, ratings R1/R2/O20/O/N, nights, weekend,
// afterWeekend, afterNights.
const TABLE = `
A | 4/5/2/2/1 | never    | whole | noAutomatic | –
B | 5/4/3/1/2 | ifNeeded | whole | any         | O, O20
C | 1/3/4/5/3 | normal   | whole | any         | O, O20
D | 3/4/2/2/5 | extra    | whole | want        | –
E | 2/5/3/2/4 | normal   | whole | noAutomatic | –
F | 4/4/1/3/5 | extra    | any   | noAutomatic | R2
G | 5/5/3/1/1 | never    | whole | any         | –
H | 3/4/3/3/2 | ifNeeded | whole | any         | –
`;

describe('syntheticTeam', () => {
  it('is the eight made-up operators A to H with the preferences of the table', () => {
    const expected = TABLE.trim()
      .split('\n')
      .map((line) => {
        const [id, ratings, nights, weekendStyle, afterWeekend, after] = line
          .split('|')
          .map((cell) => cell.trim());
        const [R1, R2, O20, O, N] = ratings.split('/').map(Number);
        const afterNights = after === '–' ? [] : after.split(', ');
        return { id, ratings: { R1, R2, O20, O, N }, nights, weekendStyle, afterWeekend, afterNights };
      });
    const actual = syntheticTeam().map(({ id, prefs }) => ({
      id,
      ratings: prefs.ratings,
      nights: prefs.nights,
      weekendStyle: prefs.weekendStyle,
      afterWeekend: prefs.afterWeekend,
      afterNights: prefs.afterNights,
    }));
    expect(actual).toEqual(expected);
  });
  it('names them Operátor A to H and leaves everything else at the defaults', () => {
    const team = syntheticTeam();
    expect(team.map((p) => p.name)).toEqual('ABCDEFGH'.split('').map((id) => `Operátor ${id}`));
    for (const p of team) {
      expect({ ...p, prefs: p.prefs.notes }).toEqual({ ...newPerson(p.id, p.name), prefs: '' });
    }
  });
  it('returns fresh objects on every call', () => {
    const first = syntheticTeam();
    first[1].prefs.afterNights.push('R1');
    first[1].prefs.ratings.R1 = 1;
    first.pop();
    const second = syntheticTeam();
    expect(second).toHaveLength(8);
    expect(second[1].prefs.afterNights).toEqual(['O', 'O20']);
    expect(second[1].prefs.ratings.R1).toBe(5);
  });
});
