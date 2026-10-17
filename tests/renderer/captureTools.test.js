// @vitest-environment jsdom
//
// Wave 2 capture tools: the pure rules of text snippets, table extraction, video
// chapters, the newsletter lane, resurfaced highlights, unfinished-form rescue and redaction.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { VexSnippets, vexSnippetExpand, vexSnippetsInstall } = require('../../src/renderer/js/text-snippets.js');
const { TableExtract, vexTablePick } = require('../../src/renderer/js/table-extract.js');
const { VideoTools } = require('../../src/renderer/js/video-tools.js');
const { NewsletterLane } = require('../../src/renderer/js/newsletter-lane.js');
const { HighlightResurface } = require('../../src/renderer/js/highlight-resurface.js');
const { FormRescue } = require('../../src/renderer/js/form-rescue.js');
const { VexPictureRedact } = require('../../src/renderer/js/redact-tool.js');

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; delete window.__vexSnip; });

describe('text snippets', () => {
  const snips = [{ t: ':addr', x: '12 Main St' }, { t: ':sig', x: 'Thanks,\n{user} {cursor}on {date}' }];
  it('expands a trigger at the end of the text before the caret', () => {
    const r = vexSnippetExpand('Hi, my address is :addr', 23, snips, {});
    expect(r.value).toBe('Hi, my address is 12 Main St');
    expect(r.caret).toBe(28);
  });
  it('fills placeholders and puts the caret at {cursor}', () => {
    const r = vexSnippetExpand(':sig', 4, snips, { user: 'Dana', date: '2026-10-16' });
    expect(r.text).toBe('Thanks,\nDana on 2026-10-16');
    expect(r.caret).toBe('Thanks,\nDana '.length);
  });
  it('leaves unknown triggers, mid-word colons and later text alone', () => {
    expect(vexSnippetExpand(':nope', 5, snips, {})).toBeNull();
    expect(vexSnippetExpand('a:addr', 6, snips, {})).toBeNull();
    const r = vexSnippetExpand(':addr and more', 5, snips, {});
    expect(r.value).toBe('12 Main St and more');
  });
  it('validates triggers and bounds the list', () => {
    expect(VexSnippets.normTrigger('Addr')).toBe(':addr');
    expect(() => VexSnippets.normTrigger('has space')).toThrow(/trigger/);
    expect(() => VexSnippets.save(':x', '  ')).toThrow(/some text/);
    VexSnippets.save(':b', 'bee'); VexSnippets.save(':a', 'ay');
    expect(VexSnippets.list().map(s => s.trigger)).toEqual([':a', ':b']);
    VexSnippets.remove(':a');
    expect(VexSnippets.list().map(s => s.trigger)).toEqual([':b']);
  });
  it('per-site off and the global switch decide what the page is told', () => {
    VexSnippets.save(':a', 'ay');
    expect(VexSnippets.script('https://x.test/')).toContain('"on":true');
    VexSnippets.setSiteOff('https://www.x.test/page', true);
    expect(VexSnippets.siteOff('https://x.test/other')).toBe(true);
    const off = VexSnippets.script('https://x.test/');
    expect(off).toContain('"on":false');
    expect(off).toContain('"snippets":[]');
    expect(() => VexSnippets.setSiteOff('about:blank', true)).toThrow(/web page/);
    VexSnippets.setSiteOff('https://x.test/', false);
    VexSnippets.setEnabled(false);
    expect(VexSnippets.script('https://x.test/')).toContain('"on":false');
  });
  it('the page script ignores key presses a page script made (untrusted) and secret fields', () => {
    document.body.innerHTML = '<textarea id="t"></textarea><input id="p" type="password"><input id="c" name="cardnumber">';
    vexSnippetsInstall(vexSnippetExpand, { on: true, snippets: [{ t: ':a', x: 'ay' }], user: '' });
    for (const id of ['t', 'p', 'c']) {
      const el = document.getElementById(id);
      el.value = ':a';
      el.setSelectionRange(2, 2);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      expect(el.value, id).toBe(':a');
    }
  });
  it('is never injected where the page may not be read', async () => {
    VexSnippets.save(':a', 'ay');
    const wv = { executeJavaScript: vi.fn().mockResolvedValue('installed') };
    window.VexTabPolicy = { canReadWebview: () => false };
    expect(await VexSnippets.applyTo(wv, 'https://x.test/')).toBe(false);
    window.VexTabPolicy = { canReadWebview: () => true };
    expect(await VexSnippets.applyTo(wv, 'file:///c:/x.html')).toBe(false);
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
    expect(await VexSnippets.applyTo(wv, 'https://x.test/')).toBe(true);
  });
});

