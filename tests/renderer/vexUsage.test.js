// @vitest-environment jsdom
//
// Feature usage (js/vex-usage.js, js/vex-usage-ui.js, js/vex-settings-groups.js):
// features register themselves, say when they are used, and can be switched
// off and on again from one place. Nothing here knows any feature by name.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

const DAY = 24 * 60 * 60 * 1000;
let VexUsage, VexSettingsGroups, VexUsageUI, now;

function load() {
  vi.resetModules();
  delete window.__vexUsageQueue;
  VexUsage = fresh('../../src/renderer/js/vex-usage.js').VexUsage;
  globalThis.VexUsage = VexUsage;
  VexUsage._now = () => now;
  VexSettingsGroups = fresh('../../src/renderer/js/vex-settings-groups.js').VexSettingsGroups;
  globalThis.VexSettingsGroups = VexSettingsGroups;
  globalThis.vexConfirm = vi.fn(async () => true);
  VexUsageUI = fresh('../../src/renderer/js/vex-usage-ui.js').VexUsageUI;
}
function feature(id, extra = {}) {
  const f = { enabled: true, ...extra };
  return {
    f,
    spec: { id, title: 'Feature ' + id, group: extra.group || '', keys: extra.keys || [], isEnabled: extra.noIsEnabled ? undefined : () => f.enabled,
      disable: vi.fn(() => { f.enabled = false; }), enable: vi.fn(() => { f.enabled = true; }) },
  };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  now = Date.UTC(2026, 9, 1);
  delete globalThis.VexFeatures;
  load();
});
afterEach(() => { delete globalThis.VexFeatures; });

describe('registry', () => {
  it('rejects a feature that cannot be switched off and on', () => {
    expect(() => VexUsage.register({ id: 'a', disable() {} })).toThrow(/enable/);
    expect(() => VexUsage.register({ id: 'bad id', disable() {}, enable() {} })).toThrow(/id/);
    expect(() => VexUsage.register(null)).toThrow();
  });

  it('touch counts a use of a registered feature and ignores others', () => {
    VexUsage.register(feature('brief').spec);
    expect(VexUsage.touch('brief')).toBe(true);
    expect(VexUsage.touch('nope')).toBe(false);
    VexUsage.flush();
    const rec = JSON.parse(localStorage.getItem('vex.featureUsage'));
    expect(rec.features.brief.n).toBe(1);
    expect(Object.keys(rec.features)).toEqual(['brief']);
  });

  it('takes registrations queued by a module that loaded first', () => {
    vi.resetModules();
    window.__vexUsageQueue = [feature('early').spec];
    const U = fresh('../../src/renderer/js/vex-usage.js').VexUsage;
    expect(U.get('early')).toBeTruthy();
    window.__vexUsageQueue.push(feature('late').spec);
    expect(U.get('late')).toBeTruthy();
  });
});

describe('the 30-day report', () => {
  it('is not ready, and lists nothing as unused, in the first 30 days', () => {
    VexUsage.register(feature('a').spec);
    now += 10 * DAY;
    const r = VexUsage.report();
    expect(r.ready).toBe(false);
    expect(r.daysLeft).toBe(20);
    expect(r.unused).toEqual([]);
    expect(r.fresh.map(x => x.id)).toEqual(['a']);
  });

  it('after 30 days separates used from unused', () => {
    VexUsage.register(feature('used').spec);
    VexUsage.register(feature('idle').spec);
    now += 20 * DAY;
    VexUsage.touch('used');
    now += 11 * DAY;
    const r = VexUsage.report();
    expect(r.ready).toBe(true);
    expect(r.used.map(x => x.id)).toEqual(['used']);
    expect(r.unused.map(x => x.id)).toEqual(['idle']);
  });

  it('a use older than 30 days no longer counts', () => {
    VexUsage.register(feature('old').spec);
    VexUsage.touch('old');
    now += 31 * DAY;
    expect(VexUsage.report().unused.map(x => x.id)).toEqual(['old']);
  });

  it('a feature registered recently is "new", not unused', () => {
    VexUsage.register(feature('a').spec);
    now += 40 * DAY;
    VexUsage.register(feature('b').spec);
    const r = VexUsage.report();
    expect(r.unused.map(x => x.id)).toEqual(['a']);
    expect(r.fresh.map(x => x.id)).toEqual(['b']);
  });

  it('uses what VexFeatures already knows about the feature', () => {
    globalThis.VexFeatures = { get: (k) => ({ id: k }), used: (item) => item.id === 'clock' };
    VexUsage.register(feature('timers', { keys: ['clock'] }).spec);
    now += 31 * DAY;
    const r = VexUsage.report();
    expect(r.used.map(x => x.id)).toEqual(['timers']);
    expect(r.used[0].catalogUsed).toBe(true);
  });

  it('keeps the record on a reload, and a corrupt one starts again, loudly', () => {
    VexUsage.register(feature('a').spec);
    VexUsage.touch('a');
    VexUsage.flush();
    load();
    expect(JSON.parse(localStorage.getItem('vex.featureUsage')).features.a.n).toBe(1);
    localStorage.setItem('vex.featureUsage', '{nope');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    load();
    VexUsage.register(feature('a').spec);
    expect(err).toHaveBeenCalled();
    expect(VexUsage.report().days).toBe(0);
    err.mockRestore();
  });
});

