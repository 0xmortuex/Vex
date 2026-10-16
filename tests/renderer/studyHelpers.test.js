// @vitest-environment jsdom
// Wave 3 study helpers: T3-027 glossary, T3-029 ledger, T3-044 cheat sheet, T3-104 draft check,
// T3-106 syllabus check, T3-115 source badge, T3-034 reading aids (js/study-*.js and friends).
import { describe, it, expect, beforeEach } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

beforeEach(() => {
  localStorage.clear();
  globalThis.VexStudyKit = fresh(JS + 'study-kit.js').VexStudyKit;
  delete globalThis.VexCourseSpaces;
  delete globalThis.VexStudyBlock;
  delete globalThis.Annotations;
});

describe('study kit', () => {
  it('a damaged value is reported, not replaced', () => {
    localStorage.setItem('vex.x', '{nope');
    const s = VexStudyKit.store('vex.x', { a: 1 });
    expect(() => s.get()).toThrow(/damaged/);
    expect(localStorage.getItem('vex.x')).toBe('{nope');
  });
  it('folds Turkish letters and drops endings only for matching', () => {
    expect(VexStudyKit.fold('Işık')).toBe(VexStudyKit.fold('isik'));
    expect(VexStudyKit.stem('hormones')).toBe(VexStudyKit.stem('hormone'));
  });
  it('diffs by word and keeps both sides', () => {
    const ops = VexStudyKit.diffWords('calls upon all states', 'calls on all member states');
    expect(ops.map(o => o.op)).toContain('add');
    expect(ops.filter(o => o.op !== 'add').map(o => o.text).join('')).toBe('calls upon all states');
    expect(ops.filter(o => o.op !== 'del').map(o => o.text).join('')).toBe('calls on all member states');
    expect(() => VexStudyKit.diffWords('a '.repeat(4100), 'b')).toThrow(/too long/);
  });
});

describe('T3-027 glossary', () => {
  let G;
  beforeEach(() => { ({ VexStudyGlossary: G } = fresh(JS + 'study-glossary.js')); });

  it('finds definitions written the usual ways and nothing else', () => {
    const text = [
      'Photosynthesis: the process by which plants turn light into chemical energy.',
      'Mitosis is defined as the division of a cell into two identical daughter cells.',
      '- Osmosis - movement of water across a membrane toward higher solute concentration',
      'The weather was nice yesterday and we walked to the park.',
      'Short: no',
    ].join('\n');
    const terms = G.harvest(text).map(c => c.term);
    expect(terms).toEqual(expect.arrayContaining(['Photosynthesis', 'Mitosis', 'Osmosis']));
    expect(terms.length).toBe(3);
  });
  it('refuses an entry without a definition and keeps the source', () => {
    expect(() => G.add({ term: 'Osmosis', def: '' })).toThrow(/definition/);
    const e = G.add({ term: 'Osmosis', def: 'Water moving across a membrane.', source: { url: 'https://a.org/x', title: 'A' } });
    expect(G.list('General')).toHaveLength(1);
    expect(e.source.url).toBe('https://a.org/x');
    G.add({ term: 'osmosis', def: 'Changed.' });
    expect(G.list('General')).toHaveLength(1);
    expect(G.list('General')[0].def).toBe('Changed.');
  });
  it('uses the current course as the subject when courses exist', () => {
    globalThis.VexCourseSpaces = { current: () => ({ name: 'Biology' }) };
    G.add({ term: 'Cell', def: 'The unit of life.' });
    expect(G.subjects()).toEqual(['Biology']);
  });
  it('a damaged glossary throws and is left alone', () => {
    localStorage.setItem(G.KEY, 'oops');
    expect(() => G.list()).toThrow(/damaged/);
    expect(localStorage.getItem(G.KEY)).toBe('oops');
  });
  it('puts a card on the first occurrence in the page, and not inside links or boxes', () => {
    const { vexGlossaryPageLib } = fresh(JS + 'study-glossary.js');
    document.body.innerHTML = '<p>Osmosis is common. Osmosis again.</p><a href="#">Osmosis link</a><textarea>osmosis</textarea>';
    const n = vexGlossaryPageLib([{ term: 'Osmosis', def: 'Water across a membrane.', src: 'Notes' }]);
    expect(n).toBe(1);
    expect(document.querySelectorAll('[data-vex-gl]')).toHaveLength(1);
    expect(document.querySelector('[data-vex-gl]').closest('p')).toBeTruthy();
  });
  it('only injects on ordinary pages, with cards on, and when there is a term', () => {
    const calls = [];
    const wv = { executeJavaScript: (js) => { calls.push(js); return Promise.resolve(0); } };
    expect(G.applyTo(wv, 'https://a.org/')).toBe(false);          // no term yet
    G.add({ term: 'Cell', def: 'The unit of life.' });
    expect(G.applyTo(wv, 'file:///start.html')).toBe(false);
    expect(G.applyTo(wv, 'https://a.org/')).toBe(true);
    G.setCards(false);
    expect(G.applyTo(wv, 'https://a.org/')).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('"term":"Cell"');
  });
  it('hands its terms to the translate glossary as kept-as-written', () => {
    const added = [];
    globalThis.GlossaryTranslate = { addTerm: (h, t, to) => added.push([h, t, to]) };
    G.add({ term: 'Cell', def: 'The unit of life.' });
    expect(G.toTranslateGlossary('General')).toBe(1);
    expect(added).toEqual([['*', 'Cell', '']]);
    delete globalThis.GlossaryTranslate;
  });
});

