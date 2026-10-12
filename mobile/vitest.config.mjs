import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The chrome's unit tests live in the repo's tests/mobile/ with the desktop's,
// so one `npm test` at the root runs everything. This config lets them also be
// run from mobile/ alone — which is what the Android workflow does, so that
// building the app does not depend on installing Electron. The root is the
// repository, because a test file outside Vitest's root is not servable.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  root: repository,
  test: {
    environment: 'node',
    include: ['tests/mobile/**/*.test.js'],
    globals: true
  }
});
