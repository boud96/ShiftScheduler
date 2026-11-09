// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { OptionalNumberField, storableNumber } from './form';

// A warning from React, or an error from jsdom, would end up in the output: the tests fail on it.
let errors: MockInstance;

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  const calls = [...errors.mock.calls];
  vi.restoreAllMocks(); // the spies
  expect(calls).toEqual([]);
});

// What a number box stores. The text is whatever the user typed or pasted; the answer is the number
// to store, or null when the box must keep the number it has.

/** The boxes of the app: whole numbers (the Team card), and the rest box with a step of a half. */
const WHOLE = [0, 1_000_000, 1] as const; // min, max, step
const REST = [8, 24, 0.5] as const;

const store = (text: string, [min, max, step]: readonly [number, number, number]) =>
  storableNumber(text, min, max, step);

describe('storableNumber', () => {
  it.each([
    ['0', 0],
    ['2', 2],
    ['25', 25],
    ['007', 7],
    ['2.0', 2],
    ['2.00', 2],
    ['1000000', 1_000_000],
  ])('stores the whole number %s as %d', (text, number) => {
    expect(store(text, WHOLE)).toBe(number);
  });

  it.each([
    ['8', 8],
    ['8.5', 8.5],
    ['10', 10],
    ['10.5', 10.5],
    ['10.50', 10.5],
    ['23.5', 23.5],
    ['24', 24],
  ])('stores %s in the rest box as %d', (text, number) => {
    expect(store(text, REST)).toBe(number);
  });

  describe('keeps a number that is a hair off the step out', () => {
    it.each(['2.0000000001', '1.9999999999', '2.00000000001', '1.99999999999', '0.0000000001'])(
      'a whole-number box: %s',
      (text) => {
        expect(store(text, WHOLE)).toBeNull();
      },
    );
    it.each([
      '10.4999999999', '10.5000000001', '8.0000000001', '23.9999999999', '10.49999999999',
    ])('the rest box: %s', (text) => {
      expect(store(text, REST)).toBeNull();
    });
    it('while a number written with zeros after the point is the number it is', () => {
      expect(store('2.0000000000', WHOLE)).toBe(2);
      expect(store('10.5000000000', REST)).toBe(10.5);
    });
  });

  it.each(['2.5', '0.5', '1.1', '99.9'])('keeps a fraction out of a whole-number box: %s', (text) => {
    expect(store(text, WHOLE)).toBeNull();
  });

  it.each(['10.25', '10.3', '10.1', '8.25', '8.75'])('keeps %s, off the half hour, out of the rest box', (text) => {
    expect(store(text, REST)).toBeNull();
  });

  it('counts the steps from the least number, not from 0', () => {
    expect(storableNumber('3', 1, 9, 2)).toBe(3);
    expect(storableNumber('9', 1, 9, 2)).toBe(9);
    expect(storableNumber('2', 1, 9, 2)).toBeNull(); // 1, 3, 5, 7, 9
    expect(storableNumber('8', 1, 9, 2)).toBeNull();
    expect(storableNumber('8.5', 8, 24, 0.5)).toBe(8.5);
    expect(storableNumber('9', 8.5, 24, 1)).toBeNull(); // 8.5, 9.5, ...
    expect(storableNumber('9.5', 8.5, 24, 1)).toBe(9.5);
  });

  it('keeps a number outside the range out, the least and the most being in', () => {
    expect(store('7.5', REST)).toBeNull();
    expect(store('7', REST)).toBeNull();
    expect(store('24.5', REST)).toBeNull();
    expect(store('25', REST)).toBeNull();
    expect(storableNumber('0', 1, 10, 1)).toBeNull();
    expect(storableNumber('1', 1, 10, 1)).toBe(1);
    expect(storableNumber('10', 1, 10, 1)).toBe(10);
    expect(storableNumber('11', 1, 10, 1)).toBeNull();
  });

  it.each([
    '', ' ', '-1', '+2', ' 2', '2 ', '1e1', '1E1', '2,5', '.5', '5.', '0x10', 'abc', '2.5.1',
    'Infinity', 'NaN', '١٢', '1_000',
  ])('keeps what is not a plain number out: %j', (text) => {
    expect(store(text, WHOLE)).toBeNull();
  });

  it('keeps out a number that cannot be exact, or is too long to be one', () => {
    const exact = Number.MAX_SAFE_INTEGER;
    expect(storableNumber(String(exact), 0, exact, 1)).toBe(exact);
    expect(storableNumber(String(exact + 2), 0, exact, 1)).toBeNull();
    expect(storableNumber('9'.repeat(30), 0, exact, 1)).toBeNull();
    expect(storableNumber('9'.repeat(400), 0, exact, 1)).toBeNull(); // Infinity to a JS number
  });

  it('stores the number itself, not one rounded to the step', () => {
    const typed = storableNumber('10.5', 8, 24, 0.5);
    expect(Object.is(typed, 10.5)).toBe(true);
    expect(Object.is(storableNumber('0', 0, 10, 1), 0)).toBe(true);
  });
});