describe('T3-029 study ledger', () => {
  let L;
  beforeEach(() => { ({ VexStudyLedger: L } = fresh(JS + 'study-ledger.js')); });
  const MON = new Date(2026, 9, 12, 10).getTime();   // Monday 12 Oct 2026

  it('weeks start on Monday', () => {
    expect(new Date(L.weekStart(new Date(2026, 9, 18, 23).getTime())).getDate()).toBe(12);
    expect(new Date(L.weekStart(MON)).getDay()).toBe(1);
  });
  it('times a subject, refuses a second timer, and drops under a minute', () => {
    L.start('Calculus', MON);
    expect(() => L.start('Chemistry', MON)).toThrow(/already running/);
    expect(L.stop(MON + 20000)).toBeNull();
    L.start('Calculus', MON);
    expect(L.stop(MON + 50 * 60000).minutes).toBe(50);
    expect(() => L.stop()).toThrow(/No timer/);
  });
  it('refuses nonsense by hand and sums planned against actual', () => {
    expect(() => L.log('Chem', 0)).toThrow(/Minutes/);
    expect(() => L.log('', 30)).toThrow(/subject/);
    expect(() => L.log('Chem', 30, Date.now() + 86400000)).toThrow(/future/);
    L.log('Chem', 40, MON); L.log('Chem', 20, MON + 86400000); L.log('Calculus', 90, MON);
    L.log('Chem', 500, MON - 8 * 86400000);                       // last week: not counted
    L.setTarget('Chem', 120);
    L.setTarget('History', 60);
    const s = L.summary(MON + 2 * 86400000);
    expect(s.total).toBe(150);
    expect(s.rows.find(r => r.subject === 'Chem')).toMatchObject({ minutes: 60, planned: 120 });
    expect(s.rows.find(r => r.subject === 'History')).toMatchObject({ minutes: 0, planned: 60 });
  });
  it('counts an ended study block once', () => {
    const log = [{ at: MON, kind: 'started', name: 'Physics', minutes: 45 }, { at: MON + 45 * 60000, kind: 'ended', name: 'Physics', how: 'time' }];
    globalThis.VexStudyBlock = { log: () => log };
    expect(L.importBlocks()).toBe(1);
    expect(L.importBlocks()).toBe(0);
    expect(L.summary(MON).rows[0]).toMatchObject({ subject: 'Physics', minutes: 45 });
  });
  it('gives the weekly review a section with the learned line', () => {
    L.log('Chem', 60, MON);
    L.setLearned('Moles finally make sense', MON);
    const sec = L.reviewSection(MON);
    expect(sec.summary).toBe('1 h of study this week');
    expect(sec.items.map(i => i.text)).toContain('What I learned: Moles finally make sense');
    L.setEnabled(false);
    expect(L.reviewSection(MON)).toBeNull();
  });
});

