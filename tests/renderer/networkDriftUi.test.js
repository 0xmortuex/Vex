// @vitest-environment jsdom
//
// The renderer half of the proxy and root-certificate look (js/network-drift.js): the sentences, the Ctrl+K command and the Settings
// section. The bridge to main is a stand-in; nothing is run.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { VexNetworkDrift } = require('../../src/renderer/js/network-drift.js');

let api, registered;
const flush = () => new Promise(r => setTimeout(r, 0));
beforeEach(() => {
  api = {
    get: vi.fn(async () => ({ ok: true, supported: true, enabled: false, hadBaseline: false })),
    set: vi.fn(async (on) => ({ ok: true, enabled: on })),
    check: vi.fn(async () => ({ ok: true, baseline: false, proxy: 'same', added: 0, count: 2 })),
  };
  window.vex = { netDrift: api };
  window.showToast = vi.fn();
  registered = null;
  window.VexSettingsGroups = { register: (def) => { registered = def; }, note: (t) => { const d = document.createElement('div'); d.textContent = t; return d; } };
  VexNetworkDrift._registered = false;
});

describe('summary', () => {
  it('says first look, changed, or nothing changed', () => {
    expect(VexNetworkDrift.summary({ baseline: true })).toMatch(/^First look done/);
    expect(VexNetworkDrift.summary({ baseline: false, proxy: 'appeared', added: 0 })).toMatch(/^Something changed/);
    expect(VexNetworkDrift.summary({ baseline: false, proxy: 'same', added: 2 })).toMatch(/^Something changed/);
    expect(VexNetworkDrift.summary({ baseline: false, proxy: 'removed', added: 0 })).toBe('Nothing changed since the last look.');
    expect(() => VexNetworkDrift.summary(null)).toThrow();
  });
});

describe('Ctrl+K command', () => {
  it('looks once and says the result', async () => {
    await VexNetworkDrift.runCommand();
    expect(api.check).toHaveBeenCalledTimes(1);
    expect(window.showToast).toHaveBeenLastCalledWith('Nothing changed since the last look.');
  });
  it('does nothing but say so off Windows', async () => {
    api.get.mockResolvedValue({ ok: true, supported: false, enabled: false });
    await VexNetworkDrift.runCommand();
    expect(api.check).not.toHaveBeenCalled();
    expect(window.showToast).toHaveBeenCalledWith('This check is for Windows only');
  });
  it('a failed look is an error the person sees, not a quiet "nothing changed"', async () => {
    api.check.mockResolvedValue({ ok: false, error: 'timed out' });
    await expect(VexNetworkDrift.runCommand()).rejects.toThrow('timed out');
  });
});

describe('Settings section', () => {
  it('is registered once, titled so Settings files it under security, and starts off', async () => {
    VexNetworkDrift.registerSettings();
    VexNetworkDrift.registerSettings();
    expect(registered.id).toBe('network-drift');
    expect(registered.title).toMatch(/^Security: /);
    const body = document.createElement('div');
    registered.render(body);
    await flush();
    const cb = body.querySelector('input[type=checkbox]');
    expect(cb.checked).toBe(false);
    expect(body.textContent).toMatch(/Off until you switch it on/);
    expect(body.textContent).toMatch(/cannot tell which/);
    expect(body.querySelector('button').textContent).toBe('Check now');
  });
  it('the switch goes through main, and goes back when main refuses', async () => {
    VexNetworkDrift.registerSettings();
    const body = document.createElement('div');
    registered.render(body);
    await flush();
    const cb = body.querySelector('input[type=checkbox]');
    cb.checked = true; cb.dispatchEvent(new Event('change'));
    await flush();
    expect(api.set).toHaveBeenCalledWith(true);
    expect(cb.checked).toBe(true);
    api.set.mockResolvedValue({ ok: false, error: 'nope' });
    cb.checked = false; cb.dispatchEvent(new Event('change'));
    await flush();
    expect(cb.checked).toBe(true);
    expect(window.showToast).toHaveBeenCalledWith('nope', 'error');
  });
  it('Check now looks and shows what it found', async () => {
    VexNetworkDrift.registerSettings();
    const body = document.createElement('div');
    registered.render(body);
    await flush();
    body.querySelector('button').click();
    await flush(); await flush();
    expect(api.check).toHaveBeenCalledTimes(1);
    expect(body.querySelector('[role=status]').textContent).toBe('Nothing changed since the last look.');
  });
});

describe('wiring', () => {
  const root = path.join(__dirname, '..', '..', 'src', 'renderer');
  it('is loaded late (no index.html tag) and has its Ctrl+K command', () => {
    expect(fs.readFileSync(path.join(root, 'js', 'lazy-boot.js'), 'utf8')).toMatch(/js\/network-drift\.js/);
    expect(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).not.toMatch(/network-drift/);
    expect(fs.readFileSync(path.join(root, 'js', 'command.js'), 'utf8')).toMatch(/id: 'network-drift', label: 'Look For Proxy And Certificate Changes'/);
  });
});
