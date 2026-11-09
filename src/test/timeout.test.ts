import { it, expect } from 'vitest';

// vite.config.ts gives every test 20 s, and 60 s on CI, where GitHub's runners take about 2.5
// times as long. A timeout is there to end a hang, not to judge speed: two UI tests take about 4 s
// on a calm machine, and a busy desktop doubles that, against the 5 s that Vitest allows by default.
it('allows a test 20 s (60 s on CI), not the default 5 s', ({ task }) => {
  expect(task.timeout).toBe(process.env.CI ? 60_000 : 20_000);
});
