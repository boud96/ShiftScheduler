import type { Level, WishId } from '../types';

// The tiers of the score. Each outweighs everything below it, so that the generator settles the
// rules in the order of the design (§3.8): a hard must is never traded for anything, a shift left
// uncovered is traded only for a hard must, and so on down to the wishes. `weights.test.ts` holds
// the inequalities that keep this order.

/** Score of one broken hard must (M2-M5, M8-M11, M13) or one person too many on a shift (M1). */
export const HARD = 1e9;
/** Score of one missing person on a shift (M1). */
export const GAP = 1e7;
/**
 * Score of one night for someone who does not want nights (S1). Above all that one night can earn
 * in the tiers below: the hours of the longest shift at BELOW_FPD (11.5 × 1e5) together with a
 * weekend shift below the minimum (WEEKEND_SHORT), since one N12 can earn both at once. So hours
 * and the weekend minimum never buy such a night; covering it does, since STRONG is below GAP.
 */
export const STRONG = 3e6;
/** Score of each weekend shift below the minimum (M12). */
export const WEEKEND_SHORT = 1e6;
/** Score of one hour below the working-time fund (M6). */
export const BELOW_FPD = 1e5;

/**
 * Penalty of one unit of each wish at level 3. These are starting values: tuning the generator
 * may change them.
 */
export const BASE_WEIGHTS: Record<WishId, number> = {
  W1: 10,
  W2: 20,
  W3: 40,
  W4a: 30,
  W4b: 30,
  W4c: 40,
  W4d: 15,
  W5a: 30,
  W5b: 40,
  W5c: 15,
  W5d: 20,
  W6: 8,
  W7: 20,
  W8: 10,
  W9: 5,
  W10: 10,
};

/** The factor of each wish level, indexed by level: 0 switches the wish off, 5 is the strongest. */
export const LEVEL_MULT: readonly number[] = [0, 0.25, 0.5, 1, 2, 4];

/** The weight of each wish at the levels in the settings: base weight times the level's factor. */
export function effectiveWeights(levels: Record<WishId, Level>): Record<WishId, number> {
  const weights = {} as Record<WishId, number>;
  for (const id of Object.keys(BASE_WEIGHTS) as WishId[]) {
    weights[id] = BASE_WEIGHTS[id] * LEVEL_MULT[levels[id]];
  }
  return weights;
}