describe('table extraction', () => {
  const rows = [['Name', 'Note'], ['A, "B"', 'x\ny'], ['=SUM(1)', '-5'], ['-abc', '+1 2']];
  it('writes CSV with quoting and a guard against spreadsheet formulas', () => {
    const csv = TableExtract.toCsv(rows).split('\r\n');
    expect(csv[0]).toBe('Name,Note');
    expect(csv[1]).toBe('"A, ""B""","x\ny"');
    expect(csv[2]).toBe("'=SUM(1),-5");
    expect(csv[3]).toBe("'-abc,'+1 2".replace("'+1 2", '+1 2'));
  });
  it('writes Markdown with a header rule and escapes pipes', () => {
    expect(TableExtract.toMarkdown([['a', 'b|c'], ['1']])).toBe('| a | b\\|c |\n| --- | --- |\n| 1 |  |');
  });
  it('writes tab-separated text on one line per row', () => {
    expect(TableExtract.toTsv([['a\tb', 'c']])).toBe('a b\tc');
  });
  it('bounds what a page returns', () => {
    expect(() => TableExtract.clean(null)).toThrow(/no table/);
    const c = TableExtract.clean({ kind: 'x', rows: [['a'.repeat(5000)], 'oops'] });
    expect(c.kind).toBe('table');
    expect(c.rows[0][0].length).toBe(2000);
    expect(c.rows[1]).toEqual([]);
  });
  it('picks the table that is clicked, with spans and a caption', async () => {
    document.body.innerHTML = '<table id="t"><caption>Cap</caption><tr><th colspan="2">H</th></tr><tr><td>1</td><td>2</td></tr></table>';
    const p = vexTablePick(5000);
    const td = document.querySelector('td');
    td.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    td.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(await p).toEqual({ kind: 'table', caption: 'Cap', rows: [['H', ''], ['1', '2']] });
    expect(document.querySelector('[data-vex-table-pick]')).toBeNull();
  });
  it('Escape cancels the pick', async () => {
    const p = vexTablePick(5000);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(p).rejects.toThrow(/Cancelled/);
  });
  it('reads a list and a definition list', async () => {
    document.body.innerHTML = '<ol><li>one</li><li>two</li></ol><dl><dt>k</dt><dd>v</dd></dl>';
    let p = vexTablePick(5000);
    document.querySelector('li').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect((await p).rows).toEqual([['1', 'one'], ['2', 'two']]);
    p = vexTablePick(5000);
    document.querySelector('dd').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect((await p).rows).toEqual([['k', 'v']]);
  });
});

