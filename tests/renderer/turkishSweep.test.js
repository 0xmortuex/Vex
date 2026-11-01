// The Turkish sweep (2026-11-01): English the owner kept finding one by one on the New Tab page, in Ctrl+K and in Settings.
// What is checked: the rules that translate a whole class of text (a typed Ctrl+K search, the privacy lists' storage keys,
// the brief's sentences with numbers) and a sample of the strings that were left in English.
import { describe, it, expect } from 'vitest';
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const { VexBrief } = require('../../src/renderer/js/brief.js');

globalThis.VexI18nUI = VexI18nUI;   // in the app it is a top-level const the brief reads
const tr = (s) => VexI18nUI.lookup(s, 'tr');

describe('Turkish sweep: rules', () => {
  it('Ctrl+K web-search row keeps what was typed, whatever the words', () => {
    expect(tr('Search "settings"')).toBe('“settings” için ara');
    expect(tr('Search "dark mode for night"')).toBe('“dark mode for night” için ara');
  });
  it('storage keys in the privacy lists stay code, the label is Turkish', () => {
    expect(tr('Stores: vex.notes, vex.bookmarks')).toBe('Saklananlar: vex.notes, vex.bookmarks');
  });
  it('a disabled back button explains itself in Turkish, in either state of the word', () => {
    expect(tr('Back — not available while a side panel is open')).toBe('Geri — yan panel açıkken kullanılamaz');
    expect(tr('Geri — not available while a side panel is open')).toBe('Geri — yan panel açıkken kullanılamaz');
  });
  it('a feature switch label and a count template', () => {
    expect(tr('Use Sounds')).toBe('Sesleri kullan');
    expect(tr('Show Private window in toolbar')).toBe('Gizli pencere araç çubuğunda göster');
    expect(tr('Waiting on me, 3')).toBe('Beni bekleyen, 3');
    expect(tr('Today at 18:00')).toBe('Bugün 18:00');
  });
});

describe('Turkish sweep: the New Tab cards (brief)', () => {
  const t = (s) => VexBrief.translate(s);
  it('the summary of what needs you', () => {
    expect(t('nothing needs you right now, 1 for today.')).toBe('şu an sizi bekleyen bir şey yok, bugün için 1.');
    expect(t('2 need you now, 1 for today, 3 to know.')).toBe('2 şey şimdi sizi bekliyor, bugün için 1, bilmeniz gereken 3.');
  });
  it('the next-step hint names the workspace', () => {
    expect(t('Nothing is pressing. Ctrl+K › Set my next step to write the very next move for Personal.')).toContain('Personal');
    expect(t('Nothing is pressing. Ctrl+K › Set my next step to write the very next move for Personal.')).not.toMatch(/Nothing is pressing/);
  });
  it('focus time, in sentences', () => {
    expect(t('Your best stretch for focused work is 16:20 to 18:00 (1 h 40 min). Nothing is scheduled.'))
      .toBe('Odaklanma için en iyi aralığınız 16:20 – 18:00 (1 sa 40 dk). Planlanmış bir şey yok.');
    expect(t('Next up: Standup at 09:30.')).toBe('Sıradaki: Standup, saat 09:30.');
  });
  it('the day shape and the week load', () => {
    expect(t('Nothing booked today · free 16:17 to 24:00')).toBe('Bugün planlanmış bir şey yok · boş: 16:17 – 24:00');
    expect(t('today light · 2 light · 3 heavy')).toBe('bugün hafif · 2 hafif · 3 yoğun');
  });
  it('a phrase only the app dictionary knows is still translated', () => {
    expect(t('just now')).toBe('az önce');
  });
  it('a reminder line', () => {
    expect(t('reminder, today 18:00 · a reminder coming up')).toBe('hatırlatıcı, bugün 18:00 · yaklaşan bir hatırlatıcı');
  });
});
