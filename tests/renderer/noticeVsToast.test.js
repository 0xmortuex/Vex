// @vitest-environment jsdom
//
// CI check:ui (windows-latest, 2026-10-17) found the "Why is Vex slow" bar's
// buttons (The whole picture / Nothing more for four hours) lying under the
// "If it misbehaves" button of the update-safety-net toast: both are fixed to
// the bottom-right corner, 16px and 20px in. The bar fires when the machine is
// slow (two busy minutes in a row), and a slow CI runner is exactly where that
// happens while the toast is up, so it showed there every time and on a fast
// machine almost never. The rule that prevents it is the one the download
// cards already follow: data-avoid-toasts="above" makes the toast stack sit on
// top of the bar (app.js placeToasts). The tests here are deterministic: they
// open both and measure.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fs = require('fs');
const path = require('path');

require('../../src/renderer/js/vex-utils.js');
const { WhySlow } = require('../../src/renderer/js/why-slow.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8').replace(/\r\n/g, '\n');
const app = read('src/renderer/js/app.js');
const start = app.indexOf('  function showToast(message, type, duration, opts) {');
const end = app.indexOf('\n  window.showToast = showToast;', start);
class FakeObserver { observe() {} disconnect() {} }
const [showToast, placeToasts] = new Function('MutationObserver', 'ResizeObserver', app.slice(start, end) + '\nreturn [showToast, placeToasts];')(FakeObserver, FakeObserver);

const rect = (el, r) => { el.getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height }); el.getClientRects = () => [1]; };
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

beforeEach(() => { document.body.innerHTML = ''; vi.useFakeTimers(); window.showToast = vi.fn(); });

describe('the notice bars and the toast stack', () => {
  it('every vexslow-notice bar asks the toasts to keep above it', () => {
    const bar = WhySlow._notice({ id: 'cpu:1', title: 'YouTube is using 60% of a processor core' });
    expect(bar.className).toBe('vexslow-notice');
    expect(bar.getAttribute('data-avoid-toasts')).toBe('above');
    // The other two bars of the same class are built in files that need the
    // whole renderer; their source is held to the same line.
    for (const f of ['src/renderer/js/sleep-consent.js', 'src/renderer/js/discord-memory.js']) {
      expect(read(f)).toMatch(/className = 'vexslow-notice';\n\s*bar\.setAttribute\('data-avoid-toasts', 'above'\)/);
    }
  });

  it('with the slow bar and the safety-net toast both up, the toast buttons and the bar buttons do not overlap', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
    const bar = WhySlow._notice({ id: 'cpu:1', title: 'YouTube is using 60% of a processor core' });
    rect(bar, { left: 760, top: 650, width: 504, height: 54 });   // bottom 16, right 16
    showToast('Vex updated to 22.22.1. Your settings from before the update are saved.', 'info', 9000, { action: { label: 'If it misbehaves', title: 'Restore the settings from before the update', run: () => {} } });
    const c = document.getElementById('toast-container');
    // Where the stack sits with no help: bottom 20, right 20, on the bar.
    const toastBox = { left: 900, top: 636, width: 360, height: 64 };
    rect(c, toastBox);
    expect(overlaps(c.getBoundingClientRect(), bar.getBoundingClientRect())).toBe(true);
    placeToasts();
    expect(c.style.bottom).toBe('78px');   // 720 - 650 + 8: the stack stands on the bar
    // The stack really moved up by that much: no overlap any more.
    const lifted = 720 - 78 - toastBox.height;
    rect(c, { ...toastBox, top: lifted });
    expect(overlaps(c.getBoundingClientRect(), bar.getBoundingClientRect())).toBe(false);
    // The bar leaves (it goes by itself after 20s): the stack comes back down.
    bar.remove();
    placeToasts();
    expect(c.style.bottom).toBe('');
  });
});

describe('the bar buttons are big enough to hit', () => {
  it('keys-sheet.css gives .vexslow-notice buttons the 24x24 minimum target', () => {
    const css = read('src/renderer/css/keys-sheet.css');
    const rule = css.slice(css.indexOf('.vexslow-notice button {'), css.indexOf('}', css.indexOf('.vexslow-notice button {')));
    expect(rule).toMatch(/min-width:\s*24px/);
    expect(rule).toMatch(/min-height:\s*24px/);
  });
});
