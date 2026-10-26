// @vitest-environment jsdom
//
// The window side of the saved cards (js/card-saver.js), 2026-10-26: the "Save this card?" offer after a payment, the chooser under a
// card field, the policy (never private, Tor, routed or plain http), filling, and typing a card into a page Vex did not recognise.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexCards } = require('../../src/renderer/js/card-saver.js');

const FULL = { id: 'c1', number: '4242424242424242', brand: 'Visa', name: 'Ada Lovelace', expMonth: 8, expYear: 2099 };
const LIST = [{ id: 'c1', nickname: '', brand: 'Visa', last4: '4242', name: 'Ada Lovelace', expMonth: 8, expYear: 2099, expired: false }];

function makeWebview(url = 'https://shop.example/pay', attrs = {}) {
  const wv = new EventTarget();
  wv.getURL = () => url;
  wv.getAttribute = (k) => attrs[k] || null;
  wv.send = vi.fn();
  wv.focus = vi.fn();
  wv.insertText = vi.fn(async () => {});
  wv.getBoundingClientRect = () => ({ left: 100, top: 80, width: 800, height: 600 });
  return wv;
}
const message = (wv, channel, data) => { const e = new Event('ipc-message'); e.channel = channel; e.args = [data]; wv.dispatchEvent(e); };
const settle = () => new Promise(r => setTimeout(r, 0));

let vexApi, toasts;
beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  toasts = [];
  vexApi = {
    cardsList: vi.fn(async () => LIST), cardsReveal: vi.fn(async () => ({ ...FULL })), cardsHas: vi.fn(async () => false),
    cardsSave: vi.fn(async () => ({ ok: true })), cardsUpdate: vi.fn(async () => ({ ok: true })), cardsDelete: vi.fn(async () => ({ ok: true })),
  };
  window.vex = vexApi;
  window.showToast = (m, k) => toasts.push([m, k]);
  window.vexConfirm = vi.fn(async () => true);
  window.vexCopySecret = vi.fn(async () => {});
  delete window.VexTabPolicy;
});
afterEach(() => { delete window.vex; delete window.showToast; delete window.vexConfirm; delete window.vexCopySecret; delete window.VexTabPolicy; });

const submitted = { host: 'shop.example', number: '4242424242424242', name: 'Ada Lovelace', expMonth: 8, expYear: 2099 };

