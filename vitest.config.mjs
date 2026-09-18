import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globals: true,
    // One temp root per run, removed when it ends (tests/global-setup.js).
    globalSetup: ['tests/global-setup.js'],
  },
});
