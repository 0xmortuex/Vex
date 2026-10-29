// @vitest-environment jsdom
//
// An on/off switch for every feature (js/feature-switches.js), 2026-10-29: a searchable Settings > Features list, and a switch at the top of each
// feature's own Settings section. Both use VexUsage.enable()/disable(), the switch that already existed for 288 features.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let VexUsage, VexSettingsGroups, VexFeatureSwitches, VexRegistry, toasts;

function load() {
  vi.resetModules();
  delete window.__vexUsageQueue;
  VexUsage = fresh('../../src/renderer/js/vex-usage.js').VexUsage;
  globalThis.VexUsage = VexUsage;
  VexSettingsGroups = fresh('../../src/renderer/js/vex-settings-groups.js').VexSettingsGroups;
  globalThis.VexSettingsGroups = VexSettingsGroups;
  VexRegistry = fresh('../../src/renderer/js/feature-registry.js').VexRegistry;
  globalThis.VexRegistry = VexRegistry;
  toasts = [];
  window.showToast = vi.fn((message, type, ms, opts) => { toasts.push({ message, type, opts }); });
  VexFeatureSwitches = fresh('../../src/renderer/js/feature-switches.js').VexFeatureSwitches;
}
// a feature with a manifest and a real on/off
function feature(id, title, group, { switchable = true, fail = false } = {}) {
  VexRegistry.define({ id, title, group, storageKeys: [], killSwitch: switchable ? 'usage' : 'none' });
  const f = { on: true };
  if (switchable) {
    VexUsage.register({ id, title, group, isEnabled: () => f.on,
      disable: vi.fn(() => { if (fail) throw new Error('would not stop'); f.on = false; }), enable: vi.fn(() => { f.on = true; }) });
  }
  return f;
}
// a Settings section the way modules draw one: .setting-group with a .setting-label heading
function section(heading) {
  const root = document.createElement('div');
  root.className = 'settings-content';
  const g = document.createElement('div');
  g.className = 'setting-group';
  const label = document.createElement('div');
  label.className = 'setting-label';
  label.textContent = heading;
  const body = document.createElement('p');
  body.textContent = 'the section\'s own settings';
  g.append(label, body);
  root.appendChild(g);
  const panel = document.createElement('div');   // where VexUsage looks when it is not told the scope
  panel.id = 'panel-settings';
  panel.appendChild(root);
  document.body.appendChild(panel);
  return { root, g };
}
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; load(); });

describe('the rows', () => {
  it('lists every manifest with whether it can be switched, and what a switch says', () => {
    feature('gesture-editor', 'Mouse gesture editor', 'Mouse gestures');
    feature('preference-store', 'Preference store', 'Preference store', { switchable: false });
    const rows = VexFeatureSwitches.rows();
    expect(rows.map(r => [r.id, r.switchable, r.on])).toEqual([['gesture-editor', true, true], ['preference-store', false, true]]);
    VexUsage.disable('gesture-editor');
    expect(VexFeatureSwitches.rows().find(r => r.id === 'gesture-editor').on).toBe(false);
  });
});

describe('Settings > Features', () => {
  it('shows a switch for a switchable feature and "Always on" for plumbing, and counts them', () => {
    feature('gesture-editor', 'Mouse gesture editor', 'Mouse gestures');
    feature('preference-store', 'Preference store', 'Preference store', { switchable: false });
    VexFeatureSwitches.open();
    const dlg = document.getElementById('vex-features-dialog');
    expect(dlg.querySelector('[data-feature="gesture-editor"] input[type=checkbox]').checked).toBe(true);
    expect(dlg.querySelector('[data-feature="preference-store"] input')).toBeNull();
    expect(dlg.querySelector('[data-feature="preference-store"]').textContent).toContain('Always on');
    expect(dlg.textContent).toContain('1 of 1 switchable features are on. 1 cannot be switched off.');
  });
  it('turning a switch off switches the feature off for real, and the count follows', async () => {
    const f = feature('gesture-editor', 'Mouse gesture editor', 'Mouse gestures');
    VexFeatureSwitches.open();
    const box = document.querySelector('#vex-features-dialog [data-feature="gesture-editor"] input');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await flush(); await flush();
    expect(f.on).toBe(false);
    expect(VexUsage.isEnabled('gesture-editor')).toBe(false);
    expect(document.getElementById('vex-features-dialog').textContent).toContain('0 of 1 switchable features are on');
    // and back on
    const again = document.querySelector('#vex-features-dialog [data-feature="gesture-editor"] input');
    again.checked = true;
    again.dispatchEvent(new Event('change'));
    await flush(); await flush();
    expect(f.on).toBe(true);
  });
  it('the search narrows the list by name or group', () => {
    feature('gesture-editor', 'Mouse gesture editor', 'Mouse gestures');
    feature('ui-sounds', 'Interface sounds', 'Sounds');
    VexFeatureSwitches.open();
    const search = document.querySelector('.vex-features-search');
    search.value = 'sound';
    search.dispatchEvent(new Event('input'));
    const ids = [...document.querySelectorAll('#vex-features-dialog [data-feature]')].map(r => r.dataset.feature);
    expect(ids).toEqual(['ui-sounds']);
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    expect(document.getElementById('vex-features-dialog').textContent).toContain('No feature matches that.');
  });
  it('a switch that fails goes back and says so, and the feature stays on', async () => {
    const f = feature('gesture-editor', 'Mouse gesture editor', 'Mouse gestures', { fail: true });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    VexFeatureSwitches.open();
    const box = document.querySelector('#vex-features-dialog [data-feature="gesture-editor"] input');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await flush(); await flush();
    expect(f.on).toBe(true);
    expect(document.querySelector('#vex-features-dialog [data-feature="gesture-editor"] input').checked).toBe(true);
    expect(toasts.some(t => t.type === 'error' && /would not stop/.test(t.message))).toBe(true);
    err.mockRestore();
  });
});

