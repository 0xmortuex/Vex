// T2-044: Turkish dates, amounts and quick capture (js/tr-parse.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let T;
// Friday 16 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 16, 10, 0, 0, 0);
beforeEach(() => { ({ VexTrParse: T } = fresh(JS + 'tr-parse.js')); });
const at = (ms) => { const d = new Date(ms); return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]; };

describe('dates', () => {
  it('reads yarın akşam 8\'de as tomorrow 20:00', () => {
    const r = T.parse("yarın akşam 8'de annemi ara", NOW);
    expect(at(r.at)).toEqual([2026, 10, 17, 20, 0]);
    expect(r.hasTime).toBe(true);
  });
  it('reads 12 Ekim as the next 12 October, with no time of day', () => {
    const r = T.parse('12 Ekim sınav', NOW);
    expect(at(r.at)).toEqual([2027, 10, 12, 9, 0]);   // 12 Ekim 2026 has passed
    expect(r.hasTime).toBe(false);
  });
  it('reads a year, a weekday that follows, and a clock time', () => {
    expect(at(T.parse('15 Kasım Cuma', NOW).at).slice(0, 3)).toEqual([2026, 11, 15]);
    expect(at(T.parse('20 Ekim 2026 14:30', NOW).at)).toEqual([2026, 10, 20, 14, 30]);
  });
  it('reads haftaya Salı as the Tuesday of next week', () => {
    expect(at(T.parse('haftaya Salı', NOW).at).slice(0, 3)).toEqual([2026, 10, 20]);   // Friday 16th: next week is Mon 19th - Sun 25th
  });
  it('reads a bare weekday as the next one, never today', () => {
    expect(at(T.parse('Cuma görüşme', NOW).at).slice(0, 3)).toEqual([2026, 10, 23]);
    expect(at(T.parse('Pazartesi', NOW).at).slice(0, 3)).toEqual([2026, 10, 19]);
  });
  it('reads relative phrases', () => {
    expect(T.parse('2 saat sonra', NOW).at - NOW.getTime()).toBe(2 * 3600e3);
    expect(T.parse('yarım saat sonra', NOW).at - NOW.getTime()).toBe(30 * 60e3);
    expect(at(T.parse('3 gün sonra', NOW).at).slice(0, 3)).toEqual([2026, 10, 19]);
  });
  it('reads numeric dates day first, and a dotted pair with two digits as a time', () => {
    expect(at(T.parse('12.12.2026', NOW).at).slice(0, 3)).toEqual([2026, 12, 12]);
    expect(at(T.parse('20.30', NOW).at)).toEqual([2026, 10, 16, 20, 30]);
  });
  it('rolls a time already gone to tomorrow, and handles part-of-day hours', () => {
    expect(at(T.parse("saat 9'da", NOW).at)).toEqual([2026, 10, 17, 9, 0]);
    expect(at(T.parse('bu akşam', NOW).at)).toEqual([2026, 10, 16, 19, 0]);
    expect(at(T.parse('yarın gece 11', NOW).at)).toEqual([2026, 10, 17, 23, 0]);
    expect(at(T.parse('yarın sabah 8', NOW).at)).toEqual([2026, 10, 17, 8, 0]);
  });
  it('does not accept 31 Nisan', () => {
    expect(T.parse('31 Nisan', NOW)).toBeNull();
  });
  it('returns null for text with no date, and parseWhen says so plainly', () => {
    expect(T.parse('merhaba dünya', NOW)).toBeNull();
    expect(() => T.parseWhen('merhaba', NOW)).toThrow(/Could not read/);
    expect(() => T.parseWhen('bugün 09:00', NOW)).toThrow(/passed/);
  });
});

describe('amounts', () => {
  it('reads the Turkish number shape', () => {
    expect(T.parseNumber('1.250,50')).toBe(1250.5);
    expect(T.parseNumber('1.250')).toBe(1250);
    expect(T.parseNumber('12,5')).toBe(12.5);
    expect(T.parseNumber('1,250.50')).toBe(1250.5);
    expect(T.parseNumber('1.234.567,8')).toBe(1234567.8);
    expect(T.parseNumber('abc')).toBeNull();
  });
  it('finds an amount in TL in any of its spellings', () => {
    expect(T.parseAmount('Toplam 1.250,50 TL ödendi').amount).toBe(1250.5);
    expect(T.parseAmount('₺99,90').amount).toBe(99.9);
    expect(T.parseAmount('250 lira').amount).toBe(250);
    expect(T.parseAmount('2,5 milyon TL').amount).toBe(2500000);
    expect(T.parseAmount('TL 1.000').amount).toBe(1000);
    expect(T.parseAmount('bir şey yok')).toBeNull();
  });
  it('writes an amount back the Turkish way', () => {
    expect(T.formatAmount(1250.5, 'TRY')).toBe('1.250,50 TL');
    expect(T.formatAmount(99, 'TRY')).toBe('99 TL');
  });
});

describe('reminders', () => {
  it('splits the message from the time and the ask word', () => {
    const r = T.reminderFromSentence("yarın akşam 8'de annemi ara hatırlat", NOW);
    expect(r.message).toBe('annemi ara');
    expect(at(r.at)).toEqual([2026, 10, 17, 20, 0]);
  });
  it('needs the ask word, so an ordinary note is never turned into a reminder', () => {
    expect(T.reminderFromSentence('12 Ekim sınav var', NOW)).toBeNull();
  });
  it('recognises Turkish date words and leaves English alone', () => {
    expect(T.isTurkish('yarın akşam')).toBe(true);
    expect(T.isTurkish('1.250 TL')).toBe(true);
    expect(T.isTurkish('tomorrow at 9am')).toBe(false);
  });
  it('lists the date phrases of a text', () => {
    const list = T.extractDates('Ödev 20 Ekim tarihine kadar. Sınav haftaya Salı.', NOW);
    expect(list.map(x => x.phrase)).toEqual(['20 Ekim', 'haftaya Salı']);
  });
  it('shows the parsed result as a line to confirm', () => {
    expect(T.describe(new Date(2026, 9, 17, 20, 0).getTime(), true, NOW)).toBe('Yarın 20:00 (Cumartesi, 17 Ekim)');
  });
  it('asks before saving', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    globalThis.window = globalThis.window || {};
    window.vexConfirm = confirm;
    expect(await T.confirmReminder({ message: 'x', at: NOW.getTime() + 3600e3, hasTime: true })).toBe(true);
    expect(confirm.mock.calls[0][0].message).toContain('"x"');
  });
});
