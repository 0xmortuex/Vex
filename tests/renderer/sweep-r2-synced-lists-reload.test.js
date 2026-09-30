// @vitest-environment jsdom
//
// Tools and personas held their list in memory and never read it again after
// a sync merged it in storage, so the next local change saved the old copy
// back over the merge (found 2026-09-30).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { PersonasManager } = require('../../src/renderer/js/personas-manager.js');
const { BUILT_IN_PERSONAS } = require('../../src/renderer/js/personas-builtin.js');
const VexTools = require('../../src/renderer/js/tools.js');

const applied = () => window.dispatchEvent(new Event('vex-sync-data-applied'));

beforeEach(() => { localStorage.clear(); });

describe('after a sync', () => {
  it('personas show what sync merged, and a later change keeps it', () => {
    globalThis.window.BUILT_IN_PERSONAS = BUILT_IN_PERSONAS;
    PersonasManager.init();
    localStorage.setItem('vex.personas', JSON.stringify([{ id: 'p_other', name: 'From the other device', systemPrompt: 'x', temperature: 0.5 }]));
    applied();
    expect(PersonasManager.getAll().some(p => p.id === 'p_other')).toBe(true);
    PersonasManager.create({ name: 'Mine', systemPrompt: 'y' });
    const saved = JSON.parse(localStorage.getItem('vex.personas'));
    expect(saved.map(p => p.name)).toEqual(expect.arrayContaining(['From the other device', 'Mine']));
  });

  it('tools show what sync merged', async () => {
    document.body.innerHTML = '<div id="tools-bar"></div>';
    VexTools.applySidebarConfig = vi.fn(async () => {});
    VexTools.renderToolsBar = vi.fn();
    await VexTools.init();
    localStorage.setItem('vex.tools', JSON.stringify([{ id: 't_other', name: 'Other', url: 'https://example.com/' }]));
    applied();
    expect(VexTools.tools.map(t => t.id)).toEqual(['t_other']);
    expect(VexTools.renderToolsBar).toHaveBeenCalled();
  });
});
