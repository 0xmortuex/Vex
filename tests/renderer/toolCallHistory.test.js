import { describe, it, expect, beforeEach } from 'vitest';
import { ToolCallHistory } from '../../src/renderer/js/agent-loop.js';

describe('ToolCallHistory', () => {
  let h;
  beforeEach(() => { h = new ToolCallHistory(); });

  describe('isStuckInLoop', () => {
    it('returns false on empty history', () => {
      expect(h.isStuckInLoop('navigate', { url: 'https://x.com' })).toBe(false);
    });

    it('returns false after 1 identical call', () => {
      h.add('navigate', { url: 'https://x.com' }, 'ok');
      expect(h.isStuckInLoop('navigate', { url: 'https://x.com' })).toBe(false);
    });

    it('returns true after 2 identical calls (MAX_IDENTICAL = 2)', () => {
      h.add('navigate', { url: 'https://x.com' }, 'ok');
      h.add('navigate', { url: 'https://x.com' }, 'ok');
      expect(h.isStuckInLoop('navigate', { url: 'https://x.com' })).toBe(true);
    });

    it('returns false when same tool but different args', () => {
      h.add('navigate', { url: 'https://a.com' }, 'ok');
      h.add('navigate', { url: 'https://a.com' }, 'ok');
      expect(h.isStuckInLoop('navigate', { url: 'https://b.com' })).toBe(false);
    });

    it('returns false when same args but different tool', () => {
      h.add('navigate', { url: 'https://x.com' }, 'ok');
      h.add('navigate', { url: 'https://x.com' }, 'ok');
      expect(h.isStuckInLoop('reload', { url: 'https://x.com' })).toBe(false);
    });

    it('only considers the last WINDOW=5 calls; older identical pairs do not trip', () => {
      // Two identical calls, then 5 different calls — older pair falls out of window
      h.add('navigate', { url: 'https://x.com' }, 'ok');
      h.add('navigate', { url: 'https://x.com' }, 'ok');
      for (let i = 0; i < 5; i++) {
        h.add('click', { selector: `#a${i}` }, 'ok');
      }
      expect(h.isStuckInLoop('navigate', { url: 'https://x.com' })).toBe(false);
    });

    it('trips when 2 identical calls appear within the last 5 even with noise around them', () => {
      h.add('click', { selector: '#a' }, 'ok');
      h.add('navigate', { url: 'https://x.com' }, 'ok');
      h.add('click', { selector: '#b' }, 'ok');
      h.add('navigate', { url: 'https://x.com' }, 'ok');
      h.add('click', { selector: '#c' }, 'ok');
      expect(h.isStuckInLoop('navigate', { url: 'https://x.com' })).toBe(true);
    });

    it('treats undefined args and {} as the same signature', () => {
      h.add('reload', undefined, 'ok');
      h.add('reload', {}, 'ok');
      expect(h.isStuckInLoop('reload', undefined)).toBe(true);
      expect(h.isStuckInLoop('reload', {})).toBe(true);
    });
  });

  describe('loopGuidance', () => {
    it('returns a structured failure object when called', () => {
      h.add('navigate', { url: 'https://x.com' }, 'first result');
      h.add('navigate', { url: 'https://x.com' }, 'second result');
      const g = h.loopGuidance('navigate', { url: 'https://x.com' });
      expect(g.ok).toBe(false);
      expect(g.loopPrevented).toBe(true);
      expect(typeof g.error).toBe('string');
    });

    it('includes the most recent result for the matching signature in the error preview', () => {
      h.add('navigate', { url: 'https://x.com' }, 'first result');
      h.add('navigate', { url: 'https://x.com' }, 'second result');
      const g = h.loopGuidance('navigate', { url: 'https://x.com' });
      expect(g.error).toContain('second result');
      expect(g.error).not.toContain('first result');
    });

    it('truncates a JSON-stringified non-string result to <= 300 chars', () => {
      const huge = { data: 'x'.repeat(1000) };
      h.add('extract_text', { selector: 'body' }, huge);
      h.add('extract_text', { selector: 'body' }, huge);
      const g = h.loopGuidance('extract_text', { selector: 'body' });
      // The preview substring is bounded; pull the segment between
      // "Previous result: " and ". DO NOT" to verify the truncation.
      const m = g.error.match(/Previous result: ([\s\S]*?)\. DO NOT/);
      expect(m).not.toBeNull();
      expect(m[1].length).toBeLessThanOrEqual(300);
    });

    it('includes the count of identical prior calls in the message', () => {
      h.add('navigate', { url: 'https://x.com' }, 'ok');
      h.add('navigate', { url: 'https://x.com' }, 'ok');
      h.add('navigate', { url: 'https://x.com' }, 'ok');
      const g = h.loopGuidance('navigate', { url: 'https://x.com' });
      expect(g.error).toMatch(/3 time\(s\)/);
    });
  });

  describe('mostRepeated', () => {
    it('returns "nothing repeated" when history is empty', () => {
      expect(h.mostRepeated()).toBe('nothing repeated');
    });

    it('returns the signature with the highest count and its count', () => {
      h.add('click', { selector: '#a' }, 'ok');
      h.add('click', { selector: '#a' }, 'ok');
      h.add('click', { selector: '#a' }, 'ok');
      h.add('navigate', { url: 'https://x.com' }, 'ok');
      const r = h.mostRepeated();
      expect(r).toMatch(/click::/);
      expect(r).toContain('(3x)');
    });

    it('handles a single unrepeated call', () => {
      h.add('reload', {}, 'ok');
      const r = h.mostRepeated();
      expect(r).toContain('(1x)');
    });
  });

  describe('add and ring buffer', () => {
    it('caps history at 20 entries (oldest dropped)', () => {
      for (let i = 0; i < 25; i++) {
        h.add('click', { selector: `#a${i}` }, 'ok');
      }
      expect(h.recentCalls.length).toBe(20);
      // Oldest should be #a5, newest #a24
      expect(h.recentCalls[0].args.selector).toBe('#a5');
      expect(h.recentCalls[h.recentCalls.length - 1].args.selector).toBe('#a24');
    });

    it('records timestamp, tool name, args, and result on each entry', () => {
      const before = Date.now();
      h.add('navigate', { url: 'https://x.com' }, { ok: true });
      const e = h.recentCalls[0];
      expect(e.toolName).toBe('navigate');
      expect(e.args).toEqual({ url: 'https://x.com' });
      expect(e.result).toEqual({ ok: true });
      expect(e.at).toBeGreaterThanOrEqual(before);
    });
  });

  describe('reset', () => {
    it('clears all history', () => {
      h.add('click', { selector: '#a' }, 'ok');
      h.add('click', { selector: '#a' }, 'ok');
      expect(h.isStuckInLoop('click', { selector: '#a' })).toBe(true);
      h.reset();
      expect(h.recentCalls).toEqual([]);
      expect(h.isStuckInLoop('click', { selector: '#a' })).toBe(false);
    });
  });

  describe('summarizeFailure', () => {
    it('lists unique tools used and navigated URLs', () => {
      h.add('navigate', { url: 'https://a.com' }, 'ok');
      h.add('click', { selector: '#x' }, 'ok');
      h.add('navigate', { url: 'https://b.com' }, 'ok');
      h.add('click', { selector: '#y' }, 'ok');
      const s = h.summarizeFailure('open two pages');
      expect(s).toContain('open two pages');
      expect(s).toContain('navigate');
      expect(s).toContain('click');
      expect(s).toContain('https://a.com');
      expect(s).toContain('https://b.com');
    });

    it('reports "(none)" when no navigate calls happened', () => {
      h.add('click', { selector: '#a' }, 'ok');
      expect(h.summarizeFailure('click only')).toContain('(none)');
    });
  });
});