describe('a switch at the top of the feature\'s own section', () => {
  it('is added by the section matching, after the heading, one per feature of the section', () => {
    feature('gesture-editor', 'Mouse gesture editor', 'Mouse gestures');
    const { root, g } = section('Mouse gestures');
    VexUsage.applyGroups(root);
    const row = g.querySelector('.vex-feature-switch[data-feature="gesture-editor"]');
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('Use Mouse gesture editor');
    expect(g.children[1]).toBe(row);   // right after the heading
    expect(row.querySelector('input').checked).toBe(true);
    VexUsage.applyGroups(root);          // again: not added twice
    expect(g.querySelectorAll('.vex-feature-switch').length).toBe(1);
  });
  it('a section no feature owns gets none; a section shared by two features gets two', () => {
    feature('a', 'Alpha', 'Shared section');
    feature('b', 'Beta', 'Shared section');
    const shared = section('Shared section');
    const other = section('Something else');
    VexUsage.applyGroups(shared.root);
    VexUsage.applyGroups(other.root);
    expect(shared.g.querySelectorAll('.vex-feature-switch').length).toBe(2);
    expect(other.g.querySelectorAll('.vex-feature-switch').length).toBe(0);
  });
  it('turning it off switches the feature off, hides the section, and the toast offers Undo', async () => {
    const f = feature('gesture-editor', 'Mouse gesture editor', 'Mouse gestures');
    const { root, g } = section('Mouse gestures');
    VexUsage.applyGroups(root);
    const box = g.querySelector('.vex-feature-switch input');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await flush(); await flush();
    expect(f.on).toBe(false);
    expect(g.classList.contains('vex-usage-hidden')).toBe(true);
    const t = toasts.find(x => /is off\. Turn it back on in Settings > Feature switches/.test(x.message));
    expect(t).toBeTruthy();
    expect(t.message).toContain('Mouse gesture editor');
    t.opts.action.run();
    await flush(); await flush();
    expect(f.on).toBe(true);
    expect(g.classList.contains('vex-usage-hidden')).toBe(false);
    expect(g.querySelector('.vex-feature-switch input').checked).toBe(true);
  });
  it('the boxes follow the truth when something else switched the feature', async () => {
    feature('gesture-editor', 'Mouse gesture editor', 'Mouse gestures');
    const { root, g } = section('Mouse gestures');
    VexUsage.applyGroups(root);
    await VexUsage.disable('gesture-editor');
    expect(g.querySelector('.vex-feature-switch input').checked).toBe(false);
    await VexUsage.enable('gesture-editor');
    expect(g.querySelector('.vex-feature-switch input').checked).toBe(true);
  });
});

describe('wiring', () => {
  it('the usage registry calls the section hooks, and the Features section is registered', () => {
    const seen = [];
    VexUsage.onGroups((scope) => seen.push(scope));
    const { root } = section('Anything');
    VexUsage.applyGroups(root);
    expect(seen).toEqual([root]);
    expect(VexSettingsGroups.ids()).toContain('features');
  });
  it('is loaded, linted and has Turkish strings', () => {
    const fs = require('fs'), path = require('path');
    const read = (f) => fs.readFileSync(path.join(__dirname, '../../' + f), 'utf8');
    expect(read('src/renderer/js/lazy-boot.js')).toContain("src: 'js/feature-switches.js'");
    expect(read('package.json')).toContain('src/renderer/js/feature-switches.js');
    const i18n = read('src/renderer/js/i18n.js');
    for (const k of ['featTitle', 'featSub', 'featSearch', 'featSummary', 'featAlwaysOn', 'featNone', 'featOpen', 'featGroupNote', 'featSectionSwitch', 'featOffDone', 'featUndo', 'featSwitchFail']) {
      expect(i18n.match(new RegExp('\\b' + k + ':', 'g')).length).toBe(2);   // English and Turkish
    }
  });
});