describe('video chapters', () => {
  it('parses a description list and refuses a single time stamp', () => {
    const d = 'Great talk\n0:00 Intro\n3:12 - Setup\n1:02:03 Q and A\nlink https://x.test/12:30';
    expect(VideoTools.parseChapters(d)).toEqual([{ s: 0, t: 'Intro' }, { s: 192, t: 'Setup' }, { s: 3723, t: 'Q and A' }]);
    expect(VideoTools.parseChapters('0:00 only one')).toEqual([]);
    expect(VideoTools.parseChapters('5:00 b\n1:00 a\n9:00 c').map(c => c.t)).toEqual(['b', 'c']);
  });
  it('cuts captions into parts when there are no chapters', () => {
    const cues = [{ s: 0, t: 'hello there everyone' }, { s: 100, t: 'more' }, { s: 310, t: 'second part starts here now with many words in it' }];
    const probe = { cues, description: '', chapterTrack: [] };
    const ch = VideoTools.chaptersFor(probe);
    expect(ch.list).toHaveLength(2);
    expect(ch.list[1].s).toBe(310);
    expect(ch.source).toMatch(/captions/);
  });
  it('prefers the chapter track, then the description', () => {
    expect(VideoTools.chaptersFor({ chapterTrack: [{ s: 1, t: 'a' }], description: '0:00 x\n1:00 y', cues: [] }).source).toMatch(/track/);
    expect(VideoTools.chaptersFor({ chapterTrack: [], description: '0:00 x\n1:00 y', cues: [] }).source).toMatch(/description/);
  });
  it('N and P find the next and previous chapter, P restarting the current one first', () => {
    const ch = [{ s: 0, t: 'a' }, { s: 60, t: 'b' }, { s: 120, t: 'c' }];
    expect(VideoTools.neighbour(ch, 10, 1).t).toBe('b');
    expect(VideoTools.neighbour(ch, 130, 1)).toBeNull();
    expect(VideoTools.neighbour(ch, 70, -1).t).toBe('b');
    expect(VideoTools.neighbour(ch, 61, -1).t).toBe('a');
    expect(VideoTools.neighbour(ch, 1, -1)).toBeNull();
  });
  it('formats stamps and filters the transcript', () => {
    expect(VideoTools.stamp(3723)).toBe('1:02:03');
    expect(VideoTools.stamp(65)).toBe('1:05');
    const lines = VideoTools.lines({ cues: [{ s: 1, t: 'Hello World' }, { s: -1, ts: '2:00', t: 'panel line' }] });
    expect(lines[1].s).toBe(120);
    expect(VideoTools.filter(lines, 'world')).toHaveLength(1);
  });
  it('refuses private, Tor or routed tabs', async () => {
    window.VexTabPolicy = { canReadWebview: () => false };
    await expect(VideoTools.probe({})).rejects.toThrow(/private, Tor/);
  });
});

describe('newsletter lane', () => {
  const now = Date.UTC(2026, 9, 16);
  const msg = (addr, subject, days, extra = {}) => ({ from: { name: addr.split('@')[0], address: addr }, subject, date: now - days * 86400000, seen: false, ...extra });
  it('counts a sender as a newsletter by its unsubscribe header or by your mark, not if you refused it', () => {
    const st = NewsletterLane.state();
    expect(NewsletterLane.isNewsletter(msg('a@x.test', 's', 1, { unsubscribe: 'https://x.test/u' }), st)).toBe(true);
    expect(NewsletterLane.isNewsletter(msg('b@x.test', 's', 1), st)).toBe(false);
    NewsletterLane.follow('b@x.test', 'B');
    expect(NewsletterLane.isNewsletter(msg('b@x.test', 's', 1), NewsletterLane.state())).toBe(true);
    NewsletterLane.ignore('a@x.test');
    expect(NewsletterLane.isNewsletter(msg('a@x.test', 's', 1, { unsubscribe: 'https://x.test/u' }), NewsletterLane.state())).toBe(false);
  });
  it('rolls up the last week by sender and writes a digest', () => {
    const all = [msg('a@x.test', 'One', 1, { unsubscribe: 'https://x.test/u' }), msg('a@x.test', 'Two', 2, { unsubscribe: 'https://x.test/u' }),
      msg('c@y.test', 'Old', 20, { unsubscribe: 'https://y.test/u' }), msg('d@z.test', 'Person', 1)];
    const r = NewsletterLane.rollup(all, NewsletterLane.state(), now);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: 'a@x.test', count: 2, unread: 2, unsubscribe: 'https://x.test/u' });
    expect(NewsletterLane.digestText(r, now)).toMatch(/2 from 1 sender[\s\S]*- One/);
  });
  it('only ever opens an https unsubscribe page', () => {
    expect(NewsletterLane.safeUnsubscribe('https://x.test/u?t=1')).toBe('https://x.test/u?t=1');
    expect(NewsletterLane.safeUnsubscribe('http://x.test/u')).toBe('');
    expect(NewsletterLane.safeUnsubscribe('mailto:u@x.test')).toBe('');
    expect(NewsletterLane.safeUnsubscribe('https://u:p@x.test/')).toBe('');
  });
  it('does nothing weekly unless you switched it on, and only once a week', async () => {
    const collect = vi.spyOn(NewsletterLane, 'collect').mockResolvedValue([msg('a@x.test', 'One', 1, { unsubscribe: 'https://x.test/u' })]);
    expect(await NewsletterLane.weeklyCheck(now)).toBeNull();
    expect(collect).not.toHaveBeenCalled();
    NewsletterLane.setWeekly(true);
    const suggest = vi.fn().mockReturnValue(true);
    globalThis.VexAttention = { suggest };
    await NewsletterLane.weeklyCheck(now);
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][0]).toMatchObject({ feature: 'newsletter-lane' });
    expect(await NewsletterLane.weeklyCheck(now + 3600000)).toBeNull();
    delete globalThis.VexAttention;
  });
  it('saves a newsletter to Read Later without measuring it', () => {
    const items = [];
    globalThis.ReadLater = { items, save: vi.fn() };
    globalThis.InboxTriage = { webmailMessage: () => 'https://mail.example/m/1' };
    NewsletterLane.readLater({ subject: 'S', account: {} });
    expect(items[0]).toMatchObject({ url: 'https://mail.example/m/1', title: 'S', newsletter: true });
    delete globalThis.ReadLater; delete globalThis.InboxTriage;
  });
});

