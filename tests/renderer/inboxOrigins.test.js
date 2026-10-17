// @vitest-environment jsdom
// T1-009 (Wave 6): every feature that writes into Notes shows up in the inbox under its own name.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const NOW = new Date(2026, 9, 14, 12, 0).getTime();

let I, AT;
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  ({ VexInbox: I } = fresh(JS + 'inbox.js'));
  ({ AgentTools: AT } = fresh(JS + 'agent-tools.js'));
});

describe('AgentTools.saveNote', () => {
  it('keeps the feature that wrote the note as a from: tag, and announces the note', () => {
    const seen = [];
    document.addEventListener('vex:note-saved', (e) => seen.push(e.detail));
    const n = AT.saveNote('A line', 'body', 'https://a.test/', { origin: 'Quick-Capture!' });
    expect(n.tags).toEqual(['agent', 'from:quick-capture']);
    expect(seen).toEqual([{ id: n.id, origin: 'quick-capture' }]);
    const plain = AT.saveNote('No origin', 'body');
    expect(plain.tags).toEqual(['agent']);
  });
});

describe('the inbox names the feature', () => {
  it('maps from: tags and the tags the direct writers leave, and ignores unknown origins', () => {
    expect(I.noteOrigin({ tags: ['agent', 'from:newsletter'] })).toBe('newsletter');
    expect(I.noteOrigin({ tags: ['meeting', 'standup'] })).toBe('meeting');
    expect(I.noteOrigin({ tags: ['pdf', 'highlights'] })).toBe('pdf');
    expect(I.noteOrigin({ tags: ['cornell'] })).toBe('cornell');
    expect(I.noteOrigin({ tags: ['agent', 'from:made-up'] })).toBe('');
    expect(I.noteOrigin({})).toBe('');
  });

  it('collect() carries the origin, rank() filters by it, and the brief names it', async () => {
    const at = new Date(NOW - 1000).toISOString();
    const src = {
      notes: () => [
        { id: 'a', title: 'Digest', content: 'x', tags: ['agent', 'from:newsletter'], updatedAt: at },
        { id: 'b', title: 'Standup', content: 'y', tags: ['meeting'], updatedAt: at },
        { id: 'c', title: 'Plain', content: 'z', tags: [], updatedAt: at },
      ],
      readLater: () => [], highlights: () => ({}), sticky: () => ({}), captures: async () => [],
    };
    const { items } = await I.collect(NOW, src);
    expect(items.find(i => i.id === 'note:a').origin).toBe('newsletter');
    expect(I.rank(items, { source: 'o:meeting' }).map(i => i.id)).toEqual(['note:b']);
    expect(I.rank(items, { source: 'o:newsletter' }).map(i => i.id)).toEqual(['note:a']);
    expect(I.rank(items, { source: 'note' }).map(i => i.id).sort()).toEqual(['note:b', 'note:c']);
    localStorage.setItem('vex.notes', JSON.stringify(src.notes()));
  });
});

describe('every Notes-writing feature passes its name', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '../../src/renderer/js', f), 'utf8');
  it('no AgentTools.saveNote call outside agent-tools.js is without an origin', () => {
    const dir = path.join(__dirname, '../../src/renderer/js');
    const missing = [];
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js') && x !== 'agent-tools.js')) {
      const text = src(f);
      let at = -1;
      while ((at = text.indexOf('AgentTools.saveNote(', at + 1)) >= 0) {
        let depth = 0, i = at + 'AgentTools.saveNote'.length, q = null;
        for (; i < text.length; i++) {
          const c = text[i];
          if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
          if (c === '\'' || c === '"' || c === '`') { q = c; continue; }
          if (c === '(') depth++;
          else if (c === ')' && --depth === 0) break;
        }
        if (!/origin:/.test(text.slice(at, i))) missing.push(f + ':' + text.slice(0, at).split('\n').length);
      }
    }
    expect(missing).toEqual([]);
  });
});
