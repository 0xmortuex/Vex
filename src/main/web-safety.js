// === Safe by default: lookalike sites, risky downloads, over-asking pages ====
//
// Everything here is a local judgement. There is no lookup, no reputation
// service and no list fetched from anywhere: an address, a file name and a
// page's own behaviour are enough to say "this one is worth a second look",
// and nothing about what you browse leaves the computer to find out.
//
// The rule that shapes it: WARN ONLY WHEN SURE. A warning that fires on honest
// sites teaches everyone to click through, so each signal below is one that
// real, honest sites essentially never produce:
//   - a name that mixes alphabets inside one word (Latin with Cyrillic),
//   - a name that is a popular site's name spelled with look-alike letters
//     (paypa1, rnicrosoft, a Cyrillic "o" in google),
//   - a popular site's name written out in front of a different site's
//     (paypal.com.account-check.xyz),
//   - a name one swapped or doubled letter away from a site you use or a
//     well-known brand.
// "strict" adds the signals that are right more often than not but not
// nearly always (any one-letter difference, a name made of brand + "login").
//
// The user can switch it off, pick strict, and say "don't warn me about this
// site" for any one site; every warning carries the reasons in plain words.

const { BRANDS } = require('./web-safety-brands');

const SENSITIVITIES = ['off', 'standard', 'strict'];

// --- addresses ---------------------------------------------------------------

// Two-part public suffixes that matter for finding the name the owner
// registered. Not the whole Public Suffix List (it is megabytes, and a stale
// copy would be worse than a small honest one): the common ones, and a wrong
// guess here only ever makes a name look more distinct, never a false alarm.
const SUFFIX2 = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
  'co.nz', 'org.nz', 'govt.nz', 'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'co.kr', 'or.kr', 'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in',
  'com.br', 'net.br', 'org.br', 'gov.br', 'com.ar', 'com.mx', 'com.co', 'com.pe', 'com.ve', 'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.hk', 'com.tw', 'com.sg', 'com.my', 'com.ph', 'co.id', 'co.th', 'co.il', 'co.za', 'org.za', 'com.tr', 'com.ua', 'com.pl',
  'com.sa', 'com.eg', 'com.ng', 'co.ke', 'com.pk', 'com.bd', 'com.vn', 'com.ru']);

function bareHost(host) {
  return String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
}
function isIpLiteral(host) {
  const h = bareHost(host);
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || (h.includes(':') && /^[0-9a-f:.]+$/.test(h));
}
// "login.paypal.co.uk" -> "paypal.co.uk"; an IP or a one-label name is itself.
function registrable(host) {
  const h = bareHost(host);
  if (!h || isIpLiteral(h) || !h.includes('.')) return h;
  const parts = h.split('.');
  if (parts.length >= 3 && SUFFIX2.has(parts.slice(-2).join('.'))) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}
function labelOf(reg) { return String(reg || '').split('.')[0]; }
function tldOf(reg) { return String(reg || '').split('.').slice(1).join('.'); }
function isPrivateName(h) {
  return h === 'localhost' || /\.(local|localhost|internal|lan|home|test|invalid|onion)$/.test(h) || !h.includes('.');
}

// The name as a person would read it (xn--pypal-4ve.com -> pаypal.com).
function unicodeHost(host) {
  const h = bareHost(host);
  if (!h.includes('xn--')) return h;
  try { return require('url').domainToUnicode(h) || h; } catch { return h; }
}

// --- scripts and look-alike letters -------------------------------------------

const SCRIPTS = [
  ['Latin', /\p{Script=Latin}/u], ['Cyrillic', /\p{Script=Cyrillic}/u], ['Greek', /\p{Script=Greek}/u],
  ['Armenian', /\p{Script=Armenian}/u], ['Hebrew', /\p{Script=Hebrew}/u], ['Arabic', /\p{Script=Arabic}/u],
  ['Han', /\p{Script=Han}/u], ['Hiragana', /\p{Script=Hiragana}/u], ['Katakana', /\p{Script=Katakana}/u],
  ['Hangul', /\p{Script=Hangul}/u], ['Thai', /\p{Script=Thai}/u], ['Devanagari', /\p{Script=Devanagari}/u],
  ['Georgian', /\p{Script=Georgian}/u], ['Cherokee', /\p{Script=Cherokee}/u],
];
function scriptsIn(label) {
  const found = new Set();
  for (const ch of String(label)) {
    if (/[\p{M}\p{N}\p{Pd}\p{Pc}]/u.test(ch)) continue;
    for (const [name, re] of SCRIPTS) if (re.test(ch)) { found.add(name); break; }
  }
  return found;
}
// Scripts that are written together in one language are not "mixed".
function mixesScripts(label) {
  const s = scriptsIn(label);
  if (s.size < 2) return false;
  const japanese = new Set(['Han', 'Hiragana', 'Katakana']);
  const korean = new Set(['Han', 'Hangul']);
  const within = (allowed) => [...s].every(x => allowed.has(x));
  return !(within(japanese) || within(korean));
}

