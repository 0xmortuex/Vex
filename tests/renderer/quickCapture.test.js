// @vitest-environment jsdom
//
// A thought while gaming is lost by the time you have alt-tabbed, found Vex,
// found the panel and clicked. One hotkey opens a box over whatever you were
// doing, takes a line, and goes. Everything it can do already exists in Vex —
// this only decides which and hands the text over.

import { describe, it, expect, vi, beforeEach } from 'vitest';
const { QuickCapture } = require('../../src/renderer/js/quick-capture.js');

let saved, ran;
beforeEach(() => {
  saved = []; ran = [];
  document.body.innerHTML = '<textarea id="ai-input"></textarea>';
  globalThis.AgentTools = {
    saveNote: vi.fn((title, content) => { saved.push({ title, content }); return { id: 'n1', title }; }),
    vexCommand: vi.fn(async (text) => { ran.push(text); return { ran: 'Timer: 20:00' }; }),
  };
  globalThis.AIPanel = { isOpen: () => false, toggle: vi.fn(), _sendChat: vi.fn() };
  globalThis.VexProblems = { note: vi.fn() };
  window.vex = { focusWindow: vi.fn(), onCaptureTake: vi.fn(), captureDone: vi.fn() };
});

describe('what a captured line does', () => {
  it('a plain thought becomes a note, titled by its first words', async () => {
    const said = await QuickCapture.run({ kind: 'note', text: 'check whether the new monitor supports 165Hz over DisplayPort' });
    expect(said).toBe('Saved to Notes');
    expect(saved[0].title).toBe('check whether the new monitor supports 165Hz…');
    expect(saved[0].content).toBe('check whether the new monitor supports 165Hz over DisplayPort');
  });

  it('a short thought is its own title, with nothing trimmed away', async () => {
    await QuickCapture.run({ kind: 'note', text: 'buy milk' });
    expect(saved[0]).toEqual({ title: 'buy milk', content: 'buy milk' });
  });

  it('a command goes through the same path as Ctrl+K', async () => {
    expect(await QuickCapture.run({ kind: 'command', text: 'timer 20 min' })).toBe('Timer: 20:00');
    expect(ran).toEqual(['timer 20 min']);
  });

  it('a question opens the panel, because an answer in a box that closes is useless', async () => {
    const said = await QuickCapture.run({ kind: 'ask', text: 'what is the capital of Peru' });
    expect(said).toBe('Asked Vex — the answer is in the panel');
    expect(window.vex.focusWindow).toHaveBeenCalled();
    expect(AIPanel.toggle).toHaveBeenCalled();
    expect(document.getElementById('ai-input').value).toBe('what is the capital of Peru');
    expect(AIPanel._sendChat).toHaveBeenCalled();
  });

  it('an empty line saves nothing', async () => {
    await expect(QuickCapture.run({ kind: 'note', text: '   ' })).rejects.toThrow(/nothing to save/);
    expect(saved).toEqual([]);
  });

  it('a failure is reported back to the box and recorded', async () => {
    globalThis.AgentTools.vexCommand = vi.fn(async () => { throw new Error('Say how long'); });
    const take = vi.fn();
    window.vex.onCaptureTake = (cb) => take.mockImplementation(cb);
    QuickCapture.init();
    await take({ id: 'c1', kind: 'command', text: 'timer soon' });
    expect(window.vex.captureDone).toHaveBeenCalledWith({ id: 'c1', ok: false, error: 'Say how long' });
    expect(VexProblems.note).toHaveBeenCalledWith('Quick capture', expect.stringContaining('timer soon'), expect.any(Error));
  });

  it('a success is reported back with what happened', async () => {
    const take = vi.fn();
    window.vex.onCaptureTake = (cb) => take.mockImplementation(cb);
    QuickCapture.init();
    await take({ id: 'c2', kind: 'note', text: 'an idea' });
    expect(window.vex.captureDone).toHaveBeenCalledWith({ id: 'c2', ok: true, said: 'Saved to Notes' });
  });
});

describe('the box itself', () => {
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '../../src/renderer/capture.html'), 'utf8');

  it('reads the line the way a person would write it', () => {
    // classify() lives in the window; exercise it exactly as written.
    const classify = new Function('return ' + html.match(/function classify\(text\)[\s\S]*?\n    }/)[0].replace(/^function /, 'function '))();
    expect(classify('buy milk')).toEqual({ kind: 'note', text: 'buy milk' });
    expect(classify('remind me to call Dana at 5')).toEqual({ kind: 'command', text: 'remind me to call Dana at 5' });
    expect(classify('timer 20 min')).toEqual({ kind: 'command', text: 'timer 20 min' });
    expect(classify('/split')).toEqual({ kind: 'command', text: 'split' });
    expect(classify('ask, what is 2+2')).toEqual({ kind: 'ask', text: 'what is 2+2' });
    expect(classify('   ')).toBe(null);
  });

  it('closes on Escape and when it loses focus — it is a box you summon', () => {
    expect(html).toContain("if (e.key === 'Escape') { window.vexCapture.close(); return; }");
    expect(html).toContain("window.addEventListener('blur'");
  });

  it('is given only the two things it needs', () => {
    const preload = fs.readFileSync(path.join(__dirname, '../../src/preload-capture.js'), 'utf8');
    const exposed = preload.slice(preload.indexOf('exposeInMainWorld'));
    expect(exposed).toContain('submit:');
    expect(exposed).toContain('close:');
    // Two channels and nothing else — the box has no reason to reach further.
    expect([...exposed.matchAll(/ipcRenderer\.(invoke|send|on)\('([^']+)'/g)].map(m => m[2])).toEqual(['capture:submit', 'capture:close']);
  });
});

// The capture window is its own BrowserWindow, so Vex's IPC policy treats it as
// an untrusted sender — correctly. It is allowed exactly two channels and
// nothing else, the same way the start page is.
describe('what the capture window is allowed to do', () => {
  const fs = require('fs'), path = require('path');
  const policy = fs.readFileSync(path.join(__dirname, '../../src/main/ipc-policy.js'), 'utf8');
  const allowance = policy.match(/^.*capture\\\.html.*$/m)[0];     // the whole rule, not the tail

  it('only from capture.html, and only its own two channels', () => {
    expect(allowance).toContain("['capture:submit', 'capture:close']");
    expect(allowance).toMatch(/\^file:/);
    for (const forbidden of ['persist-set', 'storage-save', 'api:request', 'vault:get']) {
      expect(allowance).not.toContain(forbidden);
    }
  });

  it('the rule sits before the catch-all that refuses everything else', () => {
    expect(policy.indexOf('capture.html')).toBeLessThan(policy.indexOf("throw new Error('Untrusted IPC sender')"));
  });
});