describe('T3-044 cheat sheet', () => {
  let C;
  beforeEach(() => { ({ VexCheatSheet: C } = fresh(JS + 'cheat-sheet.js')); });
  const store = {
    'https://a.org/calc': [
      { id: 1, text: 'd/dx x^2 = 2x', note: '#formula @calculus power rule', title: 'Calc notes', url: 'https://a.org/calc', at: 2 },
      { id: 2, text: 'Not tagged', note: 'plain', title: 'Calc notes', url: 'https://a.org/calc', at: 1 },
    ],
    'https://b.org/phys': [{ id: 3, text: 'F = ma', note: '#Formula', title: 'Physics', url: 'https://b.org/phys', at: 3 }],
  };
  it('reads tags and subjects out of a note', () => {
    expect(C.parseTags('see #Formula and #şekil @Calculus')).toEqual({ tags: ['formula', 'sekil'], subjects: ['calculus'] });
    expect(C.parseTags('email me@x.org #')).toEqual({ tags: [], subjects: [] });
  });
  it('groups tagged highlights by subject, else by page title', () => {
    const g = C.collect(store, { tag: 'formula' });
    expect(g.map(x => x.subject)).toEqual(['calculus', 'Physics']);
    expect(g[0].items[0].note).toBe('power rule');
    expect(C.collect(store, { tag: '#formula', subject: '@calculus' })).toHaveLength(1);
    expect(C.tags(store)).toEqual([{ tag: 'formula', n: 2 }]);
  });
  it('writes markdown and an escaped printable page', () => {
    const g = C.collect({ u: [{ text: '<b>x</b>', note: '#fx', url: 'https://a.org' }] }, { tag: 'fx' });
    expect(C.markdown(g, 'fx')).toContain('- <b>x</b>');
    expect(C.html(g, 'fx')).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(C.html(g, 'fx')).not.toContain('<b>x</b>');
  });
  it('says so when nothing carries the tag', () => {
    globalThis.Annotations = { store };
    expect(() => C.build('nothing')).toThrow(/No highlight carries #nothing/);
    expect(C.build('formula')).toHaveLength(2);
  });
});

describe('T3-104 draft check', () => {
  let D;
  beforeEach(() => { ({ VexDraftCheck: D } = fresh(JS + 'draft-check.js')); });
  const sources = [
    { id: 'n:1', kind: 'note', title: 'Sleep notes', url: '', text: 'A 2019 study found that teenagers who slept less than 7 hours had 30 percent lower exam scores. Sleep helps memory.' },
    { id: 'r:2', kind: 'saved page', title: 'Unrelated page', url: 'https://x.org', text: 'Volcanoes erupt when pressure builds in the magma chamber.' },
  ];
  it('picks out sentences that make claims', () => {
    const c = D.claims('Hello there. Studies show that teenagers need more sleep than adults do. Is it true? In 2019 the rate fell by 30 percent in most schools.');
    expect(c).toHaveLength(2);
  });
  it('marks supported, partly and unsupported, with the passage', () => {
    const draft = 'A 2019 study found that teenagers who slept less than 7 hours had 30 percent lower exam scores.\n\nResearch shows that volcanoes cause strong global cooling after every eruption.\n\nThe moon is made of green cheese according to many people in town.';
    const r = D.check(draft, sources);
    expect(r.claims[0].verdict).toBe('supported');
    expect(r.claims[0].best.source.id).toBe('n:1');
    expect(r.claims[2].verdict).toBe('none');
    expect(r.claims[2].best).toBeNull();
  });
  it('a number that the source does not have blocks "supported"', () => {
    const r = D.check('A 2019 study found that teenagers who slept less than 7 hours had 80 percent lower exam scores.', sources);
    expect(r.claims[0].verdict).not.toBe('supported');
  });
  it('lists uncited paragraphs and sources nothing leans on', () => {
    const r = D.check('A 2019 study found that teenagers who slept less than 7 hours had 30 percent lower exam scores (Lee, 2019). ' + 'x'.repeat(10) + '\n\n' + 'This paragraph makes a long general argument without any marker of where the ideas came from at all.', sources);
    expect(r.uncited).toHaveLength(1);
    expect(r.unused.map(u => u.title)).toEqual(['Unrelated page']);
  });
  it('never touches the draft and refuses cloud: no local model means an error', async () => {
    await expect(D.judge('claim', 'passage')).rejects.toThrow(/No local model/);
  });
  it('asks the local model for a one-word label and shows only the label', async () => {
    globalThis.Ollama = { generate: async () => 'SUPPORTS. The passage clearly says so.' };
    globalThis.AIRouter = { isOllamaAvailable: () => true, getModel: () => 'm' };
    expect(await D.judge('c', 'p')).toBe('supports');
    globalThis.Ollama = { generate: async () => 'maybe?' };
    await expect(D.judge('c', 'p')).rejects.toThrow(/did not answer/);
    delete globalThis.Ollama; delete globalThis.AIRouter;
  });
  it('gathers notes (not the draft), highlights and read later', () => {
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'a', title: 'Draft', content: 'draft text' }, { id: 'b', title: 'Other', content: 'other note text' }]));
    localStorage.setItem('vex.annotations', JSON.stringify({ 'https://p.org': [{ text: 'quoted', title: 'P', url: 'https://p.org' }] }));
    localStorage.setItem('vex.readLater', JSON.stringify([{ id: 'r', title: 'Saved', url: 'https://s.org', excerpt: 'saved text' }]));
    expect(D.sources('a').map(s => s.kind).sort()).toEqual(['highlights', 'note', 'saved page']);
  });
});