// One letter that is another letter to the eye. Only the pairs that are
// visually the same in common fonts: a confusable list a hundred times longer
// would fire on honest names in other languages.
const CONFUSABLE = {
  // Cyrillic
  'а': 'a', 'е': 'e', 'ё': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ї': 'i', 'ј': 'j', 'ѕ': 's', 'һ': 'h',
  'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'к': 'k', 'н': 'h', 'м': 'm', 'т': 't', 'ѵ': 'v', 'ӏ': 'l', 'ь': 'b', 'в': 'b',
  // Greek
  'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'ο': 'o', 'ρ': 'p', 'ν': 'v', 'υ': 'u', 'τ': 't', 'κ': 'k', 'χ': 'x', 'η': 'n', 'ω': 'w', 'γ': 'y',
  // Latin letters that are not the ASCII ones
  'ı': 'i', 'ɑ': 'a', 'ɡ': 'g', 'ɩ': 'i', 'ø': 'o', 'đ': 'd', 'ł': 'l', 'ħ': 'h', 'ɴ': 'n', 'ʀ': 'r', 'ꜱ': 's', 'ᴀ': 'a', 'ᴏ': 'o',
  'ℓ': 'l', 'ⅼ': 'l', 'ǀ': 'l', '𝗮': 'a',
};
// The letters with their look-alikes put back: what the name reads as.
function skeleton(s) {
  let out = '';
  for (const ch of String(s).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()) out += CONFUSABLE[ch] || ch;
  return out;
}
// Typed look-alikes, applied on top of the skeleton: digits for letters and
// letter pairs for one letter. Only for names of four letters or more (see
// resemblance): "ing" and "lng" are too short to call anything.
function fold(s) {
  return String(s)
    .replace(/rn/g, 'm').replace(/vv/g, 'w')
    .replace(/0/g, 'o').replace(/[1i|]/g, 'l').replace(/5/g, 's').replace(/3/g, 'e').replace(/4/g, 'a');
}

// Damerau-Levenshtein, optimal string alignment: a swap of two neighbouring
// letters is one edit.
function editDistance(a, b, cap = 3) {
  a = String(a); b = String(b);
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
// The kind of one-edit difference, when there is exactly one.
function oneEdit(a, b) {
  if (a === b) return null;
  if (a.length === b.length) {
    const at = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) at.push(i);
    if (at.length === 1) return 'substitution';
    if (at.length === 2 && at[1] === at[0] + 1 && a[at[0]] === b[at[1]] && a[at[1]] === b[at[0]]) return 'swap';
    return null;
  }
  if (Math.abs(a.length - b.length) !== 1) return null;
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && long[i] === short[i]) i++;
  if (long.slice(i + 1) !== short.slice(i)) return null;
  // The extra letter repeats its neighbour: "gooogle", "facebok".
  const doubled = long[i] === long[i - 1] || long[i] === long[i + 1];
  return doubled ? 'doubled' : 'extra';
}

// --- the brand index ----------------------------------------------------------

const BRAND_SET = new Set(BRANDS);
const BRAND_LABELS = new Map();   // label -> registrable (for the same-name-other-suffix rule)
for (const b of BRANDS) { const l = labelOf(b); if (!BRAND_LABELS.has(l)) BRAND_LABELS.set(l, b); }
const BRAND_SKELETONS = BRANDS.map(b => ({ reg: b, label: labelOf(b), tld: tldOf(b), skel: skeleton(b), folded: fold(skeleton(b)) }));

// Words a scam adds to a brand to make a name look official.
const LURE_WORDS = /^(login|log-in|signin|sign-in|secure|security|verify|verification|account|accounts|support|help|service|services|update|billing|wallet|official|customer|care|auth|alert|recover|recovery|unlock|confirm|id|pay|payment|payments|online|portal|web|my|mail)$/;

