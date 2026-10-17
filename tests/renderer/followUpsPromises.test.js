// @vitest-environment jsdom
//
// T3-006: promises in the person's own typed lines are offered to the follow-up ledger, from Vex's own
// boxes only, only when switched on, and never without a press.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { VexFollowUps: F } = require('../../src/renderer/js/follow-ups.js');
const { QuickCapture } = require('../../src/renderer/js/quick-capture.js');

// Wednesday 14 October 2026, noon.
const NOW = new Date(2026, 9, 14, 12, 0, 0).getTime();
let suggest;

beforeEach(() => {
  localStorage.clear();
  suggest = vi.fn(() => true);
  globalThis.VexAttention = { suggest };
  globalThis.VexProblems = { note: vi.fn() };
  globalThis.AgentTools = { saveNote: vi.fn(() => ({ id: 'n' })) };
});

describe('detecting a promise', () => {
  it('finds first-person promises in English', () => {
    expect(F.detectPromise("I'll send the form to Selin tomorrow", NOW)).toMatchObject({ who: 'Selin', what: "I'll send the form to Selin tomorrow" });
    expect(F.detectPromise('will do', NOW)).not.toBeNull();
    expect(F.detectPromise('I am going to call the bank', NOW)).not.toBeNull();
    expect(F.detectPromise('let me get back to you on that', NOW)).not.toBeNull();
    expect(F.detectPromise('I promise to review it', NOW)).not.toBeNull();
  });
  it('finds a Turkish promise', () => {
    expect(F.detectPromise('formu yarın göndereceğim', NOW)).not.toBeNull();
    expect(F.detectPromise('söz veriyorum', NOW)).not.toBeNull();
  });
  it('is not fooled by questions, other people or plain notes', () => {
    expect(F.detectPromise('will you send it?', NOW)).toBeNull();
    expect(F.detectPromise('Selin said she will send it', NOW)).toBeNull();
    expect(F.detectPromise('buy milk and eggs', NOW)).toBeNull();
    expect(F.detectPromise('', NOW)).toBeNull();
    expect(F.detectPromise('x'.repeat(500), NOW)).toBeNull();
    expect(F.detectPromise("I'll be there", NOW)).toBeNull();
  });
  it('reads a day word as 17:00 of that day', () => {
    const p = F.detectPromise("I'll send it tomorrow", NOW);
    expect(new Date(p.due).getDate()).toBe(15);
    expect(new Date(p.due).getHours()).toBe(17);
    expect(new Date(F.detectPromise('I will call you today', NOW).due).getDate()).toBe(14);
    expect(new Date(F.detectPromise("I'll finish it by friday", NOW).due).getDay()).toBe(5);
    expect(F.detectPromise("I'll send it", NOW).due).toBe(0);
  });
});

describe('offering it', () => {
  it('does nothing until switched on', () => {
    expect(F.offerFromTyped("I'll send the form tomorrow", 'the box', NOW)).toBeNull();
    expect(suggest).not.toHaveBeenCalled();
  });
  it('puts one line in the Attention Inbox and adds nothing by itself', () => {
    F.setPromises(true);
    const o = F.offerFromTyped("I'll send the form to Selin tomorrow", 'the quick-capture box', NOW);
    expect(o.who).toBe('Selin');
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][0]).toMatchObject({ feature: 'follow-ups', action: { key: 'promise:' + o.id } });
    expect(F.list()).toEqual([]);
  });
  it('the button adds it under "I owe" with the day, once', () => {
    F.setPromises(true);
    const o = F.offerFromTyped("I'll send the form to Selin tomorrow", 'the box', NOW);
    const it = F.acceptOffer(o.id);
    expect(it).toMatchObject({ dir: 'owe', who: 'Selin' });
    expect(it.due).toBeGreaterThan(0);
    expect(F.list()).toHaveLength(1);
    expect(() => F.acceptOffer(o.id)).toThrow(/expired/);
  });
  it('keeps at most 10 waiting offers', () => {
    F.setPromises(true);
    for (let i = 0; i < 14; i++) F.offerFromTyped("I'll do thing " + i, 'the box', NOW + i);
    expect(Object.keys(F._offers()).length).toBe(10);
  });
  it('is off when follow-ups are off', () => {
    F.setPromises(true);
    F.setEnabled(false);
    expect(F.offerFromTyped("I'll send it", 'the box', NOW)).toBeNull();
  });
  it('raises when the attention gate is missing', () => {
    F.setPromises(true);
    delete globalThis.VexAttention;
    expect(() => F.offerFromTyped("I'll send it", 'the box', NOW)).toThrow(/attention gate/);
  });
});

describe('from the quick-capture box', () => {
  beforeEach(() => { globalThis.VexFollowUps = F; });
  it('a promise typed there is offered and the note is still saved', async () => {
    F.setPromises(true);
    const said = await QuickCapture.run({ kind: 'note', text: "I'll send the invoice to Mert on monday" });
    expect(said).toBe('Saved to Notes');
    expect(AgentTools.saveNote).toHaveBeenCalledTimes(1);
    expect(suggest).toHaveBeenCalledTimes(1);
  });
  it('nothing is offered with the switch off', async () => {
    await QuickCapture.run({ kind: 'note', text: "I'll send the invoice to Mert on monday" });
    expect(suggest).not.toHaveBeenCalled();
  });
});
