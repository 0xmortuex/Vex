// @vitest-environment jsdom
// Wave 3: T3-028 MUN toolkit, T3-076 speech timer, T3-049 Turkish helpers.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const JS = '../../src/renderer/js/';
globalThis.vexId = (prefix = '') => prefix + Math.random().toString(36).slice(2, 10);   // vex-utils.js is a page global
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  globalThis.VexStudyKit = fresh(JS + 'study-kit.js').VexStudyKit;
});

describe('T3-028 MUN toolkit', () => {
  let M;
  beforeEach(() => { ({ VexMunToolkit: M } = fresh(JS + 'mun-toolkit.js')); });

  it('the procedure card is generic, in both languages, and says the conference rules win', () => {
    for (const lang of ['en', 'tr']) {
      const c = M.CARD[lang];
      expect(c.rows.length).toBeGreaterThanOrEqual(12);
      expect(c.warn.length).toBeGreaterThan(40);
    }
    expect(M.CARD.en.warn).toMatch(/Rules of Procedure/);
    expect(M.CARD.tr.warn).toMatch(/İç Tüzüğü/);
    // No vote thresholds are invented.
    expect(JSON.stringify(M.CARD)).not.toMatch(/two-thirds|simple majority|2\/3|\bmajority\b/i);
  });
  it('fills motions with your words and leaves blanks for the rest', () => {
    expect(M.motion('mod', { country: 'Chile', topic: 'Water', minutes: 10, seconds: 60 })).toBe('Honourable Chair, the delegate of Chile moves for a moderated caucus on the topic of "Water" for a total of 10 minutes with a speaking time of 60 seconds.');
    expect(M.motion('unmod', { country: 'Chile' }, 'tr')).toContain('___ dakikalık');
    expect(() => M.motion('nope')).toThrow(/Unknown motion/);
  });
  it('counts clauses and finds numbering and punctuation slips', () => {
    const ok = 'Committee: X\n\nThe committee,\n\nRecalling the charter of the UN,\n\nDeeply concerned by the lack of clean water,\n\n1. Calls upon all states to act;\n\n2. Encourages sharing of data;\n\n3. Decides to remain seized.';
    expect(M.countClauses(ok)).toEqual({ preamb: 2, operative: 3, numbering: [] });
    const bad = '1. First clause;\n\n3. Third clause\n\n4. Fourth clause;';
    const r = M.countClauses(bad);
    expect(r.operative).toBe(3);
    expect(r.numbering.join('|')).toMatch(/Clause 3 comes where 2/);
    expect(r.numbering.join('|')).toMatch(/Clause 3 does not end/);
    expect(r.numbering.join('|')).toMatch(/last clause \(4\) should end in a full stop/);
  });
  it('the shipped resolution template has the right shape', () => {
    const r = M.countClauses(M.TEMPLATES.resolution.en);
    expect(r.operative).toBe(4);
    expect(r.numbering).toEqual([]);
  });
  it('groups word changes and merges by accept / reject', () => {
    const K = VexStudyKit;
    const ops = K.diffWords('1. Calls upon all states to reduce emissions;', '1. Urges all member states to sharply reduce emissions;');
    const ch = M.changes(ops);
    expect(ch.length).toBeGreaterThanOrEqual(2);
    expect(M.merge(ops, ch.map(() => true))).toBe('1. Urges all member states to sharply reduce emissions;');
    expect(M.merge(ops, ch.map(() => false))).toBe('1. Calls upon all states to reduce emissions;');
    const mixed = M.merge(ops, ch.map((c, i) => i === 0));
    expect(mixed).toContain('Urges');
    expect(mixed).not.toContain('sharply');
  });
  it('turns the conference date into dated checklists and refuses without one', () => {
    const d = new Date(2027, 2, 20, 9).getTime();
    const items = M.checklistDates(d, 'paper');
    expect(new Date(items[0].date).getDate()).toBe(18);        // 30 days before 20 March = 18 Feb
    expect(items[0].key).toBe('paper:0');
    expect(() => M.checklistDates(NaN, 'paper')).toThrow(/Set the conference date/);
    expect(() => M.checklistDates(d, 'x')).toThrow(/Unknown checklist/);
  });
  it('a statistic needs a source and a year, and goes stale after three years', () => {
    expect(() => M.addStat({ text: '2.2 billion lack safe water', source: '', year: 2023 })).toThrow(/source/);
    expect(() => M.addStat({ text: '2.2 billion', source: 'WHO report', year: 'x' })).toThrow(/year/);
    M.addStat({ text: '2.2 billion lack safe water', source: 'WHO/UNICEF JMP', year: 2023 });
    expect(M._read().stats).toHaveLength(1);
    expect(M.isStale(2020, new Date(2026, 5, 1))).toBe(true);
    expect(M.isStale(2023, new Date(2026, 5, 1))).toBe(false);
  });
  it('stance notes are one per country and an empty note removes it', () => {
    M.setStance('Brazil', 'Pro-fund'); M.setStance('brazil', 'Pro-fund, wants audit');
    expect(M._read().stances).toEqual([{ country: 'Brazil', note: 'Pro-fund, wants audit' }]);
    M.setStance('Brazil', '');
    expect(M._read().stances).toEqual([]);
    expect(() => M.setStance(' ', 'x')).toThrow(/country/);
  });
  it('adds snippets only after a yes, skips duplicates, and says if snippets are missing', async () => {
    await expect(M.addSnippets()).rejects.toThrow(/Snippets are not available/);
    const items = [{ abbr: ';motion-mod' }];
    globalThis.Snippets = { items, add: (a, t, n) => { items.push({ abbr: a }); return { abbr: a, text: t, name: n }; } };
    globalThis.window.vexConfirm = vi.fn(async () => false);
    expect(await M.addSnippets()).toBe(0);
    expect(items).toHaveLength(1);
    window.vexConfirm = vi.fn(async () => true);
    expect(await M.addSnippets()).toBe(M.MOTIONS.length - 1);
    delete globalThis.Snippets;
  });
});

