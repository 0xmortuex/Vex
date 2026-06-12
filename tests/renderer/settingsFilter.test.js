// @vitest-environment jsdom
//
// Coverage for the settings search filter (SettingsUI._filter): it shows only
// matching .setting-group blocks, hides the chip nav while searching, and shows
// an empty-state when nothing matches.

import { describe, it, expect, beforeEach } from 'vitest';

const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');

function buildRoot() {
  const root = document.createElement('div');
  root.className = 'settings-content';
  root.innerHTML = `
    <div class="set-nav"></div>
    <div class="setting-group"><label class="setting-label">Privacy Hardening</label> fingerprint DoH</div>
    <div class="setting-group"><label class="setting-label">AI Memory</label> remember facts</div>
    <div class="setting-group"><label class="setting-label">Sessions</label> auto-save</div>`;
  return root;
}

describe('SettingsUI._filter', () => {
  let root;
  beforeEach(() => { root = buildRoot(); });

  it('shows only groups matching the query and hides the chip nav', () => {
    SettingsUI._filter(root, 'fingerprint');
    const groups = root.querySelectorAll('.setting-group');
    expect(groups[0].style.display).toBe('');       // Privacy matches
    expect(groups[1].style.display).toBe('none');    // AI Memory hidden
    expect(groups[2].style.display).toBe('none');    // Sessions hidden
    expect(root.querySelector('.set-nav').style.display).toBe('none');
  });

  it('restores everything and the nav when the query is cleared', () => {
    SettingsUI._filter(root, 'fingerprint');
    SettingsUI._filter(root, '');
    root.querySelectorAll('.setting-group').forEach(g => expect(g.style.display).toBe(''));
    expect(root.querySelector('.set-nav').style.display).toBe('');
  });

  it('shows an empty-state when nothing matches', () => {
    SettingsUI._filter(root, 'zzznotathing');
    const empty = root.querySelector('.set-empty');
    expect(empty).toBeTruthy();
    expect(empty.style.display).not.toBe('none');
    expect(empty.textContent).toContain('zzznotathing');
  });

  it('matches case-insensitively against the group label', () => {
    SettingsUI._filter(root, 'MEMORY');
    const groups = root.querySelectorAll('.setting-group');
    expect(groups[1].style.display).toBe(''); // AI Memory matches
  });
});
