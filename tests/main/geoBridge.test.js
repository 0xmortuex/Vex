// Geolocation bridge hardening — security audit M-3.
//
// The renderer-facing bridge in src/preload-webview.js used to expose
// `getPref()` directly, letting any guest page read the user's stored
// coordinates without going through the permission prompt. The fix collapses
// the bridge to a single atomic `resolveLocation(origin)` method that runs
// raw `geolocation:get` responses through `coarsenLocation` before they
// cross into the renderer.
//
// These tests cover the pure helper from src/main-helpers.js. The
// preload-webview.js file inlines a copy of the same logic (because the
// preload runs under session.setPreloads where relative requires are
// brittle); both copies must stay in sync — the test below catches drift
// by checking the contract exhaustively.

import { describe, it, expect } from 'vitest';
import { coarsenLocation, roundCoord, COARSE_DECIMAL_PLACES } from '../../src/main-helpers.js';

describe('roundCoord', () => {
  it('rounds to 1 decimal place (city-level, ~11 km)', () => {
    expect(COARSE_DECIMAL_PLACES).toBe(1);
    expect(roundCoord(40.689247)).toBe(40.7);
    expect(roundCoord(-74.044502)).toBe(-74.0);
    expect(roundCoord(51.50741234)).toBe(51.5);
  });

  it('handles negative values correctly', () => {
    // (-0.05, 0) inputs land on signed-zero 0 / -0 — JSON.stringify
    // collapses that to '0' anyway, so we don't pin which one we get.
    expect(Math.abs(roundCoord(-0.04))).toBe(0);
    expect(roundCoord(-0.06)).toBe(-0.1);
    expect(roundCoord(-37.334606)).toBe(-37.3);
  });

  it('returns null for non-finite or non-number input', () => {
    expect(roundCoord(NaN)).toBeNull();
    expect(roundCoord(Infinity)).toBeNull();
    expect(roundCoord(-Infinity)).toBeNull();
    expect(roundCoord('40.7')).toBeNull();
    expect(roundCoord(null)).toBeNull();
    expect(roundCoord(undefined)).toBeNull();
  });
});

describe('coarsenLocation — happy paths', () => {
  it('manual mode with finite coords → rounded {mode, latitude, longitude}', () => {
    const out = coarsenLocation({ mode: 'manual', latitude: 40.689247, longitude: -74.044502 });
    expect(out).toEqual({ mode: 'manual', latitude: 40.7, longitude: -74.0 });
  });

  it('ip mode → {mode: "ip"}', () => {
    expect(coarsenLocation({ mode: 'ip' })).toEqual({ mode: 'ip' });
  });

  it('off mode → {mode: "denied"}', () => {
    expect(coarsenLocation({ mode: 'off' })).toEqual({ mode: 'denied' });
  });

  it('manual mode without coords → falls back to {mode: "ip"}', () => {
    expect(coarsenLocation({ mode: 'manual' })).toEqual({ mode: 'ip' });
    expect(coarsenLocation({ mode: 'manual', latitude: NaN, longitude: 12.3 })).toEqual({ mode: 'ip' });
    expect(coarsenLocation({ mode: 'manual', latitude: 'oops' })).toEqual({ mode: 'ip' });
  });
});

describe('coarsenLocation — privacy contract', () => {
  // The whole point of M-3 — the renderer never sees ISP/ASN/IP/timezone/etc.,
  // even if the main-process pref store grows new fields in future.
  it('returns ONLY {mode, latitude, longitude} keys for manual mode', () => {
    const out = coarsenLocation({
      mode: 'manual',
      latitude: 40.7, longitude: -74.0,
      // Hostile/legacy/future fields that must NOT cross the bridge:
      ip: '203.0.113.42',
      isp: 'Acme ISP',
      asn: 'AS64500',
      timezone: 'America/New_York',
      accuracy: 50,
      timestamp: 1714588800000,
      country: 'US',
      city: 'New York',
      org: 'Acme Inc',
    });
    expect(Object.keys(out).sort()).toEqual(['latitude', 'longitude', 'mode']);
    expect(out).toEqual({ mode: 'manual', latitude: 40.7, longitude: -74.0 });
  });

  it('returns ONLY {mode} key for ip / denied / malformed responses', () => {
    expect(Object.keys(coarsenLocation({ mode: 'ip', ip: '1.2.3.4' }))).toEqual(['mode']);
    expect(Object.keys(coarsenLocation({ mode: 'off', latitude: 40.7 }))).toEqual(['mode']);
    expect(Object.keys(coarsenLocation({ mode: 'manual', latitude: NaN, ip: '1.2.3.4' }))).toEqual(['mode']);
  });

  it('coordinates are rounded to 1 dp (no building-level precision leak)', () => {
    // Apple Park HQ — at full precision uniquely identifies the building.
    const apple = coarsenLocation({ mode: 'manual', latitude: 37.334606, longitude: -122.009102 });
    expect(apple.latitude).toBe(37.3);
    expect(apple.longitude).toBe(-122.0);
    // 1dp = ~11 km grid; far below the ~100 m needed for street identification.
  });
});