const AFFIXES = /^(my|get|the|go|try|use|app|web|hq)$/;

// analyzeHost(host, { sensitivity, topHosts, allow })
//   -> { flagged, level: 'high'|'medium'|null, kind, resembles, reasons[], line }
// topHosts: registrable names the person visits most (their own sites).
// allow: names the person said not to warn about.
function analyzeHost(host, { sensitivity = 'standard', topHosts = [], allow = [] } = {}) {
  const none = { flagged: false, level: null, kind: null, resembles: null, reasons: [], line: '' };
  if (sensitivity === 'off') return none;
  const ascii = bareHost(host);
  if (!ascii || isIpLiteral(ascii) || isPrivateName(ascii)) return none;
  const reg = registrable(ascii);
  const allowed = new Set((allow || []).map(bareHost));
  if (allowed.has(ascii) || allowed.has(reg)) return none;
  // A site that is itself on the list (or one you already use) is what the
  // others are measured against; it is never a copy of anything.
  const known = new Set((topHosts || []).map(registrable));
  if (BRAND_SET.has(reg) || known.has(reg)) return none;

  const uni = unicodeHost(ascii);
  const uniReg = registrable(uni);
  const labels = uni.split('.');
  const strict = sensitivity === 'strict';
  const found = (level, kind, resembles, reasons) => ({
    flagged: strict || level === 'high', level, kind, resembles, reasons,
    line: lineFor(kind, reg, uniReg, resembles),
  });
  const result = [];

  // 1. one word of two alphabets: honest names do not do this.
  const mixed = labels.find(mixesScripts);
  if (mixed) {
    const sc = [...scriptsIn(mixed)].join(' and ');
    result.push(found('high', 'mixed-script', null, [`One part of the name (“${mixed}”) mixes ${sc} letters, which honest sites do not do. It is the usual way to fake a familiar name.`]));
  }

  // 2. the name spelled with look-alike letters: unicode ones for any length
  //    of name, typed ones (0 for o, rn for m) for names of four or more.
  const hasNonAscii = /[^\x00-\x7f]/.test(uni);
  const skel = skeleton(uniReg);
  const targets = [...BRAND_SKELETONS, ...[...known].filter(k => k && k.includes('.')).map(k => ({ reg: k, label: labelOf(k), tld: tldOf(k), skel: skeleton(k), folded: fold(skeleton(k)), mine: true }))];
  for (const t of targets) {
    if (t.reg === uniReg || t.reg === reg) continue;
    if (hasNonAscii && skel === t.skel) {
      result.push(found('high', 'homograph', t.reg, [`The name is written with letters from another alphabet that look like “${t.reg}”.`]));
      break;
    }
    if (t.label.length >= 4 && t.tld === tldOf(uniReg) && fold(skel) === t.folded && labelOf(uniReg) !== t.label) {
      result.push(found('high', 'lookalike', t.reg, [`Swaps letters for numbers or lookalike pairs so that it reads as “${t.reg}”.`]));
      break;
    }
  }

  // 3. a popular site's whole name written in front of someone else's.
  if (!result.length) {
    for (const t of BRAND_SKELETONS) {
      if (t.label.length < 4 || !(uni === t.reg || uni.includes(t.reg + '.') || uni.includes('.' + t.reg + '.'))) continue;
      if (labelOf(uniReg) === t.label) continue;      // google.com.au is Google's
      if (uni.endsWith('.' + t.reg) || uni === t.reg) continue;   // a real subdomain
      result.push(found('high', 'subdomain', t.reg, [`“${t.reg}” appears at the front of the name, but the site really belongs to “${uniReg}”.`]));
      break;
    }
  }

  // 4. one swapped, doubled or dropped letter from a brand or a site you use.
  if (!result.length) {
    const label = labelOf(uniReg), tld = tldOf(uniReg);
    for (const t of targets) {
      if (t.label.length < 5 || t.tld !== tld || t.label === label) continue;
      if (Math.abs(t.label.length - label.length) > 1) continue;
      const edit = oneEdit(label, t.label);
      if (!edit) continue;
      if (edit === 'swap' || edit === 'doubled') {
        // "doubled" in either direction: gooogle (extra) or gogle (missing).
        result.push(found('high', 'typo', t.reg, [`One letter away from “${t.reg}” (${edit === 'swap' ? 'two letters swapped' : 'a doubled letter'}), the kind of slip a copycat site registers on purpose.`]));
        break;
      }
      // Any other single difference: right often, but not almost always.
      if (strict && !AFFIXES.test(label)) {
        result.push(found('medium', 'near', t.reg, [`Only one letter different from “${t.reg}”.`]));
        break;
      }
    }
    // The reverse of "doubled": a brand with a doubled letter, written with one.
    if (!result.length) {
      for (const t of targets) {
        if (t.label.length < 5 || t.tld !== tld || t.label === label) continue;
        const e = oneEdit(t.label, label);
        if (e === 'doubled') { result.push(found('high', 'typo', t.reg, [`One letter away from “${t.reg}” (a doubled letter dropped), the kind of slip a copycat site registers on purpose.`])); break; }
      }
    }
  }

  // Strict only: brand + a word that sounds official.
  if (!result.length && strict) {
    const label = labelOf(uniReg);
    const tokens = label.split('-');
    if (tokens.length > 1) {
      for (const t of BRAND_SKELETONS) {
        if (t.label.length < 5) continue;
        if (tokens.includes(t.label) && tokens.some(w => w !== t.label && LURE_WORDS.test(w))) {
          result.push(found('medium', 'brand-word', t.reg, [`Written as “${t.label}” plus an official-sounding word, which is how fake sign-in pages are named.`]));
          break;
        }
      }
    }
  }
  // Strict only: any name that needs punycode at all.
  if (!result.length && strict && /(^|\.)xn--/.test(ascii)) {
    result.push(found('medium', 'international', null, ['The name uses letters outside the plain alphabet, which is easy to mistake for another name.']));
  }

  if (!result.length) return none;
  // The most certain reason first; every reason kept.
  result.sort((a, b) => (a.level === b.level ? 0 : a.level === 'high' ? -1 : 1));
  const first = result[0];
  if (!first.flagged) return none;
  return { ...first, reasons: result.flatMap(r => r.reasons) };
}

