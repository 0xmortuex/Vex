// Live Turkish-leftovers scan (part of scripts/turkish-scan/). See scripts/turkish-scan/run.mjs for the order.
// It starts Vex on a THROWAWAY profile with the interface in Turkish, drives it over the debugging port only (no OS input),
// opens each surface and records every visible text, title, placeholder and aria-label that still reads as English.
// Heuristic: does this UI string still read as English to a Turkish user?
const STOP = new Set(('the your and to for is of with a an in on you are this that or not can will be from by at it as all ' +
  'if when what how why which who has have had was were do does did no yes any more most less new use used using ' +
  'open close save cancel delete remove add edit show hide search find choose select enable disable turn off on ' +
  'settings help back next skip done start stop run set get see view make create copy paste undo redo reset clear ' +
  'name title description list item items click press tap drag drop here there them they their its our we us me my ' +
  'only also just but so than then into out up down over under about after before while during between each every ' +
  'per via without within without again still yet already now today tomorrow yesterday never always ' +
  'file folder page tab tabs window site sites link links image images video text word words ' +
  'error failed failure ok please try loading loaded unavailable available enabled disabled ' +
  'download downloads upload history bookmark bookmarks password passwords account sign login logout ' +
  'allow block blocked allowed ask deny update updates version install installed ' +
  'free private public default custom automatic automatically manual ' +
  'one two three first last other another some many few ' +
  'show shows shown hidden keep keeps kept move moves send sends sent ' +
  'press click type typing ' +
  'too very really ' +
  'light dark mode theme color colour size ' +
  'speed memory battery network ' +
  'minutes minute hours hour seconds second days day week weeks month ' +
  'dialog panel menu button toolbar sidebar ' +
  'learn try tip tips note notes ' +
  'create created delete deleted').split(/\s+/));
// words that are the same in Turkish UI (brands, tech terms) - never count alone
const NEUTRAL = new Set('vex ok url http https www api ai css html js json pdf zip gb mb kb ms px ctrl alt shift tab enter esc f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12 vpn dns tor ip tls ssl wifi usb gpu cpu ram ssd'.split(' '));
const AMBIG = new Set("a on all as at it no ok in do new open page tab tabs size mode theme time day second minute hour set get see use used show hide start stop name list copy move keep kept one two three other some per via text file link links site sites image video panel menu button".split(" "));
const TR_HINT = /[çğıöşüÇĞİÖŞÜ]|\b(ve|bir|için|ile|bu|şu|olarak|daha|veya|değil|yok|var|çok|kadar|gibi|ama|her|tüm|hiç|nasıl|nedir|Ayarlar|Sekme|Kapat|Aç)\b/;

export function looksEnglish(raw) {
  // TURKISH_SCAN_SHORT=1: also count a short capitalised ASCII phrase (World, Active, Templates) that has no entry; the callers drop the ones that are already Turkish
  if (process.env.TURKISH_SCAN_SHORT && typeof raw === 'string' && /^[A-Z][a-z]{3,}( [a-zA-Z]+){0,2}$/.test(raw.trim()) && !TR_HINT.test(raw) && !NEUTRAL.has(raw.trim().toLowerCase())) return true;
  const t = raw.replace(/\s+/g, ' ').trim();
  if (t.length < 2) return false;
  if (/^(https?:|vex:|file:|www\.)/i.test(t) || /^[\w.-]+\.(com|org|net|io|js|json|exe|md|html|txt|png|zip)\b/i.test(t)) return false;
  if (/^[^A-Za-z]*$/.test(t)) return false;
  if (/^[A-Z0-9_+\- ./:]{1,12}$/.test(t) && !STOP.has(t.toLowerCase())) return false; // keys / codes
  if (/^(Ctrl|Alt|Shift|Win|Cmd)\b[+ ]/.test(t) && t.length < 24) return false;
  const words = t.match(/[A-Za-z][A-Za-z'’]*/g) || [];
  if (!words.length) return false;
  const hasTr = TR_HINT.test(t);
  const lw = words.map(w => w.toLowerCase().replace(/['’]s$/, ''));
  const hits = lw.filter(w => STOP.has(w)).length;
  const real = lw.filter(w => !NEUTRAL.has(w)).length;
  if (!real) return false;
  if (words.length === 1) return !hasTr && hits === 1 && words[0].length > 2;
  const strong = lw.filter(w => STOP.has(w) && !AMBIG.has(w)).length;
  return hasTr ? strong >= 2 : hits >= 1;
}
