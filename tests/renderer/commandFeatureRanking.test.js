// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { CommandBar } = require('../../src/renderer/js/command.js');
const { VexFeatures } = require('../../src/renderer/js/feature-catalog.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="command-bar"><div id="command-results"></div></div>';
  window.escapeHtml = s => String(s);
  globalThis.CommandBar = CommandBar;
  globalThis.VexFeatures = VexFeatures;
  globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons;
  CommandBar._providerStats = {};
});

describe('feature names in Ctrl+K', () => {
  it('puts Vex Pet before web search and Snippets, even with frequent Snippets use', () => {
    localStorage.setItem('vex.commandUsage', JSON.stringify({ snippets: { n: 100, at: Date.now() } }));
    CommandBar.search('pet');
    const ids = CommandBar.results.map(r => r.id);
    expect(ids[0]).toBe('feature:fun-pet');
    expect(ids.indexOf('feature:fun-pet')).toBeLessThan(ids.indexOf('search'));
  });
  it('sorts catalogue hits before truncation, so a direct name match cannot get buried', () => {
    const original = VexFeatures.search;
    vi.spyOn(VexFeatures, 'search').mockImplementation(q => [...Array.from({ length: 8 }, (_, i) => ({ id: 'other' + i, name: 'Other', what: 'pet' })), ...original.call(VexFeatures, q)]);
    expect(CommandBar._featureResults('pet', [])[0].id).toBe('feature:fun-pet');
    vi.restoreAllMocks();
  });
  it('links the pet to its actual settings group without silently enabling it', () => {
    const feature = VexFeatures.get('fun-pet');
    expect(feature.setting.section).toBe('setting-fun-progress');
    expect(VexFeatures.actions(feature)).toContainEqual({ act: 'settings', label: 'Open settings' });
    expect(localStorage.getItem('vex.fun')).toBeNull();
  });
  it('finds a short feature keyword such as XP ahead of web search', () => {
    CommandBar.search('xp');
    const ids = CommandBar.results.map(r => r.id);
    expect(ids).toContain('feature:fun-levels');
    expect(ids.indexOf('feature:fun-levels')).toBeLessThan(ids.indexOf('search'));
  });
  it('does not duplicate a feature whose command is already represented', () => {
    expect(CommandBar._featureResults('pdf', [{ id: 'pdf' }]).some(r => r.id === 'feature:pdf')).toBe(false);
  });
  it('still offers a web search when no feature matches', () => {
    CommandBar.search('zzzznonexistent');
    expect(CommandBar.results.some(r => r.id === 'search')).toBe(true);
    expect(CommandBar.results.some(r => r.id.startsWith('feature:'))).toBe(false);
  });
});