describe('T3-106 syllabus coverage', () => {
  let S;
  beforeEach(() => { ({ VexSyllabusCheck: S } = fresh(JS + 'syllabus-check.js')); });
  it('reads a pasted list with bullets, numbers and weeks', () => {
    expect(S.parseTopics('1. Limits and continuity\n- Derivatives\n* Derivatives\nWeek 3: Integration by parts\nok\n; Series')).toEqual(['Limits and continuity', 'Derivatives', 'Integration by parts', 'Series']);
  });
  it('calls a topic covered, thin or missing', () => {
    const items = [
      { kind: 'note', title: 'Derivatives', text: 'Derivatives measure rates of change. ' + 'The derivative of a function '.repeat(30) },
      { kind: 'note', title: 'Limits', text: 'A limit describes behaviour near a point.' },
      { kind: 'highlights', title: 'Limits page', text: 'limit continuity definition' },
      { kind: 'note', title: 'Continuity', text: 'Limits and continuity are linked.' },
      { kind: 'note', title: 'Cooking', text: 'Boil the pasta.' },
    ];
    const r = S.check(['Derivatives', 'Limits and continuity', 'Integration by parts', 'Series convergence'], items);
    const st = Object.fromEntries(r.map(x => [x.topic, x.status]));
    expect(st['Derivatives']).toBe('covered');
    expect(st['Limits and continuity']).toBe('covered');
    expect(st['Integration by parts']).toBe('missing');
    expect(st['Series convergence']).toBe('missing');
    expect(S.summary(r)).toEqual({ covered: 2, thin: 0, missing: 2, total: 4 });
    expect(S.checklist(r, 'Calc')).toContain('- [ ] Integration by parts (missing)');
  });
  it('finds Turkish topics by folded words and counts a pasted deck line as an item', () => {
    const items = S.items('Işık ve gölge\nKalıtım');
    const r = S.check(['Isik ve golge', 'Kalitim'], items);
    expect(r.map(x => x.status)).toEqual(['thin', 'thin']);
    expect(r[0].matches[0].kind).toBe('deck');
  });
  it('keeps at most 20 saved syllabi and needs a name', () => {
    expect(() => S.save('', 'x')).toThrow(/Name/);
    for (let i = 0; i < 25; i++) S.save('c' + i, 'topic ' + i);
    expect(S.saved()).toHaveLength(20);
    expect(S.saved()[0].name).toBe('c24');
  });
});

