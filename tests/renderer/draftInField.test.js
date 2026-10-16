// @vitest-environment jsdom
//
// T2-034: js/draft-in-field.js refuses sensitive boxes, shows a word diff and a tone
// check, writes only when asked, and never submits.
import { describe, it, expect, beforeEach } from 'vitest';

const { VexDraftField: D } = require('../../src/renderer/js/draft-in-field.js');

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; delete window.__vexDraftTarget; });

describe('which boxes may be touched', () => {
  it('refuses passwords, codes, cards, frames and read-only boxes', () => {
    expect(D.refusal({ kind: 'input', type: 'password' })).toMatch(/password/);
    expect(D.refusal({ kind: 'input', type: 'text', autocomplete: 'one-time-code' })).toMatch(/code/);
    expect(D.refusal({ kind: 'input', type: 'text', name: 'card_number' })).toMatch(/card/);
    expect(D.refusal({ kind: 'input', type: 'text', label: 'CVV' })).toMatch(/card/);
    expect(D.refusal({ inFrame: true })).toMatch(/frame/);
    expect(D.refusal({ kind: 'textarea', readOnly: true })).toMatch(/cannot be edited/);
    expect(D.refusal({})).toMatch(/Click into the box/);
  });
  it('accepts a plain text area, a text input and an editable', () => {
    expect(D.refusal({ kind: 'textarea', type: 'textarea', name: 'comment' })).toBeNull();
    expect(D.refusal({ kind: 'input', type: 'text', name: 'title' })).toBeNull();
    expect(D.refusal({ kind: 'editable', type: '' })).toBeNull();
  });
});

describe('diff', () => {
  it('marks removed and added words and rebuilds both sides', () => {
    const d = D.diff('I has a apple', 'I have an apple');
    const before = d.filter(x => x.t !== 'add').map(x => x.text).join('');
    const after = d.filter(x => x.t !== 'del').map(x => x.text).join('');
    expect(before).toBe('I has a apple');
    expect(after).toBe('I have an apple');
    expect(d.some(x => x.t === 'del')).toBe(true);
    expect(d.some(x => x.t === 'add')).toBe(true);
  });
  it('identical text is one unchanged piece', () => { expect(D.diff('same words', 'same words')).toEqual([{ t: 'same', text: 'same words' }]); });
  it('refuses a text too long to compare', () => {
    expect(() => D.diff('word '.repeat(5000), 'x')).toThrow(/too long/);
  });
});

describe('tone check', () => {
  it('counts, it does not guess', () => {
    expect(D.toneCheck('FIX THIS NOW!!! THIS IS BROKEN!!!').notes.join(' ')).toMatch(/exclamation/);
    expect(D.toneCheck('FIX THIS NOW!!! THIS IS BROKEN!!!').notes.join(' ')).toMatch(/capitals/);
    expect(D.toneCheck('Do it').notes.join(' ')).toMatch(/curt/);
    expect(D.toneCheck('Thank you for the quick reply, I will look at it today.').notes[0]).toMatch(/Nothing stands out/);
    expect(D.toneCheck('word '.repeat(40) + '.').notes.join(' ')).toMatch(/words; the reader/);
  });
});

describe('the model answer', () => {
  it('reads the JSON, refuses anything else', () => {
    expect(D.parseReply('{"text":"Hello","tone":"warm","changed":"x"}')).toEqual({ text: 'Hello', tone: 'warm', changed: 'x' });
    expect(D.parseReply('Sure! {"text":"Hi"} done').text).toBe('Hi');
    expect(() => D.parseReply('no json here')).toThrow(/expected shape/);
    expect(() => D.parseReply('{"text":""}')).toThrow(/empty/);
  });
  it('the prompt carries the instruction and the text', () => {
    expect(D.buildPrompt('my text', 'Make it shorter.')).toMatch(/Make it shorter\.[\s\S]*my text/);
  });
});

describe('the page scripts (run for real in jsdom)', () => {
  const run = (script) => JSON.parse((0, eval)(script));
  it('probe reports the focused textarea and writes nothing', () => {
    document.body.innerHTML = '<form id="f"><textarea id="t" name="comment">hello there</textarea></form>';
    const t = document.getElementById('t'); t.focus();
    const info = run(D.probeScript());
    expect(info.kind).toBe('textarea');
    expect(info.value).toBe('hello there');
    expect(t.value).toBe('hello there');
  });
  it('apply sets the value with input and change events and does not submit', () => {
    document.body.innerHTML = '<form id="f"><textarea id="t">old</textarea></form>';
    const t = document.getElementById('t'); t.focus();
    let submitted = false, inputs = 0, changes = 0;
    document.getElementById('f').addEventListener('submit', () => { submitted = true; });
    t.addEventListener('input', () => inputs++); t.addEventListener('change', () => changes++);
    run(D.probeScript());
    expect(run(D.applyScript('new text', 'all')).ok).toBe(true);
    expect(t.value).toBe('new text');
    expect(inputs).toBe(1); expect(changes).toBe(1);
    expect(submitted).toBe(false);
  });
  it('replaces only the selection when asked', () => {
    document.body.innerHTML = '<textarea id="t">keep this and change that</textarea>';
    const t = document.getElementById('t'); t.focus();
    t.setSelectionRange(14, 25);
    run(D.probeScript());
    t.setSelectionRange(14, 25);
    run(D.applyScript('fix that', 'selection'));
    expect(t.value).toBe('keep this and fix that');
  });
  it('says so when the box is gone', () => {
    document.body.innerHTML = '<textarea id="t">x</textarea>';
    document.getElementById('t').focus();
    run(D.probeScript());
    document.getElementById('t').remove();
    expect(run(D.applyScript('y', 'all')).ok).toBe(false);
  });
});