function lineFor(kind, reg, uniReg, resembles) {
  switch (kind) {
    case 'mixed-script': return `“${uniReg}” mixes alphabets inside one name, a common trick for faking a familiar site.`;
    case 'homograph': return `“${uniReg}” is written with look-alike letters to pass for ${resembles}.`;
    case 'lookalike': return `“${uniReg}” is made to read as ${resembles}.`;
    case 'subdomain': return `“${uniReg}” puts ${resembles} in front of its own name so it looks like that site.`;
    case 'typo': return `“${uniReg}” is a one-letter slip away from ${resembles}.`;
    case 'near': return `“${uniReg}” is one letter different from ${resembles}.`;
    case 'brand-word': return `“${uniReg}” is built from ${resembles}'s name and an official-sounding word.`;
    default: return `“${uniReg}” uses letters that are easy to mistake for another name.`;
  }
}

// --- downloads -----------------------------------------------------------------

const KIND_BY_EXT = {};
for (const e of 'exe msi msix msixbundle appx appxbundle appinstaller scr com pif cpl msp jar gadget application'.split(' ')) KIND_BY_EXT[e] = 'program';
for (const e of 'bat cmd ps1 psm1 vbs vbe js jse wsf wsh hta reg lnk sh command py url scf'.split(' ')) KIND_BY_EXT[e] = 'script';
for (const e of 'docm xlsm pptm dotm xlam'.split(' ')) KIND_BY_EXT[e] = 'macro';
for (const e of 'iso img vhd vhdx dmg pkg apk deb rpm'.split(' ')) KIND_BY_EXT[e] = 'installer';
const KIND_WORD = { program: 'a program', script: 'a script', macro: 'a document with macros', installer: 'an installer or disk image', archive: 'a compressed folder' };
const ARCHIVE_NAME = /\.(zip|rar|7z)$/i;

