// @vitest-environment jsdom
//
// The shortcuts bar's letter chips (gui-style.js) drew a white letter on every
// chip colour; on the darkened green host colours that was 4.4:1, under the
// 4.5:1 check:ui requires. The letter now takes white or black from the chip.

import { describe, it, expect, vi } from 'vitest';

function contrast(a, b) {
  const L = (rgb) => {
    const [r, g, bl] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const x = L(a), y = L(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// The test's own colour reading (not the module's), so a parsing mistake in
// gui-style.js cannot agree with itself.
const rgbOf = (css) => {
  let m = css.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  m = css.match(/^hsl\((\d+), (\d+)%, (\d+)%\)$/);
  const [h, s, l] = [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100];
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map(n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))));
};

describe('shortcut letter chip ink', async () => {
  vi.resetModules();
  document.body.innerHTML = '<div id="top-bar"></div><div id="top-bar-right"></div>';
  await import('../../src/renderer/js/gui-style.js');
  const { chipInk, hostColor } = window.VexGuiStyle;

  it('reads at 4.5:1 on every host colour the bar can draw', () => {
    // hostColor hashes the host to a hue; walk every hue it can produce.
    for (let h = 0; h < 360; h++) {
      const bg = `hsl(${h}, 55%, 34%)`;
      const ink = chipInk(bg);
      expect(contrast(rgbOf(ink), rgbOf(bg)), bg + ' with ' + ink).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the green that failed check:ui gets a readable letter', () => {
    const bg = hostColor('https://github.com');
    expect(contrast(rgbOf(chipInk(bg)), rgbOf(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('reads on any custom colour a picker can give', () => {
    for (let i = 0; i < 4096; i++) {
      const hex = '#' + [i >> 8, (i >> 4) & 15, i & 15].map(n => (n * 17).toString(16).padStart(2, '0')).join('');
      expect(contrast(rgbOf(chipInk(hex)), rgbOf(hex)), hex).toBeGreaterThanOrEqual(4.5);
    }
    expect(chipInk('#fff')).toBe('#000');
    expect(chipInk('#123')).toBe('#fff');
  });

  it('keeps white where white passes', () => {
    expect(chipInk('hsl(240, 55%, 34%)')).toBe('#fff');
  });
});