describe('T3-076 speech timer', () => {
  let T;
  beforeEach(() => {
    ({ VexSpeechTimer: T } = fresh(JS + 'speech-timer.js'));
    globalThis.VexSettingsGroups = undefined;
  });
  afterEach(() => { T.close(); vi.useRealTimers(); });

  it('formats and counts down', () => {
    expect(T.fmt(65)).toBe('1:05');
    expect(T.fmt(0)).toBe('0:00');
    expect(T.fmt(29.2)).toBe('0:30');
    expect(T.remaining({ total: 60000, left: 60000, startedAt: 0 }, 5)).toBe(60000);
    expect(T.remaining({ total: 60000, left: 60000, startedAt: 1000 }, 21000)).toBe(40000);
    expect(T.remaining({ total: 60000, left: 1000, startedAt: 1000 }, 9000)).toBe(0);
  });
  it('keeps a speakers list with notes and the next one up', () => {
    expect(() => T.addSpeaker(' ')).toThrow(/name/);
    T.addSpeaker('Brazil', 'wants audit'); T.addSpeaker('Chile');
    expect(T.nextUp().name).toBe('Brazil');
    T.recordLap(T.nextUp().id, 47.4);
    expect(T.nextUp().name).toBe('Chile');
    expect(T._read().speakers[0].spoke).toBe(47);
    T.setNote(T._read().speakers[1].id, 'neutral');
    expect(T._read().speakers[1].note).toBe('neutral');
    expect(() => T.setNote('nope', 'x')).toThrow(/gone/);
    expect(() => { for (let i = 0; i < 70; i++) T.addSpeaker('s' + i); }).toThrow(/list is full/);
  });
  it('presets are 5 to 3600 seconds', () => {
    expect(T.PRESETS).toEqual([30, 60, 90, 120]);
    expect(() => T.setPreset(2)).toThrow(/5 to 3600/);
    expect(T.setPreset(45)).toBe(45);
    expect(T._read().preset).toBe(45);
  });
  it('opens inside the window, counts down, says Time and stays closed when switched off', async () => {
    const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
    vi.useFakeTimers();
    T.setEnabled(false);
    expect(() => T.open()).toThrow(/switched off/);
    T.setEnabled(true);
    T.open();
    const hud = document.getElementById('vex-speech-hud');
    expect(hud.parentNode).toBe(document.body);
    expect(hud.style.position).toBe('fixed');
    hud.querySelector('[data-preset="30"]').click(); await flush();
    expect(hud.querySelector('[data-clock]').textContent).toBe('0:30');
    hud.querySelector('[data-start]').click(); await flush();
    vi.advanceTimersByTime(10100);
    expect(hud.querySelector('[data-clock]').textContent).toBe('0:20');
    vi.advanceTimersByTime(21000);
    expect(hud.querySelector('[data-clock]').textContent).toBe('0:00');
    expect(hud.querySelector('[aria-live]').textContent).toBe('Time');
    expect(hud.querySelector('[data-start]').textContent).toBe('Again');
    T.close();
    expect(document.getElementById('vex-speech-hud')).toBeNull();
  });
  it('next speaker starts the clock for the next name and records the last time', () => {
    vi.useFakeTimers();
    T.addSpeaker('Brazil'); T.addSpeaker('Chile');
    T.open();
    T._nextSpeaker();
    expect(T._run.current.name).toBe('Brazil');
    vi.advanceTimersByTime(12000);
    T._nextSpeaker();
    expect(T._run.current.name).toBe('Chile');
    expect(T._read().speakers[0].spoke).toBe(12);
    vi.advanceTimersByTime(3000);
    expect(() => T._nextSpeaker()).toThrow(/finished/);
  });
});