describe('the offer after a payment', () => {
  it('asks to save a card it does not have, showing the last four digits only, and says the CVV is never kept', async () => {
    const wv = makeWebview(); VexCards.attach(wv);
    message(wv, 'vex-card-submit', submitted);
    await settle();
    const offer = document.getElementById('vex-card-offer');
    expect(offer).toBeTruthy();
    expect(offer.textContent).toContain('4242');
    expect(offer.textContent).not.toContain('4242424242424242');
    expect(offer.textContent).toMatch(/CVV\) is never saved/);
    expect(offer.textContent).toContain('shop.example');
  });

  it('Save keeps it through the vault of cards, with the number, name and expiry', async () => {
    const wv = makeWebview(); VexCards.attach(wv);
    message(wv, 'vex-card-submit', submitted); await settle();
    document.querySelector('#vex-card-offer .primary').click(); await settle();
    expect(vexApi.cardsSave).toHaveBeenCalledWith({ number: '4242424242424242', name: 'Ada Lovelace', expMonth: 8, expYear: 2099 });
    expect(toasts[0][0]).toBe('Card saved');
    expect(document.getElementById('vex-card-offer')).toBeNull();
  });

  it('never sends a security code: nothing in the call carries one even if the page message did', async () => {
    const wv = makeWebview(); VexCards.attach(wv);
    message(wv, 'vex-card-submit', { ...submitted, cvv: '123', cvc: '123' }); await settle();
    document.querySelector('#vex-card-offer .primary').click(); await settle();
    expect(JSON.stringify(vexApi.cardsSave.mock.calls)).not.toMatch(/123/);
  });

  it('"Never for this site" stops the offer on that site, and Settings can bring it back', async () => {
    const wv = makeWebview(); VexCards.attach(wv);
    message(wv, 'vex-card-submit', submitted); await settle();
    document.querySelector('#vex-card-offer .muted').click();
    expect(VexCards._never()).toEqual(['shop.example']);
    message(wv, 'vex-card-submit', submitted); await settle();
    expect(document.getElementById('vex-card-offer')).toBeNull();
  });

  it('is not made for a card that is already saved, or when the offer is switched off', async () => {
    const wv = makeWebview(); VexCards.attach(wv);
    vexApi.cardsHas.mockResolvedValueOnce(true);
    message(wv, 'vex-card-submit', submitted); await settle();
    expect(document.getElementById('vex-card-offer')).toBeNull();
    VexCards.setOffering(false);
    message(wv, 'vex-card-submit', submitted); await settle();
    expect(document.getElementById('vex-card-offer')).toBeNull();
    expect(vexApi.cardsHas).toHaveBeenCalledTimes(1);
  });

  it('is not made in a private or Tor tab, a routed tab, a plain http page, or for another site\'s name', async () => {
    window.VexTabPolicy = { canFillWebview: () => false, isRouted: () => false };
    let wv = makeWebview(); VexCards.attach(wv);
    message(wv, 'vex-card-submit', submitted); await settle();
    expect(document.getElementById('vex-card-offer')).toBeNull();

    window.VexTabPolicy = { canFillWebview: () => true, isRouted: () => true };
    wv = makeWebview('https://shop.example/pay', { partition: 'persist:route-tor' }); VexCards.attach(wv);
    message(wv, 'vex-card-submit', submitted); await settle();
    expect(document.getElementById('vex-card-offer')).toBeNull();

    window.VexTabPolicy = { canFillWebview: () => true, isRouted: () => false };
    wv = makeWebview('http://shop.example/pay'); VexCards.attach(wv);
    message(wv, 'vex-card-submit', submitted); await settle();
    expect(document.getElementById('vex-card-offer')).toBeNull();

    wv = makeWebview(); VexCards.attach(wv);
    message(wv, 'vex-card-submit', { ...submitted, host: 'evil.example' }); await settle();
    expect(document.getElementById('vex-card-offer')).toBeNull();
  });

  it('refuses a number or an expiry that cannot be a card', async () => {
    const wv = makeWebview(); VexCards.attach(wv);
    message(wv, 'vex-card-submit', { ...submitted, number: '12' }); await settle();
    message(wv, 'vex-card-submit', { ...submitted, expMonth: 13 }); await settle();
    message(wv, 'vex-card-submit', { ...submitted, expYear: 1999 }); await settle();
    expect(document.getElementById('vex-card-offer')).toBeNull();
  });
});