describe('resurfaced highlights', () => {
  const D = 86400000;
  const now = Date.UTC(2026, 9, 16, 12);
  const hl = (id, days) => ({ id: 'h:' + id, kind: 'highlight', at: now - days * D, text: 'quote ' + id, title: 'T' + id });
  it('brings a highlight back after 1, 3, 7 and 21 days, once per step', () => {
    const seen = {};
    let due = HighlightResurface.due([hl('a', 1.1)], seen, now);
    expect(due.highlights.map(h => h.step)).toEqual([0]);
    HighlightResurface.mark(seen, due, now);
    expect(HighlightResurface.due([hl('a', 1.1)], seen, now).highlights).toEqual([]);
    expect(HighlightResurface.due([hl('a', 3.2)], seen, now).highlights[0].step).toBe(1);
    seen['h:a'] = { step: 4, at: now };
    expect(HighlightResurface.due([hl('a', 40)], seen, now).highlights).toEqual([]);
  });
  it('picks at most 3 highlights and 1 note a day, and a note only in its second week', () => {
    const items = [hl('a', 2), hl('b', 2), hl('c', 2), hl('d', 2),
      { id: 'n:1', kind: 'note', at: now - 8 * D, text: 'n', title: 'N1' }, { id: 'n:2', kind: 'note', at: now - 9 * D, text: 'n', title: 'N2' }, { id: 'n:3', kind: 'note', at: now - 3 * D, text: 'n', title: 'N3' }];
    const due = HighlightResurface.due(items, {}, now);
    expect(due.highlights).toHaveLength(3);
    expect(due.notes.map(n => n.id)).toEqual(['n:1']);
  });
  it('asks the Attention Inbox once a day and remembers what the row announced', () => {
    globalThis.Annotations = { store: { p: [{ id: 'x', text: 'a quote', at: now - 2 * D, title: 'Page', url: 'https://p.test/' }] } };
    const suggest = vi.fn().mockReturnValue(true);
    globalThis.VexAttention = { suggest };
    expect(HighlightResurface.check(now)).toBe(true);
    expect(suggest.mock.calls[0][0]).toMatchObject({ feature: 'resurface', action: { key: 'open' } });
    expect(HighlightResurface.check(now + 1000)).toBe(false);
    expect(HighlightResurface.state().pending).toEqual(['h:x']);
    delete globalThis.Annotations; delete globalThis.VexAttention;
  });
  it('is off when switched off', () => {
    HighlightResurface.setEnabled(false);
    expect(HighlightResurface.check(now)).toBe(false);
  });
});

