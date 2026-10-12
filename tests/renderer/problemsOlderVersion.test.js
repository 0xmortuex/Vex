// @vitest-environment jsdom
//
// The owner's problem list still showed "TypeError: under.click is not a
// function", fixed many versions ago (found 2026-10-09). Each problem now
// carries the Vex version it happened in; after an update the older ones are
// folded under "From an older version" (not deleted), this version's stay in
// view, and the list has a Clear with Undo rather than a confirm dialog.
import { describe, it, expect, vi, beforeEach } from 'vitest';

window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let VexProblems;
async function start(version) {
  delete window.__vexProblemsWired;
  vi.resetModules();
  window.vex = version ? { getAppVersion: vi.fn(async () => version) } : {};
  ({ VexProblems } = await import('../../src/renderer/js/problems.js?' + Math.random()));
  globalThis.VexProblems = VexProblems;
  await Promise.resolve(); await Promise.resolve();
  return VexProblems;
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('problems carry their version', () => {
  it('folds away the ones from before an update, and keeps this version\'s in view', async () => {
    await start('2.37.0');
    VexProblems.note('Toolbar', 'TypeError: under.click is not a function');
    expect(JSON.parse(localStorage.getItem(VexProblems.KEY))[0].v).toBe('2.37.0');

    await start('2.38.3');   // updated
    VexProblems.note('Sync', 'Could not reach the server');
    expect(VexProblems.count()).toBe(1);
    expect(VexProblems.lines().join('\n')).toMatch(/Sync: Could not reach the server/);
    expect(VexProblems.lines().join('\n')).not.toMatch(/under\.click/);
    expect(VexProblems.olderCount()).toBe(1);
    expect(VexProblems.olderLines()[0]).toMatch(/Toolbar: TypeError: under\.click is not a function \(Vex 2\.37\.0\)$/);
    expect(VexProblems.all()).toHaveLength(2);   // folded, not deleted
  });

  it('counts problems saved before versions were stamped as older', async () => {
    localStorage.setItem('vex.problems', JSON.stringify([{ at: 1, area: 'Toolbar', message: 'TypeError: under.click is not a function', detail: '', n: 3 }]));
    await start('2.38.3');
    expect(VexProblems.count()).toBe(0);
    expect(VexProblems.olderCount()).toBe(3);
  });

  it('hides nothing while the version is not known', async () => {
    localStorage.setItem('vex.problems', JSON.stringify([{ at: 1, area: 'Toolbar', message: 'old', detail: '', n: 1 }]));
    await start(null);
    expect(VexProblems.count()).toBe(1);
    expect(VexProblems.olderCount()).toBe(0);
  });

  it('stamps a problem noted before the version arrived with this version', async () => {
    delete window.__vexProblemsWired;
    vi.resetModules();
    let answer;
    window.vex = { getAppVersion: () => new Promise(r => { answer = r; }) };
    ({ VexProblems } = await import('../../src/renderer/js/problems.js?' + Math.random()));
    VexProblems.note('Startup', 'Something failed early');
    answer('2.38.3');
    await Promise.resolve(); await Promise.resolve();
    expect(VexProblems.count()).toBe(1);
    expect(JSON.parse(localStorage.getItem(VexProblems.KEY))[0].v).toBe('2.38.3');
  });

  // The version arrives before app.js copies the saved list from
  // vex-persist.json into browser storage; reading the list then lost it.
  it('does not read the list when the version arrives, before storage is filled', async () => {
    await start('2.38.3');
    localStorage.setItem('vex.problems', JSON.stringify([{ at: 1, area: 'Toolbar', message: 'old', detail: '', n: 1, v: '2.37.0' }]));
    expect(VexProblems.all()).toHaveLength(1);
    expect(VexProblems.olderCount()).toBe(1);
  });

  it('brings an old problem back into view when it happens again', async () => {
    await start('2.37.0');
    VexProblems.note('Toolbar', 'Same thing');
    await start('2.38.3');
    expect(VexProblems.count()).toBe(0);
    VexProblems.note('Toolbar', 'Same thing');
    expect(VexProblems.count()).toBe(2);
    expect(VexProblems.olderCount()).toBe(0);
  });
});

describe('Memory › Health: the folded list and Clear with Undo', () => {
  it('shows older ones folded; Clear empties the list and Undo puts it back', async () => {
    await start('2.37.0');
    VexProblems.note('Toolbar', 'TypeError: under.click is not a function');
    await start('2.38.3');
    VexProblems.note('Sync', 'Could not reach the server');
    const offers = [];
    globalThis.VexUndo = { offer: vi.fn((o) => { offers.push(o); return {}; }) };
    window.vex.diagnostics = vi.fn(async () => ({ version: '2.38.3', uptimeMs: 60000, marks: {}, events: [], extensionErrors: [] }));
    const { MemoryPanel } = await import('../../src/renderer/js/memory-panel.js?' + Math.random());
    document.body.innerHTML = '<div id="memory-health"></div>';
    await MemoryPanel.renderDiagnostics();
    const host = document.getElementById('memory-health');
    const fold = host.querySelector('details#memory-health-older');
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary').textContent).toBe('From an older version (1)');
    expect(fold.textContent).toMatch(/under\.click/);
    expect(host.querySelector('.memory-health').textContent).toMatch(/1 quiet problem/);
    expect(host.querySelector('.memory-health').textContent).not.toMatch(/under\.click/);

    host.querySelector('#memory-clear-problems').click();
    expect(VexProblems.all()).toEqual([]);
    expect(offers).toHaveLength(1);
    expect(offers[0].message).toBe('Cleared the problem list');
    await vi.waitFor(() => expect(host.querySelector('#memory-clear-problems')).toBe(null));

    await offers[0].undo();
    expect(VexProblems.all().map(p => p.message).sort()).toEqual(['Could not reach the server', 'TypeError: under.click is not a function']);
    expect(VexProblems.olderCount()).toBe(1);
    expect(host.querySelector('details#memory-health-older')).not.toBe(null);
  });
});
