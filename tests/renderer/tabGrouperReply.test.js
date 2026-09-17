// Organize Tabs with AI (Ctrl+Shift+G) said "AI returned malformed response"
// for every failure: a reasoning model that returned nothing, a reply with a
// sentence around the JSON, a reply cut off at the token limit. The parser
// now accepts what is usable and says which way the rest failed; and the
// model sees short ids (t1…tn) instead of UUIDs, mapped back afterwards.

import { describe, it, expect } from 'vitest';
import { _shortIds, _parseGroupsReply } from '../../src/renderer/js/tab-grouper.js';

const META = [
  { id: 'tab-7e0d548b-0741-4e39-adb2-03fb898a19d8', title: 'Claude', url: 'claude.ai', summary: '' },
  { id: 'tab-3b3d0176-2dcb-4482-84d5-aa86b501d73e', title: 'Claude Code', url: 'claude.ai', summary: '' },
  { id: 'tab-ec3c4193-165d-4847-bd26-b1508173c1a7', title: 'Roblox', url: 'roblox.com', summary: '' },
];
const REPLY = { groups: [{ name: 'AI', color: 'indigo', tabIds: ['t1', 't2'], pattern: 'claude', confidence: 0.9 }], ungrouped: ['t3'], reasoning: 'two Claude tabs' };

describe('short ids', () => {
  it('sends t1…tn and keeps everything else', () => {
    const { tabs, toReal } = _shortIds(META);
    expect(tabs.map(t => t.id)).toEqual(['t1', 't2', 't3']);
    expect(tabs[0]).toMatchObject({ title: 'Claude', url: 'claude.ai' });
    expect(toReal.get('t2')).toBe(META[1].id);
    expect(META[0].id).toMatch(/^tab-7e0d/);   // the caller's list is untouched
  });
});

describe('reading the reply', () => {
  const { toReal } = _shortIds(META);

  it('maps the ids back, and drops one the model invented', () => {
    const p = _parseGroupsReply(JSON.stringify({ ...REPLY, groups: [{ ...REPLY.groups[0], tabIds: ['t1', 't2', 't9'] }] }), toReal);
    expect(p.groups[0].tabIds).toEqual([META[0].id, META[1].id]);
    expect(p.ungrouped).toEqual([META[2].id]);
    expect(p.reasoning).toBe('two Claude tabs');
  });

  it('accepts a code fence, a <think> block, a sentence either side, or an object', () => {
    const json = JSON.stringify(REPLY);
    for (const text of ['```json\n' + json + '\n```', '<think>cluster by host…</think>\n' + json, 'Here are the groups:\n' + json + '\nHope that helps!']) {
      expect(_parseGroupsReply(text, toReal).groups[0].tabIds, text.slice(0, 20)).toEqual([META[0].id, META[1].id]);
    }
    expect(_parseGroupsReply(REPLY, toReal).groups[0].tabIds).toEqual([META[0].id, META[1].id]);
  });

  it('says which way it failed', () => {
    expect(() => _parseGroupsReply('', toReal)).toThrow(/empty reply/);
    expect(() => _parseGroupsReply('<think>hmm</think>', toReal)).toThrow(/empty reply/);
    expect(() => _parseGroupsReply('{"groups": [{"name": "AI", "tabIds": ["t1", ', toReal)).toThrow(/cut off/);
    expect(() => _parseGroupsReply('I cannot help with that.', toReal)).toThrow(/not JSON: “I cannot help/);
  });

  it('copes with a reply that has no groups at all', () => {
    expect(_parseGroupsReply('{"reasoning": "nothing in common"}', toReal)).toEqual({ reasoning: 'nothing in common', groups: [], ungrouped: [] });
  });
});
