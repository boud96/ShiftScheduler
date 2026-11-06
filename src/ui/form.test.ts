import { describe, expect, it } from 'vitest';
import { storableNumber } from './form';

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
