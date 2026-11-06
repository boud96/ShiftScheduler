import { it, expect } from 'vitest';

// vite.config.ts gives every test 20 s. A timeout is there to end a hang, not to judge speed: two
// UI tests take about 4 s on a calm machine, and a busy desktop doubles that, against the 5 s that
// Vitest allows by default.
it('allows a test 20 s, not the default 5 s', ({ task }) => {
  expect(task.timeout).toBe(20_000);
});
