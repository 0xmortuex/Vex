// @vitest-environment jsdom
//
// Teach mode: the clicks you make, saved as steps that replay. The rule that
// cannot bend is the one about secrets — a password typed while recording is
// never in the recording. After that: a step should survive a redesign where
// it can, and a recording should not fill up with one step per keystroke.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { TeachMode: T } = require('../../src/renderer/js/teach-mode.js');

beforeEach(() => {
  document.body.innerHTML = '';
  T.recording = false;
  T.steps = [];
  T._webview = null;
  T._secretSeen = false;
  window.showToast = vi.fn();
  window.vexPrompt = vi.fn();
  globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'https://site.example/start', send: vi.fn() }) };
  globalThis.AgentLoop = { saveMacroFromSteps: vi.fn((name, calls) => ({ id: 'macro_1', name, calls })) };
});

describe('turning what you did into steps', () => {
  it('a button is clicked by its words, which outlive a redesign', () => {
    expect(T.toCall({ kind: 'click', text: 'Continue', selector: '.btn-x7fa', tag: 'button' }))
      .toEqual({ tool: 'click_text', parameters: { text: 'Continue' } });
  });

  it('something with no words is clicked by where it is', () => {
    expect(T.toCall({ kind: 'click', text: '', selector: '#menu > button:nth-of-type(2)', tag: 'button' }))
      .toEqual({ tool: 'click', parameters: { selector: '#menu > button:nth-of-type(2)' } });
  });

  it('a field is filled with what you typed', () => {
    expect(T.toCall({ kind: 'type', selector: '#email', value: 'me@example.com' }))
      .toEqual({ tool: 'type_text', parameters: { selector: '#email', text: 'me@example.com' } });
  });

  it('a password step hands the page back instead of replaying anything', () => {
    const call = T.toCall({ kind: 'secret', selector: '#password' });
    expect(call.tool).toBe('hand_over');
    expect(JSON.stringify(call)).not.toMatch(/value|text/);
  });

  it('a page move is part of the recording', () => {
    expect(T.toCall({ kind: 'navigate', url: 'https://site.example/step2' }))
      .toEqual({ tool: 'navigate', parameters: { url: 'https://site.example/step2' } });
  });
});

describe('tidying the recording', () => {
  it('typing into one field is one step, with the value it ended on', () => {
    const out = T.fold([
      { kind: 'type', selector: '#q', value: 'el' },
      { kind: 'type', selector: '#q', value: 'elec' },
      { kind: 'type', selector: '#q', value: 'electron' },
    ]);
    expect(out).toEqual([{ kind: 'type', selector: '#q', value: 'electron' }]);
  });

  it('a double click is one click', () => {
    const click = { kind: 'click', selector: '#go', text: 'Go' };
    expect(T.fold([click, { ...click }])).toHaveLength(1);
  });

  it('two different clicks stay two steps', () => {
    expect(T.fold([
      { kind: 'click', selector: '#a', text: 'A' },
      { kind: 'click', selector: '#b', text: 'B' },
    ])).toHaveLength(2);
  });
});

describe('a session', () => {
  it('starts on the page you are on, and tells the page to record', () => {
    const wv = WebviewManager.getActiveWebview();
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    T.start('Monthly invoice');
    expect(T.recording).toBe(true);
    expect(T.steps[0]).toEqual({ kind: 'navigate', url: 'https://site.example/start' });
    expect(wv.send).toHaveBeenCalledWith('vex-teach', true);
    expect(document.body.classList.contains('teach-recording')).toBe(true);
    expect(document.getElementById('teach-badge')).toBeTruthy();
  });

  it('will not record a page that is not a web page', () => {
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => 'file:///C:/x.html' }) };
    expect(() => T.start('x')).toThrow(/Open the page/);
  });

  it('saves what was recorded as a repeatable task', () => {
    T.start('Monthly invoice');
    T.record({ kind: 'click', selector: '#invoices', text: 'Invoices', tag: 'a' });
    T.record({ kind: 'type', selector: '#month', value: 'September' });
    const macro = T.stop('Monthly invoice');
    expect(AgentLoop.saveMacroFromSteps).toHaveBeenCalled();
    expect(macro.calls.map(c => c.tool)).toEqual(['navigate', 'click_text', 'type_text']);
    expect(T.recording).toBe(false);
    expect(document.getElementById('teach-badge')).toBe(null);
  });

  it('a recording with nothing in it is refused rather than saved', () => {
    T.start('Empty');
    expect(() => T.stop('Empty')).toThrow(/nothing in it/);
    expect(AgentLoop.saveMacroFromSteps).not.toHaveBeenCalled();
  });

  it('throwing it away keeps nothing and switches the page recorder off', () => {
    const wv = WebviewManager.getActiveWebview();
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    T.start('x');
    T.record({ kind: 'click', selector: '#a', text: 'A' });
    T.cancel();
    expect(T.recording).toBe(false);
    expect(T.steps).toEqual([]);
    expect(wv.send).toHaveBeenLastCalledWith('vex-teach', false);
  });

  it('nothing is recorded when nothing was asked for', () => {
    expect(T.record({ kind: 'click', selector: '#a' })).toBe(null);
    expect(T.steps).toEqual([]);
  });

  it('a recording cannot grow without end', () => {
    T.start('x');
    for (let i = 0; i < T.MAX_STEPS + 20; i++) T.record({ kind: 'click', selector: '#a' + i });
    expect(T.steps.length).toBeLessThanOrEqual(T.MAX_STEPS);
  });
});
