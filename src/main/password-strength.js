// What makes a saved password weak, worked out on this computer from a list
// that ships inside Vex (nothing is looked up online). Used by Password Health
// (vault:health in main/vault.js); only the reasons ever leave main, never the
// password.
//
// Limits, stated plainly: this is a pattern check, not a guess-count estimate.
// A password it passes can still be weak (a long sentence from a song), and a
// password it flags may be fine for a throwaway account. The online breach
// check in Password Health is the stronger test, and is opt-in.
'use strict';

// Passwords that top every public breach-frequency list, in the form they are
// compared (lower case). Variants with digits or symbols added are caught by
// stripping those (see baseOf).
const COMMON = new Set((
  'password passw0rd p@ssw0rd p@ssword pass1234 password1 password12 password123 password1234 passwort ' +
  '123456 1234567 12345678 123456789 1234567890 12345 1234 123 111111 000000 121212 654321 666666 ' +
  '123123 112233 987654321 159753 696969 123321 1q2w3e4r 1q2w3e 1qaz2wsx qazwsx qweasd zaq12wsx ' +
  'qwerty qwerty1 qwerty12 qwerty123 qwertyuiop qwertz azerty asdfgh asdfghjkl zxcvbn zxcvbnm ' +
  'abc123 abcd1234 abcdef abc12345 admin admin1 admin123 administrator root toor guest user test test1 test123 ' +
  'welcome welcome1 welcome123 login letmein letmein1 changeme default secret master hello hello123 ' +
  'iloveyou iloveu loveyou lovely sunshine princess angel angels butterfly flower shadow ' +
  'monkey dragon football baseball soccer hockey basketball superman batman spiderman pokemon naruto ' +
  'michael jessica jennifer ashley daniel andrew joshua thomas charlie robert matthew ' +
  'trustno1 starwars whatever freedom cookie summer winter spring autumn ' +
  'master123 passw0rd1 hunter hunter2 access access14 mustang ranger harley computer internet ' +
  'google facebook twitter instagram youtube amazon netflix microsoft apple samsung ' +
  'killer jordan tigger buster pepper ginger maggie hannah ' +
  'merhaba sifre parola sifre123 şifre 12345qwert qwert123 benimsifrem galatasaray fenerbahce besiktas ' +
  'contraseña hola123 motdepasse soleil bonjour hallo123 ' +
  'zxcvbnm123 asd123 asdasd qwe123 qweqwe 1qazxsw2 q1w2e3r4 q1w2e3 qazwsxedc 7777777 888888 999999 ' +
  '1111111 11111111 00000000 12341234 123456a a123456 a1234567 aa123456 abc1234 asdf1234 asdfasdf'
).split(/\s+/).filter(Boolean));

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', 'azertyuiop', 'qwertzuiop'];
const LEET = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

// The password with the usual "make it look new" changes taken off: digits or
// symbols added at the end, and look-alike characters turned back to letters.
function baseOf(p) {
  let s = String(p).toLowerCase().replace(/[\d!@#$%^&*._-]+$/, '');
  let out = '';
  for (const ch of s) out += LEET[ch] || ch;
  return out;
}

// True when every step of the string moves by the same single step along the
// alphabet, the digits, or a keyboard row, in either direction ("abcdef",
// "654321", "asdfgh").
function isRun(s) {
  if (s.length < 5) return false;
  const lower = s.toLowerCase();
  let step = null, ok = true;
  for (let i = 1; i < lower.length; i++) {
    const d = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    if (step === null) step = d; else if (d !== step) { ok = false; break; }
  }
  if (ok && (step === 1 || step === -1)) return true;
  return ROWS.some(row => row.includes(lower) || [...row].reverse().join('').includes(lower));
}

// -> an array of short reasons; empty when nothing was found.
function weakReasons({ password, host = '', username = '' }) {
  const p = String(password == null ? '' : password);
  if (!p) return [];
  const reasons = [];
  const lower = p.toLowerCase();
  if (p.length < 8) reasons.push('too short');
  if (/^\d+$/.test(p)) reasons.push('digits only');
  if (COMMON.has(lower)) reasons.push('common password');
  else if (p.length < 16 && COMMON.has(baseOf(p))) reasons.push('a common password with a small change');
  if (p.length >= 4 && new Set(lower).size === 1) reasons.push('one character repeated');
  else if (p.length >= 6 && new Set(lower).size <= 2) reasons.push('only two different characters');
  else if (isRun(p)) reasons.push('a simple sequence');
  const user = String(username || '').toLowerCase();
  const userName = user.includes('@') ? user.split('@')[0] : user;
  if (user && (lower === user || (userName.length >= 3 && lower === userName))) reasons.push('same as the username');
  else if (userName.length >= 4 && p.length < 16 && lower.includes(userName)) reasons.push('contains the username');
  const labels = String(host).toLowerCase().replace(/^www\./, '').split('.');
  const site = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  if (site && site.length >= 4 && p.length < 16 && lower.includes(site)) reasons.push('contains the site name');
  return reasons;
}

// Whole days a password has gone unchanged, or null when its date is unknown.
function ageDays(updatedAt, now = Date.now()) {
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86400000));
}

module.exports = { weakReasons, ageDays, COMMON };
