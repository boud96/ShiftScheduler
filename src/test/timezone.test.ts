import { it, expect } from 'vitest';

// vite.config.ts pins the unit tests to the Prague time zone, whatever zone the machine is in
// (see globalSetup.ts for why).
it('runs in the Europe/Prague time zone', () => {
  expect(new Date(2027, 2, 28, 12).getTimezoneOffset()).toBe(-120); // CEST, after 28 Mar 2027
  expect(new Date(2027, 0, 15, 12).getTimezoneOffset()).toBe(-60); // CET, in winter
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Prague');
});
