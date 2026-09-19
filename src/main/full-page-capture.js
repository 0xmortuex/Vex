// === The whole page, not just the part on screen ===========================
//
// A screenshot of a web page is a screenshot of one screenful of it. The
// receipt, the long thread, the article with its charts: you scroll, capture,
// scroll, capture, and stitch — or you give up. This does the scrolling,
// capturing and stitching.
//
// Why not one pass: a <webview> guest draws into a surface exactly the size of
// the element on screen. DevTools' captureBeyondViewport, and even a viewport
// override (what Chrome's own "Capture full size screenshot" does), only tile
// that one surface — both were tried live and both produced the FIRST
// SCREENFUL repeated down a correctly-sized image. The numbers were right and
// the picture was wrong. So: one screenful at a time, and the renderer
// stitches them on a canvas.
//
// Each tile is taken with the debugger's Page.captureScreenshot, not the tab's
// capturePage: capturePage waits for the window to paint a fresh frame, and a
// window behind others (you pressed the command, then looked elsewhere) never
// does — a live run passed seven minutes. The debugger renders on demand.
//
// What makes stitching look right:
//   - lazy images    a picture below the fold has never been asked to load; the
//                    page is scrolled through once first.
//   - fixed/sticky   a header pinned to the top would appear on every tile. It
//                    is captured once, in the first tile, then hidden for the
//                    rest and restored after.
//   - the last tile  the page cannot scroll past its end, so the last tile
//                    overlaps the one before; tiles carry the REAL scroll
//                    position, not the one asked for, and are drawn there.
//   - size           past MAX_HEIGHT the top of the page is captured and the
//                    caller is told it was cut, rather than exhausting memory.

const MAX_HEIGHT = 30000;      // css px of page captured at most
const MAX_STEPS = 60;          // lazy-load scroll-through, at most

// Runs in the page. Hides everything pinned to the viewport and remembers how
// it was, so restoring puts back the page's own inline style exactly.
const HIDE_PINNED = `(() => {
  const found = [];
  for (const el of document.querySelectorAll('body *')) {
    const pos = getComputedStyle(el).position;
    if (pos !== 'fixed' && pos !== 'sticky') continue;
    el.setAttribute('data-vex-shot-vis', el.style.getPropertyValue('visibility') + '|' + el.style.getPropertyPriority('visibility'));
    el.style.setProperty('visibility', 'hidden', 'important');
    found.push(el);
  }
  return found.length;
})()`;

const RESTORE_PINNED = `(() => {
  for (const el of document.querySelectorAll('[data-vex-shot-vis]')) {
    const [v, p] = el.getAttribute('data-vex-shot-vis').split('|');
    if (v) el.style.setProperty('visibility', v, p || ''); else el.style.removeProperty('visibility');
    el.removeAttribute('data-vex-shot-vis');
  }
  return true;
})()`;

// Not requestAnimationFrame: Chromium throttles animation frames in a window it
// thinks is hidden or covered, and waiting on two of them per tile made one
// capture take 158 s in a live run. A short fixed pause lets the scroll paint.
const PAINT_MS = 120;

function createFullPageCapture({ webContents, sleep = (ms) => new Promise(r => setTimeout(r, ms)) }) {
  async function capture(wcId) {
    const wc = typeof wcId === 'number' ? webContents.fromId(wcId) : null;
    if (!wc || wc.isDestroyed()) throw new Error('That tab has closed');
    if (!/^https?:|^file:/i.test(wc.getURL())) throw new Error('Only a web page can be captured this way');
    const dbg = wc.debugger;
    if (dbg.isAttached()) throw new Error('DevTools is open on this tab — close it and try again');
    try { dbg.attach('1.3'); }
    catch (err) { throw new Error('Could not reach the page to capture it: ' + err.message); }
    try { return await captureAttached(dbg); }
    finally { try { dbg.detach(); } catch { /* gone with the tab */ } }
  }

  async function captureAttached(dbg) {
    const send = (m, p) => dbg.sendCommand(m, p || {});
    const run = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) throw new Error('The page refused: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || 'error').split(/\r?\n/)[0]);
      return r && r.result ? r.result.value : undefined;
    };

    const start = await run('({ x: scrollX, y: scrollY, vw: innerWidth, vh: innerHeight, h: document.documentElement.scrollHeight })');
    if (!start || !start.vh || !start.vw) throw new Error('The page did not say how big it is');
    const vh = start.vh;

    // Walk down once so lazy images start loading.
    if (start.h > vh) {
      const steps = Math.min(MAX_STEPS, Math.ceil(start.h / Math.max(200, vh)));
      for (let i = 1; i <= steps; i++) { await run('window.scrollTo(0, ' + Math.round(i * vh) + ')'); await sleep(120); }
      await sleep(400);
    }
    // The page may have grown as things loaded.
    const fullHeight = Math.max(vh, Number(await run('document.documentElement.scrollHeight')) || start.h);
    const height = Math.min(fullHeight, MAX_HEIGHT);

    const tiles = [];
    let hidden = false;
    try {
      for (let want = 0; want < height; want += vh) {
        await run('window.scrollTo(0, ' + want + ')');
        await sleep(PAINT_MS);
        const y = Number(await run('scrollY')) || 0;
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        if (!shot || !shot.data) throw new Error('The page could not be drawn');
        tiles.push({ y, dataUrl: 'data:image/png;base64,' + shot.data });
        if (!hidden) { await run(HIDE_PINNED); hidden = true; }
        if (y + vh >= fullHeight) break;                  // reached the end
        if (tiles.length > 1 && y === tiles[tiles.length - 2].y) break;   // the page stopped scrolling
      }
    } finally {
      if (hidden) { try { await run(RESTORE_PINNED); } catch { /* tab gone */ } }
      try { await run('window.scrollTo(' + start.x + ', ' + start.y + ')'); } catch { /* tab gone */ }
    }

    return { tiles, width: start.vw, viewportHeight: vh, height, cut: fullHeight > height };
  }

  return { capture };
}

module.exports = { createFullPageCapture, MAX_HEIGHT, HIDE_PINNED, RESTORE_PINNED };
