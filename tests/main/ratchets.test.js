// T0-020 and T0-008: the source ratchets (scripts/ratchets.js).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const R = require('../../scripts/ratchets.js');

describe('mask', () => {
  it('ignores setInterval in comments and strings', () => {
    const src = '// setInterval(a)\n/* setInterval(b) */\nconst s = "setInterval(c)"; const t = `x setInterval(d)`;\n';
    expect(R.findRawIntervals(src)).toHaveLength(0);
  });
  it('finds a real one, with its line, and not a method named like it', () => {
    const src = 'const a = 1;\nconst t = setInterval(() => {}, 5);\nobj.setInterval(x);\nwindow.setInterval(y, 1);\n';
    expect(R.findRawIntervals(src).map(h => h.line)).toEqual([2, 4]);
  });
});

describe('silent catches', () => {
  it('flags an empty catch, a comment-only catch and .catch(() => {})', () => {
    expect(R.findSilentCatches('try { a(); } catch {}')).toHaveLength(1);
    expect(R.findSilentCatches('try { a(); } catch (e) { /* ignore */ }')).toHaveLength(1);
    expect(R.findSilentCatches('p.catch(() => {});')).toHaveLength(1);
    expect(R.findSilentCatches('p.catch(e => {})')).toHaveLength(1);
  });
  it('accepts a catch that does something, and a marked deliberate one', () => {
    expect(R.findSilentCatches('try { a(); } catch (e) { VexProblems.note("x", "y", e); }')).toHaveLength(0);
    expect(R.findSilentCatches('p.catch(err => console.error(err))')).toHaveLength(0);
    expect(R.findSilentCatches('try { a(); } catch { /* vex-allow-empty-catch: probing */ }')).toHaveLength(0);
  });
});

describe('compare', () => {
  const allow = { 'no-raw-interval': { 'src/renderer/js/a.js': 2 }, 'no-silent-catch': {} };
  it('fails a new file, fails a listed file that grew, notes one that improved', () => {
    expect(R.compare({ 'no-raw-interval': { 'src/renderer/js/new.js': 1 } }, allow).errors).toHaveLength(1);
    expect(R.compare({ 'no-raw-interval': { 'src/renderer/js/a.js': 3 } }, allow).errors).toHaveLength(1);
    const ok = R.compare({ 'no-raw-interval': { 'src/renderer/js/a.js': 1 } }, allow);
    expect(ok.errors).toHaveLength(0);
    expect(ok.notes).toHaveLength(1);
  });
});

describe('the real tree', () => {
  it('breaks no ratchet', () => {
    const r = R.check();
    expect(r.errors).toEqual([]);
  });
  it('scan finds the same files the allowlist lists, in a temp tree', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-'));
    try {
      fs.mkdirSync(path.join(dir, 'src', 'renderer', 'js'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'renderer', 'js', 'x.js'), 'setInterval(f, 1);\ntry{}catch{}\n');
      const c = R.scan(dir);
      expect(c['no-raw-interval']).toEqual({ 'src/renderer/js/x.js': 1 });
      expect(c['no-silent-catch']).toEqual({ 'src/renderer/js/x.js': 1 });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('unasked toasts (T0-019)', () => {
  it('flags a direct showToast, in every spelling, but not a definition or a method of something else', () => {
    expect(R.findUngatedToasts('showToast("a");')).toHaveLength(1);
    expect(R.findUngatedToasts('window.showToast("a", "info");')).toHaveLength(1);
    expect(R.findUngatedToasts('root.showToast("a");')).toHaveLength(1);
    expect(R.findUngatedToasts('function showToast(a) {}\nwindow.showToast = showToast;\nx.showToast(1);')).toHaveLength(0);
    expect(R.findUngatedToasts('// showToast("a")\nconst s = "showToast(b)";')).toHaveLength(0);
  });
  it('accepts a toast that sits inside a VexAttention call and refuses one that does not', () => {
    expect(R.findUngatedToasts('VexAttention.notify({ feature: "x", urgency: "useful" }, () => window.showToast("a"));')).toHaveLength(0);
    expect(R.findUngatedToasts('if (typeof VexAttention !== "undefined") VexAttention.toast(o, "a");\nelse window.showToast("a");')).toHaveLength(0);
    expect(R.findUngatedToasts('const x = 1;\n' + 'y();\n'.repeat(200) + 'window.showToast("a");')).toHaveLength(1);
  });
  it('the unsolicited notices that were migrated are no longer in the allowlist counts', () => {
    const allow = require('../../scripts/ratchet-allowlist.json')['no-ungated-toast'];
    for (const f of ['search-again.js', 'onboarding.js', 'discord-theme.js', 'webview.js']) {
      expect(allow['src/renderer/js/' + f] || 0).toBe(0);
    }
  });
});
