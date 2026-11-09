// What the specs of tests/e2e share. This file is no spec: its name does not end in `.spec.ts`, so
// Playwright does not run it.
import path from 'node:path';

/** The built page, opened from disk. `npm run test:e2e` builds it first. */
export const fileUrl = 'file://' + path.resolve('dist/index.html');

/**
 * What the browser prints when the page's Content Security Policy stops something. csp.spec.ts
 * shows that this matches what Chromium prints, so a spec that finds no such message has not been
 * looking for the wrong text. A request that the policy blocks never reaches the network, so
 * Playwright sees no request for it: the console message is what tells of the attempt. Chromium
 * reports only the page's own violations there. One inside the generator's worker is blocked all
 * the same, but not reported.
 */
export const POLICY_MESSAGE = /\bCSP\b|security[\s-]policy/i;

/** The names of the months as the heading of the Month screen spells them. */
const MONTH_NAMES = [
  'Leden',
  'Únor',
  'Březen',
  'Duben',
  'Květen',
  'Červen',
  'Červenec',
  'Srpen',
  'Září',
  'Říjen',
  'Listopad',
  'Prosinec',
];

/** A heading such as `Leden 2027` as a number of months, to tell which way to step. */
export function monthNumber(heading: string): number {
  const [name, year] = heading.trim().split(' ');
  const index = MONTH_NAMES.indexOf(name);
  if (index < 0 || !/^\d{4}$/.test(year)) {
    throw new Error(`Not the heading of a month: "${heading}"`);
  }
  return Number(year) * 12 + index;
}
