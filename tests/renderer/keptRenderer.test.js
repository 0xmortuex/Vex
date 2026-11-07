// @vitest-environment jsdom
//
// Wave 5, pages as data the person keeps: the window's side of the datasets. Which tab may be kept from (private, Tor, routed and
// container tabs and banking/payment/sign-in/mail/health pages never), the helper that asks main, and how a page watch's change
// reaches a dataset (only when switched on). No clock, no network, nothing drawn on a real screen.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let VexKept;
beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  fresh(JS + 'page-sensitivity.js');
  window.vexGuestUrl = (wv) => wv.__url;
  window.VexTabPolicy = { isPrivateWindow: false, canReadWebview: () => true };
  globalThis.VexPlural = { count: (n, forms) => n + ' ' + (n === 1 ? forms.en[0] : forms.en[1]) };
  ({ VexKept } = fresh(JS + 'kept-common.js'));
  globalThis.VexKept = VexKept;
});
afterEach(() => {
  delete globalThis.VexKept; delete globalThis.VexPlural; delete globalThis.VexI18nUI; delete window.vex;
});

const tab = (url, partition) => ({ __url: url, getAttribute: (name) => (name === 'partition' ? partition : null) });

describe('which tab may be kept from', () => {
  it('needs a page', () => {
    expect(VexKept.refusal(null)).toBe('Open a page first');
  });
  it('never a private window', () => {
    window.VexTabPolicy.isPrivateWindow = true;
    expect(VexKept.refusal(tab('https://example.com/a'))).toMatch(/private, Tor, routed or container/);
  });
  it('never a tab the read policy refuses (Tor, a proxy, a container route)', () => {
    window.VexTabPolicy.canReadWebview = () => false;
    expect(VexKept.refusal(tab('https://example.com/a'))).toMatch(/private, Tor, routed or container/);
  });
  it('never a session other than the main one (a burner, a Tor identity, a container)', () => {
    for (const partition of ['persist:container-work', 'tor:identity1', 'burner-1', 'persist:identity-2']) {
      expect(VexKept.refusal(tab('https://example.com/a', partition)), partition).toMatch(/private, Tor, routed or container/);
    }
    expect(VexKept.refusal(tab('https://example.com/a', 'persist:main'))).toBe('');
  });
  it('only a web page', () => {
    for (const url of ['file:///C:/secret.html', 'vex://settings', 'about:blank', '']) expect(VexKept.refusal(tab(url)), url).toBe('Only a web page can be kept');
  });
  it('never a banking, payment, sign-in, mail or health page, and says why', () => {
    for (const url of ['https://www.paypal.com/', 'https://example.com/login', 'https://mail.google.com/mail', 'https://example.com/a?token=abc', 'https://mychart.example.org/']) {
      const why = VexKept.refusal(tab(url));
      expect(why, url).not.toBe('');
      expect(why, url).toMatch(/left alone/);
    }
  });
  it('an ordinary page is fine', () => {
    expect(VexKept.refusal(tab('https://example.com/prices'))).toBe('');
  });
});

describe('asking main', () => {
  it('returns the answer when main says ok', async () => {
    window.vex = { datasetList: async () => ({ ok: true, items: [1] }) };
    expect((await VexKept.call('datasetList')).items).toEqual([1]);
  });
  it('throws main\'s own sentence when it says no', async () => {
    window.vex = { datasetCreate: async () => ({ ok: false, error: 'You already keep 50 datasets (the limit). Delete one first.' }) };
    await expect(VexKept.call('datasetCreate', {})).rejects.toThrow('You already keep 50 datasets');
  });
  it('throws when there is no answer or no such function', async () => {
    window.vex = { datasetList: async () => undefined };
    await expect(VexKept.call('datasetList')).rejects.toThrow('It did not work');
    await expect(VexKept.call('nothingHere')).rejects.toThrow('not available');
  });
});

describe('texts with numbers in them', () => {
  it('fills {1} and {2}', () => {
    expect(VexKept.t('Added: {1}. Already there: {2}', 3, 0)).toBe('Added: 3. Already there: 0');
  });
  it('translates the whole sentence first when Vex is in Turkish', () => {
    globalThis.VexI18nUI = { lookup: (text) => (text === 'Added: {1}' ? 'Eklendi: {1}' : null) };
    expect(VexKept.t('Added: {1}', 4)).toBe('Eklendi: 4');
    expect(VexKept.t('Something else {1}', 4)).toBe('Something else 4');
  });
});

describe('a page watch fills a dataset', () => {
  let D;
  beforeEach(() => {
    ({ VexKeptDatasets: D } = fresh(JS + 'kept-datasets.js'));
    vi.spyOn(VexKept, 'call').mockResolvedValue({ ok: true, datasets: 1 });
  });
  const at = Date.UTC(2026, 0, 2, 3, 4, 5);

  it('does nothing while datasets are switched off', async () => {
    await D.onSnapshot({ watchId: 'w_1', kind: 'number', value: '12.5', at, why: 'went up' });
    expect(VexKept.call).not.toHaveBeenCalled();
  });
  it('adds one row with the time, the value and what changed', async () => {
    D.setEnabled(true);
    await D.onSnapshot({ watchId: 'w_1', kind: 'number', value: '12.5', at, why: 'went up' });
    expect(VexKept.call).toHaveBeenCalledWith('datasetAppendWatch', 'w_1', ['2026-01-02T03:04:05.000Z', '12.5', 'went up']);
  });
  it('a text watch writes first look or changed, not the page', async () => {
    D.setEnabled(true);
    await D.onSnapshot({ watchId: 'w_1', kind: 'text', value: 'a whole page of words', at, first: true, summary: '' });
    await D.onSnapshot({ watchId: 'w_1', kind: 'text', value: 'a whole page of words', at, first: false, summary: '3 lines added' });
    expect(VexKept.call.mock.calls[0][2]).toEqual(['2026-01-02T03:04:05.000Z', 'first look', '']);
    expect(VexKept.call.mock.calls[1][2]).toEqual(['2026-01-02T03:04:05.000Z', 'changed', '3 lines added']);
  });
  it('ignores a snapshot with no watch', async () => {
    D.setEnabled(true);
    await D.onSnapshot({ kind: 'number', value: '1', at });
    expect(VexKept.call).not.toHaveBeenCalled();
  });
  it('is off by default and refuses to start a dataset while off', async () => {
    expect(D.enabled()).toBe(false);
    await expect(D.keepFromPage()).rejects.toThrow(/switched off/);
    await expect(D.keep({ rows: [['a']] }, tab('https://example.com/a'))).rejects.toThrow(/switched off/);
  });
});
