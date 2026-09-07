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
}];
