// @vitest-environment jsdom
//
// T3-038: "What I changed" (js/settings-changes.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let VexChanges, change;

function settingsPage() {
  document.body.innerHTML = `
    <div id="panel-settings"><div class="settings-content">
      <div class="setting-group" id="g1"><label class="setting-label">Privacy</label>
        <div class="setting-toggle-row"><span>Block ads</span><input type="checkbox" id="s-ads" checked></div>
        <div class="setting-toggle-row"><span>Mouse gestures</span><input type="checkbox" id="s-gest"></div>
        <div class="setting-toggle-row"><span>No id here</span><input type="checkbox" checked></div>
      </div>
      <div class="setting-group" id="g2"><label class="setting-label">General</label>
        <div class="setting-row"><label for="s-engine">Search engine</label>
          <select id="s-engine"><option value="google" selected>Google</option><option value="ddg">DuckDuckGo</option></select></div>
      </div>
      <div id="vex-sg-park-resume" class="setting-group"><label class="setting-label">Park</label>
        <div class="setting-toggle-row"><span>Made by script</span><input type="checkbox" id="s-script"></div>
      </div>
    </div></div>`;
  // Every control is wired the way Settings wires it: a change event.
  document.getElementById('panel-settings').addEventListener('change', (e) => change(e.target.id, e.target.type === 'checkbox' ? e.target.checked : e.target.value));
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  change = vi.fn();
  window.showToast = vi.fn();
  settingsPage();
  ({ VexSettingsControl: globalThis.VexSettingsControl } = fresh(JS + 'settings-control.js'));
  ({ VexChanges } = fresh(JS + 'settings-changes.js'));
  delete globalThis.VexUsage; delete globalThis.VexRegistry; delete globalThis.VexMinimalMode;
});

describe('controls', () => {
  it('lists nothing while every control is at the way the page builds it', () => {
    expect(VexChanges.controls()).toEqual([]);
  });

  it('lists a switch and a dropdown that were moved, with both values in words', () => {
    document.getElementById('s-ads').checked = false;
    document.getElementById('s-engine').value = 'ddg';
    const rows = VexChanges.controls();
    expect(rows.map(r => r.id).sort()).toEqual(['s-ads', 's-engine']);
    const ads = rows.find(r => r.id === 's-ads');
    expect(ads).toMatchObject({ label: 'Block ads', section: 'Privacy', nowText: 'Off', defText: 'On' });
    expect(rows.find(r => r.id === 's-engine')).toMatchObject({ nowText: 'DuckDuckGo', defText: 'Google', section: 'General' });
  });

  it('leaves out a control with no id and one a module draws at run time', () => {
    document.querySelectorAll('input:not([id])').forEach(e => { e.checked = false; });
    document.getElementById('s-script').checked = true;
    expect(VexChanges.controls()).toEqual([]);
  });
});

describe('revert', () => {
  it('puts one control back through its own change event', async () => {
    document.getElementById('s-ads').checked = false;
    expect(await VexChanges.revertControl('s-ads')).toBe(true);
    expect(document.getElementById('s-ads').checked).toBe(true);
    expect(change).toHaveBeenCalledWith('s-ads', true);
    expect(await VexChanges.revertControl('s-ads')).toBe(false);
  });

  it('puts a dropdown back to its first-listed default', async () => {
    document.getElementById('s-engine').value = 'ddg';
    await VexChanges.revertControl('s-engine');
    expect(document.getElementById('s-engine').value).toBe('google');
    expect(change).toHaveBeenCalledWith('s-engine', 'google');
  });

  it('says so when a setting is no longer there', async () => {
    await expect(VexChanges.revertControl('nope')).rejects.toThrow(/no longer there/);
  });

  it('reverts everything, and reports a failure instead of hiding it', async () => {
    document.getElementById('s-ads').checked = false;
    document.getElementById('s-gest').checked = true;
    document.getElementById('s-engine').value = 'ddg';
    expect(await VexChanges.revertAll()).toBe(3);
    expect(VexChanges.controls()).toEqual([]);
  });
});

describe('features', () => {
  function registry(defs) {
    const state = new Map(defs.map(d => [d.id, d.on]));
    globalThis.VexRegistry = {
      has: (id) => defs.some(d => d.id === id),
      get: (id) => defs.find(d => d.id === id),
      tierDefault: (id) => defs.find(d => d.id === id).std,
    };
    globalThis.VexUsage = {
      features: () => defs.map(d => ({ id: d.id, title: d.title })),
      isEnabled: (id) => state.get(id),
      get: (id) => ({ enable: async () => state.set(id, true), disable: async () => state.set(id, false) }),
    };
    return state;
  }

  it('lists a stable feature you switched off and one the standard tier leaves off that you switched on', () => {
    registry([
      { id: 'a', title: 'A', group: 'G', maturity: 'stable', killSwitch: 'usage', std: true, on: false },
      { id: 'b', title: 'B', group: 'G', maturity: 'stable', killSwitch: 'usage', std: false, on: true },
      { id: 'c', title: 'C', group: 'G', maturity: 'stable', killSwitch: 'usage', std: true, on: true },
    ]);
    expect(VexChanges.features().map(f => f.id)).toEqual(['a', 'b']);
  });

  it('does not count a new feature that arrived off, nor a feature with no switch, nor anything in Minimal Vex', () => {
    registry([
      { id: 'n', title: 'N', group: 'G', maturity: 'new', killSwitch: 'usage', std: true, on: false },
      { id: 'k', title: 'K', group: 'G', maturity: 'stable', killSwitch: 'none', std: true, on: false },
    ]);
    expect(VexChanges.features()).toEqual([]);
    registry([{ id: 'a', title: 'A', group: 'G', maturity: 'stable', killSwitch: 'usage', std: true, on: false }]);
    globalThis.VexMinimalMode = { isOn: () => true };
    expect(VexChanges.features()).toEqual([]);
  });

  it('reverts a feature to the standard default', async () => {
    const state = registry([{ id: 'a', title: 'A', group: 'G', maturity: 'stable', killSwitch: 'usage', std: true, on: false }]);
    await VexChanges.revertFeature('a');
    expect(state.get('a')).toBe(true);
  });
});
