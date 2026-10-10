// The "Ask Vex" guide's passwords answer promised a breach check and editing in
// Settings › Passwords that did not exist. Each thing it names now does; this
// pins the words to the code that backs them.
import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(path.join(__dirname, '../../src/renderer/js', p), 'utf8');

it('every promise in the passwords answer has code behind it', () => {
  const guide = read('guide-templates.js');
  const at = guide.indexOf("id: 'passwords'");
  const entry = guide.slice(at, guide.indexOf("feature: 'passwords'", at));
  const passwords = read('passwords.js');
  const health = read('password-health.js');
  const auth = read('authenticator.js');
  const claims = [
    [/search, add, edit, show or copy one/, passwords.includes("id=\"pw-search\"") && passwords.includes('_addLogin(') && passwords.includes('_editLogin(') && passwords.includes('data-reveal') && passwords.includes('data-copy')],
    [/asks for your PIN first/, passwords.includes('_recheck(')],
    [/export them all/, passwords.includes('vaultExportCsv(')],
    [/Password Health finds reused and weak passwords, and breached ones/, health.includes('vaultBreachCheck(') && health.includes('Reused passwords') && health.includes('Weak passwords')],
    [/import Google Authenticator's export/, auth.includes('totpImportMigration(')],
    [/Back up every account with a passphrase/, auth.includes('totpExportBackup(')],
  ];
  for (const [words, backed] of claims) {
    expect(entry.replace(/\\'/g, "'")).toMatch(words);
    expect(backed, String(words)).toBe(true);
  }
  expect(entry).not.toMatch(/checks them for reuse and breaches, and lets you edit one/);
});
