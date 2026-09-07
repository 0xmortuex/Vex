import js from '@eslint/js';
import globals from 'globals';
import promise from 'eslint-plugin-promise';
export default [{
  files: ['src/main/**/*.js', 'src/diagnostics.js', 'scripts/build-icons.js', 'scripts/bundle-browser-libs.js', 'src/renderer/js/network.js', 'src/renderer/js/data-contracts.js', 'src/renderer/js/sync-records.js', 'src/renderer/js/lifecycle.js'],
  languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
  plugins: { promise },
  rules: { ...js.configs.recommended.rules, 'no-control-regex': 'off', 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }], 'promise/catch-or-return': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error' }
}, {
  files: ['src/renderer/js/network.js', 'src/renderer/js/data-contracts.js', 'src/renderer/js/sync-records.js', 'src/renderer/js/lifecycle.js'],
  rules: { 'no-restricted-properties': ['error',
    { property: 'innerHTML', message: 'Shared services must return data; render with safe DOM properties in the UI layer.' },
    { property: 'outerHTML', message: 'Avoid untrusted HTML parsing in shared services.' },
    { property: 'insertAdjacentHTML', message: 'Avoid untrusted HTML parsing in shared services.' }
  ] }
}, {
  // src/main.js is not yet clean enough for the full set (unused bindings and
  // unreturned promises still need a dedicated pass), but it MUST be checked for
  // undefined identifiers: splitting main.js into services left a call to
  // _autofillPopup whose binding was never destructured, and the ReferenceError
  // only surfaced when a user opened an OAuth sign-in popup - as a modal crash
  // dialog in the shipped build, with nothing in CI to catch it.
  files: ['src/main.js'],
  languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
  rules: { ...js.configs.recommended.rules, 'no-control-regex': 'off', 'no-empty': ['error', { allowEmptyCatch: true }], 'no-unused-vars': 'off' }
}];
