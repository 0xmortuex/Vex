// @vitest-environment jsdom
//
// Turkish for every notification (owner report 2026-11-01: "notifications of RAM usage are in English for a user who uses
// Vex in Turkish": "Vex is using 1546 MB, over your 1200 MB ceiling. Sleep 1 idle tab ...").
//
// A toast / notice with a changing part ("Vex is using ${n} MB ...") is never a plain key of the Turkish table: it needs a
// template key with {1} holes, which js/i18n-ui.js matches. This scans the sources for the calls that put a text in front of the
// person and requires Turkish for each one:
//   - renderer: showToast('...'), window.showToast?.('...'), VexMediaKit.toast, the title/detail/yes of SleepConsent.gate(...)
//     and the title/body of window.vex.notify(...). Each is read with its changing parts replaced by a sample (a number, or an
//     "s" for a plural ending), both branches of a "cond ? 'a' : 'b'" are read, and each text has to be found by VexI18nUI.lookup;
//   - main process: every notifier.show({ title, body }) the main process builds itself, which has to be found by main/i18n-main.js.
// A new English notification with no Turkish entry fails here. Nothing in this file grows tests/renderer/l10nBaseline.json.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const i18nMain = require('../../src/main/i18n-main.js');

const walk = (d, out = []) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p);
  }
  return out;
};

// A backslash escape in a literal: \n is a space, a backslash-u followed by four digits is that character, \x is x.
function esc(src, j) {
  const c = src[j + 1];
  if (c === 'n') return { text: ' ', next: j + 2 };
  if (c === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(j + 2, j + 6))) return { text: String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)), next: j + 6 };
  return { text: c, next: j + 2 };
}

