// @vitest-environment jsdom
// T3-105: PDF-under-300-KB preset (a one-page PDF around a JPEG), document expiry reminders, requirements -> checklist.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let P;
beforeEach(() => {
  localStorage.clear(); vi.resetModules();
  ({ VexPhotoPrep: P } = fresh(JS + 'photo-prep.js'));
});

describe('PDF preset', () => {
  it('is offered, as a pdf format with a 300 KB cap', () => {
    const p = P.PRESETS.find(x => x.id === 'pdf-300');
    expect(p).toMatchObject({ format: 'pdf', maxKB: 300 });
    expect(P.outName('scan.jpeg', 'pdf')).toBe('scan-prepared.pdf');
  });
  it('wraps a JPEG in a PDF with a valid cross-reference table', () => {
    const jpeg = new Uint8Array([0xFF, 0xD8, 1, 2, 3, 4, 5, 0xFF, 0xD9]);
    const pdf = P.pdfFromJpeg(jpeg, 1200, 1600);
    const text = Buffer.from(pdf).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Length ' + jpeg.length);
    expect(text).toContain('/MediaBox [0 0 576.00 768.00]');
    const start = Number(/startxref\n(\d+)/.exec(text)[1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const rows = text.slice(start).split('\n').filter(l => /^\d{10} 00000 n $/.test(l));
    expect(rows).toHaveLength(5);
    rows.forEach((row, i) => expect(text.slice(Number(row.slice(0, 10))).startsWith((i + 1) + ' 0 obj')).toBe(true));
    // the JPEG bytes are inside untouched
    const at = pdf.findIndex((b, i) => b === 0xFF && pdf[i + 1] === 0xD8 && pdf[i + 2] === 1);
    expect([...pdf.slice(at, at + jpeg.length)]).toEqual([...jpeg]);
    expect(pdf.length).toBeLessThan(jpeg.length + P.PDF_OVERHEAD);
  });
  it('refuses something that is not a JPEG', () => {
    expect(() => P.pdfFromJpeg(new Uint8Array([1, 2, 3, 4]), 10, 10)).toThrow(/not a JPEG/);
  });
});

describe('expiry reminders', () => {
  const now = new Date(2026, 9, 17, 12, 0).getTime();
  it('plans 90, 30 and 7 days before at 09:00 and skips the ones already past', () => {
    const t = P.reminderTimes('2027-03-31', now);
    expect(t.map(x => x.daysBefore)).toEqual([90, 30, 7]);
    const d = new Date(t[2].at);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2027, 2, 24, 9]);
    expect(P.reminderTimes('2026-11-01', now).map(x => x.daysBefore)).toEqual([7]);
  });
  it('refuses a bad or past date', () => {
    expect(() => P.reminderTimes('31/03/2027', now)).toThrow(/like 2027-03-31/);
    expect(() => P.reminderTimes('2027-02-31', now)).toThrow(/not a real date/);
    expect(() => P.addDoc('Passport', '2025-01-01', now)).toThrow(/already passed/);
    expect(() => P.addDoc('  ', '2027-01-01', now)).toThrow(/which document/);
  });
  it('keeps only the label and date, makes the reminders, and removes them with the document', async () => {
    const created = []; const deleted = [];
    window.vex = { reminders: { create: vi.fn(async (m, at) => { const id = 'r' + created.length; created.push({ m, at }); return { id }; }), delete: vi.fn(async (id) => { deleted.push(id); }) } };
    const { doc } = P.addDoc('Passport', '2027-03-31', now);
    expect(await P.scheduleDoc(doc.id, now)).toBe(3);
    expect(created[0].m).toContain('Passport expires on 2027-03-31');
    expect(P.docs()[0]).toMatchObject({ label: 'Passport', expires: '2027-03-31', reminders: ['r0', 'r1', 'r2'] });
    expect(Object.keys(P.docs()[0]).sort()).toEqual(['expires', 'id', 'label', 'reminders']);
    expect(await P.removeDoc(doc.id)).toBe(true);
    expect(deleted).toEqual(['r0', 'r1', 'r2']);
    expect(P.docs()).toEqual([]);
  });
  it('reports a damaged list instead of replacing it', () => {
    localStorage.setItem(P.EXPIRY_KEY, '{nope');
    expect(() => P.docs()).toThrow(/could not be read/);
    expect(localStorage.getItem(P.EXPIRY_KEY)).toBe('{nope');
  });
});

describe('requirements to checklist', () => {
  const page = 'Bring the following:\n1. Two passport photos, 35 x 45 mm, white background\n- Photocopy of your ID\n* Application form\nThe photo must be a recent colour photo. Files must be PDF or JPG, no more than 250 KB each.\nThis office is open daily.';
  it('takes bullets and requirement sentences, once each', () => {
    const items = P.checklistFrom(page);
    expect(items).toContain('Two passport photos, 35 x 45 mm, white background');
    expect(items).toContain('Photocopy of your ID');
    expect(items).toContain('Application form');
    expect(items.some(i => /must be a recent colour photo/.test(i))).toBe(true);
    expect(items.some(i => /open daily/.test(i))).toBe(false);
  });
  it('recognises the size, weight and format and names a preset', () => {
    const l = P.limitsFrom(page);
    expect(l.sizeMm).toEqual([35, 45]);
    expect(l.maxKB).toBe(250);
    expect(l.formats).toEqual(['PDF', 'JPG']);
    expect(l.hints).toContain('White background');
    expect(l.preset).toBe('id-35x45');
    expect(P.limitsFrom('Upload a PDF, max 2 MB').preset).toBe('pdf-300');
    expect(P.limitsFrom('Upload a photo under 100 KB').preset).toBe('jpg-100');
  });
  it('writes a ticked-box list', () => {
    expect(P.checklistText(['Application form'], { sizeMm: [35, 45], maxKB: 250 })).toBe('- [ ] Application form\n- [ ] Photo size 35 x 45 mm\n- [ ] File under 250 KB');
  });
});