describe('T3-115 source badge', () => {
  let B;
  const NOW = Date.parse('2026-10-16T00:00:00Z');
  beforeEach(() => { ({ VexSourceBadge: B } = fresh(JS + 'source-badge.js')); });
  const flag = (r, id) => r.flags.find(f => f.id === id);

  it('classifies addresses without calling any of them true', () => {
    expect(B.domainKind('www.bilkent.edu.tr').id).toBe('edu');
    expect(B.domainKind('data.tuik.gov.tr').id).toBe('gov');
    expect(B.domainKind('en.wikipedia.org').id).toBe('wiki');
    expect(B.domainKind('someone.medium.com').id).toBe('blog');
    expect(B.domainKind('reddit.com').id).toBe('social');
    expect(B.domainKind('example.org').id).toBe('org');
    expect(B.domainKind('example.com').id).toBe('com');
  });
  it('reads age, author, https, citations and opinion', () => {
    const r = B.assess({ url: 'http://blog.example.com/opinion/x', date: '2018-03-01', author: false, outLinks: 0, refs: false }, NOW);
    expect(r.rough).toBe(true);
    expect(flag(r, 'https').tone).toBe('warn');
    expect(flag(r, 'age').label).toMatch(/about 9 years ago/);
    expect(flag(r, 'author').tone).toBe('warn');
    expect(flag(r, 'cites').tone).toBe('warn');
    expect(flag(r, 'opinion')).toBeTruthy();
    const good = B.assess({ url: 'https://www.nih.gov/a', date: '2026-08-01T00:00:00Z', author: true, outLinks: 6, refs: true }, NOW);
    expect(flag(good, 'age').tone).toBe('good');
    expect(flag(good, 'cites').tone).toBe('good');
    expect(flag(good, 'opinion')).toBeUndefined();
  });
  it('a date in the future or unreadable is "no date", not a guess', () => {
    expect(flag(B.assess({ url: 'https://a.org', date: '2030-01-01' }, NOW), 'age').label).toMatch(/No publication date/);
    expect(flag(B.assess({ url: 'https://a.org', date: 'soon' }, NOW), 'age').label).toMatch(/No publication date/);
  });
  it('the page scanner finds the facts in a document', () => {
    const { vexSourcePageLib } = fresh(JS + 'source-badge.js');
    document.head.innerHTML = '<meta property="article:published_time" content="2025-01-02"><meta name="author" content="A. Writer">';
    document.body.innerHTML = '<article><a href="https://other.org/1">1</a><a href="https://third.net/2">2</a><h2>References</h2></article>';
    const f = vexSourcePageLib();
    expect(f.date).toBe('2025-01-02');
    expect(f.author).toBe(true);
    expect(f.outLinks).toBe(2);
    expect(f.refs).toBe(true);
  });
  it('refuses a page that is not on the web', async () => {
    await expect(B.inspect({ executeJavaScript: async () => ({}), getURL: () => 'file:///a.html' })).rejects.toThrow(/not a web page/);
  });
});

describe('T3-034 reading aids', () => {
  let A;
  beforeEach(() => { ({ AccessibilityPack: A } = fresh(JS + 'accessibility.js')); });
  it('writes only values from its own lists', () => {
    expect(A.aidsCss({ lineSpacing: '1.8', letterSpacing: 'wide' })).toContain('line-height:1.8!important');
    expect(A.aidsCss({ lineSpacing: '1.8', letterSpacing: 'wide' })).toContain('letter-spacing:.1em');
    expect(A.aidsCss({ lineSpacing: 'red;}body{display:none', letterSpacing: 'off' })).toBe('');
    expect(A.aidsCss({ lineSpacing: 'off', letterSpacing: 'off' })).toBe('');
  });
  it('has a system-font option that downloads nothing', () => {
    expect(A.FONTS.system).not.toMatch(/@import|url\(/);
    expect(A.FONTS.system).toContain('Verdana');
  });
  it('injects the aids with the page style, and takes the focus line off again', () => {
    const sent = [];
    A.cfg = { ...A.cfg, font: 'system', lineSpacing: '1.5', focusLine: true };
    A.applyTo({ executeJavaScript: (js) => { sent.push(js); return Promise.resolve(); } });
    expect(sent[0]).toContain('line-height:1.5');
    expect(sent[0]).toContain('__vexFocusOff=function');
    A.cfg.focusLine = false;
    A.applyTo({ executeJavaScript: (js) => { sent.push(js); return Promise.resolve(); } });
    expect(sent[1]).toContain('if(window.__vexFocusOff){window.__vexFocusOff();}');
  });
  it('the focus line follows the pointer and removes its listener', () => {
    document.body.innerHTML = '';
    // eslint-disable-next-line no-new-func
    new Function(A.focusLineJs(true))();
    expect(document.getElementById('vex-focus-top')).toBeTruthy();
    document.dispatchEvent(new MouseEvent('mousemove', { clientY: 200 }));
    expect(document.getElementById('vex-focus-top').style.height).toBe('170px');
    expect(document.getElementById('vex-focus-bottom').style.top).toBe('230px');
    new Function(A.focusLineJs(false))();
    expect(document.getElementById('vex-focus-top')).toBeNull();
    expect(window.__vexFocusOff).toBeNull();
  });
});