// Abused cheaply registered suffixes: not "bad", but the place throwaway
// malware hosts are put because they cost almost nothing.
const CHEAP_TLDS = new Set(['zip', 'mov', 'top', 'xyz', 'click', 'work', 'rest', 'country', 'gq', 'tk', 'ml', 'ga', 'cf', 'icu', 'cyou', 'buzz', 'cam', 'monster', 'sbs', 'cfd', 'su', 'loan', 'download', 'review', 'racing', 'party', 'bid', 'win', 'men']);
const DECOY_EXT = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|bmp|txt|rtf|mp3|mp4|avi|mkv|zip|rar|7z|csv|html?)\.(exe|scr|bat|cmd|com|pif|js|jse|vbs|vbe|ps1|msi|lnk|hta|cpl|jar|wsf)$/i;
const BIDI = /[‪-‮⁦-⁩]/;

function extOf(filename) {
  const m = /\.([A-Za-z0-9]{1,12})\s*$/.exec(String(filename || ''));
  return m ? m[1].toLowerCase() : '';
}

// classifyDownload({ filename, url, pageUrl }, { sensitivity, allow, topHosts, trusted })
//   -> { warn, level, kind, fileKind, reasons[], line, host }
function classifyDownload({ filename = '', url = '' } = {}, { sensitivity = 'standard', allow = [], topHosts = [] } = {}) {
  const out = { warn: false, level: null, kind: null, fileKind: null, reasons: [], line: '', host: '' };
  if (sensitivity === 'off') return out;
  let u;
  try { u = new URL(String(url)); } catch { return out; }
  if (!/^https?:$/.test(u.protocol)) return out;
  const host = bareHost(u.hostname);
  out.host = host;
  const reg = registrable(host);
  const name = String(filename || decodeURIComponent((u.pathname.split('/').pop() || '')).replace(/[?#].*$/, ''));
  const ext = extOf(name);
  const fileKind = KIND_BY_EXT[ext] || null;
  const decoy = DECOY_EXT.test(name) || BIDI.test(name);
  // Cheat and exploit tools, and fake "updates" (download-guard.js, T3-010): by the
  // file's name only. An archive counts here, since that is how they are handed out.
  const allowed = new Set((allow || []).map(bareHost));
  const siteAllowed = allowed.has(host) || allowed.has(reg);
  const trusted = BRAND_SET.has(reg) || (topHosts || []).map(registrable).includes(reg);
  const guard = siteAllowed || isPrivateName(host) ? null : require('./download-guard').inspectName(name, host, { trusted });
  if (!fileKind && !decoy && !guard) return out;
  out.fileKind = fileKind || (guard && ARCHIVE_NAME.test(name) ? 'archive' : 'program');

  if (siteAllowed) return out;
  const strict = sensitivity === 'strict';

  const reasons = [];
  let highs = 0;
  const risk = (high, why) => { reasons.push(why); if (high) highs++; };
  if (guard) risk(true, guard.reason);

  if (BIDI.test(name)) risk(true, 'The file name hides its real ending behind reversed text.');
  else if (DECOY_EXT.test(name)) risk(true, `The name ends “.${ext}” behind a picture or document ending, so it looks like a file it is not.`);
  if (isIpLiteral(host)) risk(true, 'It comes from a bare number address, not a named site. Software publishers do not distribute from those.');
  const tld = host.split('.').pop();
  if (CHEAP_TLDS.has(tld) && !trusted) risk(false, `It comes from a “.${tld}” address, a cheap suffix that is mostly used for throwaway sites.`);
  if (u.protocol === 'http:' && fileKind && !isPrivateName(host)) risk(false, 'It is sent without encryption, so anyone on the network could swap the file for another.');
  const hostCheck = analyzeHost(host, { sensitivity: 'standard', topHosts, allow });
  if (hostCheck.flagged) risk(true, `The site looks like a copy: ${hostCheck.line}`);

  // A disguised name is warned about whatever the host. Otherwise: standard
  // wants one sure reason or two weaker ones; strict warns for any program or
  // script from a site that is not yours and not a known one.
  let warn = false;
  if (decoy || guard) warn = true;
  else if (fileKind && !trusted && !isPrivateName(host)) {
    warn = highs > 0 || reasons.length >= 2 || (strict && (fileKind === 'program' || fileKind === 'script' || reasons.length > 0));
  }
  if (!warn) return out;
  if (!reasons.length) reasons.push(`It is ${KIND_WORD[fileKind] || 'a file that can run code'} from a site you have not used before.`);
  out.warn = true;
  out.level = highs > 0 ? 'high' : 'medium';
  out.kind = guard ? guard.kind : decoy ? 'disguised' : isIpLiteral(host) ? 'ip-host' : hostCheck.flagged ? 'lookalike-host' : 'unknown-host';
  out.reasons = reasons;
  const first = reasons[0];
  out.line = `${name || 'This file'} is ${KIND_WORD[out.fileKind] || 'a file that can run code'}. ${first}`;
  // A cheat tool or fake update is held until the person answers, and the prompt does
  // not offer "always allow from this site" for it (permission-prompts.js).
  if (guard) { out.guard = guard.kind; out.quarantine = true; }
  return out;
}

// --- permission prompts ---------------------------------------------------------

const SENSITIVE = new Set(['camera', 'microphone', 'media', 'geolocation', 'notifications', 'clipboard-read', 'display-capture', 'midi', 'midiSysex']);
const RISK_LINE = {
  camera: 'It could watch and record you through the camera.',
  microphone: 'It could listen and record sound around you.',
  media: 'It could watch you and listen through the camera and microphone.',
  'display-capture': 'It could see everything on the screen or window you pick.',
  geolocation: 'It could learn where you are, to street level.',
  notifications: 'It could put messages on your screen even when the site is closed, which is how many scams and ads reach people.',
  'clipboard-read': 'It could read whatever you last copied, which may be a password or a code.',
  midi: 'It could talk to music devices plugged into the computer.',
  midiSysex: 'It could send low-level commands to music devices plugged into the computer.',
};
const WINDOW_MS = 10 * 60 * 1000;

// A running memory of what each site asked for, kept only in memory.
function createAskLog({ now = () => Date.now() } = {}) {
  const log = new Map();   // origin -> [{ permission, at, gesture }]
  return {
    note(origin, permission, gesture) {
      const at = now();
      const list = (log.get(origin) || []).filter(e => at - e.at <= WINDOW_MS);
      list.push({ permission, at, gesture: !!gesture });
      log.set(origin, list);
      if (log.size > 200) log.delete(log.keys().next().value);
      return list;
    },
    forget() { log.clear(); },
  };
}

// assessPermission({ permission, origin, topOrigin, gesture, recent }, { sensitivity, allow, topHosts })
//   -> { show, level: 'normal'|'caution'|'high', riskLine, summary, why[] }
// recent: the list noteAsk() returned (this origin's asks in the last ten minutes).
function assessPermission({ permission, origin = '', topOrigin = '', gesture = true, recent = [] } = {}, { sensitivity = 'standard', allow = [], topHosts = [] } = {}) {
  const base = { show: false, level: 'normal', riskLine: '', summary: '', why: [] };
  if (sensitivity === 'off') return base;
  const key = permission === 'media' ? 'media' : permission;
  if (!SENSITIVE.has(key)) return base;
  const riskLine = RISK_LINE[key] || '';
  let host;
  try { host = new URL(origin).hostname; } catch { host = ''; }
  const allowed = new Set((allow || []).map(bareHost));
  if (host && (allowed.has(bareHost(host)) || allowed.has(registrable(host)) || allowed.has(origin))) return { ...base, riskLine };

  const strict = sensitivity === 'strict';
  const why = [];
  let strong = false, weak = false;
  const distinct = new Set((recent || []).map(r => r.permission === 'media' ? 'camera' : r.permission).filter(p => SENSITIVE.has(p) || p === 'camera'));
  if (/^http:/i.test(origin) && !isPrivateName(bareHost(host))) { strong = true; why.push('The page is not encrypted, so anyone on the network could see what it gets.'); }
  const look = host ? analyzeHost(host, { sensitivity: 'standard', allow, topHosts }) : null;
  if (look && look.flagged) { strong = true; why.push('The site looks like a copy of another one: ' + look.line); }
  if (topOrigin && origin && topOrigin !== origin && /^https?:/i.test(topOrigin)) {
    strong = true;
    let top = ''; try { top = new URL(topOrigin).hostname; } catch { /* leave blank */ }
    why.push(`The request comes from a frame of another site${top ? ` inside ${top}` : ''}, not from the page itself.`);
  }
  if (distinct.size >= 3) { strong = true; why.push(`It has asked for ${distinct.size} different sensitive things in the last ten minutes.`); }
  else if (distinct.size === 2) { weak = true; why.push('It has asked for two different sensitive things in a short time.'); }
  if (gesture === false && ['camera', 'microphone', 'media', 'geolocation', 'clipboard-read'].includes(key)) { weak = true; why.push('It asked on its own, without you clicking anything.'); }
  const flagged = strong || (strict && weak);
  return {
    show: true, level: flagged ? (strong ? 'high' : 'caution') : 'normal', riskLine,
    summary: flagged ? 'This site asks for more than it should.' : '',
    why: flagged ? why : [],
  };
}

// --- the person's choices ---------------------------------------------------------

const MAX_LIST = 500;
// A bare host or an origin, as typed or as it arrives.
function cleanHost(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  try { if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) return new URL(s).hostname.replace(/^www\./, ''); } catch { return ''; }
  return s.replace(/^www\./, '').replace(/[/?#].*$/, '').replace(/\.+$/, '');
}
function originOf(value) {
  try { const u = new URL(String(value)); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; }
}

// file: where the choices are kept; read: () => text|null; write: (text) => Promise.
function createWebSafety({ read, write, topHosts = () => [] }) {
  let state = { v: 1, sensitivity: 'standard', allow: [], paranoid: [] };
  try {
    const text = read();
    if (text) {
      const j = JSON.parse(text);
      if (j && typeof j === 'object') {
        if (SENSITIVITIES.includes(j.sensitivity)) state.sensitivity = j.sensitivity;
        if (Array.isArray(j.allow)) state.allow = j.allow.map(cleanHost).filter(Boolean).slice(0, MAX_LIST);
        if (Array.isArray(j.paranoid)) state.paranoid = j.paranoid.map(originOf).filter(Boolean).slice(0, MAX_LIST);
      }
    }
  } catch (err) {
    // A damaged file is said, not hidden: the choices fall back to the defaults.
    console.error('[WebSafety] could not read the saved choices; using the defaults:', err.message);
  }
  let writes = Promise.resolve();
  const save = () => {
    const text = JSON.stringify(state);
    writes = writes.catch(() => {}).then(() => write(text));
    return writes;
  };
  const asks = createAskLog();
  const paranoidSet = () => new Set(state.paranoid);

  return {
    get sensitivity() { return state.sensitivity; },
    snapshot() { return { sensitivity: state.sensitivity, allow: [...state.allow], paranoid: [...state.paranoid] }; },
    setSensitivity(level) {
      if (!SENSITIVITIES.includes(level)) throw new Error('Sensitivity is off, standard or strict');
      state.sensitivity = level;
      return save();
    },
    allowHost(host) {
      const h = cleanHost(host);
      if (!h) throw new Error('That is not a site name');
      if (!state.allow.includes(h)) { state.allow.push(h); if (state.allow.length > MAX_LIST) state.allow.shift(); }
      return save();
    },
    forgetHost(host) {
      const h = cleanHost(host);
      state.allow = state.allow.filter(x => x !== h);
      return save();
    },
    isAllowed(host) {
      const h = bareHost(host);
      return state.allow.includes(h) || state.allow.includes(registrable(h));
    },
    setParanoid(origin, on) {
      const o = originOf(origin);
      if (!o) throw new Error('Paranoid mode is for a website address');
      const set = paranoidSet();
      if (on) set.add(o); else set.delete(o);
      state.paranoid = [...set].slice(0, MAX_LIST);
      return save();
    },
    // On the path of every request a page makes: nothing at all to do while
    // no site is in paranoid mode.
    isParanoid(urlOrOrigin) { return state.paranoid.length > 0 && state.paranoid.includes(originOf(urlOrOrigin)); },
    analyze(host) { return analyzeHost(host, { sensitivity: state.sensitivity, topHosts: topHosts(), allow: state.allow }); },
    judgeDownload(info) { return classifyDownload(info, { sensitivity: state.sensitivity, topHosts: topHosts(), allow: state.allow }); },
    judgePermission(info) {
      const recent = info.permission && info.origin ? asks.note(info.origin, info.permission, info.gesture) : [];
      return assessPermission({ ...info, recent }, { sensitivity: state.sensitivity, topHosts: topHosts(), allow: state.allow });
    },
    flush() { return writes; },
  };
}

module.exports = {
  SENSITIVITIES, analyzeHost, classifyDownload, assessPermission, createWebSafety, createAskLog,
  registrable, bareHost, isIpLiteral, skeleton, fold, editDistance, oneEdit, mixesScripts, unicodeHost, cleanHost, originOf,
  BRANDS, KIND_BY_EXT, RISK_LINE,
};
