import { it, expect } from 'vitest';
import {
  effectiveWeights,
  BASE_WEIGHTS,
  LEVEL_MULT,
  HARD,
  GAP,
  STRONG,
  WEEKEND_SHORT,
  BELOW_FPD,
} from './weights';
import { defaultSettings } from '../defaults';

it('wish levels scale the base weights', () => {
  const w = effectiveWeights({ ...defaultSettings().wishLevels, W6: 5, W9: 0 });
  expect(w.W6).toBe(BASE_WEIGHTS.W6 * 4); expect(w.W9).toBe(0); expect(w.W1).toBe(BASE_WEIGHTS.W1);
});

it('has the score scales and one factor per wish level', () => {
  expect([HARD, GAP, STRONG, WEEKEND_SHORT, BELOW_FPD]).toEqual([1e9, 1e7, 2e6, 1e6, 1e5]);
  expect(LEVEL_MULT).toEqual([0, 0.25, 0.5, 1, 2, 4]);
});

it('the tiers keep their order', () => {
  // a broken hard must outweighs anything the generator might trade it for, and so does a gap
  expect(HARD / 2).toBeGreaterThan(GAP);
  expect(GAP).toBeGreaterThan(STRONG);
  // the hours of the longest shift never buy a night of someone who does not want nights
  expect(STRONG).toBeGreaterThan(11.5 * BELOW_FPD);
  // a night of such a person never buys a weekend shift
  expect(STRONG).toBeGreaterThan(WEEKEND_SHORT);
  // and no wish, at its strongest level, buys a weekend shift
  expect(WEEKEND_SHORT).toBeGreaterThan(4 * Math.max(...Object.values(BASE_WEIGHTS)));
});

it('weighs all 16 wishes, and the default levels leave the base weights as they are', () => {
  const { wishLevels } = defaultSettings();
  expect(Object.keys(BASE_WEIGHTS).sort()).toEqual(Object.keys(wishLevels).sort());
  expect(effectiveWeights(wishLevels)).toEqual(BASE_WEIGHTS);
});

it('weighs the doctor wish W10 at 10', () => {
  expect(BASE_WEIGHTS.W10).toBe(10);
});

it('turns each level into its factor: off, quarter, half, normal, double, four times', () => {
  const base = defaultSettings().wishLevels;
  const w3 = ([0, 1, 2, 3, 4, 5] as const).map((level) => effectiveWeights({ ...base, W3: level }).W3);
  expect(w3).toEqual([0, 0.25, 0.5, 1, 2, 4].map((factor) => BASE_WEIGHTS.W3 * factor));
});
