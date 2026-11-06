import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { Choice } from './text';

// The pieces that the forms of the Team and the Rules screens are made of.

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

/**
 * A whole number of at least 0. What is typed stays in the box as it is, even while it is no
 * number yet (the box is empty, a minus sign): only a number that is good is stored, and when the
 * box is left it shows the number that is stored.
 */
export function NumberField(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
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
