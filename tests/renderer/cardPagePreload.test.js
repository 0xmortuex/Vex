// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://shop.example/pay"}
//
// The card script in preload-webview.js (2026-10-26): what it recognises as a card form, how it fills one, and what it refuses. It is
// run here the way the preload runs it, against a stand-in for ipcRenderer. A real click and a real submit (isTrusted) cannot be made
// in jsdom, so the capture on submit is driven in the real app; this covers the filling, the field detection and the refusals.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
const BLOCK = SOURCE.slice(SOURCE.indexOf('// === Payment cards'));

let sent, handlers;
function load() {
  sent = []; handlers = {};
  const ipcRenderer = { sendToHost: (ch, d) => sent.push([ch, d]), on: (ch, fn) => { handlers[ch] = fn; } };
  new Function('require', BLOCK)((name) => { if (name === 'electron') return { ipcRenderer }; throw new Error('no ' + name); });
}
const fill = (d) => handlers['vex-card-fill']({}, d);
const CARD = { number: '4242424242424242', name: 'Ada Lovelace', expMonth: 8, expYear: 2027 };

beforeEach(() => {
  document.body.innerHTML = '';
  // jsdom lays nothing out: every box counts as shown
  Element.prototype.getBoundingClientRect = function () { return { width: 120, height: 20, left: 0, top: 0, right: 120, bottom: 20, x: 0, y: 0 }; };
  load();
});

describe('filling a form it recognises', () => {
  it('fills the number, name and a one-box expiry from the autocomplete hints, then moves to the CVV box', () => {
    document.body.innerHTML = `<form><input id="n" autocomplete="cc-number"><input id="nm" autocomplete="cc-name"><input id="e" autocomplete="cc-exp" placeholder="MM / YY"><input id="c" autocomplete="cc-csc"></form>`;
    fill({ now: true, ...CARD });
    expect(document.getElementById('n').value).toBe('4242424242424242');
    expect(document.getElementById('nm').value).toBe('Ada Lovelace');
    expect(document.getElementById('e').value).toBe('08/27');
    expect(document.activeElement.id).toBe('c');
    expect(sent.find(s => s[0] === 'vex-card-filled')[1]).toMatchObject({ filled: 3, found: true, cvc: true });
  });

  it('knows the boxes by their words when there is no hint, in English and in Turkish', () => {
    document.body.innerHTML = `<form><label for="a">Card number</label><input id="a"><label for="b">Name on card</label><input id="b"><label for="c">Expiry date</label><input id="c"></form>`;
    fill({ now: true, ...CARD });
    expect(document.getElementById('a').value).toBe('4242424242424242');
    expect(document.getElementById('b').value).toBe('Ada Lovelace');
    expect(document.getElementById('c').value).toBe('08/27');
    document.body.innerHTML = `<form><label for="a">Kart Numarası</label><input id="a"><label for="c">Son Kullanma Tarihi</label><input id="c"><label for="g">Güvenlik Kodu</label><input id="g"></form>`;
    load();
    fill({ now: true, ...CARD });
    expect(document.getElementById('a').value).toBe('4242424242424242');
    expect(document.getElementById('c').value).toBe('08/27');
    expect(document.activeElement.id).toBe('g');
  });

  it('fills a month box and a year box, as inputs and as selects, in the form each one takes', () => {
    document.body.innerHTML = `<form><input id="n" autocomplete="cc-number"><input id="m" autocomplete="cc-exp-month" maxlength="2"><input id="y" autocomplete="cc-exp-year" maxlength="2"></form>`;
    fill({ now: true, ...CARD });
    expect(document.getElementById('m').value).toBe('08');
    expect(document.getElementById('y').value).toBe('27');

    document.body.innerHTML = `<form><input id="n" autocomplete="cc-number">
      <select id="m" autocomplete="cc-exp-month">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(v => `<option value="${String(v).padStart(2, '0')}">${v}</option>`).join('')}</select>
      <select id="y" autocomplete="cc-exp-year">${[2026, 2027, 2028].map(v => `<option value="${v}">${v}</option>`).join('')}</select></form>`;
    load();
    fill({ now: true, ...CARD });
    expect(document.getElementById('m').value).toBe('08');
    expect(document.getElementById('y').value).toBe('2027');
  });

  it('writes a four-digit year where the box wants one, and no slash where it holds four characters', () => {
    document.body.innerHTML = `<form><input id="n" autocomplete="cc-number"><input id="e" autocomplete="cc-exp" placeholder="MM/YYYY"></form>`;
    fill({ now: true, ...CARD });
    expect(document.getElementById('e').value).toBe('08/2027');
    document.body.innerHTML = `<form><input id="n" autocomplete="cc-number"><input id="e" autocomplete="cc-exp" maxlength="4"></form>`;
    load();
    fill({ now: true, ...CARD });
    expect(document.getElementById('e').value).toBe('0827');
  });

  it('tells the page a change happened, so a framework that watches the box sees it', () => {
    document.body.innerHTML = `<form><input id="n" autocomplete="cc-number"></form>`;
    const seen = [];
    const n = document.getElementById('n');
    n.addEventListener('input', () => seen.push('input'));
    n.addEventListener('change', () => seen.push('change'));
    fill({ now: true, ...CARD });
    expect(seen).toEqual(['input', 'change']);
  });

  it('leaves a box the person already typed in alone', () => {
    document.body.innerHTML = `<form><input id="n" autocomplete="cc-number"><input id="nm" autocomplete="cc-name" value="My own name"></form>`;
    fill({ now: true, ...CARD });
    expect(document.getElementById('nm').value).toBe('My own name');
    expect(document.getElementById('n').value).toBe('4242424242424242');
  });

  it('fills only the card form it found a number box in, not another form on the page', () => {
    document.body.innerHTML = `<form id="a"><input id="q" autocomplete="cc-name"></form><form id="b"><input id="n" autocomplete="cc-number"><input id="nm" autocomplete="cc-name"></form>`;
    fill({ now: true, ...CARD });
    expect(document.getElementById('nm').value).toBe('Ada Lovelace');
    expect(document.getElementById('q').value).toBe('');
  });
});

