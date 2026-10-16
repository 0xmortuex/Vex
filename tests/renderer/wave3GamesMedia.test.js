// @vitest-environment jsdom
//
// Wave 3, games and media: each feature has a manifest and a VexUsage row, arrives as "new", is
// loaded after media-kit.js, and the small hooks it added elsewhere (New Tab text, calendar sources,
// the status channel, the notification preload) are in place.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const IDS = ['patch-digest', 'service-check', 'panel-guard', 'net-courtesy', 'video-later', 'game-timers', 'content-board', 'drops-desk', 'writing-desk', 'push-bundle'];

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  delete window.__vexUsageQueue;
  globalThis.VexRegistry = fresh(JS + 'feature-registry.js').VexRegistry;
  globalThis.VexUsage = fresh(JS + 'vex-usage.js').VexUsage;
  fresh(JS + 'feature-manifests.js');
  globalThis.VexUsageRegistry = fresh(JS + 'vex-usage-registry.js').VexUsageRegistry;
});

describe('registration', () => {
  it('every feature has a manifest, is new, and has a VexUsage row', () => {
    const rows = new Set(VexUsageRegistry.table().map(([id]) => id));
    for (const id of IDS) {
      expect(VexRegistry.has(id), id).toBe(true);
      expect(VexRegistry.get(id).maturity, id).toBe('new');
      expect(rows.has(id), id).toBe(true);
    }
  });
  it('no game-affecting feature is on by default', () => {
    for (const [file, name] of [['patch-digest', 'VexPatchDigest'], ['service-check', 'VexServiceCheck'], ['panel-guard', 'VexPanelGuard'], ['net-courtesy', 'VexNetCourtesy'], ['push-bundle', 'VexPushBundle']]) {
      globalThis.VexMediaKit = require('../../src/renderer/js/media-kit.js').VexMediaKit;
      const mod = require('../../src/renderer/js/' + file + '.js')[name];
      expect(mod.enabled(), name).toBe(false);
    }
  });
  it('loads media-kit.js before the features and every file exists', () => {
    const html = read('src', 'renderer', 'index.html');
    const at = (f) => html.indexOf('<script src="js/' + f + '.js"></script>');
    expect(at('media-kit')).toBeGreaterThan(0);
    for (const id of ['patch-digest', 'service-check', 'panel-guard', 'net-courtesy', 'video-later', 'game-timers', 'content-board', 'drops-desk', 'writing-desk', 'push-bundle']) {
      expect(at(id), id).toBeGreaterThan(at('media-kit'));
      expect(fs.existsSync(path.join(ROOT, 'src', 'renderer', 'js', id + '.js')), id).toBe(true);
    }
    expect(at('jobs')).toBeLessThan(at('media-kit'));
  });
  it('starts each one through bootStep', () => {
    const app = read('src', 'renderer', 'js', 'app.js');
    for (const id of IDS) expect(app, id).toContain("bootStep('" + id + "'");
  });
});

describe('the hooks', () => {
  it('adds bounded plain text lines to the New Tab and keeps a failing source from breaking the rest', () => {
    const { VexNewTab } = require('../../src/renderer/js/vex-integration.js');
    VexNewTab._textWidgets.clear();
    VexNewTab.addTextWidget('a-source', () => ['One', '  Two   words  ', 'x'.repeat(500)]);
    VexNewTab.addTextWidget('b-source', () => { throw new Error('boom'); });
    VexNewTab.addTextWidget('c-source', () => ['Three', 'Four']);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = VexNewTab._text();
    err.mockRestore();
    expect(out).toHaveLength(4);
    expect(out[1].text).toBe('Two words');
    expect(out[2].text).toHaveLength(200);
    expect(() => VexNewTab.addTextWidget('Bad Id', () => [])).toThrow(/lowercase/);
    expect(() => VexNewTab.addTextWidget('ok-id', null)).toThrow(/function/);
    expect(VexNewTab._allWidgets().map(w => w.text)[0]).toBe('One');
  });
  it('lets features add calendar events, and drops a malformed one', () => {
    const { Calendar } = require('../../src/renderer/js/calendar.js');
    Calendar._providers.clear();
    Calendar.addProvider('x-source', () => [{ start: 1, end: 2, summary: 'Good' }, { start: 'a', end: 2, summary: 'Bad' }]);
    expect(Calendar.extraEvents(0, 10).map(e => e.summary)).toEqual(['Good']);
    expect(() => Calendar.addProvider('Bad Id', () => [])).toThrow(/lowercase/);
  });
  it('has the status channel in the schema, the preload, the UI-only list and the private-window block', () => {
    expect(read('src', 'main', 'ipc-schemas.js')).toContain("define('status:check'");
    expect(read('src', 'preload.js')).toContain("ipcRenderer.invoke('status:check'");
    const policy = read('src', 'main', 'ipc-policy.js');
    expect(policy).toContain("'status:check'");
    expect(policy).toMatch(/\|devfeeds:\|repos:[^/]*\|status:[|)]/);
    expect(read('src', 'main.js').match(/ipcMain\.handle\('status:check'/g)).toHaveLength(1);
  });
  it('the notification preload block only acts on a page the window listed, and reads no page content', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'preload-webview.js'), 'utf8');
    const block = src.slice(src.indexOf('Site notifications held for the hourly bundle'), src.indexOf("Where this tab's sound comes out"));
    expect(block).toContain("ipcRenderer.on('vex-push-rules'");
    expect(block).toContain("sendToHost('vex-push-held'");
    expect(block).toContain("const listed = hosts.some(");
    expect(block).toContain('rather than risk holding a code');
    expect(block).not.toMatch(/document\.(body|documentElement)\.(innerHTML|textContent)/);
  });
});