// A plural ending is "s"; a count, a name, a size: a number (the template matcher takes a number as a changing part).
const sample = (ex) => (/Plural\.s\(|\.s\(|\? *'s' *: *''|\? *'' *: *'s'/.test(ex) ? 's' : '2');

// The cartesian product of the variants of the pieces of a "+" join (capped: a runaway chain is not a notification).
const join = (acc, next) => {
  const out = [];
  for (const a of acc) for (const b of next) { out.push(a + b); if (out.length >= 16) return out; }
  return out;
};

// Where the bracket that opens at 0 closes (quotes skipped).
function closes(ex) {
  let d = 0, q = null;
  for (let i = 0; i < ex.length; i++) {
    const ch = ex[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') q = ch;
    else if (ch === '(') d++;
    else if (ch === ')') { d--; if (d === 0) return i; }
  }
  return -1;
}

// Reads a string expression at `start` (literals, template literals, "+" joins, "cond ? a : b"). Returns every text it can be
// (a ternary gives both branches) with each changing part replaced by a sample, and where it stopped. null when it holds no literal.
function read(src, start) {
  let i = start, acc = [''], literal = false;
  for (;;) {
    while (/\s/.test(src[i])) i++;
    const c = src[i];
    let part;
    if (c === "'" || c === '"') {
      let j = i + 1, s = '';
      while (src[j] !== c) { if (src[j] === '\\') { const e = esc(src, j); s += e.text; j = e.next; } else s += src[j++]; if (j > src.length) return null; }
      part = [s]; literal = true; i = j + 1;
    } else if (c === '`') {
      let j = i + 1, texts = [''];
      while (src[j] !== '`') {
        if (src[j] === '\\') { const e = esc(src, j); texts = join(texts, [e.text]); j = e.next; }
        else if (src[j] === '$' && src[j + 1] === '{') {
          let d = 1, k = j + 2;
          while (d) { if (src[k] === '{') d++; else if (src[k] === '}') d--; k++; }
          const hole = src.slice(j + 2, k - 1);
          const inner = /\?/.test(hole) && !/Plural\.s\(/.test(hole) ? read(hole, 0) : null;
          texts = join(texts, inner ? inner.texts : [sample(hole)]); j = k;
        } else texts = join(texts, [src[j++]]);
      }
      part = texts; literal = true; i = j + 1;
    } else {
      // an expression: runs to the next top-level "+", "," or closing bracket; a "?" makes it a ternary
      let j = i, d = 0, q = null;
      while (j < src.length) {
        const ch = src[j];
        if (q) { if (ch === '\\') j++; else if (ch === q) q = null; }
        else if (ch === "'" || ch === '"' || ch === '`') q = ch;
        else if ('([{'.includes(ch)) d++;
        else if (')]}'.includes(ch)) { if (d === 0) break; d--; }
        else if (d === 0 && (ch === ',' || ch === '+' || ch === '?' || ch === ':' || ch === ';')) break;
        j++;
      }
      const ex = src.slice(i, j).trim();
      if (!ex) return null;
      if (src[j] === '?') {
        const a = read(src, j + 1), b = a && src[a.end] === ':' ? read(src, a.end + 1) : null;
        if (a && b) { part = [...a.texts, ...b.texts]; literal = true; i = b.end; }
        else return null;
      } else {
        let inner = null;
        if (ex[0] === '(' && ex[ex.length - 1] === ')' && closes(ex) === ex.length - 1) { const r = read(ex.slice(1, -1), 0); if (r && r.end >= ex.length - 2) inner = r; }
        // "(result && result.error) || 'Could not '": the text that is shown when the first operand is empty
        const or = !inner && src[j] === '+' ? /(?:\|\||\?\?)\s*(['"`][\s\S]*)$/.exec(ex) : null;
        const orText = or ? read(or[1], 0) : null;
        part = inner ? inner.texts : orText ? orText.texts : [sample(ex)]; i = j;
      }
    }
    acc = join(acc, part);
    while (/\s/.test(src[i])) i++;
    if (src[i] === '+') { i++; continue; }
    return literal ? { texts: acc, end: i } : null;
  }
}

// Something a person reads: not "2", "22", "Vex" or "2 — 2".
const readable = (t) => { const w = t.replace(/Vex|GitHub|[\d\s.,:;—·()%\-+"“”'’…!?]/g, ''); return w.length >= 3 && /[A-Za-z]{3}/.test(w); };
const clean = (texts) => [...new Set(texts.map((t) => t.trim()).filter((t) => t.length >= 4 && readable(t)))];

function renderCalls(raw) {
  const src = raw.replace(/\(window\.vexTr \|\| String\)\(/g, '(');   // the translated form of an OS notification: read what is inside
  const out = [];
  const line = (i) => src.slice(0, i).split('\n').length;
  const add = (m, r) => { if (r) for (const text of clean(r.texts)) out.push({ line: line(m.index), text }); };
  let m;
  const TOAST = /(?:showToast|VexMediaKit\.toast)\??\.?\(\s*/g;
  while ((m = TOAST.exec(src))) add(m, read(src, TOAST.lastIndex));
  const NOTIFY = /(?:window\.)?vex\??\.notify\??\.?\(\s*/g;
  while ((m = NOTIFY.exec(src))) {
    const a = read(src, NOTIFY.lastIndex);
    add(m, a);
    if (a && src[a.end] === ',') add(m, read(src, a.end + 1));
  }
  // The notices of the Attention Budget (js/vex-attention.js): VexAttention.notify / osNotify / suggest({ title, body }).
  const ATT = /VexAttention\.(?:notify|osNotify|suggest)\(\{/g;
  while ((m = ATT.exec(src))) {
    const body = src.slice(ATT.lastIndex, ATT.lastIndex + 700);
    for (const k of body.matchAll(/(?:^|[\s,{])(title|body):\s*/g)) add(m, read(src, ATT.lastIndex + k.index + k[0].length));
  }
  // The cards of SleepConsent.gate({ title, detail, yes }) (js/sleep-consent.js).
  const GATE = /SleepConsent\.(?:gate|ask)\(\{/g;
  while ((m = GATE.exec(src))) {
    const body = src.slice(GATE.lastIndex, GATE.lastIndex + 900);
    for (const k of body.matchAll(/(?:^|[\s,{])(title|detail|yes):\s*/g)) add(m, read(src, GATE.lastIndex + k.index + k[0].length));
  }
  return out;
}

function mainCalls(src) {
  const out = [];
  const line = (i) => src.slice(0, i).split('\n').length;
  const RE = /(?:notifier|quiet|show)\.?(?:show)?\(\s*\{\s*title:\s*/g;
  let m;
  while ((m = RE.exec(src))) {
    const t = read(src, RE.lastIndex);
    if (!t) continue;
    for (const text of clean(t.texts)) out.push({ line: line(m.index), text });
    const b = /^\s*,\s*body:\s*/.exec(src.slice(t.end, t.end + 200));
    if (b) { const body = read(src, t.end + b[0].length); if (body) for (const text of clean(body.texts)) out.push({ line: line(m.index), text }); }
  }
  return out;
}

describe('Turkish for every toast and desktop notification', () => {
  const renderFiles = walk(path.join(ROOT, 'src', 'renderer', 'js')).filter((f) => !/i18n/.test(path.basename(f)));

  it('the scan sees the toasts (a broken scan would pass everything)', () => {
    let n = 0;
    for (const f of renderFiles) n += renderCalls(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).length;
    expect(n).toBeGreaterThan(1500);
    const tabs = renderCalls(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'js', 'tabs.js'), 'utf8').replace(/\r\n/g, '\n')).map((c) => c.text);
    expect(tabs.some((t) => t.startsWith('Vex is using 2 MB, over your 2 MB ceiling. Sleep 2 idle tabs'))).toBe(true);
  });

  it('every toast, card and renderer notification text has a Turkish entry or template', () => {
    const gaps = [];
    for (const f of renderFiles) {
      const src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
      for (const c of renderCalls(src)) if (VexI18nUI.lookup(c.text, 'tr') == null) gaps.push(path.relative(ROOT, f) + ':' + c.line + '  ' + c.text);
    }
    expect(gaps, 'Add these to TABLE.tr in src/renderer/js/i18n-ui.js (a changing part is a {1} hole):\n' + gaps.join('\n')).toEqual([]);
  });

  it('every notification the main process builds itself has Turkish in main/i18n-main.js', () => {
    const files = [path.join(ROOT, 'src', 'main.js'), ...walk(path.join(ROOT, 'src', 'main'))];
    let seen = 0;
    const gaps = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
      for (const c of mainCalls(src)) {
        seen++;
        if (i18nMain.translate(c.text, 'tr') === c.text) gaps.push(path.relative(ROOT, f) + ':' + c.line + '  ' + c.text);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(5);
    expect(gaps, 'Add these to TR in src/main/i18n-main.js:\n' + gaps.join('\n')).toEqual([]);
  });

  it('the notifier translates what it shows (title, body and the buttons of a reminder toast)', () => {
    const notify = require('../../src/main/notify.js');
    const shown = [];
    class FakeNotification {
      static isSupported() { return true; }
      constructor(opts) { this.opts = opts; shown.push(opts); }
      on(ev, fn) { if (ev === 'show') setTimeout(fn, 0); }
      show() {}
    }
    const n = notify.createNotifier({ Notification: FakeNotification, translate: (s) => i18nMain.translate(s, 'tr') });
    const xml = n.toastXml({ title: 'Reminder', body: 'x', tag: 'abc', kind: 'reminder' });
    expect(xml).toContain('content="Ertele 9 dk"');
    expect(xml).toContain('content="Aç"');
    expect(n.toastXml({ title: 'a', body: 'b', tag: 'abc', kind: 'news' })).toContain('content="Bu kaynağı sustur"');
    return n.show({ title: 'Reminder — urgent', body: 'From the extension Foo' }).then(() => {
      expect(shown[0].title).toBe('Hatırlatıcı — acil');
      expect(shown[0].body).toBe('Uzantıdan: Foo');
    });
  });

  it('the main-process language table reads a body line by line', () => {
    expect(i18nMain.translate('Take the pills\nFrom the extension Foo', 'tr')).toBe('Take the pills\nUzantıdan: Foo');
    expect(i18nMain.translate('Reminder', 'en')).toBe('Reminder');
  });

  it('the memory-ceiling question reads in Turkish, with the numbers carried across', () => {
    const q = 'Vex is using 1546 MB, over your 1200 MB ceiling. Sleep 1 idle tab to free about 197 MB?';
    const tr = VexI18nUI.lookup(q, 'tr');
    expect(tr).toBe('Vex 1546 MB kullanıyor, 1200 MB üst sınırınızı aşıyor. Boştaki 1 sekme uyutulup yaklaşık 197 MB boşaltılsın mı?');
    expect(VexI18nUI.lookup('Vex is using 1900 MB, over your 1200 MB ceiling. Sleep 3 idle tabs to free about 640 MB?', 'tr')).toContain('Boştaki 3 sekme');
    for (const s of ['Asleep they use no memory and reload where they were when you come back to them.', 'Let them sleep', 'Not now', 'Always']) {
      expect(VexI18nUI.lookup(s, 'tr'), s).not.toBeNull();
    }
  });

  it('a name with spaces and lower-case words between quotes or before a dash is carried across', () => {
    expect(VexI18nUI.lookup('Added to “my reading list”', 'tr')).toBe('“my reading list” içine eklendi');
    expect(VexI18nUI.lookup('Subscribed to some small blog — it is in the Feeds panel', 'tr')).toBe('some small blog aboneliği başladı — Beslemeler panelinde');
    expect(VexI18nUI.lookup('Some channel is live', 'tr')).toBe('Some channel canlı yayında');
  });

  it('the cards Vex draws outside the toast stack are inside the translated scopes', () => {
    expect(VexI18nUI.SCOPES).toContain('.vexslow-notice');
  });
});