describe('unfinished-form rescue', () => {
  it('previews the typed text and names the page by title, else host', () => {
    const e = { url: 'https://www.shop.test/cart', title: '', fields: [{ v: 'first   line' }, { v: 'second' }] };
    expect(FormRescue.label(e)).toBe('shop.test');
    expect(FormRescue.preview(e)).toBe('first line · second');
    expect(FormRescue.label({ ...e, title: 'Checkout' })).toBe('Checkout');
  });
  it('lists only closed pages that still have text', async () => {
    window.vex = { tabSnapshots: { load: async () => ({ entries: [{ url: 'https://a.test/', closed: true, closedAt: 5, fields: [{ v: 'x' }] }, { url: 'https://b.test/', fields: [{ v: 'y' }] }, { url: 'https://c.test/', closed: true, fields: [] }] }) } };
    expect((await FormRescue.list()).map(e => e.url)).toEqual(['https://a.test/']);
    delete window.vex;
  });
  it('nudges once a day, and not when there is nothing', async () => {
    const suggest = vi.fn().mockReturnValue(true);
    globalThis.VexAttention = { suggest };
    window.vex = { tabSnapshots: { load: async () => ({ entries: [] }) } };
    expect(await FormRescue.nudge()).toBe(false);
    window.vex = { tabSnapshots: { load: async () => ({ entries: [{ url: 'https://a.test/', closed: true, closedAt: 5, fields: [{ v: 'x' }] }] }) } };
    expect(await FormRescue.nudge()).toBe(true);
    expect(await FormRescue.nudge()).toBe(false);
    delete globalThis.VexAttention; delete window.vex;
  });
});

describe('redaction', () => {
  const W = (text, x0, x1 = x0 + text.length * 10) => ({ text, bbox: { x0, y0: 0, x1, y1: 10 } });
  it('checks card numbers with Luhn', () => {
    expect(VexPictureRedact.luhn('4242 4242 4242 4242')).toBe(true);
    expect(VexPictureRedact.luhn('4242 4242 4242 4243')).toBe(false);
    expect(VexPictureRedact.luhn('123')).toBe(false);
  });
  it('suggests emails, valid cards, phones and long tokens, and merges the words of a match', () => {
    const lines = [
      { words: [W('Mail', 0), W('dana@example.com', 50)] },
      { words: [W('Card', 0), W('4242', 50), W('4242', 100), W('4242', 150), W('4242', 200)] },
      { words: [W('Call', 0), W('+90', 50), W('532', 90), W('123', 130), W('45', 170), W('67', 200)] },
      { words: [W('key', 0), W('x'.repeat(20) + 'Y'.repeat(12) + '1234', 50)] },
      { words: [W('Order', 0), W('number', 60), W('12', 140)] },
    ];
    const found = VexPictureRedact.findSensitive(lines);
    const kinds = found.map(f => f.kind).sort();
    expect(kinds).toEqual(['card', 'email', 'phone', 'token']);
    const card = found.find(f => f.kind === 'card');
    expect(card.x).toBe(50);
    expect(card.x + card.w).toBe(240);
  });
  it('does not flag an invalid card number as a card', () => {
    const f = VexPictureRedact.findSensitive([{ words: [W('1111', 0), W('2222', 50), W('3333', 100), W('4445', 150)] }]);
    expect(f.some(x => x.kind === 'card')).toBe(false);
  });
  it('pads a region inside the picture and writes the watermark line', () => {
    expect(VexPictureRedact.pad({ x: 2, y: 2, w: 10, h: 10 }, 5, 100, 14)).toMatchObject({ x: 0, y: 0, w: 17, h: 14 });
    expect(VexPictureRedact.watermarkText('the bank', new Date('2026-10-16T10:00:00Z'))).toBe('For the bank only, 2026-10-16');
    expect(VexPictureRedact.watermarkText('  ')).toBe('');
  });
  it('refuses a file that is not a picture', async () => {
    await expect(VexPictureRedact.stripFile({ type: 'application/pdf', name: 'a.pdf' })).rejects.toThrow(/PNG, JPEG/);
  });
});
