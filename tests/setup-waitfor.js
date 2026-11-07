// vi.waitFor() gives up after 1 second unless told otherwise. That is plenty on a development PC, but the project's CI
// runner is a shared 2-core machine running four test files at once, and a poll for "the child process is gone" or
// "the render has finished" can take longer than a second there without anything being wrong. A poll costs nothing
// while the condition comes true quickly (it returns at once), so the floor is raised to 15 s for every test file:
// a test that passes a larger timeout keeps it; a condition that really never comes true still fails, 15 s later.
import { vi } from 'vitest';

const FLOOR_MS = 15000;
const original = vi.waitFor.bind(vi);
vi.waitFor = (callback, options) => {
  const given = typeof options === 'number' ? { timeout: options } : { ...(options || {}) };
  given.timeout = Math.max(given.timeout ?? 1000, FLOOR_MS);
  return original(callback, given);
};
