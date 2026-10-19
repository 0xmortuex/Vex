// The Morning Brief's cards are drawn by the New Tab page, which neither the shared dictionary nor the page's own word list
// reaches, so VexBrief.localize translates the snapshot on its way there. A long-time Turkish-only user saw "Needs you",
// "Winding down", "AI news is off..." and "Good evening" in English above a Turkish greeting.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { VexBrief } = require('../../src/renderer/js/brief.js');

const morning = () => ({
  enabled: true,
  greeting: { text: 'Good evening', date: 'Monday, October 19' },
  sections: [
    { id: 'autopilot', title: 'Needs you', status: 'ok', summary: 'Nothing is waiting on you.', note: 'Mail is not included. Turn it on in Autopilot to rank your unread mail too.', action: { label: 'Open Autopilot', cmd: { type: 'autopilot-open' } } },
    { id: 'evening-wind-down', title: 'Winding down', status: 'ok', items: [{ text: '3 things left undone' }, { text: '1 thing left undone' }, { text: 'and 4 more' }, { text: 'Tomorrow starts with Dentist 09:30' }, { text: 'Nothing scheduled to start tomorrow' }] },
    { id: 'ai-news', title: 'AI news', status: 'hint', hint: 'AI news is off. Turn it on in Settings › AI news to see the top stories here.' },
    { id: 'numbers', title: 'Yesterday in numbers', status: 'ok', stats: [{ label: 'pages visited', value: 12 }] },
    { id: 'one-new-thing', title: 'One new thing', status: 'ok', items: [{ text: 'My own page called Open', badge: 'Reminder', actions: [{ label: 'Not today', cmd: {} }] }] },
  ],
});

describe('VexBrief.localize', () => {
  it('translates the greeting, titles, messages, buttons and counts', () => {
    const m = VexBrief.localize(morning(), 'tr');
    expect(m.greeting.text).toBe('İyi akşamlar');
    expect(m.sections.map(s => s.title)).toEqual(['Sizi bekleyenler', 'Günü bitirirken', 'Yapay zekâ haberleri', 'Dün sayılarla', 'Yeni bir şey']);
    expect(m.sections[0].summary).toBe('Sizi bekleyen bir şey yok.');
    expect(m.sections[0].note).toMatch(/^E-posta dahil değil\./);
    expect(m.sections[0].action.label).toBe('Otopilotu aç');
    expect(m.sections[2].hint).toMatch(/^Yapay zekâ haberleri kapalı\./);
    expect(m.sections[3].stats[0].label).toBe('ziyaret edilen sayfa');
    expect(m.sections[1].items.map(i => i.text)).toEqual([
      '3 iş yapılmadan kaldı', '1 iş yapılmadan kaldı', '4 tane daha', 'Yarın şununla başlıyor: Dentist 09:30', 'Yarın başlamak üzere planlanmış bir şey yok',
    ]);
    expect(m.sections[4].items[0].actions[0].label).toBe('Bugün değil');
    expect(m.sections[4].items[0].badge).toBe('Hatırlatıcı');
  });
  it('leaves what a person wrote alone, even when it contains a translated word', () => {
    const m = VexBrief.localize(morning(), 'tr');
    expect(m.sections[4].items[0].text).toBe('My own page called Open');
  });
  it('returns English untouched, and the same object', () => {
    const m = morning();
    expect(VexBrief.localize(m, 'en')).toBe(m);
  });
  it('does not change the snapshot it was given (the brief keeps its English copy)', () => {
    const m = morning();
    VexBrief.localize(m, 'tr');
    expect(m.sections[0].title).toBe('Needs you');
    expect(m.greeting.text).toBe('Good evening');
  });
  it('copes with no brief at all', () => {
    expect(VexBrief.localize(null, 'tr')).toBeNull();
    expect(VexBrief.localize({ enabled: true }, 'tr')).toEqual({ enabled: true });
  });
  it('translates every section title the brief registers', () => {
    const files = ['brief-sections.js', 'brief-integration.js', 'autopilot.js', 'brief-extras/evening.js', 'brief-extras/streaks.js', 'brief-extras/one-new-thing.js', 'brief-extras/news-actions.js', 'brief-extras/audio-digest.js'];
    const titles = new Set();
    for (const f of files) {
      const src = fs.readFileSync('src/renderer/js/' + f, 'utf8');
      for (const m of src.matchAll(/\bid: '[\w-]+', title: '((?:[^'\\]|\\.)*)'/g)) titles.add(m[1].replace(/\\'/g, "'"));
      for (const m of src.matchAll(/^\s{2}title: '((?:[^'\\]|\\.)*)',$/gm)) titles.add(m[1].replace(/\\'/g, "'"));
    }
    expect(titles.size).toBeGreaterThan(12);
    const missing = [...titles].filter(t => !Object.prototype.hasOwnProperty.call(VexBrief.TR, t));
    expect(missing).toEqual([]);
  });
});

describe('the brief\'s date and greeting follow the language Vex is set to', () => {
  afterEach(() => { delete globalThis.VexI18nUI; });
  it('writes the date in Turkish when Vex is set to Turkish', () => {
    globalThis.VexI18nUI = { locale: () => 'tr' };
    const g = VexBrief.greeting(new Date(2026, 9, 19, 19, 0).getTime());
    expect(g.date).toMatch(/Pazartesi/);
    expect(g.date).toMatch(/Ekim/);
  });
  it('does not force a language when Vex is in English', () => {
    globalThis.VexI18nUI = { locale: () => 'en' };
    const g = VexBrief.greeting(new Date(2026, 9, 19, 19, 0).getTime());
    expect(g.text).toBe('Good evening');
    expect(g.date).not.toMatch(/Pazartesi/);
  });
});

describe('the snapshot is translated on its way to the page', () => {
  it('today.js passes the brief through VexBrief.localize', () => {
    expect(fs.readFileSync('src/renderer/js/today.js', 'utf8')).toMatch(/snap\.morning = VexBrief\.localize\(await VexBrief\.build\(/);
  });
});
