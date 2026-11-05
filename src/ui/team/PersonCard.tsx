import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  FairnessCounts,
  ISODate,
  Person,
  Preferences,
  Rating,
  WeekdayShift,
} from '../../domain/types';
import { useApp } from '../store';
import {
  AFTER_WEEKEND_CHOICES,
  NIGHTS_CHOICES,
  RATING_CHOICES,
  TEAM_SCREEN,
  WEEKEND_CHOICES,
} from '../text';
import type { Choice } from '../text';

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

/** The number that the text is, if it is a whole number of at least 0; otherwise null. */
function wholeNumber(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * A box with its label above it. The label points at the box by its id and does not wrap it: the
 * text of a label that wraps a select includes all its options, and the label of a box is to be
 * the label alone, for the page's readers and for the tests that find a box by it.
 */
function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/** The value of an option in the page, which holds text only: `null` is the empty text. */
const keyOf = (value: string | number | null): string => (value === null ? '' : String(value));

function ChoiceSelect<T extends string | number | null>(props: {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
}) {
  const { label, value, choices, onChange } = props;
  return (
    <Field label={label}>
      {(id) => (
        <select
          id={id}
          value={keyOf(value)}
          onChange={(e) => {
            const picked = choices.find((choice) => keyOf(choice.value) === e.target.value);
            if (picked !== undefined) onChange(picked.value);
          }}
        >
          {choices.map((choice) => (
            <option key={keyOf(choice.value)} value={keyOf(choice.value)}>
              {choice.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * A whole number of at least 0. What is typed stays in the box as it is, even while it is no
 * number yet (the box is empty, a minus sign): only a number that is good is stored, and when the
 * box is left it shows the number that is stored.
 */
function NumberField(props: { label: string; value: number; onChange: (value: number) => void }) {
  const { label, value, onChange } = props;
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    // The number changed other than by typing here, e.g. another plan was opened.
    setShown(value);
    setText(String(value));
  }
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type="number"
          min={0}
          step={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const typed = wholeNumber(e.target.value);
            if (typed !== null && typed !== value) onChange(typed);
          }}
          onBlur={() => setText(String(value))}
        />
      )}
    </Field>
  );
}

interface PersonCardProps {
  person: Person;
  /** Whether the person is first in the team, and so cannot move up. */
  first: boolean;
  /** Whether the person is last in the team, and so cannot move down. */
  last: boolean;
  /** Puts the cursor in the name when the card appears: for the person who was just added. */
  autoFocus?: boolean;
}

/** The card of one person: who they are, when they are in the team, and the survey's answers. */
export function PersonCard({ person, first, last, autoFocus = false }: PersonCardProps) {
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

      <div className="field-grid">
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

      <div className="field-grid">
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

      <fieldset className="group">
        <legend>{TEAM_SCREEN.afterNights}</legend>
        <div className="check-row">
          {AFTER_NIGHT_SHIFTS.map((shift) => (
            <label key={shift} className="check">
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

      <div className="field-grid">
        {ALLOWANCE_KEYS.map((key) => (
          <NumberField
            key={key}
            label={TEAM_SCREEN.allowance[key]}
            value={person.allowance[key]}
            onChange={(days) => update({ allowance: { ...person.allowance, [key]: days } })}
          />
        ))}
      </div>

      <fieldset className="group">
        <legend>{TEAM_SCREEN.startingCounts}</legend>
        <div className="field-grid">
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
