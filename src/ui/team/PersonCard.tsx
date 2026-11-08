import type {
  FairnessCounts,
  ISODate,
  Person,
  Preferences,
  Rating,
  WeekdayShift,
} from '../../domain/types';
import { ChoiceSelect, Field, NumberField, OptionalNumberField } from '../form';
import { useApp } from '../store';
import {
  AFTER_WEEKEND_CHOICES,
  NIGHTS_CHOICES,
  RATING_CHOICES,
  TEAM_SCREEN,
  WEEKEND_CHOICES,
} from '../text';

type AfterNightShift = Preferences['afterNights'][number];

/** The shifts that get a rating, in the order of the survey. */
const RATED_SHIFTS: readonly WeekdayShift[] = ['R1', 'R2', 'O20', 'O', 'N'];

/** The shifts that may come after the day off that follows the last night, in the card's order. */
const AFTER_NIGHT_SHIFTS: readonly AfterNightShift[] = ['R1', 'R2', 'O', 'O20'];

const ALLOWANCE_KEYS: readonly (keyof Person['allowance'])[] = ['DOV', 'MD'];

const COUNT_KEYS: readonly (keyof FairnessCounts)[] = [
  'twelve',
  'nights',
  'holidayTwelve',
  'festive',
];

/** The most that a limit of 12-hour shifts a month takes: as many as the general maximum may be. */
const MAX_TWELVE_LIMIT = 10;

/** The most that a limit of nights a month takes: a night on every day of the longest month. */
const MAX_NIGHTS_LIMIT = 31;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The stored date for what a date box holds: null when it is empty, never an empty text. Undefined
 * when it holds anything but `YYYY-MM-DD` (a browser lets a year have more than four digits): that
 * is not to be stored, and clearing the date instead would drop the person's limit unseen.
 */
function storedDate(text: string): ISODate | null | undefined {
  if (text === '') return null;
  return ISO_DATE.test(text) ? text : undefined;
}

interface PersonCardProps {
  person: Person;
  /** Whether the person is first in the team, and so cannot move up. */
  first: boolean;
  /** Whether the person is last in the team, and so cannot move down. */
  last: boolean;
  /** The general maximum of 12-hour shifts a month, which a person without a limit has. */
  generalMaxTwelve: number;
  /** Puts the cursor in the name when the card appears: for the person who was just added. */
  autoFocus?: boolean;
}

/**
 * The card of one person: who they are, when they are in the team, the survey's answers, and the
 * numbers: allowances, limits and the counts they start with.
 */
