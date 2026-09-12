// @vitest-environment jsdom
//
// The Work panel: the job's tools, and the Ask Vex AI button added alongside
// them. Two things here are regressions waiting to happen:
//
//  1. Tool icons. 137 of the 318 tools are marked with a typographic sign
//     rather than a drawing, and those used to be returned as bare text, so a
//     grid mixing them with SVG tools rendered at two different sizes.
//  2. Reaching AIPanel. It is a top-level `const`, not a property of window, so
//     `window.AIPanel?.open()` is undefined and the button would do nothing at
//     all without saying so. tests/renderer/globalsOnWindow.test.js guards the
//     general case; this pins the behaviour of this particular button.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
globalThis.ToolboxPacks = ToolboxPacks;
const { Toolbox } = require('../../src/renderer/js/toolbox.js');
globalThis.Toolbox = Toolbox; global.window.Toolbox = Toolbox;
const { WorkPanel } = require('../../src/renderer/js/job-work-panel.js');

const JOB = { id: 'dev', name: 'Software Developer', cat: 'Tech', theme: 'midnight', tools: ['regex', 'json-format'] };

beforeEach(() => {
  document.body.innerHTML = '<div id="panel-work"><div id="host"></div></div>';
  window.escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.JobProfiles = { current: () => 'dev', get: () => JOB };
  window.AIRouter = { getOllamaStatus: () => ({ available: true, online: true, preferLocal: true, forceCloud: false, model: 'llama3.2:3b' }) };
  localStorage.clear();
});

const render = () => {
  const host = document.getElementById('host');
  WorkPanel.renderPanel(host);
  return host;
};

describe('tool icons render at one consistent size', () => {
  it('gives a typographic tool icon the same box as a drawn one', () => {
    const glyph = Toolbox.iconMarkup({ icon: '.*', family: 'dev' }, 16);
    const drawn = Toolbox.iconMarkup({ icon: 'star', family: 'dev' }, 16);
    // The drawn one is an SVG sized 16; the typographic one must be boxed to
    // match rather than returned as bare text.
    expect(drawn).toContain('<svg');
    expect(glyph).toContain('tb-glyph');
    expect(glyph).toContain('width:16px');
    expect(glyph).toContain('height:16px');
  });

  it('never returns a bare string for a typographic icon', () => {
    for (const icon of ['.*', '{ }', 'Aa', '0x', 'aeiou', '#']) {
      const out = Toolbox.iconMarkup({ icon, family: 'dev' }, 16);
      expect(out.startsWith('<'), icon).toBe(true);
    }
  });

  it('escapes a typographic icon rather than trusting it as markup', () => {
    const out = Toolbox.iconMarkup({ icon: '<b>x', family: 'dev' }, 16);
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;b&gt;');
  });

  it('still draws an SVG for an icon that names one', () => {
    expect(Toolbox.iconMarkup({ icon: 'star' }, 16)).toContain('<svg');
  });
});

describe('Ask Vex AI button', () => {
  it('is rendered with an icon and says where the AI runs', () => {
    const host = render();
    const btn = host.querySelector('#wp-ai');
    expect(btn).toBeTruthy();
    expect(btn.querySelector('svg')).toBeTruthy();
    expect(host.querySelector('#wp-ai-where').textContent).toContain('llama3.2:3b');
  });

  it('opens the AI panel through the bare global, not window.AIPanel', () => {
    const open = vi.fn(); const sendMessage = vi.fn();
    globalThis.AIPanel = { open, sendMessage };
    try {
      const host = render();
      host.querySelector('#wp-ai').click();
      expect(open).toHaveBeenCalled();
      // The job goes in as context so the first reply is about their work.
      expect(sendMessage).toHaveBeenCalledWith('chat', expect.objectContaining({
        message: expect.stringContaining('Software Developer'),
      }));
    } finally { delete globalThis.AIPanel; }
  });

  it('says so instead of failing silently when the AI panel is missing', () => {
    const toast = vi.fn(); window.showToast = toast;
    const host = render();
    host.querySelector('#wp-ai').click();
    expect(toast).toHaveBeenCalledWith('The AI panel is not available', 'error');
  });

  it('does not claim the local model is absent before the check has run', () => {
    window.AIRouter = {
      getOllamaStatus: () => ({ available: null, online: true, forceCloud: false, model: 'llama3.2:3b' }),
      refreshOllamaStatus: () => Promise.resolve(true),
    };
    const host = render();
    expect(host.querySelector('#wp-ai-where').textContent).toBe('Checking for a local model…');
  });

  it('reports the cloud only once the local check has actually come back', () => {
    window.AIRouter = { getOllamaStatus: () => ({ available: false, online: true, forceCloud: false }) };
    const host = render();
    expect(host.querySelector('#wp-ai-where').textContent).toBe('Cloud — no local model is running');
  });
});

// Tools that render as a typographic sign are no longer recommended for a job.
// A profile saved before that change still lists them, so they are dropped
// once — but only once, so a tool the user deliberately added keeps showing.
describe('dropping the no-icon tools from a saved job list', () => {
  beforeEach(() => {
    window.JobProfiles = {
      current: () => 'dev',
      get: () => JOB,
      recommendedTools: (j) => (j.tools || []).filter(id => {
        const t = Toolbox.all().find(x => x.id === id);
        return t ? Toolbox.rendersDrawnIcon(t) : false;
      }),
    };
  });

  it('uses the filtered recommendation when nothing was saved yet', () => {
    const host = render();
    const shown = [...host.querySelectorAll('.wp-tool')].map(b => b.dataset.id);
    for (const id of shown) {
      const t = Toolbox.all().find(x => x.id === id);
      expect(Toolbox.rendersDrawnIcon(t), id).toBe(true);
    }
  });

  it('drops them from an already-saved list, once, and records that it did', () => {
    const glyph = Toolbox.all().find(t => !Toolbox.rendersDrawnIcon(t));
    const drawn = Toolbox.all().find(t => Toolbox.rendersDrawnIcon(t));
    localStorage.setItem('vex.jobTools', JSON.stringify([glyph.id, drawn.id]));

    render();
    expect(JSON.parse(localStorage.getItem('vex.jobTools'))).toEqual([drawn.id]);
    expect(localStorage.getItem(WorkPanel.MIGRATION_KEY)).toBe('1');
  });

  it('leaves a tool the user added themselves alone after the migration has run', () => {
    const glyph = Toolbox.all().find(t => !Toolbox.rendersDrawnIcon(t));
    localStorage.setItem(WorkPanel.MIGRATION_KEY, '1');
    localStorage.setItem('vex.jobTools', JSON.stringify([glyph.id]));

    const host = render();
    expect(JSON.parse(localStorage.getItem('vex.jobTools'))).toEqual([glyph.id]);
    expect([...host.querySelectorAll('.wp-tool')].map(b => b.dataset.id)).toContain(glyph.id);
  });

  it('keeps an unknown tool id rather than quietly discarding it', () => {
    localStorage.setItem('vex.jobTools', JSON.stringify(['not-a-real-tool']));
    render();
    expect(JSON.parse(localStorage.getItem('vex.jobTools'))).toEqual(['not-a-real-tool']);
  });
});
