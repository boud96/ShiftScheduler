/**
 * Runs once in the main Vitest process, before any test worker starts, so that every test file runs
 * in the same time zone. The date tests need a zone with daylight saving time: in UTC they would
 * pass without ever crossing a clock change.
 */
export function setup(): void {
  process.env.TZ = 'Europe/Prague';
}
