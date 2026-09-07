// Real Chromium checks in the smoke harness's throwaway profile only.

// Drive a real key press through the browser instead of dispatching a synthetic
// KeyboardEvent. Synthetic events run page handlers but never move focus, so a
// tab-order assertion built on them silently passes even when sequential focus
// navigation is broken.
async function pressKey(dbg, key, code, keyCode) {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await dbg.sendCommand('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  }
}

// Emulate a media feature and CONFIRM the page observes it before asserting on
// anything it should cause. Without the matchMedia check, a silently-ignored
// emulation would make every downstream assertion vacuously true.
async function withEmulatedMedia(contents, dbg, features, probe) {
  await dbg.sendCommand('Emulation.setEmulatedMedia', { features });
  try {
    return await contents.executeJavaScript(probe);
  } finally {
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  }
}

async function run({ mainWindow }) {
  const contents = mainWindow.webContents;
  let count = 0;
  for (const style of ['classic', 'glass']) {
    for (const zoom of [1, 1.25, 1.5, 2]) {
      contents.setZoomFactor(zoom);
      const result = await contents.executeJavaScript(`(async () => {
        Onboarding._close();
        localStorage.setItem('vex.lang', 'tr');
        await window.VexGuiStyle?.set?.(${JSON.stringify(style)});
        const launch = document.createElement('button'); launch.textContent = 'Open'; document.body.append(launch); launch.focus();
        const pending = window.vexPrompt({ title: 'Çalışma alanındaki bütün değişiklikleri kaydetmek için açıklayıcı bir ad belirtin', label: 'Çalışma alanının adı', value: 'Türkçe çalışma alanı' });
        const dialog = document.querySelector('.vex-dialog');
        const rect = dialog.getBoundingClientRect();
        const fits = rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
        const translated = dialog.querySelector('[data-cancel]').textContent === 'İptal';
        dialog.querySelector('[data-ok]').focus();
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab', bubbles:true, cancelable:true}));
        const trapped = document.activeElement === dialog.querySelector('input');
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
        const cancelled = await pending === null;
        const returned = document.activeElement === launch;
        launch.remove();
        return { fits, translated, trapped, cancelled, returned };
      })()`);
      if (Object.values(result).some(value => !value)) throw new Error('UI smoke failed for ' + style + ' at ' + zoom + ': ' + JSON.stringify(result));
      count++;
    }
  }
  contents.setZoomFactor(1);

  // --- Accessibility preferences and keyboard-only navigation (both GUI styles) ---
  const dbg = contents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  const a11y = [];
  try {
    for (const style of ['classic', 'glass']) {
      await contents.executeJavaScript(`window.VexGuiStyle?.set?.(${JSON.stringify(style)})`);

      // Reduced motion must collapse real animation/transition time, not merely
      // be declared in a stylesheet that never matches.
      const motion = await withEmulatedMedia(contents, dbg, [{ name: 'prefers-reduced-motion', value: 'reduce' }], `(() => {
        const matched = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const probe = document.createElement('div');
        probe.style.transition = 'opacity 900ms linear';
        probe.style.animation = 'vexNoSuchAnimation 900ms linear';
        document.body.append(probe);
        const cs = getComputedStyle(probe);
        const seconds = (v) => parseFloat(v) * (v.trim().endsWith('ms') ? 0.001 : 1);
        const transition = seconds(cs.transitionDuration);
        const animation = seconds(cs.animationDuration);
        probe.remove();
        return { matched, transition, animation };
      })()`);
      if (!motion.matched) throw new Error('prefers-reduced-motion emulation did not reach the page for ' + style);
      if (!(motion.transition < 0.05) || !(motion.animation < 0.05)) {
        throw new Error('reduced motion did not shorten durations for ' + style + ': ' + JSON.stringify(motion));
      }

      // Forced colors (Windows High Contrast) must give controls a visible
      // border and keep the focus ring, or chrome disappears into the canvas.
      const contrast = await withEmulatedMedia(contents, dbg, [{ name: 'forced-colors', value: 'active' }], `(() => {
        const matched = matchMedia('(forced-colors: active)').matches;
        const probe = document.createElement('button');
        probe.textContent = 'x';
        probe.style.border = 'none';
        document.body.append(probe);
        const border = getComputedStyle(probe).borderTopWidth;
        probe.remove();
        return { matched, border };
      })()`);
      if (!contrast.matched) throw new Error('forced-colors emulation did not reach the page for ' + style);
      if (parseFloat(contrast.border) < 1) {
        throw new Error('forced colors left a control without a border for ' + style + ': ' + JSON.stringify(contrast));
      }

      // Keyboard-only navigation. Counting how many Tab presses land somewhere
      // is style-dependent and was near its own threshold, so anchor on a known
      // control and assert the invariant that actually matters: each press moves
      // focus to a different visible element and never strands it on <body>.
      const anchored = await contents.executeJavaScript(`(() => {
        const focusable = [...document.querySelectorAll('button, [href], input, select, textarea, [tabindex]')]
          .filter(el => !el.disabled && el.tabIndex !== -1 && el.getClientRects().length > 0);
        if (focusable.length < 3) return { count: focusable.length };
        focusable[0].focus();
        return { count: focusable.length, anchored: document.activeElement === focusable[0] };
      })()`);
      if (!(anchored.count >= 3)) throw new Error('too few focusable chrome controls for ' + style + ': ' + anchored.count);
      if (!anchored.anchored) throw new Error('could not anchor keyboard focus for ' + style);

      const stops = [];
      for (let i = 0; i < 4; i++) {
        await pressKey(dbg, 'Tab', 'Tab', 9);
        stops.push(await contents.executeJavaScript(`(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const rects = el.getClientRects();
          return { key: el.tagName + '#' + (el.id || '') + '.' + (el.className || ''), visible: rects.length > 0 };
        })()`));
      }
      const stranded = stops.findIndex(stop => stop === null);
      if (stranded >= 0) throw new Error('Tab stranded focus on <body> at press ' + (stranded + 1) + ' for ' + style);
      if (stops.some(stop => !stop.visible)) throw new Error('Tab focused an invisible control for ' + style + ': ' + JSON.stringify(stops));
      const distinct = new Set(stops.map(stop => stop.key)).size;
      if (distinct < 2) throw new Error('Tab did not move focus for ' + style + ': ' + JSON.stringify(stops));
      a11y.push(style + ' (reduced-motion, forced-colors, ' + anchored.count + ' focusable, ' + distinct + ' distinct stops)');
    }
  } finally {
    try { if (dbg.isAttached()) dbg.detach(); } catch {}
  }

  const pdf = await contents.printToPDF({ pageSize: 'A4', printBackground: false });
  if (pdf.subarray(0, 4).toString() !== '%PDF') throw new Error('PDF printing did not produce a PDF');
  return count + ' style/zoom keyboard-dialog cases; a11y: ' + a11y.join('; ') + '; PDF print passed';
}
module.exports = { run };