// --- OptionalNumberField ----------------------------------------------------------------------

/** The label of the box in these tests; the range is 0 to 10 and the step 1, as for a limit. */
const LIMIT = 'Limit';

/** A box for a limit that may be unset, and a spy for what it stores. */
function renderLimit(value: number | null) {
  const onChange = vi.fn<(value: number | null) => void>();
  const props = { label: LIMIT, min: 0, max: 10, placeholder: 'bez limitu', onChange };
  const view = render(createElement(OptionalNumberField, { ...props, value }));
  return {
    box: screen.getByLabelText<HTMLInputElement>(LIMIT),
    onChange,
    /** Another value arrives from outside, as when another plan is opened. */
    show: (shown: number | null) =>
      view.rerender(createElement(OptionalNumberField, { ...props, value: shown })),
  };
}

/** Replaces what is in a box, by typing. */
async function enter(box: HTMLElement, text: string) {
  await userEvent.clear(box);
  await userEvent.type(box, text);
}

describe('OptionalNumberField', () => {
  it('an empty optional number stores null', async () => {
    const { box, onChange } = renderLimit(4);
    await userEvent.clear(box);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('stores a number that is good, and the last number typed stays', async () => {
    const { box, onChange } = renderLimit(null);
    await userEvent.type(box, '1');
    await userEvent.type(box, '0'); // 10: the least and the most are in
    expect(onChange.mock.calls).toEqual([[1], [10]]);
  });

  it('stores 0 as 0, not as an empty box', async () => {
    const { box, onChange } = renderLimit(4);
    await enter(box, '0');
    expect(onChange.mock.calls).toEqual([[null], [0]]); // emptied on the way, then 0
    expect(Object.is(onChange.mock.lastCall?.[0], 0)).toBe(true);
  });

  it('stores nothing for a number outside the range, off the step, or not a plain number', () => {
    const { box, onChange } = renderLimit(4);
    for (const text of ['11', '-1', '2.5', '1e1', '4.0000000001']) {
      fireEvent.change(box, { target: { value: text } });
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stores nothing for the number that is stored already', () => {
    const { box, onChange } = renderLimit(4);
    fireEvent.change(box, { target: { value: '04' } }); // 4, written another way
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stores nothing for a limit that was not set and is cleared again', async () => {
    const { box, onChange } = renderLimit(null);
    await userEvent.type(box, '-5'); // not good, so not stored: still no limit
    await userEvent.clear(box);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the limit while the box holds what a browser reports as an empty value', () => {
    // A browser gives '' for a box that holds a minus sign or a letter, and says so in
    // `validity.badInput`. That box is not empty, so it does not clear the limit.
    const { box, onChange } = renderLimit(4);
    Object.defineProperty(box, 'validity', { value: { badInput: true }, configurable: true });
    fireEvent.change(box, { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is a number box of the range given, step 1, with the stored number in it', () => {
    const set = renderLimit(4);
    expect(set.box).toHaveValue(4);
    expect(set.box).toHaveAttribute('placeholder', 'bez limitu');
    expect(set.box).toHaveAttribute('type', 'number');
    expect(set.box).toHaveAttribute('min', '0');
    expect(set.box).toHaveAttribute('max', '10');
    expect(set.box).toHaveAttribute('step', '1');
  });

  it('shows an empty box, with the placeholder, for a limit that is not set', () => {
    const { box } = renderLimit(null);
    expect(box).toHaveValue(null);
    expect(box).toHaveAttribute('placeholder', 'bez limitu');
  });

  it('shows an empty box again when it is left with a letter in it', () => {
    // A browser keeps a letter in the box and gives '' for its value, so that the text of the box
    // stays '' and the box is not drawn again. jsdom keeps no letter, so a '7' that the box shows
    // and its text does not hold stands for one.
    const { box } = renderLimit(null);
    Object.defineProperty(box, 'validity', { value: { badInput: true }, configurable: true });
    box.value = '7';
    fireEvent.blur(box);
    expect(box).toHaveValue(null);
  });

  it('shows the stored value again when the box is left', async () => {
    const { box } = renderLimit(4);
    await userEvent.click(box);
    fireEvent.change(box, { target: { value: '11' } }); // not good: nothing is stored
    await userEvent.tab();
    expect(box).toHaveValue(4);
  });

  it('shows a value that arrives from outside, an empty one among them', () => {
    const { box, show } = renderLimit(4);
    show(7);
    expect(box).toHaveValue(7);
    show(null);
    expect(box).toHaveValue(null);
    show(0);
    expect(box).toHaveValue(0);
  });
});
