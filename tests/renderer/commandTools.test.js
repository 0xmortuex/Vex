// @vitest-environment jsdom
//
// Toolbox tools in the command bar (Ctrl+K). With hundreds of tools, typing
// "bmi" or "subnet" should open the tool itself rather than sending you to the
// Toolbox window to hunt for it.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
globalThis.ToolboxPacks = ToolboxPacks;
const { Toolbox } = require('../../src/renderer/js/toolbox.js');
globalThis.Toolbox = Toolbox;
const { CommandBar } = require('../../src/renderer/js/command.js');
window.escapeHtml = (s) => String(s);

const spec = (id, name, family, desc, keywords) => ({
  id, name, family, desc, icon: '★', keywords,
  fields: [], run: () => 'ok', examples: [{ in: {}, out: 'ok' }],
});

beforeEach(() => {
  ToolboxPacks.specs = [];
  ToolboxPacks.add([
    spec('health-bmi', 'BMI calculator', 'health', 'Body mass index from height and weight', ['body mass']),
    spec('web-subnet', 'Subnet calculator', 'web', 'Network, broadcast and host range for a CIDR block'),
    spec('fin-loan', 'Loan & mortgage payment', 'finance', 'Monthly payment for a fixed-rate loan'),
  ]);
  vi.spyOn(Toolbox, 'openTool').mockImplementation(() => {});
});

describe('CommandBar tool results', () => {
  it('finds a tool by name, and says where it comes from', () => {
    const hits = CommandBar._toolResults('bmi');
    expect(hits.map(h => h.id)).toContain('tool:health-bmi');
    const bmi = hits.find(h => h.id === 'tool:health-bmi');
    expect(bmi.label).toBe('BMI calculator');
    expect(bmi.hint).toBe('Toolbox · Health');
  });

  it('opens the tool when chosen', () => {
    CommandBar._toolResults('subnet').find(h => h.id === 'tool:web-subnet').action();
    expect(Toolbox.openTool).toHaveBeenCalledWith('web-subnet');
  });

  it('also matches the description and keywords', () => {
    expect(CommandBar._toolResults('cidr').map(h => h.id)).toEqual(['tool:web-subnet']);
    expect(CommandBar._toolResults('body mass').map(h => h.id)).toEqual(['tool:health-bmi']);
  });

  it('ranks a name match above a description match, and caps the list', () => {
    const hits = CommandBar._toolResults('loan');
    expect(hits[0].id).toBe('tool:fin-loan');
    ToolboxPacks.specs = [];
    ToolboxPacks.add(Array.from({ length: 20 }, (_, i) => spec(`t-${i}`, `Thing ${i}`, 'general', 'A thing')));
    expect(CommandBar._toolResults('thing')).toHaveLength(6);
  });

  it('offers nothing for an unrelated query', () => {
    expect(CommandBar._toolResults('zzzz')).toEqual([]);
  });

  it('a tool that refuses to open reports it instead of throwing', () => {
    Toolbox.openTool.mockImplementation(() => { throw new Error('Toolbox has no tool "gone"'); });
    window.showToast = vi.fn();
    CommandBar._toolResults('bmi')[0].action();
    expect(window.showToast).toHaveBeenCalledWith('Toolbox has no tool "gone"', 'error');
  });
});