describe('one-click off and on', () => {
  it('disable calls the feature, records it, and enable puts it back', async () => {
    const { f, spec } = feature('a');
    VexUsage.register(spec);
    await VexUsage.disable('a');
    expect(spec.disable).toHaveBeenCalled();
    expect(f.enabled).toBe(false);
    expect(VexUsage.list()[0].status).toBe('off');
    await VexUsage.enable('a');
    expect(f.enabled).toBe(true);
    expect(JSON.parse(localStorage.getItem('vex.featureUsage')).off).toEqual({});
  });

  it('an error from the feature is raised, and nothing is recorded as off', async () => {
    const { spec } = feature('a');
    spec.disable = vi.fn(() => { throw new Error('would not stop'); });
    VexUsage.register(spec);
    await expect(VexUsage.disable('a')).rejects.toThrow('would not stop');
    expect(JSON.parse(localStorage.getItem('vex.featureUsage')).off).toEqual({});
  });

  it('a feature switched off here is told again when it registers after a restart', async () => {
    VexUsage.register(feature('a').spec);
    await VexUsage.disable('a');
    load();
    const again = feature('a');
    VexUsage.register(again.spec);
    await Promise.resolve();
    expect(again.spec.disable).toHaveBeenCalled();
  });
});

describe('Settings sections', () => {
  function settings(...labels) {
    document.body.innerHTML = '<div id="panel-settings"><div class="settings-content">'
      + labels.map(l => `<div class="setting-group"><label class="setting-label">${l}</label></div>`).join('') + '</div></div>';
  }

  it('hides the section of a switched-off feature and shows it again exactly as it was', async () => {
    settings('General', 'Morning brief and digest', 'About');
    VexUsage.register(feature('brief', { group: 'Morning brief' }).spec);
    const groups = () => [...document.querySelectorAll('.setting-group')];
    await VexUsage.disable('brief');
    expect(groups().map(g => g.classList.contains('vex-usage-hidden'))).toEqual([false, true, false]);
    await VexUsage.enable('brief');
    expect(groups().map(g => g.classList.contains('vex-usage-hidden'))).toEqual([false, false, false]);
  });

  it('a module-owned group is injected at runtime before About, once, and rebuilt on enhance', () => {
    settings('General', 'About');
    VexSettingsGroups.register({ id: 'demo', title: 'Demo tool', before: 'about', build: el => { el.append('built'); } });
    VexSettingsGroups.inject();
    const labels = [...document.querySelectorAll('.setting-group .setting-label')].map(l => l.textContent);
    // 'Feature usage' is the group vex-usage-ui.js registers by itself.
    expect(labels).toEqual(['General', 'Feature usage', 'Demo tool', 'About']);
    expect(document.querySelectorAll('#vex-sg-demo')).toHaveLength(1);
  });

  it('patches SettingsUI.enhance so the sections are there when Settings is built', () => {
    settings('General', 'About');
    vi.resetModules();
    const calls = [];
    globalThis.SettingsUI = { enhance() { calls.push(document.querySelectorAll('#vex-sg-demo2').length); } };
    const G = fresh('../../src/renderer/js/vex-settings-groups.js').VexSettingsGroups;
    G._defs.set('demo2', { title: 'Demo 2', keywords: '', before: '', build() {} });
    globalThis.SettingsUI.enhance();
    expect(calls).toEqual([1]);
    delete globalThis.SettingsUI;
  });

  it('the dashboard says "too early" first, then offers Hide for unused features', async () => {
    VexUsage.register(feature('idle').spec);
    VexUsageUI.open();
    let dlg = document.getElementById('vex-usage-dialog');
    expect(dlg.textContent).toMatch(/30 more days|of 30 days/);
    expect(dlg.textContent).not.toContain('Not used in 30 days');
    dlg.remove();
    now += 31 * DAY;
    VexUsageUI.open();
    dlg = document.getElementById('vex-usage-dialog');
    expect(dlg.textContent).toContain('Not used in 30 days (1)');
    dlg.querySelector('[data-feature="idle"] button').click();
    await vi.waitFor(() => expect(VexUsage.list()[0].status).toBe('off'));
    await vi.waitFor(() => expect(document.getElementById('vex-usage-dialog').textContent).toContain('Switched off (1)'));
  });

  it('says so when nothing has registered, instead of an empty list', () => {
    VexUsageUI.open();
    expect(document.getElementById('vex-usage-dialog').textContent).toContain('No feature has registered');
  });
});
