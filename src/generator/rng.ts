/**
 * A seeded random number generator (mulberry32). Each call of the function it returns gives the
 * next number of the sequence, in [0, 1). The same seed always gives the same sequence, so a
 * search, or a test with random data, can be run again with the same result.
 */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
