// @vitest-environment jsdom
//
// js/writing-desk.js (T3-094): drafts with sources, reference boards, the asset shelf.
import { describe, it, expect, beforeEach } from 'vitest';

globalThis.VexMediaKit = require('../../src/renderer/js/media-kit.js').VexMediaKit;
const { VexWritingDesk } = require('../../src/renderer/js/writing-desk.js');

beforeEach(() => { localStorage.clear(); VexWritingDesk.setEnabled(true); });

describe('drafts', () => {
  it('counts words, including accents and apostrophes, and exports Markdown with sources', () => {
    expect(VexWritingDesk.wordCount("Don't panic: caf\u00e9 au lait, 3 cups")).toBe(7);
    expect(VexWritingDesk.wordCount('')).toBe(0);
    const d = VexWritingDesk.newDraft('My post', [{ url: 'https://a.example/x', title: 'A [source]' }]);
    VexWritingDesk.saveDraft(d.id, { text: 'Hello world.' });
    const md = VexWritingDesk.markdown(VexWritingDesk.data().drafts[0]);
    expect(md).toBe('# My post\n\nHello world.\n\n## Sources\n\n- [A source](https://a.example/x)\n');
  });
  it('saves the title and text, refuses a text that is too long, and caps drafts at 30', () => {
    const d = VexWritingDesk.newDraft();
    expect(VexWritingDesk.saveDraft(d.id, { title: '  ' }).title).toBe('Untitled draft');
    expect(() => VexWritingDesk.saveDraft(d.id, { text: 'x'.repeat(200001) })).toThrow(/up to 200000/);
    expect(() => VexWritingDesk.saveDraft('nope', { text: 'x' })).toThrow(/not on the desk/);
    for (let i = 0; i < 29; i++) VexWritingDesk.newDraft('d' + i);
    expect(() => VexWritingDesk.newDraft('one more')).toThrow(/30 drafts/);
  });
  it('keeps a source once and only as a web address', () => {
    const d = VexWritingDesk.newDraft();
    VexWritingDesk.addSource(d.id, 'https://a.example/x', 'A');
    expect(() => VexWritingDesk.addSource(d.id, 'https://a.example/x', 'A')).toThrow(/already/);
    expect(() => VexWritingDesk.addSource(d.id, 'file:///c:/secret', 'A')).toThrow(/Only a web address/);
    VexWritingDesk.removeSource(d.id, 'https://a.example/x');
    expect(VexWritingDesk.data().drafts[0].sources).toEqual([]);
  });
  it('opens a draft from a content card with the card\'s sources beside it', () => {
    VexWritingDesk.open = () => {};
    const d = VexWritingDesk.fromCard({ title: 'Recap', sources: [{ url: 'https://a.example/1', title: 'One' }] });
    expect(d).toMatchObject({ title: 'Recap', sources: [{ url: 'https://a.example/1', title: 'One' }] });
  });
});

describe('boards and the shelf', () => {
  it('cleans a colour, an image address and a link, and refuses the rest', () => {
    expect(VexWritingDesk.cleanItem('color', '3366FF').value).toBe('#3366ff');
    expect(VexWritingDesk.cleanItem('color', '#abc').value).toBe('#abc');
    expect(() => VexWritingDesk.cleanItem('color', 'red')).toThrow(/like #3366ff/);
    expect(VexWritingDesk.cleanItem('image', 'https://a.example/i.png').value).toBe('https://a.example/i.png');
    expect(() => VexWritingDesk.cleanItem('image', 'data:image/png;base64,AAAA')).toThrow(/Only a web address/);
    expect(() => VexWritingDesk.cleanItem('text', '')).toThrow(/value/);
  });
  it('keeps items on a board and on the shelf within their limits', () => {
    const b = VexWritingDesk.addBoard('Palette');
    VexWritingDesk.addBoardItem(b.id, 'color', '#112233', 'Navy');
    expect(() => VexWritingDesk.addBoardItem(b.id, 'text', 'x', '')).toThrow(/colours, images and links/);
    expect(() => VexWritingDesk.addBoardItem('nope', 'color', '#112233')).toThrow(/not there/);
    VexWritingDesk.addShelf('text', 'No spam. Be kind.', 'Rules');
    expect(VexWritingDesk.data().shelf[0]).toMatchObject({ kind: 'text', label: 'Rules', value: 'No spam. Be kind.' });
    for (let i = 0; i < 59; i++) VexWritingDesk.addShelf('text', 'line ' + i, '');
    expect(() => VexWritingDesk.addShelf('text', 'too many', '')).toThrow(/holds 60/);
    VexWritingDesk.removeBoard(b.id);
    expect(VexWritingDesk.data().boards).toEqual([]);
  });
  it('throws on a damaged desk instead of starting an empty one', () => {
    localStorage.setItem('vex.writing', '{"drafts":1}');
    expect(() => VexWritingDesk.data()).toThrow(/not readable/);
  });
});
