// The postcode lookup identifies Vex to OpenStreetMap, and nothing else on that host or anywhere else is touched.
import { describe, it, expect } from 'vitest';

const { applyGeoUserAgent, isVexGeoRequest } = require('../../src/main/geo-user-agent.js');
const UA = 'Vex/36.25.1 (+https://github.com/0xmortuex/Vex)';
const PAGE = 'file:///C:/Users/x/AppData/Local/Programs/Vex/resources/app/src/renderer/index.html';
const req = (over = {}) => ({
  url: 'https://nominatim.openstreetmap.org/search?postalcode=34852&country=tr&format=jsonv2',
  resourceType: 'xhr',
  requestHeaders: { 'User-Agent': 'Mozilla/5.0 vex/36.25.1 Chrome/148 Electron/42', Accept: 'application/json' },
  ...over,
});

describe('Nominatim User-Agent', () => {
  it('is set on the postcode lookup made by a Vex page, and nothing else changes', () => {
    const d = req();
    expect(applyGeoUserAgent(d.requestHeaders, d, UA, PAGE)).toBe(true);
    expect(d.requestHeaders['User-Agent']).toBe(UA);
    expect(d.requestHeaders.Accept).toBe('application/json');
    expect(Object.keys(d.requestHeaders).filter(k => k.toLowerCase() === 'user-agent')).toHaveLength(1);
  });
  it('replaces the header whatever its capitalisation', () => {
    const d = req({ requestHeaders: { 'user-agent': 'x' } });
    expect(applyGeoUserAgent(d.requestHeaders, d, UA, PAGE)).toBe(true);
    expect(Object.keys(d.requestHeaders)).toEqual(['User-Agent']);
  });
  it('leaves a website on that host alone (the asking page is https, or unknown)', () => {
    for (const page of ['https://nominatim.openstreetmap.org/ui/search.html', 'https://example.com/', '', undefined]) {
      const d = req();
      expect(applyGeoUserAgent(d.requestHeaders, d, UA, page), String(page)).toBe(false);
      expect(d.requestHeaders['User-Agent']).toMatch(/Mozilla/);
    }
  });
  it('leaves page loads, other paths, other hosts and other schemes alone', () => {
    for (const over of [
      { resourceType: 'mainFrame' },
      { url: 'https://nominatim.openstreetmap.org/ui/search.html' },
      { url: 'https://example.com/search' },
      { url: 'http://nominatim.openstreetmap.org/search' },
      { url: 'https://nominatim.openstreetmap.org.evil.test/search' },
    ]) {
      const d = req(over);
      expect(isVexGeoRequest(d, PAGE), JSON.stringify(over)).toBe(false);
      expect(applyGeoUserAgent(d.requestHeaders, d, UA, PAGE)).toBe(false);
      expect(d.requestHeaders['User-Agent']).toMatch(/Mozilla/);
    }
  });
  it('refuses to run without a User-Agent to send', () => {
    const d = req();
    expect(() => applyGeoUserAgent(d.requestHeaders, d, '', PAGE)).toThrow(/says who is asking/);
  });
  it('is wired into the one shared header dispatcher with the page that asked', () => {
    const fs = require('fs');
    const main = fs.readFileSync(require('path').resolve(__dirname, '../../src/main.js'), 'utf8');
    expect(main).toMatch(/require\('\.\/main\/geo-user-agent'\)/);
    expect(main).toMatch(/_applyGeoUserAgent\(h, details, 'Vex\/' \+ app\.getVersion\(\) \+ ' \(\+https:\/\/github\.com\/0xmortuex\/Vex\)', _pageUrlOf\(details\.webContentsId\)\)/);
  });
});
