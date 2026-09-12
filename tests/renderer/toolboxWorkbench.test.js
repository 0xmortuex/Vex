// @vitest-environment jsdom
//
// The workbench shell and the tools rebuilt on it.
//
// The old tools were a textarea, two buttons and a div. Base64 could do exactly
// one thing — standard Base64 of a UTF-8 string — and answered "Not valid
// Base64" to a JWT segment, a Base64URL string, or anything pasted with quotes
// around it. These pin the cases that used to fail.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { ToolboxWorkbench } = require('../../src/renderer/js/toolbox-workbench.js');
globalThis.ToolboxWorkbench = ToolboxWorkbench; global.window.ToolboxWorkbench = ToolboxWorkbench;
const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
globalThis.ToolboxPacks = ToolboxPacks;
const { Toolbox } = require('../../src/renderer/js/toolbox.js');
globalThis.Toolbox = Toolbox; global.window.Toolbox = Toolbox;

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
});

const type = (text) => {
  const el = document.getElementById('wb-in');
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const outText = () => document.getElementById('wb-out').textContent;
const isError = () => document.getElementById('wb-out').classList.contains('wb-error');

describe('the workbench shell', () => {
  const spec = {
    id: 'test-tool', title: 'Test', blurb: 'a tool',
    options: [
      { id: 'upper', label: 'Upper case', type: 'toggle', default: false },
      { id: 'mode', label: 'Mode', type: 'select', default: 'a', options: [['a', 'A'], ['b', 'B']] },
      { id: 'extra', label: 'Only for B', type: 'text', default: '', when: (s) => s.mode === 'b' },
    ],
    run: ({ input, opt }) => {
      if (input === 'boom') throw new Error('that input is no good');
      return { output: opt.upper ? input.toUpperCase() : input, note: 'mode ' + opt.mode };
    },
  };

  it('draws a control for every option', () => {
    ToolboxWorkbench.open(spec);
    expect(document.querySelectorAll('#wb-opts .wb-field, #wb-opts .wb-toggle').length).toBe(3);
    expect(document.querySelectorAll('.wb-select').length).toBe(1);
  });

  it('runs as you type, without pressing anything', async () => {
    ToolboxWorkbench.open(spec);
    type('hello');
    await new Promise(r => setTimeout(r, 200));
    expect(outText()).toBe('hello');
  });

  it('hides an option that does not apply, and shows it when it does', () => {
    ToolboxWorkbench.open(spec);
    const field = document.querySelector('[data-opt="extra"]').closest('.wb-field');
    expect(field.hidden).toBe(true);
    const sel = document.querySelector('[data-opt="mode"]');
    sel.value = 'b';
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    expect(field.hidden).toBe(false);
  });

  it('re-runs immediately when an option changes, auto-update or not', () => {
    ToolboxWorkbench.open(spec);
    type('hello');
    document.getElementById('wb-auto').checked = false;
    const t = document.querySelector('[data-opt="upper"]');
    t.checked = true;
    t.dispatchEvent(new Event('change', { bubbles: true }));
    expect(outText()).toBe('HELLO');
  });

  // A tool that quietly produces nothing is indistinguishable from a broken one.
  it('shows a thrown message as an error rather than swallowing it', () => {
    ToolboxWorkbench.open(spec);
    type('boom');
    document.getElementById('wb-run').click();
    expect(outText()).toBe('that input is no good');
    expect(isError()).toBe(true);
  });

  it('remembers options between openings', () => {
    ToolboxWorkbench.open(spec);
    const sel = document.querySelector('[data-opt="mode"]');
    sel.value = 'b';
    sel.dispatchEvent(new Event('input', { bubbles: true }));

    document.body.innerHTML = '';
    ToolboxWorkbench.open(spec);
    expect(document.querySelector('[data-opt="mode"]').value).toBe('b');
  });

  it('only keeps the input when asked to', () => {
    ToolboxWorkbench.open(spec);
    type('secret');
    document.body.innerHTML = '';
    ToolboxWorkbench.open(spec);
    expect(document.getElementById('wb-in').value).toBe('');

    document.getElementById('wb-remember').checked = true;
    document.getElementById('wb-remember').dispatchEvent(new Event('change', { bubbles: true }));
    type('kept');
    document.body.innerHTML = '';
    ToolboxWorkbench.open(spec);
    expect(document.getElementById('wb-in').value).toBe('kept');
  });

  it('feeds the output back in when swapped', () => {
    ToolboxWorkbench.open({ ...spec, options: [spec.options[0]] });
    type('abc');
    document.querySelector('[data-opt="upper"]').checked = true;
    document.querySelector('[data-opt="upper"]').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('wb-swap').click();
    expect(document.getElementById('wb-in').value).toBe('ABC');
  });

  it('says so rather than silently doing nothing when there is no output to copy', () => {
    ToolboxWorkbench.open(spec);
    document.getElementById('wb-copy').click();
    expect(window.showToast).toHaveBeenCalledWith('Nothing to copy yet');
  });

  it('refuses a spec with no run(), instead of opening something inert', () => {
    expect(() => ToolboxWorkbench.open({ id: 'x', title: 'x' })).toThrow(/run\(\)/);
  });
});

// Every one of these was a real failure of the old tool.
describe('Base64 handles what is actually out there', () => {
  const run = (input, opt) => {
    Toolbox._base64();
    type(input);
    if (opt) {
      for (const [k, v] of Object.entries(opt)) {
        const el = document.querySelector(`[data-opt="${k}"]`);
        if (!el) continue;
        if (el.type === 'checkbox') { el.checked = v; el.dispatchEvent(new Event('change', { bubbles: true })); }
        else { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
      }
    }
    document.getElementById('wb-run').click();
    return { out: outText(), err: isError() };
  };

  it('decodes ordinary padded Base64', () => {
    expect(run('aG93IGFyZSB5b3UgYnJv').out).toBe('how are you bro');
  });

  it('decodes an unpadded segment, as a JWT carries', () => {
    expect(run('eyJhbGciOiJIUzI1NiJ9').out).toBe('{"alg":"HS256"}');
  });

  it('decodes Base64URL, where - and _ replace + and /', () => {
    expect(run('SGVsbG8tX3dvcmxk').out).toBe('Hello-_world');
  });

  it('copes with quotes and newlines from a paste', () => {
    expect(run('"aG93IGFyZSB5\nb3UgYnJv"').out).toBe('how are you bro');
  });

  it('encodes, and can leave the padding off', () => {
    expect(run('how are you?', { mode: 'encode', variant: 'url', pad: false }).out).toBe('aG93IGFyZSB5b3U_');
  });

  it('shows the bytes when they are not text', () => {
    expect(run('aG93', { charset: 'hex' }).out).toBe('68 6f 77');
  });

  it('names the character it choked on rather than just failing', () => {
    const r = run('abc$$$def', { lenient: false });
    expect(r.err).toBe(true);
    expect(r.out).toContain('$');
  });

  it('explains when bytes decoded but are not valid text', () => {
    const r = run('/v8A', { charset: 'utf-8' });
    expect(r.err).toBe(true);
    expect(r.out).toContain('Hex bytes');
  });
});

describe('the other rebuilt tools', () => {
  const open = (fn, input) => { fn.call(Toolbox); type(input); document.getElementById('wb-run').click(); return outText(); };

  it('URL: breaks a URL into its parts', () => {
    Toolbox._urlencode();
    const sel = document.querySelector('[data-opt="mode"]');
    sel.value = 'parse'; sel.dispatchEvent(new Event('input', { bubbles: true }));
    type('https://example.com/a?q=1&b=2');
    document.getElementById('wb-run').click();
    expect(outText()).toContain('example.com');
    expect(outText()).toContain('q = 1');
  });

  it('JSON: points at the line and column of a syntax error', () => {
    const out = open(Toolbox._json, '{"a":1,,}');
    expect(isError()).toBe(true);
    expect(out).toMatch(/line \d+, column \d+/);
  });

  it('JWT: is explicit that it does not verify the signature', () => {
    Toolbox._jwt();
    type('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig');
    document.getElementById('wb-run').click();
    expect(document.getElementById('wb-note').textContent).toContain('NOT checked');
  });

  it('Timestamp: reads unix seconds', () => {
    expect(open(Toolbox._timestamp, '1760000000')).toContain('1760000000');
  });

  it('Case: offers every form at once', () => {
    const out = open(Toolbox._caseconvert, 'the quick brown fox');
    expect(out).toContain('theQuickBrownFox');
    expect(out).toContain('the_quick_brown_fox');
    expect(out).toContain('THE_QUICK_BROWN_FOX');
  });

  it('Word count: counts words, characters and sentences', () => {
    const out = open(Toolbox._wordcount, 'one two three. four five!');
    expect(out).toContain('words           5');
    expect(out).toContain('sentences');
  });
});

// Two sizes: a panel you glance at, and a full-screen surface where the tool
// shows everything it knows. The second is not merely a bigger box — the
// reference column only exists there.
describe('the two sizes', () => {
  const spec = {
    id: 'size-tool', title: 'Sized', run: ({ input }) => input,
    details: [
      { title: 'Facts', rows: [['a', 'first'], ['b', 'second']] },
      { title: 'Try one', examples: true, rows: [['hello world', 'a greeting']] },
      { title: 'Prose', text: 'Some explanation.' },
    ],
  };

  it('starts compact', () => {
    ToolboxWorkbench.open(spec);
    expect(document.getElementById('vex-workbench').classList.contains('wb-full')).toBe(false);
  });

  it('fills the window when expanded, and goes back', () => {
    ToolboxWorkbench.open(spec);
    const m = document.getElementById('vex-workbench');
    document.getElementById('wb-expand').click();
    expect(m.classList.contains('wb-full')).toBe(true);
    document.getElementById('wb-expand').click();
    expect(m.classList.contains('wb-full')).toBe(false);
  });

  it('remembers the size per tool', () => {
    ToolboxWorkbench.open(spec);
    document.getElementById('wb-expand').click();
    document.body.innerHTML = '';
    ToolboxWorkbench.open(spec);
    expect(document.getElementById('vex-workbench').classList.contains('wb-full')).toBe(true);
  });

  it('renders the reference sections', () => {
    ToolboxWorkbench.open(spec);
    expect(document.querySelectorAll('#wb-ref .wb-ref-sec').length).toBe(3);
    expect(document.getElementById('wb-ref').textContent).toContain('Some explanation.');
  });

  it('loads an example straight into the input when clicked', () => {
    ToolboxWorkbench.open(spec);
    document.querySelector('#wb-ref [data-example]').click();
    expect(document.getElementById('wb-in').value).toBe('hello world');
    expect(outText()).toBe('hello world');
  });

  it('leaves the reference out entirely for a tool with no details', () => {
    ToolboxWorkbench.open({ id: 'plain', title: 'Plain', run: ({ input }) => input });
    expect(document.getElementById('wb-ref').innerHTML.trim()).toBe('');
  });

  it('escapes reference content rather than trusting it as markup', () => {
    ToolboxWorkbench.open({
      id: 'esc', title: 'Esc', run: ({ input }) => input,
      details: [{ title: '<img src=x>', rows: [['<b>bold</b>', '<i>it</i>']] }],
    });
    const ref = document.getElementById('wb-ref');
    expect(ref.querySelector('img')).toBe(null);
    expect(ref.querySelector('b')).toBe(null);
    expect(ref.textContent).toContain('<b>bold</b>');
  });
});

// The reference is the "every detail" part, so the rebuilt tools must carry it.
describe('the rebuilt tools ship reference material', () => {
  const TOOLS = ['_base64', '_hash', '_urlencode', '_json', '_jwt', '_timestamp', '_caseconvert', '_wordcount'];

  it('every one has a full-screen reference with real content', () => {
    for (const fn of TOOLS) {
      document.body.innerHTML = '';
      Toolbox[fn]();
      const secs = document.querySelectorAll('#wb-ref .wb-ref-sec');
      expect(secs.length, fn).toBeGreaterThan(0);
      expect(document.getElementById('wb-ref').textContent.trim().length, fn).toBeGreaterThan(80);
    }
  });

  it('every one describes itself in the header', () => {
    for (const fn of TOOLS) {
      document.body.innerHTML = '';
      Toolbox[fn]();
      expect(document.querySelector('.wb-head-blurb').textContent.length, fn).toBeGreaterThan(20);
    }
  });

  it('every one offers options worth having', () => {
    for (const fn of TOOLS) {
      document.body.innerHTML = '';
      Toolbox[fn]();
      expect(document.querySelectorAll('#wb-opts .wb-field, #wb-opts .wb-toggle').length, fn).toBeGreaterThan(0);
    }
  });
});
