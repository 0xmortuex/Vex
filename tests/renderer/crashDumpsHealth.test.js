// @vitest-environment jsdom
//
// Health lists the crash dump files kept on this computer, says plainly what a dump holds, and offers
// "include in the next problem report" as an unticked box that only lists names and sizes.
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { MemoryPanel } = require('../../src/renderer/js/memory-panel.js');
const { VexReport } = require('../../src/renderer/js/report-problem.js');

const d = { crashDumps: { dir: 'C:\\profile\\crashes', keepDays: 14, files: [{ name: 'a.dmp', bytes: 314544, at: 1700000000000 }, { name: 'b.dmp', bytes: 100, at: 1690000000000 }] } };

beforeEach(() => { document.body.innerHTML = ''; globalThis.VexReport = VexReport; VexReport.setIncludeDumps(false); });

describe('the crash dump block in Health', () => {
  it('is absent when there are no dumps', () => {
    expect(MemoryPanel._crashDumpBlock({})).toBe(null);
    expect(MemoryPanel._crashDumpBlock({ crashDumps: { files: [] } })).toBe(null);
  });
  it('lists the files, the folder and the honest note about memory', () => {
    const el = MemoryPanel._crashDumpBlock(d);
    const text = el.textContent;
    expect(text).toContain('Crash dump files on this computer');
    expect(text).toContain('a.dmp — 307 KB');
    expect(text).toContain('C:\\profile\\crashes');
    expect(text).toMatch(/snapshot of the memory of a crashed process/);
    expect(text).toMatch(/never uploads them and never attaches them/);
    expect(text).toMatch(/deletes them after 14 days/);
  });
  it('the include box starts unticked and only switches the next report', () => {
    const el = MemoryPanel._crashDumpBlock(d);
    document.body.appendChild(el);
    const box = el.querySelector('#memory-crash-dumps-include');
    expect(box.checked).toBe(false);
    expect(VexReport.dumpLines(d)).toEqual([]);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(VexReport.dumpLines(d).length).toBeGreaterThan(1);
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(VexReport.dumpLines(d)).toEqual([]);
  });
});
