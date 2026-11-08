import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { Choice } from './text';

// The pieces that the forms of the Team and the Rules screens are made of.

/** A plain number: digits, and digits after a point. No sign, no exponent, nothing to the side. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

/**
 * The number that the text is, if it may be stored: a plain number within `min` and `max` that
 * lies on the step, counted from `min`. Otherwise null. The count of steps has to be exactly a
 * whole number: a number a hair off the step is not on it. So the step has to be one that a
 * binary number holds exactly (1, 0.5, 0.25): the division by a step of 0.1 is not exact, and a
 * good number such as 0.3 would be refused.
 */
export function storableNumber(
  text: string,
  min: number,
  max: number,
  step: number,
): number | null {
  if (!PLAIN_NUMBER.test(text)) return null;
  const n = Number(text);
  if (n < min || n > max) return null;
  const steps = (n - min) / step;
  return steps === Math.round(steps) ? n : null;
}

/**
 * A box with its label above it. The label points at the box by its id and does not wrap it: the
 * text of a label that wraps a select includes all its options, and the label of a box is to be
 * the label alone, for the page's readers and for the tests that find a box by it.
 */
export function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="form-field">
      <label className="form-field-label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/** The value of an option in the page, which holds text only: `null` is the empty text. */
const keyOf = (value: string | number | null): string => (value === null ? '' : String(value));

export function ChoiceSelect<T extends string | number | null>(props: {
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

/** The text that a number box holds for a stored number: empty while there is none. */
const textOf = (value: number | null): string => (value === null ? '' : String(value));

interface NumberBoxProps {
  label: string;
  /** The stored number; null where there is none, in a box that may be empty. */
  value: number | null;
  min: number;
  /** Undefined: no limit, but the number has to be one that stays exact. */
  max: number | undefined;
  step: number;
  placeholder?: string;
  /** Stores a number that is good and is not the one stored. */
  onNumber: (value: number) => void;
  /** Stores an empty box. Without it an empty box stores nothing, and the stored number stays. */
  onEmpty?: () => void;
}

/**
 * The box of the two number fields. What is typed stays in the box as it is, even while it is no
 * number yet (the box is empty, a minus sign): only a number that is good is stored, and when the
 * box is left it shows the number that is stored. A number is good when it is within `min` and
 * `max` and on the step: with a step of 0.5 a half is good, with a step of 1 only a whole number
 * is.
 */
function NumberBox(props: NumberBoxProps) {
  const { label, value, min, max, step, placeholder, onNumber, onEmpty } = props;
  const limit = max ?? Number.MAX_SAFE_INTEGER; // beyond it a number cannot be exact
  const [text, setText] = useState(textOf(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    // The number changed other than by typing here, e.g. another plan was opened.
    setShown(value);
    setText(textOf(value));
  }
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value === '') {
              // A browser gives '' for a box that holds a minus sign or a letter, and says so in
              // `validity.badInput`. That box is not empty, so it stores nothing.
              if (onEmpty !== undefined && value !== null && !e.target.validity.badInput) onEmpty();
              return;
            }
            const typed = storableNumber(e.target.value, min, limit, step);
            if (typed !== null && typed !== value) onNumber(typed);
          }}
          onBlur={(e) => {
            setText(textOf(value));
            // A box that holds a letter has '' for its text. Where the text is '' already (a limit
            // that is not set) nothing is drawn again, and the letter would stay: the box is told.
            if (e.target.validity.badInput) e.target.value = textOf(value);
          }}
        />
      )}
    </Field>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** The least number the box takes, 0 or more: the box takes no minus sign. Default 0. */
  min?: number;
  /** The most it takes. Default: no limit, but the number has to be one that stays exact. */
  max?: number;
  /**
   * The distance between the numbers it takes, counted from `min`. Default 1: whole numbers. A
   * number a hair off the step is not taken. It has to be a step that a binary number holds
   * exactly: 1, 0.5, 0.25.
   */
  step?: number;
}

/**
 * A number in a range, by default a whole number of at least 0. An empty box stores nothing: the
 * stored number stays, and the box shows it again when it is left.
 */
export function NumberField(props: NumberFieldProps) {
  const { label, value, onChange, min = 0, max, step = 1 } = props;
  return (
    <NumberBox label={label} value={value} min={min} max={max} step={step} onNumber={onChange} />
  );
}

interface OptionalNumberFieldProps {
  label: string;
  /** The stored number; null where there is none, and the box is empty. */
  value: number | null;
  /** The least whole number the box takes, 0 or more: the box takes no minus sign. */
  min: number;
  /** The most whole number it takes. */
  max: number;
  /** In the empty box, to say what it stands for: "no limit", or the general value. */
  placeholder: string;
  onChange: (value: number | null) => void;
}

/**
 * A whole number in a range that may be left out, such as the limit of a person. It follows the
 * rules of `NumberField` except for the empty box, which stores null. 0 is a number like another,
 * not an empty box. A box that holds something that is no number (a minus sign, a letter) is not
 * empty either, and stores nothing.
 */
export function OptionalNumberField(props: OptionalNumberFieldProps) {
  const { label, value, min, max, placeholder, onChange } = props;
  return (
    <NumberBox
      label={label}
      value={value}
      min={min}
      max={max}
      step={1}
      placeholder={placeholder}
      onNumber={onChange}
      onEmpty={() => onChange(null)}
    />
  );
}
