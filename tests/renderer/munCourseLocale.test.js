// @vitest-environment jsdom
// T2-057 (js/mun-dossier.js), T2-040 (js/course-spaces.js), T2-033 (js/translate-locale.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

describe('Model UN dossier', () => {
  let D;
  beforeEach(() => { localStorage.clear(); ({ VexMunDossier: D } = fresh(JS + 'mun-dossier.js')); });

  it('refuses an item without a source, and takes an address or a citation', () => {
    const d = D.create({ country: 'Brazil', committee: 'UNSC', topic: 'Water security' });
    expect(() => D.addItem(d.id, 'position', { text: 'Supports X', source: '' })).toThrow(/needs a source/);
    expect(() => D.addItem(d.id, 'position', { text: 'Supports X', source: 'short' })).toThrow(/source/);
    expect(() => D.addItem(d.id, 'position', { text: 'Supports X', source: 'javascript:alert(1)' })).toThrow(/web address|http/);
    expect(D.addItem(d.id, 'position', { text: 'Supports X', source: 'https://un.org/doc' }).added).toBe(true);
    expect(D.addItem(d.id, 'resolutions', { text: 'Sponsored it', source: 'A/RES/78/1 (2023)' }).added).toBe(true);
    expect(D.addItem(d.id, 'position', { text: 'Supports X', source: 'https://un.org/doc' }).added).toBe(false);
    expect(D.get(d.id).sections.resolutions[0].source).toEqual({ url: '', title: 'A/RES/78/1 (2023)' });
  });
  it('refuses an unknown section, a missing country and a gone dossier', () => {
    expect(() => D.create({ country: ' ' })).toThrow(/country/);
    expect(() => D.addItem('nope', 'position', { text: 'a', source: 'https://a.org' })).toThrow(/gone/);
    const d = D.create({ country: 'Chile' });
    expect(() => D.addItem(d.id, 'jokes', { text: 'a', source: 'https://a.org' })).toThrow(/Unknown section/);
  });
  it('writes a section with numbered sources, and the search links', () => {
    const d = D.create({ country: 'Brazil', topic: 'Water' });
    D.addItem(d.id, 'allies', { text: 'Votes with Argentina', source: { url: 'https://un.org/v', title: 'Voting record' } });
    const md = D.sectionMarkdown(D.get(d.id), 'allies');
    expect(md).toContain('Votes with Argentina [1]');
    expect(md).toContain('[1] Voting record - https://un.org/v');
    const links = D.unLinks('Brazil', 'Water');
    expect(links.map(l => l.url.startsWith('https://digitallibrary.un.org/search'))).toEqual([true, true, true]);
    expect(links[0].url).toContain('Water%20Brazil');
  });
  it('imports research board quotes with their pages, skipping ones with no source', () => {
    globalThis.ResearchBoard = { list: () => [{ text: 'q1', url: 'https://a.org/1', title: 'A' }, { text: 'q2', url: '', title: '' }] };
    const d = D.create({ country: 'Brazil' });
    expect(D.importBoard(d.id, 'speeches')).toBe(1);
  });
  it('makes six section notes and an index', async () => {
    const saved = [];
    globalThis.AgentTools = { saveNote: (t, c) => { const n = { id: 'n' + saved.length, title: t, content: c }; saved.push(n); return n; } };
    const d = D.create({ country: 'Brazil', topic: 'Water' });
    expect(await D.makeNotes(d.id)).toBe(7);
    expect(saved.map(n => n.title)).toContain('Brazil: dossier');
    expect(saved[saved.length - 1].content).toContain('digitallibrary.un.org');
  });
});

describe('course spaces', () => {
  let C;
  beforeEach(() => { localStorage.clear(); ({ VexCourseSpaces: C } = fresh(JS + 'course-spaces.js')); });

  it('cleans a course and refuses a bad deck address', () => {
    expect(C.clean({ name: ' Calc II ', term: 'Autumn', allow: 'a.org b.org' })).toMatchObject({ name: 'Calc II', allow: ['a.org', 'b.org'] });
    expect(() => C.clean({ name: '' })).toThrow(/name/);
    expect(() => C.clean({ name: 'x', deckUrl: 'file:///a' })).toThrow(/http/);
  });
  it('finds the next exam of a course', () => {
    const now = 1000 * 3600e3;
    const exams = [{ course: 'Calc II', date: now + 5e6 }, { course: 'calc ii', date: now + 1e6 }, { course: 'Phys', date: now + 1 }, { course: 'Calc II', date: now - 9e9 }];
    expect(C.nextExam('Calc II', exams, now).date).toBe(now + 1e6);
    expect(C.nextExam('Bio', exams, now)).toBeNull();
  });
  it('makes a course with a project space and switches to it', async () => {
    const space = { id: 's1', name: 'Calc II', noteIds: [] };
    globalThis.ProjectSpaces = { create: vi.fn().mockResolvedValue(space), get: (id) => (id === 's1' ? space : null), list: () => [space], active: () => space, switchTo: vi.fn().mockResolvedValue(space), addNote: vi.fn() };
    const c = await C.add({ name: 'Calc II', allow: 'a.org' });
    expect(c.spaceId).toBe('s1');
    await expect(C.add({ name: 'calc ii' })).rejects.toThrow(/already/);
    expect(C.current().id).toBe(c.id);
    await C.open(c.id);
    expect(ProjectSpaces.switchTo).toHaveBeenCalledWith('s1');
    C.addNote(c.id, 'note1');
    expect(ProjectSpaces.addNote).toHaveBeenCalledWith('s1', 'note1');
  });
  it('starts a study block with the course list, and refuses an empty list', () => {
    const c = (() => { localStorage.setItem('vex.courses', JSON.stringify([{ id: 'c1', name: 'Calc', allow: [], spaceId: 's' }, { id: 'c2', name: 'Phys', allow: ['a.org'], spaceId: 's' }])); return null; })();
    expect(c).toBeNull();
    globalThis.VexStudyBlock = { start: vi.fn().mockReturnValue({}) };
    expect(() => C.studyNow('c1')).toThrow(/Add the sites/);
    C.studyNow('c2', 40);
    expect(VexStudyBlock.start).toHaveBeenCalledWith({ name: 'Phys', allow: ['a.org'], minutes: 40 });
  });
});

