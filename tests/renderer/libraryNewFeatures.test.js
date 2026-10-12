// The Library lists what Vex can do. Found 2026-10-12 by using it: the 2FA
// "Fill code from authenticator", "Save a password for this site", "Generate a
// strong password" and a panel's "page as a tab" were in Ctrl+K and the menus
// but not in "Everything Vex can do", and the Passkeys entry had no button to
// open Settings > Passkeys.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '../../src/renderer/', p), 'utf8');
const html = read('index.html');
const commandSrc = read('js/command.js');
const panelToTab = read('js/panel-to-tab.js');

describe('the Library knows the newer login and panel helpers', () => {
  it('lists the three login helpers with a command that exists', () => {
    for (const [id, cmd] of [['filltotp', 'filltotp'], ['savepassword', 'savepassword'], ['genpassword', 'genpassword']]) {
      const f = VexFeatures.get(id);
      expect(f, id).toBeTruthy();
      expect(f.cmd).toBe(cmd);
      expect(commandSrc).toContain("id: '" + cmd + "'");
    }
  });

  it('lists a panel\'s page as a tab, with the command it describes', () => {
    const f = VexFeatures.get('panel-page-tab');
    expect(f).toBeTruthy();
    expect(panelToTab).toContain("id: 'panel-page-tab'");
  });

  it('gives Passkeys a button that opens its Settings section, which is in the page', () => {
    const f = VexFeatures.get('passkeys');
    const open = VexFeatures.actions(f).find(a => a.act === 'settings');
    expect(open).toBeTruthy();
    expect(f.setting.section).toBe('settings-passkeys');
    expect(html).toContain('id="settings-passkeys"');
  });
});
