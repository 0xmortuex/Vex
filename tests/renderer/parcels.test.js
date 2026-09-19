// @vitest-environment jsdom
//
// Parcels: recognise a tracking number, open the carrier's own page, keep a
// list. Nothing is looked up, so nothing is sent until Track is pressed.

import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
require('../../src/renderer/js/page-export.js');
const { Parcels } = require('../../src/renderer/js/parcels.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
});

describe('check digits', () => {
  it('UPS: the published sample passes, one changed digit fails', () => {
    expect(Parcels.upsValid('1Z999AA10123456784')).toBe(true);
    expect(Parcels.upsValid('1Z999AA10123456785')).toBe(false);
  });

  it('international post (S10)', () => {
    expect(Parcels.s10Valid('RR123456785GB')).toBe(true);        // 12345678 → check digit 5
    expect(Parcels.s10Valid('RR123456784GB')).toBe(false);
  });
});

describe('recognising a number', () => {
  it('knows the carrier from the format, ignoring spaces, dashes and case', () => {
    expect(Parcels.identify(' 1z999aa1 0123 456784 ')).toEqual({ number: '1Z999AA10123456784', carrier: 'ups', sure: true });
    expect(Parcels.identify('RR123456785GB')).toMatchObject({ carrier: 'royalmail', sure: true });
    expect(Parcels.identify('RR123456785US')).toMatchObject({ carrier: 'usps', sure: true });
    expect(Parcels.identify('RR123456785DE')).toMatchObject({ carrier: 'track17', sure: true });
    expect(Parcels.identify('9400 1000 0000 0000 0000 00')).toMatchObject({ carrier: 'usps', sure: true });
    expect(Parcels.identify('TBA123456789012')).toMatchObject({ carrier: 'amazon', sure: true });
    expect(Parcels.identify('JJD000390007882345678')).toMatchObject({ carrier: 'dhl', sure: true });
  });

  it('all-digit numbers are only "probably"', () => {
    expect(Parcels.identify('123456789012')).toEqual({ number: '123456789012', carrier: 'fedex', sure: false });
    expect(Parcels.identify('1234567890')).toMatchObject({ carrier: 'dhl', sure: false });
  });

  it('a UPS-shaped number with a wrong check digit is not "sure"', () => {
    expect(Parcels.identify('1Z999AA10123456785')).toMatchObject({ carrier: 'ups', sure: false });
  });

  it('refuses what is not a tracking number', () => {
    for (const x of ['', 'hello', 'RR123456784GB', '12345', 'https://example.com']) expect(Parcels.identify(x), x).toBeNull();
  });
});

describe('tracking pages', () => {
  it('go to the carrier, with the number encoded', () => {
    expect(Parcels.trackUrl({ carrier: 'ups', number: '1Z999AA10123456784' })).toBe('https://www.ups.com/track?tracknum=1Z999AA10123456784');
    expect(Parcels.trackUrl({ carrier: 'royalmail', number: 'RR123456785GB' })).toBe('https://www.royalmail.com/track-your-item#/tracking-results/RR123456785GB');
    expect(() => Parcels.trackUrl({ carrier: 'nobody', number: 'x' })).toThrow(/No tracking page/);
  });

  it('Track opens a new tab on that page', () => {
    globalThis.TabManager = { createTab: vi.fn() };
    Parcels.track({ carrier: 'fedex', number: '123456789012' });
    expect(TabManager.createTab).toHaveBeenCalledWith('https://www.fedex.com/fedextrack/?trknbr=123456789012', true);
  });
});

describe('the list', () => {
  it('adds, newest first, and refuses duplicates', () => {
    Parcels.add('RR123456785GB', { label: 'Shoes' });
    Parcels.add('1Z999AA10123456784');
    expect(Parcels.list().map(p => p.number)).toEqual(['1Z999AA10123456784', 'RR123456785GB']);
    expect(Parcels.list()[1]).toMatchObject({ carrier: 'royalmail', label: 'Shoes' });
    expect(() => Parcels.add('rr 123456785 gb')).toThrow(/already/);
  });

  it('an unknown format needs a carrier, and a carrier can be chosen over the guess', () => {
    expect(() => Parcels.add('ABC123XYZ')).toThrow(/pick the carrier/);
    expect(Parcels.add('ABC123XYZ', { carrier: 'dhl' })).toMatchObject({ number: 'ABC123XYZ', carrier: 'dhl' });
    expect(Parcels.add('123456789012', { carrier: 'ups' }).carrier).toBe('ups');
    expect(() => Parcels.add('<script>', { carrier: 'dhl' })).toThrow(/letters and digits/);
  });

  it('removes one', () => {
    Parcels.add('RR123456785GB');
    Parcels.remove('RR123456785GB');
    expect(Parcels.list()).toEqual([]);
    expect(() => Parcels.remove('RR123456785GB')).toThrow(/gone/);
  });

  it('unreadable saved parcels are an error, never silently replaced', () => {
    localStorage.setItem('vex.parcels', '[{');
    expect(() => Parcels.add('RR123456785GB')).toThrow(/could not be read/);
  });
});

describe('the sheet', () => {
  it('says whose a number is while you type, and adds it', () => {
    Parcels.open();
    const o = () => document.querySelector('.vex-parcels-overlay');
    const num = o().querySelector('[data-number]');
    num.value = '123456789012'; num.dispatchEvent(new Event('input'));
    expect(o().querySelector('[data-hint]').textContent).toMatch(/Probably FedEx/);
    num.value = 'RR123456785GB'; num.dispatchEvent(new Event('input'));
    expect(o().querySelector('[data-hint]').textContent).toBe('Looks like Royal Mail');
    o().querySelector('[data-label]').value = 'Book';
    o().querySelector('[data-add]').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(o().textContent).toContain('Book');
    expect(o().textContent).toContain('RR123456785GB · Royal Mail');
  });
});
