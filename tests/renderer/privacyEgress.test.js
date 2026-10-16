// @vitest-environment jsdom
//
// Privacy dashboard › "What left this computer" (js/privacy-dashboard.js over the
// main-process ledger src/main/egress-ledger.js): the proof line, the filters, the rows.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const DAY = 24 * 3600 * 1000;
const tick = () => new Promise(r => setTimeout(r, 0));

let PD, el, summary, rows;
beforeEach(() => {
  document.body.innerHTML = '<div id="host"><div id="pd-egress"></div></div>';
  el = document.getElementById('host');
  PD = fresh('../../src/renderer/js/privacy-dashboard.js').PrivacyDashboard;
  PD._el = el;
  PD._egFilter = { kind: '', feature: '', host: '' };
  summary = { count: 0, bytesOut: 0, bytesIn: 0, byFeature: [], nothingLeft: true, keptSince: Date.now() - 3 * DAY };
  rows = [];
  window.vex = {
    egressSummary: vi.fn(async () => summary),
    egressList: vi.fn(async () => rows),
    egressClear: vi.fn(async () => ({ ok: true })),
  };
  window.showToast = vi.fn();
  globalThis.vexConfirm = vi.fn(async () => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the proof line', () => {
  it('says nothing left this computer when the list is older than a day and empty for it', async () => {
    PD._egressBuild(el);
    await PD._egressRefresh();
    const proof = el.querySelector('#pd-egress-proof');
    expect(proof.textContent).toBe('Nothing left this computer in the last 24 hours.');
    expect(proof.dataset.state).toBe('none');
  });

  it('does not claim 24 hours it has not watched', async () => {
    summary.keptSince = Date.now() - 5 * 3600 * 1000;
    PD._egressBuild(el);
    await PD._egressRefresh();
    expect(el.querySelector('#pd-egress-proof').textContent).toMatch(/Nothing has left this computer in the 5 hours this list has been kept/);
  });

  it('counts requests and bytes when something left', async () => {
    summary = { ...summary, count: 2, bytesOut: 2048, bytesIn: 512, nothingLeft: false, byFeature: [{ name: 'Cloud AI (chat)', count: 2 }] };
    rows = [{ t: Date.now(), feature: 'Cloud AI (chat)', host: 'x.workers.dev', kind: 'ai', out: 2000, in: 500, ok: true }];
    PD._egressBuild(el);
    await PD._egressRefresh();
    expect(el.querySelector('#pd-egress-proof').textContent).toBe('2 requests in the last 24 hours: 2.0 KB sent, 512 B received.');
    expect(el.querySelector('#pd-egress-list').textContent).toContain('Cloud AI (chat) → x.workers.dev');
    expect([...el.querySelectorAll('#pd-egress-feature option')].map(o => o.textContent)).toEqual(['All features', 'Cloud AI (chat)']);
  });
});

describe('filters and forgetting', () => {
  it('asks the ledger for the chosen kind, feature and host', async () => {
    PD._egressBuild(el);
    await PD._egressRefresh();
    const kind = el.querySelector('#pd-egress-kind');
    kind.value = 'ai';
    kind.dispatchEvent(new Event('change'));
    await tick();
    expect(window.vex.egressList).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'ai', feature: '', host: '' }));
    const host = el.querySelector('#pd-egress-host');
    host.value = ' Workers.DEV ';
    host.dispatchEvent(new Event('input'));
    await tick();
    expect(window.vex.egressList).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'workers.dev' }));
  });

  it('shows the filter has nothing to show rather than an empty box', async () => {
    PD._egressBuild(el);
    await PD._egressRefresh();
    expect(el.querySelector('#pd-egress-list').textContent).toBe('Nothing to show for this filter.');
  });

  it('forgets the list only after a confirm', async () => {
    PD._egressBuild(el);
    globalThis.vexConfirm = vi.fn(async () => false);
    el.querySelector('.pd-reset').click();
    await tick();
    expect(window.vex.egressClear).not.toHaveBeenCalled();
    globalThis.vexConfirm = vi.fn(async () => true);
    el.querySelector('.pd-reset').click();
    await tick(); await tick();
    expect(window.vex.egressClear).toHaveBeenCalled();
  });

  it('says why when the list cannot be read (a private window, an old build) instead of showing nothing', async () => {
    window.vex.egressSummary = vi.fn(async () => { throw new Error('This operation is unavailable in a private window'); });
    PD._egressBuild(el);
    await PD._egressRefresh();
    expect(el.querySelector('#pd-egress-proof').textContent).toMatch(/not available here \(This operation is unavailable in a private window\)/);
  });
});
