import js from '@eslint/js';
import globals from 'globals';
import promise from 'eslint-plugin-promise';
export default [{
  files: ['src/main/**/*.js', 'src/diagnostics.js', 'scripts/build-icons.js', 'scripts/bundle-browser-libs.js'],
  languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
  plugins: { promise },
  rules: { ...js.configs.recommended.rules, 'no-control-regex': 'off', 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }], 'promise/catch-or-return': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error' }
}];
