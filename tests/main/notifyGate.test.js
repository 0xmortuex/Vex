// The Attention Budget for Windows toasts (T0-019): createNotifyGate in src/main/notify.js.
import { describe, it, expect, vi } from 'vitest';

const { createNotifyGate } = require('../../src/main/notify.js');

function make(over = {}) {
  const t = { now: 1_700_000_000_000 };
  const show = vi.fn().mockResolvedValue({ ok: true });
  const gate = createNotifyGate({ show, now: () => t.now, ...over });
  return { gate, show, t };
}

describe('createNotifyGate', () => {
  it('lets reminders and anything with no urgency through, always, even in a bad moment', async () => {
    const { gate, show } = make();
    gate.setState({ quiet: true, reason: 'game', until: 0 });
    for (let i = 0; i < 10; i++) {
      await gate.gated({ title: 'Reminder ' + i, kind: 'reminder' });
      await gate.gated({ title: 'Extension ' + i });
    }
    expect(show).toHaveBeenCalledTimes(20);
    expect(gate.denied()).toEqual([]);
  });

  it('holds useful and ambient toasts back while the window says it is a bad moment, and says why', async () => {
    const { gate, show } = make();
    gate.setState({ quiet: true, reason: 'meeting', until: 0 });
    const r = await gate.gated({ title: 'Free to keep', urgency: 'useful', feature: 'free-games' });
    expect(r).toEqual({ ok: false, suppressed: true, reason: 'quiet: meeting' });
    expect(show).not.toHaveBeenCalled();
    expect(gate.denied()[0]).toMatchObject({ feature: 'free-games', reason: 'quiet: meeting', urgency: 'useful' });
    gate.setState({ quiet: false, reason: '', until: 0 });
    expect((await gate.gated({ title: 'Free to keep', urgency: 'useful', feature: 'free-games' })).ok).toBe(true);
  });

  it('caps useful toasts at three an hour and twelve a day', async () => {
    const { gate, show, t } = make();
    const send = (i) => gate.gated({ title: 'T' + i, urgency: 'useful', feature: 'f' + i });
    for (let i = 0; i < 3; i++) { expect((await send(i)).ok).toBe(true); t.now += 61 * 1000; }
    expect(await send(3)).toMatchObject({ suppressed: true, reason: 'hourly limit' });
    t.now += 3600 * 1000;
    expect((await send(4)).ok).toBe(true);
    expect(show).toHaveBeenCalledTimes(4);
    const day = make({ hourCap: 99 });
    let shown = 0;
    for (let i = 0; i < 20; i++) {
      const r = await day.gate.gated({ title: 'D' + i, urgency: 'ambient', feature: 'd' + i });
      if (r.ok) shown++;
      day.t.now += 61 * 1000;
    }
    expect(shown).toBe(12);
    expect(day.gate.denied()[0].reason).toBe('daily limit');
  });

  it('does not repeat the same toast within ten minutes, and does not list the repeat', async () => {
    const { gate, t } = make();
    const same = { title: 'Same', urgency: 'useful', feature: 'x', tag: 'same' };
    expect((await gate.gated(same)).ok).toBe(true);
    expect(await gate.gated(same)).toMatchObject({ suppressed: true, reason: 'repeat' });
    expect(gate.denied()).toEqual([]);
    t.now += 11 * 60 * 1000;
    expect((await gate.gated(same)).ok).toBe(true);
  });

  it('does not count a toast Windows refused', async () => {
    const show = vi.fn().mockRejectedValue(new Error('Windows refused'));
    const gate = createNotifyGate({ show });
    for (let i = 0; i < 5; i++) await expect(gate.gated({ title: 'N' + i, urgency: 'useful', feature: 'f' + i })).rejects.toThrow('Windows refused');
    expect(show).toHaveBeenCalledTimes(5);
  });

  it('refuses a made-up urgency and a state without a quiet flag', async () => {
    const { gate } = make();
    await expect(gate.gated({ title: 'x', urgency: 'loud' })).rejects.toThrow(/Urgency/);
    expect(() => gate.setState({ reason: 'x' })).toThrow();
    expect(() => createNotifyGate({})).toThrow();
  });

  it('keeps the held-back list bounded and can clear it', async () => {
    const { gate } = make({ maxDenied: 5 });
    gate.setState({ quiet: true, reason: 'focus', until: 0 });
    for (let i = 0; i < 9; i++) await gate.gated({ title: 'N' + i, urgency: 'ambient', feature: 'f' + i });
    expect(gate.denied()).toHaveLength(5);
    gate.clearDenied();
    expect(gate.denied()).toEqual([]);
  });
});
