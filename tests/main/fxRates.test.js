// The Central Bank rate table for TL equivalent (src/main/fx-rates.js), against a local stand-in.
import { describe, it, expect } from 'vitest';

const { createFxRates, parseTcmb, TCMB_URL } = require('../../src/main/fx-rates');

const XML = `<?xml version="1.0"?><Tarih_Date Tarih="15.10.2026" Date="10/15/2026" Bulten_No="2026/190">
<Currency CrossOrder="0" Kod="USD" CurrencyCode="USD"><Unit>1</Unit><ForexBuying>41.1000</ForexBuying><ForexSelling>41.2000</ForexSelling></Currency>
<Currency CrossOrder="1" Kod="EUR" CurrencyCode="EUR"><Unit>1</Unit><ForexBuying>44.0000</ForexBuying><ForexSelling>44.1000</ForexSelling></Currency>
<Currency CrossOrder="2" Kod="JPY" CurrencyCode="JPY"><Unit>100</Unit><ForexBuying>27.0000</ForexBuying><ForexSelling>27.5000</ForexSelling></Currency>
<Currency CrossOrder="3" Kod="XDR" CurrencyCode="XDR"><Unit>1</Unit><ForexBuying>1</ForexBuying><ForexSelling>1</ForexSelling></Currency></Tarih_Date>`;

describe('parseTcmb', () => {
  it('reads the date and the wanted currencies per unit', () => {
    const r = parseTcmb(XML);
    expect(r.date).toBe('2026-10-15');
    expect(r.rates.USD).toEqual({ buying: 41.1, selling: 41.2 });
    expect(r.rates.JPY.selling).toBeCloseTo(0.275);
    expect(r.rates.XDR).toBeUndefined();
  });
  it('refuses a table without a date or without dollar and euro', () => {
    expect(() => parseTcmb('<x/>')).toThrow(/no date/);
    expect(() => parseTcmb('<Tarih_Date Tarih="15.10.2026"></Tarih_Date>')).toThrow(/dollar and the euro/);
  });
});

describe('tcmb()', () => {
  it('makes one credential-less GET to the fixed address', async () => {
    const calls = [];
    const f = async (url, init) => { calls.push({ url, init }); return new Response(XML, { status: 200 }); };
    const out = await createFxRates({ fetch: f }).tcmb();
    expect(out).toMatchObject({ date: '2026-10-15', source: 'TCMB' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TCMB_URL);
    expect(calls[0].init.credentials).toBe('omit');
    expect(calls[0].init.egress.feature).toBe('TL equivalent');
  });
  it('says what the bank answered when it is not ok', async () => {
    const f = async () => new Response('no', { status: 503 });
    await expect(createFxRates({ fetch: f }).tcmb()).rejects.toThrow(/503/);
  });
});