describe('T3-049 Turkish helpers', () => {
  let H;
  beforeEach(() => {
    globalThis.VexTurkishWords = fresh(JS + 'turkish-wordlist.js').VexTurkishWords;
    ({ VexTurkishHelpers: H } = fresh(JS + 'turkish-helpers.js'));
  });

  it('the bundled list is a few hundred words and holds the commonest', () => {
    expect(VexTurkishWords.count()).toBeGreaterThan(600);
    for (const w of ['güzel', 'yağmur', 'çalışmak', 'öğrenci', 'şehir', 'ağaç']) expect(VexTurkishWords.set().has(w), w).toBe(true);
  });
  it('Turkish casing: I and i are two letters', () => {
    expect(H.lower('ISPARTA İSTANBUL')).toBe('ısparta istanbul');
    expect(H.upper('ışık iyi')).toBe('IŞIK İYİ');
  });
  it('puts the letters back where exactly one reading is a known word', () => {
    expect(H.deasciify('guzel yagmur').text).toBe('güzel yağmur');
    expect(H.deasciify('Ogrenci okula gidiyor').text).toContain('Öğrenci');
    const r = H.deasciify('sehir ve cocuk');
    expect(r.text).toBe('şehir ve çocuk');
    expect(r.changed.map(c => c.to)).toEqual(['şehir', 'çocuk']);
  });
  it('leaves known words, words already in Turkish, and unknown words alone', () => {
    expect(H.deasciify('bir su ve gun').text).toBe('bir su ve gün');       // "su" and "bir" are words; "gun" is not
    expect(H.deasciify('güzel Işık').text).toBe('güzel Işık');
    expect(H.deasciify('zxcvb qwerty').changed).toEqual([]);
  });
  it('keeps capital letters, including the dotted İ', () => {
    expect(H.deasciify('Istanbul GUZEL').text).toBe('Istanbul GÜZEL');   // Istanbul is not on the list: left alone
    H.addWord('istanbul');
    expect(H.deasciify('Istanbul').text).toBe('Istanbul');                // already a known word as typed
  });
  it('understands endings, so inflected forms of a listed word are known', () => {
    expect(H.known('sepetlerimiz')).toBe(false);                           // sepet is not on the list
    expect(H.known('okullarda')).toBe(true);                               // okul + lar + da
    expect(H.known('çalışıyorum')).toBe(true);                             // çalış + ıyor + um
    expect(H.deasciify('calisiyorum').text).toBe('çalışıyorum');
  });
  it('two readings that both fit are left alone and reported', () => {
    H.addWord('kus'); H.addWord('kuş');
    const r = H.deasciify('kus');
    expect(r.text).toBe('kus');                                            // "kus" is itself known
    H.removeWord('kus');
    H.addWord('ucus'); H.addWord('uçus');
    const r2 = H.deasciify('ucus');
    expect(r2.text).toBe('ucus');
  });
  it('a personal dictionary: stems offered, endings covered, bad words refused', () => {
    expect(() => H.addWord('a b')).toThrow(/2 to 40 letters/);
    expect(H.stemCandidates('sepetlerimiz')).toContain('sepet');
    expect(H.addWord('sepet')).toBe(true);
    expect(H.addWord('sepet')).toBe(false);
    expect(H.known('sepetlerimiz')).toBe(true);
    expect(H.known('sepedi')).toBe(false);                                 // consonant change not covered
    expect(H.removeWord('sepet')).toBe(true);
    expect(H.known('sepetler')).toBe(false);
  });
  it('lists unknown words with near suggestions and never edits the text', () => {
    const text = 'Güzel bir sehir ve xqzv. Güzel';
    const u = H.unknown(text);
    expect(u.map(x => x.word)).toEqual(expect.arrayContaining(['sehir', 'xqzv']));
    expect(u.find(x => x.word === 'sehir').suggestions).toContain('şehir');
    expect(u.find(x => x.word === 'güzel')).toBeUndefined();
    expect(text).toBe('Güzel bir sehir ve xqzv. Güzel');
  });
  it('the dictionary address takes one word only', () => {
    expect(H.tdkUrl('güzel')).toBe('https://sozluk.gov.tr/?kelime=g%C3%BCzel');
    expect(() => H.tdkUrl('iki kelime')).toThrow(/single word/);
    expect(() => H.tdkUrl('')).toThrow(/single word/);
  });
  it('right-click rows: TDK for a word, letters for text that needs them, none when off', () => {
    expect(H.textItems('guzel', null, {}).map(i => i.label)).toEqual(["TDK'de ara", 'Put Turkish letters back...']);
    expect(H.textItems('two words here', null, {}).map(i => i.label)).toEqual([]);
    expect(H.textItems('xqzv', null, {}).map(i => i.label)).toEqual(["TDK'de ara"]);
    H.setEnabled(false);
    expect(H.textItems('guzel', null, {})).toEqual([]);
  });
  it('replaces text in a box only through the page, and says if the page refused', async () => {
    globalThis.VexSettingsGroups = fresh(JS + 'vex-settings-groups.js').VexSettingsGroups;
    const sent = [];
    const wv = { executeJavaScript: async (js) => { sent.push(js); return true; } };
    await H.fixSelection(wv, 'guzel yagmur', true);
    const ok = document.querySelector('#vex-tr-diff .btn-primary');
    expect(ok.textContent).toBe('Replace the selection');
    expect(document.querySelector('#vex-tr-diff ins')).toBeTruthy();
    expect(sent).toEqual([]);                                              // nothing until the button
    ok.click();
    await Promise.resolve(); await Promise.resolve();
    expect(sent[0]).toContain('insertText');
    expect(sent[0]).toContain('güzel yağmur');
    delete globalThis.VexSettingsGroups;
  });
  it('the formal letters are templates with blanks, not filled-in advice', () => {
    expect(Object.keys(H.TEMPLATES)).toEqual(['dilekce', 'tuketici', 'mazeret']);
    for (const t of Object.values(H.TEMPLATES)) expect(t.text).toMatch(/\[/);
    expect(H.TEMPLATES.tuketici.text).toContain('6502');
  });
});
