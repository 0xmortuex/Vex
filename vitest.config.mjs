import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globals: true,
    // Vitest's own 5 s default is too tight for the tests that build the whole
    // Library / Settings / theme pages in jsdom: on a loaded CI runner they take
    // 4-40 s of wall time, and v19.91.7's CI run went red on one of them
    // (libraryOpenButtons, 2026-10-12) while it passed locally in 1 s. A hung
    // test still fails, just after 30 s; the CI job itself is bounded at 20 min.
    // A test that renders a lot may ask for more per test: it(..., fn, 60000).
    testTimeout: 30000,
    hookTimeout: 30000,
    // One temp root per run, removed when it ends (tests/global-setup.js).
    globalSetup: ['tests/global-setup.js'],
    // The plural helper every renderer module may use (js/vex-plural.js).
    setupFiles: ['tests/setup-plural.js'],
  },
});
