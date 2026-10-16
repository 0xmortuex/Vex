// Wave 2 integration: the two Turkish parsers (VexTr from the daily flow, VexTrParse from the
// study branch) give one answer where they overlap, and the deadline finder reads the phrases
// only VexTrParse understands.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

// Friday 16 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 16, 10, 0, 0, 0);
let TR, P;
beforeEach(() => {
  TR = fresh(JS + 'vex-tr.js').VexTr;
  globalThis.VexTr = TR;
  P = fresh(JS + 'tr-parse.js').VexTrParse;
});
afterEach(() => { delete globalThis.VexTr; delete globalThis.VexTrParse; });
const ymd = (ms) => { const d = new Date(ms); return [d.getFullYear(), d.getMonth() + 1, d.getDate()]; };
const sameDay = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

describe('amounts', () => {
  it.each(['1.250,50', '1250,5', '12.5', '12.50', '1.250', '1.250.000', '1250', '0,5', '100.000'])('%s is the same number in both', (s) => {
    expect(P.parseNumber(s)).toBe(TR.parseAmount(s).value);
  });
  it('still reads the shapes only VexTrParse knows', () => {
    expect(P.parseNumber('1,250,000')).toBe(1250000);
    expect(P.parseNumber('-5')).toBe(-5);
    expect(P.parseNumber('1234.567')).toBe(1234.567);
  });
});

describe('days', () => {
  it.each(['bugun', 'yarin', 'obur gun', 'ertesi gun', 'cuma', 'pazartesi', 'carsamba', 'pazar'])('%s lands on the day VexTr gives', (w) => {
    const r = P.parse(w + ' 14:00', NOW);
    expect(r).not.toBeNull();
    expect(ymd(r.at)).toEqual(sameDay(TR.parseDay(w, NOW).date));
  });
  it('keeps "yarından sonra" as the day after tomorrow', () => {
    expect(ymd(P.parse('yarından sonra 14:00', NOW).at)).toEqual([2026, 10, 18]);
  });
  it.each(['pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi', 'pazar'])('haftaya %s is the same day in both, and inside next week (Mon-Sun)', (w) => {
    const a = ymd(P.parse('haftaya ' + w + ' 14:00', NOW).at);
    expect(a).toEqual(sameDay(TR.parseDay('haftaya ' + w, NOW).date));
    const d = new Date(a[0], a[1] - 1, a[2]);
    expect(d >= new Date(2026, 9, 19) && d <= new Date(2026, 9, 25)).toBe(true);
  });
  it('a Friday saying Cuma means next week', () => {
    expect(ymd(P.parse('Cuma 09:00', NOW).at)).toEqual([2026, 10, 23]);
  });
});

describe('clocks', () => {
  it.each([['akşam', 8], ['sabah', 9], ['öğleden sonra', 3], ['gece', 11], ['gece', 12], ['öğle', 1]])('%s %i is the hour VexTr gives', (part, h) => {
    const r = P.parse('yarın ' + part + ' ' + h, NOW);
    expect(r).not.toBeNull();
    expect(new Date(r.at).getHours()).toBe(TR.parseClock(TR.fold(part) + ' ' + h).hour);
  });
});

describe('the deadline finder reads VexTrParse phrases', () => {
  let D;
  beforeEach(() => {
    globalThis.VexTrParse = P;
    D = fresh(JS + 'deadline-extractor.js').VexDeadlines;
  });
  it('reads "son tarih haftaya Salı" as the Tuesday of next week', () => {
    const out = D.extract('Başvuru için son tarih haftaya Salı.', NOW.getTime());
    expect(out.length).toBe(1);
    expect(ymd(out[0].dueAt)).toEqual([2026, 10, 20]);
  });
  it('uses the clock when the phrase has one', () => {
    const out = D.extract("Teslim: yarın akşam 8'de.", NOW.getTime());
    expect(out.length).toBe(1);
    expect(new Date(out[0].dueAt).getHours()).toBe(20);
  });
  it('still uses VexTr for the plain day, at the due hour', () => {
    const out = D.extract('Son tarih 15 Kasım.', NOW.getTime());
    expect(out.length).toBe(1);
    expect(new Date(out[0].dueAt).getHours()).toBe(17);
  });
  it('finds nothing without a trigger word', () => {
    expect(D.extract('Toplantı haftaya Salı.', NOW.getTime())).toEqual([]);
  });
});