describe('what it refuses', () => {
  it('does nothing without a number box, and says no card form was found', () => {
    document.body.innerHTML = `<form><input id="s" name="search"></form>`;
    fill({ now: true, ...CARD });
    expect(document.getElementById('s').value).toBe('');
    expect(sent.find(s => s[0] === 'vex-card-filled')[1]).toMatchObject({ found: false, filled: 0 });
  });

  it('ignores a fill that does not follow the click it was asked for (not now, no matching id)', () => {
    document.body.innerHTML = `<form><input id="n" autocomplete="cc-number"></form>`;
    fill({ id: 'cf9-1', ...CARD });
    expect(document.getElementById('n').value).toBe('');
    expect(sent.length).toBe(0);
  });

  it('ignores a number that is not twelve to nineteen digits', () => {
    document.body.innerHTML = `<form><input id="n" autocomplete="cc-number"></form>`;
    for (const bad of ['4242', '4242 4242 4242 4242', '<script>', 42424242424242, undefined]) fill({ now: true, ...CARD, number: bad });
    expect(document.getElementById('n').value).toBe('');
    expect(sent.length).toBe(0);
  });

  it('does not fill a box that is hidden', () => {
    document.body.innerHTML = `<form><input id="n" autocomplete="cc-number" style="display:none"><input id="m" autocomplete="cc-number"></form>`;
    Element.prototype.getBoundingClientRect = function () { return this.id === 'n' ? { width: 0, height: 0 } : { width: 100, height: 20 }; };
    fill({ now: true, ...CARD });
    expect(document.getElementById('n').value).toBe('');
    expect(document.getElementById('m').value).toBe('4242424242424242');
  });

  it('never reads or reports a security code: the script has no code that sends one', () => {
    expect(BLOCK).not.toMatch(/sendToHost\([^)]*cvc/i);
    expect(BLOCK).not.toMatch(/cvc\w*\.value/);
  });
});