describe('Turkish and English translation helpers', () => {
  let L;
  beforeEach(() => { localStorage.clear(); ({ VexLocaleTranslate: L } = fresh(JS + 'translate-locale.js')); });

  it('tells Turkish from English', () => {
    expect(L.detect('Bu ders için çok önemli bir konu ve herkes bunu bilmeli').lang).toBe('tr');
    expect(L.detect('The students are reading this paper and they will write a report').lang).toBe('en');
    expect(L.detect('ok').lang).toBe('');
    expect(L.detect('12345 67890 11111').lang).toBe('');
  });
  it('skips text already in the target language, not text in the other one', () => {
    const tr = 'Bu ders için çok önemli bir konu ve herkes bunu bilmeli';
    const en = 'The students are reading this paper and they will write a report';
    expect(L.skips(tr, 'tr')).toBe(true);
    expect(L.skips(en, 'tr')).toBe(false);
    expect(L.skips(tr, 'es')).toBe(false);
    L.save({ skipSame: false });
    expect(L.skips(tr, 'tr')).toBe(false);
  });
  it('never-translates a site by host, ignoring www', () => {
    expect(L.isNever('https://www.example.com/a')).toBe(false);
    L.setNever('https://www.example.com/a', true);
    expect(L.isNever('https://example.com/b')).toBe(true);
    expect(() => L.setNever('about:blank', true)).toThrow(/not a web page/);
    L.setNever('https://example.com', false);
    expect(L.isNever('https://example.com')).toBe(false);
  });
  it('writes an instruction from the profile and shapes only summaries and chat', () => {
    expect(L.instruction('summary')).toBe('');
    const prof = L.state().profile;
    prof.summary = { lang: 'tr', formality: 'formal' };
    L.save({ profile: prof, keepNames: ['Vex', 'FlashMind'] });
    const line = L.instruction('summary');
    expect(line).toContain('Turkish');
    expect(line).toContain('siz');
    expect(line).toContain('Vex, FlashMind');
    const req = { message: 'Summarise this' };
    expect(L.shapeRequest('summarize', req).message).toContain(line);
    expect(L.shapeRequest('summarize', L.shapeRequest('summarize', req)).message.split(line).length).toBe(2);   // not added twice
    expect(L.shapeRequest('translate', req)).toBe(req);
    expect(L.shapeRequest('chat', req)).toBe(req);                                   // chat profile is still auto
  });
  it('leaves everything alone when switched off', () => {
    const prof = L.state().profile; prof.summary = { lang: 'tr', formality: 'neutral' };
    L.save({ profile: prof });
    L.setEnabled(false);
    const req = { message: 'x' };
    expect(L.shapeRequest('summarize', req)).toBe(req);
    expect(L.skips('Bu ders için çok önemli bir konu ve herkes bunu bilmeli', 'tr')).toBe(false);
  });
  it('translates a compose box through the glossary and keep-names', async () => {
    globalThis.window.vex = { translateText: vi.fn(async (t) => t.replace('Hello', 'Merhaba')) };
    L.save({ keepNames: ['FlashMind'] });
    const GT = { termsFor: () => [], protect: (text, terms) => { const found = []; let out = text; for (const e of terms) out = out.replace(e.term, () => { found.push(e.term); return 'ZXQ' + (found.length - 1) + 'QXZ'; }); return { text: out, found }; }, restore: (t, found) => t.replace(/ZXQ(\d+)QXZ/g, (m, n) => found[n]), restorePartial: (t) => t, NOT_APPLIED: '[x] ' };
    globalThis.GlossaryTranslate = GT;
    const out = await L.translateText('Hello FlashMind', 'tr', '');
    expect(out).toBe('Merhaba FlashMind');
    expect(window.vex.translateText.mock.calls[0][0]).not.toContain('FlashMind');
    await expect(L.translateText('  ', 'tr')).rejects.toThrow(/Write something/);
  });
  it('builds a gloss script that is valid JavaScript', () => {
    expect(() => new Function(L.glossScript([{ term: 'Bridge', to: 'Köprü' }]))).not.toThrow();
    expect(() => new Function(L.clearGlossScript())).not.toThrow();
  });
});
