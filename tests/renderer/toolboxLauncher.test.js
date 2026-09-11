// @vitest-environment jsdom
//
// The Toolbox launcher and the shared screen for declarative tools: every
// tool is findable by search, a pack tool opens in the shared runner with a
// live result, and the user's own links live in the Toolbox by default (the
// rail keeps one Toolbox button) unless they choose the sidebar.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
globalThis.ToolboxPacks = ToolboxPacks;
const { Toolbox } = require('../../src/renderer/js/toolbox.js');
globalThis.Toolbox = Toolbox;
const VexTools = require('../../src/renderer/js/tools.js');
globalThis.VexTools = VexTools;
window.escapeHtml = (s) => String(s);

const SPEC = {
  id: 'test-double', name: 'Doubler', icon: '×2', family: 'math', desc: 'Doubles a number',
  keywords: ['twice'],
  fields: [{ id: 'n', label: 'Number', type: 'number', value: 4 }],
  run: (v) => { if (Number.isNaN(v.n)) throw new Error('Enter a number'); return String(v.n * 2); },
  examples: [{ in: { n: 4 }, out: '8' }],
};

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="tools-bar"></div>';
  ToolboxPacks.specs = [];
  ToolboxPacks.add([SPEC]);
  VexTools.tools = [{ id: 'tool_1', name: 'My CRM', url: 'https://crm.example.com', desc: 'Customer list' }];
});

describe('Toolbox search', () => {
  it('finds hand-built and pack tools by name, description, keyword or family', () => {
    expect(Toolbox.get('test-double')).toBe(SPEC);
    expect(Toolbox.get('regex').name).toBe('Regex Tester');
    expect(Toolbox._matches(SPEC, 'doub')).toBe(true);
    expect(Toolbox._matches(SPEC, 'twice')).toBe(true);
    expect(Toolbox._matches(SPEC, 'math number')).toBe(true);
    expect(Toolbox._matches(SPEC, 'loan')).toBe(false);
  });

  it('the launcher lists every tool and filters as you type', () => {
    Toolbox.open();
    const count = () => document.querySelectorAll('#tb-list .tb-tool').length;
    expect(count()).toBe(Toolbox.all().length + VexTools.tools.length + 1); // + "Add a link"
    const s = document.getElementById('tb-search');
    s.value = 'doubler';
    s.dispatchEvent(new Event('input'));
    expect([...document.querySelectorAll('#tb-list .tb-tool')].map(b => b.textContent)).toEqual([expect.stringContaining('Doubler')]);
  });
});

describe('the shared tool screen', () => {
  it('shows the result live and the tool\'s own error for bad input', () => {
    Toolbox.openTool('test-double');
    const input = document.querySelector('#vex-tbtool input');
    expect(document.getElementById('tbt-body').textContent).toContain('8');
    input.value = '21';
    input.dispatchEvent(new Event('input'));
    expect(document.getElementById('tbt-body').textContent).toContain('42');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(document.getElementById('tbt-body').textContent).toContain('Enter a number');
  });

  it('refuses an unknown tool', () => {
    expect(() => Toolbox.openTool('nope')).toThrow(/no tool "nope"/);
  });
});

describe('your links', () => {
  it('live in the Toolbox by default, with one Toolbox button on the rail', () => {
    expect(Toolbox.linksInRail()).toBe(false);
    VexTools.renderToolsBar();
    const rail = [...document.querySelectorAll('#tools-bar .tool-icon')];
    expect(rail).toHaveLength(1);
    expect(rail[0].title).toMatch(/Toolbox/);
    Toolbox.open();
    expect(document.getElementById('tb-list').textContent).toContain('My CRM');
  });

  it('go back on the rail when the user asks, and leave the Toolbox', () => {
    Toolbox.setLinksInRail(true);
    const rail = [...document.querySelectorAll('#tools-bar .tool-icon')];
    expect(rail.map(b => b.dataset.toolId)).toEqual(['tool_1', undefined]); // the link, then "Add tool"
    Toolbox.open();
    expect(document.getElementById('tb-list').textContent).not.toContain('My CRM');
  });

  it('the Toolbox checkbox moves them to the rail', () => {
    Toolbox.open();
    const cb = document.querySelector('#tb-list input[type="checkbox"]');
    window.showToast = vi.fn();
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    expect(Toolbox.linksInRail()).toBe(true);
  });
});