describe('the chooser', () => {
  it('lists the saved cards under the field, and pressing one sends its details to the page script for that click', async () => {
    const wv = makeWebview(); VexCards.attach(wv);
    message(wv, 'vex-card-want', { id: 'cf1-9', host: 'shop.example', kind: 'num', x: 40, y: 100, w: 300 });
    await settle();
    const box = document.getElementById('vex-card-chooser');
    expect(box).toBeTruthy();
    expect(box.textContent).toContain('Visa');
    expect(box.textContent).toContain('4242');
    expect(box.textContent).not.toContain('4242424242424242');
    expect(box.style.left).toBe('140px');
    document.querySelector('#vex-card-chooser .vex-card-item[role=option]').click();
    await settle();
    expect(vexApi.cardsReveal).toHaveBeenCalledWith('c1');
    expect(wv.send).toHaveBeenCalledWith('vex-card-fill', { id: 'cf1-9', now: false, number: '4242424242424242', name: 'Ada Lovelace', expMonth: 8, expYear: 2099 });
    expect(document.getElementById('vex-card-chooser')).toBeNull();
  });

  it('does not appear when no card is saved, and is never drawn by a private tab', async () => {
    const wv = makeWebview(); VexCards.attach(wv);
    vexApi.cardsList.mockResolvedValueOnce([]);
    message(wv, 'vex-card-want', { id: 'a', host: 'shop.example', kind: 'num' }); await settle();
    expect(document.getElementById('vex-card-chooser')).toBeNull();
    window.VexTabPolicy = { canFillWebview: () => false, isRouted: () => false };
    message(wv, 'vex-card-want', { id: 'b', host: 'shop.example', kind: 'num' }); await settle();
    expect(document.getElementById('vex-card-chooser')).toBeNull();
    expect(vexApi.cardsList).toHaveBeenCalledTimes(1);
  });

  it('writes a card\'s name as text, never as markup', async () => {
    const wv = makeWebview(); VexCards.attach(wv);
    vexApi.cardsList.mockResolvedValueOnce([{ ...LIST[0], name: '<img src=x onerror=alert(1)>', nickname: '<b>x</b>' }]);
    message(wv, 'vex-card-want', { id: 'a', host: 'shop.example', kind: 'num' }); await settle();
    const box = document.getElementById('vex-card-chooser');
    expect(box.querySelector('img')).toBeNull();
    expect(box.querySelector('b')).toBeNull();
    expect(box.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('asks before filling a card that has run out', async () => {
    const wv = makeWebview(); VexCards.attach(wv);
    vexApi.cardsReveal.mockResolvedValueOnce({ ...FULL, expYear: 2020 });
    window.vexConfirm.mockResolvedValueOnce(false);
    const r = await VexCards.fillCard(wv, 'c1', {});
    expect(r.reason).toBe('cancelled');
    expect(wv.send).not.toHaveBeenCalled();
  });

  it('the "Fill a saved card" route marks the fill as the person\'s own (now) and needs no click id', async () => {
    const wv = makeWebview(); VexCards.attach(wv);
    await VexCards.fillCard(wv, 'c1', {});
    expect(wv.send).toHaveBeenCalledWith('vex-card-fill', expect.objectContaining({ now: true, id: '', number: '4242424242424242' }));
  });

  it('says what happened after the page script answers', async () => {
    const wv = makeWebview(); VexCards.attach(wv);
    message(wv, 'vex-card-filled', { found: true, filled: 3, cvc: true }); await settle();
    expect(toasts.at(-1)[0]).toMatch(/Type the security code/);
    message(wv, 'vex-card-filled', { found: false, filled: 0 }); await settle();
    expect(toasts.at(-1)[0]).toMatch(/No card boxes found/);
    message(wv, 'vex-card-filled', { found: true, filled: 0 }); await settle();
    expect(toasts.at(-1)[0]).toMatch(/nothing was filled/);
  });
});

describe('a page Vex did not recognise', () => {
  it('types the number, the name or the expiry into the box that has the focus', async () => {
    const wv = makeWebview();
    await VexCards.typeInto(wv, 'c1', 'number');
    await VexCards.typeInto(wv, 'c1', 'name');
    await VexCards.typeInto(wv, 'c1', 'expiry');
    expect(wv.insertText.mock.calls.map(c => c[0])).toEqual(['4242424242424242', 'Ada Lovelace', '08/99']);
    expect(wv.focus).toHaveBeenCalledTimes(3);
  });
  it('types nothing for a name that was never saved, and nothing in a tab that may not use cards', async () => {
    const wv = makeWebview();
    vexApi.cardsReveal.mockResolvedValueOnce({ ...FULL, name: '' });
    expect((await VexCards.typeInto(wv, 'c1', 'name')).ok).toBe(false);
    window.VexTabPolicy = { canFillWebview: () => false, isRouted: () => false };
    expect((await VexCards.typeInto(wv, 'c1', 'number')).ok).toBe(false);
    expect(wv.insertText).not.toHaveBeenCalled();
  });
  it('copies the number through the secret clipboard, which clears it after thirty seconds', async () => {
    await VexCards.copyNumber('c1');
    expect(window.vexCopySecret).toHaveBeenCalledWith('4242424242424242', 'Card number copied');
  });
});

describe('the manager', () => {
  it('lists the cards with the actions, and disables the page actions when the tab may not use cards', async () => {
    window.VexTabPolicy = { canFillWebview: () => false, isRouted: () => false };
    await VexCards.openManager(makeWebview(), {});
    const dlg = document.querySelector('.vex-cards-dialog');
    expect(dlg.textContent).toContain('Visa');
    expect(dlg.textContent).toMatch(/CVV\) is never saved/);
    const labels = [...dlg.querySelectorAll('.vex-cards-actions button')].map(b => [b.textContent, b.disabled]);
    expect(labels.find(l => l[0] === 'Fill the form')[1]).toBe(true);
    expect(labels.find(l => l[0] === 'Copy number')[1]).toBe(false);
    expect(dlg.textContent).toMatch(/private or Tor tab/);
  });
  it('adds a card by hand and shows the reason when the number is wrong', async () => {
    await VexCards.openManager(null, { add: true });
    const form = document.querySelector('.vex-cards-form');
    form.querySelector('[name=number]').value = '4242 4242 4242 4242';
    form.querySelector('[name=name]').value = 'Ada';
    form.querySelector('[name=exp]').value = '8/27';
    vexApi.cardsSave.mockResolvedValueOnce({ ok: false, error: 'That card number does not look right: check the digits' });
    form.dispatchEvent(new Event('submit', { cancelable: true })); await settle();
    expect(vexApi.cardsSave).toHaveBeenCalledWith({ number: '4242 4242 4242 4242', name: 'Ada', expMonth: '8', expYear: '27', nickname: '' });
    expect(document.querySelector('.vex-cards-form .warn').textContent).toMatch(/does not look right/);
    form.dispatchEvent(new Event('submit', { cancelable: true })); await settle();
    expect(document.querySelector('.vex-cards-form')).toBeNull();   // saved: back to the list
  });
  it('refuses an expiry that is not a month and a year before it asks main', async () => {
    await VexCards.openManager(null, { add: true });
    const form = document.querySelector('.vex-cards-form');
    form.querySelector('[name=number]').value = '4242424242424242';
    form.querySelector('[name=exp]').value = 'later';
    form.dispatchEvent(new Event('submit', { cancelable: true })); await settle();
    expect(vexApi.cardsSave).not.toHaveBeenCalled();
    expect(document.querySelector('.vex-cards-form .warn').textContent).toMatch(/month and year/);
  });
  it('Escape closes it, and Delete asks first', async () => {
    await VexCards.openManager(null, {});
    const del = [...document.querySelectorAll('.vex-cards-actions button')].find(b => b.textContent === 'Delete');
    window.vexConfirm.mockResolvedValueOnce(false);
    del.click(); await settle();
    expect(vexApi.cardsDelete).not.toHaveBeenCalled();
    del.click(); await settle();
    expect(vexApi.cardsDelete).toHaveBeenCalledWith('c1');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('vex-cards-dialog')).toBeNull();
  });
});

describe('the overlay layers', () => {
  it('every card overlay uses a layer VexLayer knows (found in the real app 2026-10-26: "modal" is not one, the manager drew empty)', async () => {
    const TIERS = ['chrome', 'panel', 'dialog', 'menu', 'toast', 'system'];
    window.VexLayer = { track: (el, o) => { if (!TIERS.includes(o.tier)) throw new Error('Unknown overlay tier "' + o.tier + '"'); } };
    try {
      const wv = makeWebview(); VexCards.attach(wv);
      message(wv, 'vex-card-submit', submitted); await settle();
      expect(document.getElementById('vex-card-offer')).toBeTruthy();
      message(wv, 'vex-card-want', { id: 'a', host: 'shop.example', kind: 'num' }); await settle();
      expect(document.getElementById('vex-card-chooser')).toBeTruthy();
      await VexCards.openManager(wv, {});
      expect(document.querySelector('.vex-cards-dialog').children.length).toBeGreaterThan(0);
    } finally { delete window.VexLayer; }
  });
});

describe('Settings > Payment cards', () => {
  it('says how many cards, never syncs them, and holds the offer switch', async () => {
    const box = document.createElement('div');
    await VexCards.renderPanel(box);
    expect(box.textContent).toMatch(/1 card is saved/);
    expect(box.textContent).toMatch(/never synced/);
    const sw = box.querySelector('input[type=checkbox]');
    expect(sw.checked).toBe(true);
    sw.checked = false; sw.dispatchEvent(new Event('change'));
    expect(VexCards.offering()).toBe(false);
  });
});
