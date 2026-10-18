// Catalogue entries must point at the real way to use a feature, not only at a generic Settings page, and an entry
// that says "there is no command" must not have one. Release radar is the case that started this: it has a full
// "What is new for you" dialog with Check now, but its Library card only offered a link to "Workflow and chains".
import { describe, it, expect, beforeEach } from 'vitest';

const fs = require('fs');
const path = require('path');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');
const { commandIds } = require('./_catalogTargets.js');

const JS = path.resolve(__dirname, '../../src/renderer/js');
// A command counts as live when a module has registered it; here every command id found in the sources is.
beforeEach(() => { globalThis.CommandBar = { commands: [...commandIds].map(id => ({ id, label: id, action() {} })) }; });
const src = (f) => fs.readFileSync(path.join(JS, f), 'utf8');

describe('Release radar', () => {
  const f = VexFeatures.get('workflow-release-radar');
  it('has a button that opens its screen, and its Settings section', () => {
    expect(f.cmd).toBe('release-radar');
    expect(f.openLabel).toMatch(/new for me/i);
    expect(VexFeatures.actions(f).map(a => a.act)).toEqual(expect.arrayContaining(['command', 'settings']));
  });
  it('the command is real: it opens the dialog that has Check now, Open release and Mark seen', () => {
    const radar = src('patch-radar.js');
    expect(radar).toMatch(/id: 'release-radar', label: 'What is new for me'/);
    for (const control of ['Check now', 'Open release', 'Mark seen']) expect(radar, control).toContain(control);
    expect(radar).toMatch(/async open\(\)/);
  });
  it('its "off" message names the real section', () => {
    expect(src('patch-radar.js')).toContain('Settings › Workflow and chains');
  });
});

describe('entries that gained a real way in', () => {
  const wired = {
    'workflow-weekly-note': { cmd: 'weekly-note' },
    'tab-cleanup': { cmd: 'tab-cleanup' },
    'meeting-prep': { cmd: 'meeting-prep' },
    'attention-inbox': { cmd: 'attention-inbox' },
    'page-actions': { cmd: 'pageaction:new' },
    'site-audio-memory': { cmd: 'siteplay:level' },
    'smart-bookmarks': { cmd: 'living-bookmarks' },
    screenshare: { cmd: 'checkscreenshare' },
    'keep-awake': { cmd: 'keep-awake' },
    'library-data': { panel: 'library' },
    'feature-registry': { section: 'vex-sg-feature-usage' },
    fortune: { section: 'settings-expression' },
    citations: { section: 'settings-citations' },
    'tab-auto-group': { section: 'setting-smart-tab-grouping' },
    'gesture-editor': { section: 'setting-gesture-editor' },
    'panel-guard': { section: 'setting-panel-guard' },
    'net-courtesy': { section: 'setting-net-courtesy' },
  };
  it.each(Object.entries(wired))('%s', (id, want) => {
    const f = VexFeatures.get(id);
    expect(f, id).toBeTruthy();
    if (want.cmd) { expect(f.cmd).toBe(want.cmd); expect(commandIds.has(want.cmd), want.cmd + ' is registered by a module').toBe(true); }
    if (want.panel) expect(f.panel).toBe(want.panel);
    if (want.section) expect(f.setting.section).toBe(want.section);
    expect(VexFeatures.actions(f).length, id + ' has a button').toBeGreaterThan(0);
  });
});

describe('invariants', () => {
  it('the AI agent is only told "there is no command to run" for an entry that has neither a command nor a panel', () => {
    const tools = src('agent-tools.js');
    expect(tools).toMatch(/f\.manual && !f\.cmd && !f\.panel \? \{ note: 'Done by hand/);
    // Twenty-odd entries are both "by hand" (a gesture, a typed phrase) and have a command; the agent must be given the command.
    const both = VexFeatures.ITEMS.filter(f => f.manual && f.cmd);
    expect(both.length).toBeGreaterThan(10);
  });
  it('the two new Settings anchors exist in the code that draws them', () => {
    expect(fs.readFileSync(path.resolve(JS, '../index.html'), 'utf8')).toContain('id="setting-smart-tab-grouping"');
    expect(src('citation-tracker.js')).toContain("g.id = 'settings-citations'");
  });
});