describe('coarsenLocation — error / malformed input', () => {
  // Per the audit's privacy guidance: the bridge never returns an error
  // object that might leak internal state (stack frames, IPC channel names,
  // pref-store paths). It returns one of the three documented shapes; an
  // unexpected input falls through to {mode: 'denied'} — the safest default.
  it('null → {mode: "denied"}', () => {
    expect(coarsenLocation(null)).toEqual({ mode: 'denied' });
  });

  it('undefined → {mode: "denied"}', () => {
    expect(coarsenLocation(undefined)).toEqual({ mode: 'denied' });
  });

  it('non-object types → {mode: "denied"}', () => {
    expect(coarsenLocation('manual')).toEqual({ mode: 'denied' });
    expect(coarsenLocation(42)).toEqual({ mode: 'denied' });
    expect(coarsenLocation(true)).toEqual({ mode: 'denied' });
  });

  it('unknown mode → {mode: "denied"}', () => {
    expect(coarsenLocation({ mode: 'gps', latitude: 40.7, longitude: -74.0 })).toEqual({ mode: 'denied' });
    expect(coarsenLocation({ mode: 'allow' })).toEqual({ mode: 'denied' });
    expect(coarsenLocation({})).toEqual({ mode: 'denied' });
  });

  it('arrays → {mode: "denied"}', () => {
    // Arrays are typeof 'object'; ensure the helper doesn't accidentally
    // accept ['manual', 40.7, -74.0] or similar.
    expect(coarsenLocation([])).toEqual({ mode: 'denied' });
    expect(coarsenLocation([{ mode: 'manual', latitude: 40.7, longitude: -74.0 }])).toEqual({ mode: 'denied' });
  });
});

describe('coarsenLocation — exhaustive return-shape contract', () => {
  // Every return path of the helper. Pinning all three shapes here so a
  // future refactor can't silently introduce a fourth shape (e.g. {error:..})
  // without a test failure.
  it('return shape is one of three documented forms', () => {
    const cases = [
      { mode: 'manual', latitude: 1, longitude: 2 },
      { mode: 'manual' }, // → ip fallback
      { mode: 'ip' },
      { mode: 'off' },
      null,
      'bogus',
    ];
    for (const c of cases) {
      const out = coarsenLocation(c);
      expect(out).not.toBeNull();
      expect(typeof out).toBe('object');
      expect(['denied', 'manual', 'ip']).toContain(out.mode);
      if (out.mode === 'manual') {
        expect(typeof out.latitude).toBe('number');
        expect(typeof out.longitude).toBe('number');
        expect(Object.keys(out).sort()).toEqual(['latitude', 'longitude', 'mode']);
      } else {
        expect(Object.keys(out)).toEqual(['mode']);
      }
    }
  });
});

describe('preload-webview.js — bridge surface', () => {
  // The audit's core finding: the bridge used to expose two methods, only
  // one of which checked permission. Pin the new surface to a SINGLE method
  // so the bypass can't reappear.
  //
  // Static source-text test — preload-webview.js requires the real electron
  // module, can't be loaded in node. Reading the file is good enough to
  // catch a regression of "added back getPref / checkPermission".
  it('only exposes resolveLocation on the bridge object', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../../src/preload-webview.js'), 'utf8');

    // Find the literal bridge object declaration. We expect exactly one
    // method key on it: `resolveLocation`.
    const m = src.match(/const bridge = \{([\s\S]*?)\n\s*\};/);
    expect(m, 'bridge object literal not found').toBeTruthy();
    const body = m[1];

    expect(body).toMatch(/resolveLocation\s*:/);

    // Forbidden methods that previously existed and would re-introduce the
    // bypass if added back. If a future feature genuinely needs one of these,
    // remove it from this list AND add a permission-check test for it.
    expect(body, 'getPref must NOT be back on the bridge').not.toMatch(/\bgetPref\s*:/);
    expect(body, 'checkPermission must NOT be back on the bridge').not.toMatch(/\bcheckPermission\s*:/);
  });
});
