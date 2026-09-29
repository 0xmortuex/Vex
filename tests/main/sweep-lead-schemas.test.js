// Channels the 2026-09-29 sweep found refused by their own schema.
import { describe, it, expect } from 'vitest';
const schemas = require('../../src/main/ipc-schemas.js');
const ok = (ch, args) => { schemas.validate(ch, args); return true; };

describe('what the callers really send is accepted', () => {
  // Quick capture: the interface's answer was refused, so the box sat on
  // "Saving…" until "Vex did not answer".
  it("Quick capture's answer", () => {
    expect(ok('capture:done', [{ id: 'cap_lx2', ok: true, said: 'Saved a note' }])).toBe(true);
    expect(ok('capture:done', [{ id: 'cap_lx2', ok: false, error: 'That did not work' }])).toBe(true);
    expect(() => schemas.validate('capture:done', [])).toThrow();
    expect(() => schemas.validate('capture:done', [{ id: 'x'.repeat(41), ok: true }])).toThrow();
  });

  it("a page's report of a key it left alone", () => {
    expect(ok('guest:page-shortcut', [{ key: 'b', shift: false }])).toBe(true);
    expect(() => schemas.validate('guest:page-shortcut', [{ key: 'bb', shift: false }])).toThrow();
  });
});

describe('saved page names', () => {
  const { safeFileName } = require('../../src/main/page-save.js');
  // A PDF tab is titled "dummy.pdf"; saved as a PDF it became "dummy.pdf.pdf".
  it('do not double the extension', () => {
    expect(safeFileName('dummy.pdf', 'pdf')).toBe('dummy.pdf');
    expect(safeFileName('Report.PDF', 'pdf')).toBe('Report.pdf');
    expect(safeFileName('a.pdf', 'mhtml')).toBe('a.pdf.mhtml');
    expect(safeFileName('con', 'pdf')).toBe('page.pdf');
  });
});

describe('lock and Tor', () => {
  it('the lock state and Tor cancel are accepted, nothing else rides along', () => {
    expect(ok('vex-lock:state', [true])).toBe(true);
    expect(() => schemas.validate('vex-lock:state', ['yes'])).toThrow();
    expect(ok('tor:cancel', [])).toBe(true);
  });
});