export function PersonCard({
  person,
  first,
  last,
  generalMaxTwelve,
  autoFocus = false,
}: PersonCardProps) {
  const { dispatch } = useApp();
  const { prefs } = person;

  const update = (patch: Partial<Person>) =>
    dispatch({ type: 'updatePerson', person: { ...person, ...patch } });
  const updatePrefs = (patch: Partial<Preferences>) => update({ prefs: { ...prefs, ...patch } });

  const setDate = (key: 'activeFrom' | 'activeTo', text: string) => {
    const date = storedDate(text);
    if (date !== undefined) update({ [key]: date });
  };

  const rate = (shift: WeekdayShift, rating: Rating | null) => {
    const ratings = { ...prefs.ratings };
    if (rating === null) delete ratings[shift];
    else ratings[shift] = rating;
    updatePrefs({ ratings });
  };

  // The list is kept in the order of the card, whatever the order the boxes were ticked in.
  const setAfterNight = (shift: AfterNightShift, checked: boolean) =>
    updatePrefs({
      afterNights: AFTER_NIGHT_SHIFTS.filter((s) =>
        s === shift ? checked : prefs.afterNights.includes(s),
      ),
    });

  const move = (delta: -1 | 1) => dispatch({ type: 'movePerson', personId: person.id, delta });

  const remove = () => {
    if (window.confirm(TEAM_SCREEN.confirmRemove(person.name))) {
      dispatch({ type: 'removePerson', personId: person.id });
    }
  };

  return (
    <article className="person-card" aria-label={person.name}>
      <div className="person-card-head">
        <input
          className="person-name"
          aria-label={TEAM_SCREEN.name}
          value={person.name}
          autoComplete="off" // the name of a colleague, not one for the browser to fill in
          autoFocus={autoFocus}
          onChange={(e) => update({ name: e.target.value })}
        />
        <button
          type="button"
          className="button"
          aria-label={TEAM_SCREEN.moveUp}
          disabled={first}
          onClick={() => move(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="button"
          aria-label={TEAM_SCREEN.moveDown}
          disabled={last}
          onClick={() => move(1)}
        >
          ↓
        </button>
        <button type="button" className="button button-danger" onClick={remove}>
          {TEAM_SCREEN.remove}
        </button>
      </div>

      <div className="form-field-grid">
        <Field label={TEAM_SCREEN.activeFrom}>
          {(id) => (
            <input
              id={id}
              type="date"
              value={person.activeFrom ?? ''}
              onChange={(e) => setDate('activeFrom', e.target.value)}
            />
          )}
        </Field>
        <Field label={TEAM_SCREEN.activeTo}>
          {(id) => (
            <input
              id={id}
              type="date"
              value={person.activeTo ?? ''}
              onChange={(e) => setDate('activeTo', e.target.value)}
            />
          )}
        </Field>
      </div>

      <div className="form-field-grid">
        {RATED_SHIFTS.map((shift) => (
          <ChoiceSelect
            key={shift}
            label={shift}
            value={prefs.ratings[shift] ?? null}
            choices={RATING_CHOICES}
            onChange={(rating) => rate(shift, rating)}
          />
        ))}
      </div>

      <ChoiceSelect
        label={TEAM_SCREEN.nights}
        value={prefs.nights}
        choices={NIGHTS_CHOICES}
        onChange={(nights) => updatePrefs({ nights })}
      />
      <ChoiceSelect
        label={TEAM_SCREEN.weekends}
        value={prefs.weekendStyle}
        choices={WEEKEND_CHOICES}
        onChange={(weekendStyle) => updatePrefs({ weekendStyle })}
      />
      <ChoiceSelect
        label={TEAM_SCREEN.afterWeekend}
        value={prefs.afterWeekend}
        choices={AFTER_WEEKEND_CHOICES}
        onChange={(afterWeekend) => updatePrefs({ afterWeekend })}
      />

      <fieldset className="form-group">
        <legend>{TEAM_SCREEN.afterNights}</legend>
        <div className="form-check-row">
          {AFTER_NIGHT_SHIFTS.map((shift) => (
            <label key={shift} className="form-check">
              <input
                type="checkbox"
                checked={prefs.afterNights.includes(shift)}
                onChange={(e) => setAfterNight(shift, e.target.checked)}
              />
              <span>{shift}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label={TEAM_SCREEN.notes}>
        {(id) => (
          <textarea
            id={id}
            rows={2}
            value={prefs.notes}
            onChange={(e) => updatePrefs({ notes: e.target.value })}
          />
        )}
      </Field>

      <div className="form-field-grid">
        {ALLOWANCE_KEYS.map((key) => (
          <NumberField
            key={key}
            label={TEAM_SCREEN.allowance[key]}
            value={person.allowance[key]}
            onChange={(days) => update({ allowance: { ...person.allowance, [key]: days } })}
          />
        ))}
      </div>

      <div className="form-field-grid">
        <OptionalNumberField
          label={TEAM_SCREEN.maxTwelve}
          min={0}
          max={MAX_TWELVE_LIMIT}
          placeholder={TEAM_SCREEN.maxTwelveGeneral(generalMaxTwelve)}
          value={person.maxTwelve}
          onChange={(maxTwelve) => update({ maxTwelve })}
        />
        <OptionalNumberField
          label={TEAM_SCREEN.maxNights}
          min={0}
          max={MAX_NIGHTS_LIMIT}
          placeholder={TEAM_SCREEN.maxNightsNone}
          value={person.maxNights}
          onChange={(maxNights) => update({ maxNights })}
        />
      </div>

      <fieldset className="form-group">
        <legend>{TEAM_SCREEN.startingCounts}</legend>
        <div className="form-field-grid">
          {COUNT_KEYS.map((key) => (
            <NumberField
              key={key}
              label={TEAM_SCREEN.counts[key]}
              value={person.startingCounts[key]}
              onChange={(count) =>
                update({ startingCounts: { ...person.startingCounts, [key]: count } })
              }
            />
          ))}
        </div>
      </fieldset>
    </article>
  );
}
