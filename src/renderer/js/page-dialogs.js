// === A page's alert / confirm / prompt, over its own tab or panel ===
//
// Electron's own box for these belonged to the whole Vex window and disabled
// all of it (src/main/page-dialogs.js says how that froze Vex). Main now sends
// the question here ('page-dialog:show'), and it is asked over the page that
// asked — that tab's or panel's area only. The rest of Vex keeps working; only
// that page waits for the answer, as in Chrome.
//
// A tab or panel that is not on screen gets a marker instead, and the
// question comes up when it is shown. A page that is neither a tab nor a
// panel and not on screen (a hidden helper page) gets "Cancel" at once: nobody
// could ever answer it. From a page's second dialog on, the question offers to
// stop the page showing any more.
const PageDialogs = (() => {
  const t = (key, fallback) => window.VexI18n?.t(key, fallback) || fallback;
  const waiting = [];   // [{ d, wv, overlay }] in the order they came
  let timer = null;

  function webviewFor(guestId) {
    for (const wv of document.querySelectorAll('webview')) {
      try { if (wv.getWebContentsId() === guestId) return wv; } catch { /* not attached yet: not that page */ }
    }
    return null;
  }

  // Which tab or panel the page is, for its marker.
  function placeOf(wv) {
    if (typeof WebviewManager !== 'undefined' && WebviewManager.webviews) {
      for (const [tabId, w] of WebviewManager.webviews) if (w === wv) return { tab: tabId };
    }
    if (typeof SidebarManager !== 'undefined' && SidebarManager.panelWebviews) {
      for (const [name, w] of Object.entries(SidebarManager.panelWebviews)) if (w === wv) return { panel: name };
    }
    return null;
  }

  function onScreen(wv) {
    if (!wv.isConnected || document.body.classList.contains('vex-locked')) return false;
    const r = wv.getBoundingClientRect();
    return r.width >= 40 && r.height >= 40 && getComputedStyle(wv).visibility !== 'hidden';
  }

  // ---- markers on a tab or a panel's icon that is not on screen ------------
  // A tab is drawn in the side list (.tab-item) and, in the looks with tabs
  // on top, in the strip (.top-tab); both are marked.
  function markerHosts(place) {
    if (!place) return [];
    if (place.tab) return [...document.querySelectorAll(`.tab-item[data-tab-id="${CSS.escape(place.tab)}"], .top-tab[data-tab-id="${CSS.escape(place.tab)}"]`)];
    return [...document.querySelectorAll(`.sidebar-icon[data-panel="${CSS.escape(place.panel)}"]`)];
  }
  function setMarker(entry, on) {
    for (const host of markerHosts(entry.place)) {
      let mark = host.querySelector(':scope > .vex-page-dialog-mark');
      if (!on) { if (mark) mark.remove(); continue; }
      if (mark) continue;
      mark = document.createElement('span');
      mark.className = 'vex-page-dialog-mark' + (entry.place.panel ? ' icon-badge' : '');
      mark.title = t('pageDialogWaiting', 'This page is waiting for an answer');
      mark.setAttribute('aria-label', mark.title);
      mark.innerHTML = VexIcons.svg('message', { size: entry.place.panel ? 10 : 11 });
      const close = host.querySelector(':scope > .tab-close');
      if (close) host.insertBefore(mark, close); else host.appendChild(mark);
    }
  }

  // ---- the question ---------------------------------------------------------
  function build(entry) {
    const { d } = entry;
    const overlay = document.createElement('div');
    overlay.className = 'vex-page-dialog-overlay';
    const box = document.createElement('div');
    box.className = 'vex-dialog vex-page-dialog';
    box.setAttribute('role', d.type === 'alert' ? 'alertdialog' : 'dialog');
    box.setAttribute('aria-modal', 'true');
    const title = document.createElement('div');
    title.className = 'vex-dialog-title';
    title.textContent = d.origin ? t('pageDialogSays', '{site} says').replace('{site}', d.origin) : t('pageDialogThisPage', 'This page says');
    box.appendChild(title);
    box.setAttribute('aria-label', title.textContent);
    if (d.message) {
      const msg = document.createElement('div');
      msg.className = 'vex-dialog-msg vex-page-dialog-msg';
      msg.textContent = d.message;
      box.appendChild(msg);
    }
    let input = null;
    if (d.type === 'prompt') {
      input = document.createElement('input');
      input.className = 'vex-dialog-input';
      input.type = 'text';
      input.value = d.value || '';
      input.setAttribute('aria-label', d.message || title.textContent);
      box.appendChild(input);
    }
    let stop = null;
    if (d.offerStop) {
      const label = document.createElement('label');
      label.className = 'vex-page-dialog-stop';
      stop = document.createElement('input');
      stop.type = 'checkbox';
      label.append(stop, document.createTextNode(' ' + t('pageDialogStop', "Don't let this page show more dialogs")));
      box.appendChild(label);
    }
    const actions = document.createElement('div');
    actions.className = 'vex-dialog-actions';
    let cancel = null;
    if (d.type !== 'alert') {
      cancel = document.createElement('button');
      cancel.className = 'vex-dialog-btn';
      cancel.dataset.cancel = '';
      cancel.textContent = t('cancel', 'Cancel');
      actions.appendChild(cancel);
    }
    const ok = document.createElement('button');
    ok.className = 'vex-dialog-btn primary';
    ok.dataset.ok = '';
    ok.textContent = t('ok', 'OK');
    actions.appendChild(ok);
    box.appendChild(actions);
    overlay.appendChild(box);

    const answer = (yes) => respond(entry, yes, input ? input.value : undefined, !!(stop && stop.checked));
    ok.addEventListener('click', () => answer(true));
    if (cancel) cancel.addEventListener('click', () => answer(false));
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answer(d.type === 'alert'); return; }
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.type !== 'checkbox') { e.preventDefault(); answer(true); return; }
      if (e.key === 'Tab') {
        const items = [...overlay.querySelectorAll('input, button')];
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    entry.overlay = overlay;
    entry.focusTarget = input || ok;
    entry.wv.insertAdjacentElement('afterend', overlay);
  }

  // Over the page's own area, in the page's own stacking: whatever Vex puts
  // over the page (a menu, the command bar) covers the question too.
  function place(entry) {
    const { wv, overlay } = entry;
    const parent = wv.offsetParent || wv.parentElement;
    const r = wv.getBoundingClientRect();
    const c = parent.getBoundingClientRect();
    const z = parseInt(getComputedStyle(wv).zIndex, 10);
    const want = {
      left: (r.left - c.left - parent.clientLeft + parent.scrollLeft) + 'px',
      top: (r.top - c.top - parent.clientTop + parent.scrollTop) + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
      zIndex: String(Number.isFinite(z) ? z + 1 : 6),
    };
    // Written only when it moved, so placing it is not itself a change to react to.
    for (const k of Object.keys(want)) if (overlay.style[k] !== want[k]) overlay.style[k] = want[k];
  }

  // While its question is on screen the page takes no pointer: it cannot
  // answer anyway, and a page that had the focus otherwise kept getting the
  // clicks meant for the question over it — OK did nothing (found live under
  // CDP, 2026-10-05). The page's own value comes back when it is answered.
  function holdPage(entry, on) {
    const wv = entry.wv;
    if (on && !entry.held) {
      entry.held = { pointerEvents: wv.style.pointerEvents };
      wv.style.pointerEvents = 'none';
    } else if (!on && entry.held) {
      wv.style.pointerEvents = entry.held.pointerEvents;
      entry.held = null;
    }
  }

  // Shown again the moment its tab or panel is: switching tabs, opening a
  // panel or a tab strip drawn again (which drops a marker) are changes to the
  // page's elements, seen here at once. A timer alone was not enough: Chromium
  // slows the timers of a window that is covered, and the question stayed
  // hidden after switching back to its tab (found live, 2026-10-05).
  let watcher = null, queued = false;
  const ours = (node) => !!(node && node.nodeType === 1 && (node.classList.contains('vex-page-dialog-mark') || node.closest('.vex-page-dialog-overlay, .vex-page-dialog-mark')));
  function onChange(records) {
    const outside = records.some(rec => rec.type === 'attributes'
      ? !ours(rec.target)
      : ![...rec.addedNodes, ...rec.removedNodes].every(ours));
    if (!outside || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; refresh(); });
  }
  function watch(on) {
    if (on && !watcher) {
      watcher = new MutationObserver(onChange);
      watcher.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
      window.addEventListener('resize', refresh);
    } else if (!on && watcher) {
      watcher.disconnect(); watcher = null;
      window.removeEventListener('resize', refresh);
    }
  }

  function refresh() {
    const shownFor = new Set();
    for (const entry of waiting) {
      const visible = onScreen(entry.wv) && !shownFor.has(entry.wv);
      if (visible) {
        shownFor.add(entry.wv);
        const fresh = !entry.overlay;
        if (fresh) build(entry);
        if (!entry.overlay.isConnected) entry.wv.insertAdjacentElement('afterend', entry.overlay);
        const wasHidden = entry.overlay.hidden;
        if (wasHidden) entry.overlay.hidden = false;
        place(entry);
        holdPage(entry, true);
        entry.marked = false;
        setMarker(entry, false);
        // The page the user is in takes the keys; one in a panel beside it
        // does not pull them away from what they are typing.
        if (fresh || wasHidden) {
          const a = document.activeElement;
          if (!a || a === document.body || a === entry.wv) entry.focusTarget.focus();
        }
      } else {
        if (entry.overlay && !entry.overlay.hidden) entry.overlay.hidden = true;
        holdPage(entry, false);
        entry.marked = true;
        setMarker(entry, true);
      }
    }
    watch(waiting.length > 0);
    if (!waiting.length && timer) { clearInterval(timer); timer = null; }
  }

  function finish(entry) {
    const at = waiting.indexOf(entry);
    if (at >= 0) waiting.splice(at, 1);
    if (entry.overlay) entry.overlay.remove();
    holdPage(entry, false);
    entry.marked = false;
    setMarker(entry, false);
    refresh();
  }

  function respond(entry, ok, value, stop) {
    if (!waiting.includes(entry)) return;
    const payload = { id: entry.d.id, ok: !!ok, stop };
    if (entry.d.type === 'prompt' && ok) payload.value = String(value ?? '');
    const back = entry.wv.isConnected && onScreen(entry.wv) && entry.overlay && entry.overlay.contains(document.activeElement);
    finish(entry);
    window.vex.pageDialogAnswer(payload);
    if (back) { try { entry.wv.focus(); } catch { /* gone */ } }
  }

  function show(d) {
    if (!d || typeof d.id !== 'string') return;
    const wv = webviewFor(d.guestId);
    const entry = { d, wv, overlay: null, place: wv ? placeOf(wv) : null };
    // Nobody can see this page and it is no tab or panel to come back to.
    if (!wv || (!entry.place && !onScreen(wv))) {
      window.vex.pageDialogAnswer({ id: d.id, ok: d.type === 'alert', stop: false });
      return;
    }
    waiting.push(entry);
    refresh();
    if (!timer) timer = setInterval(refresh, 250);
  }

  // Main answered it already: the page closed, crashed or left.
  function close(d) {
    const entry = waiting.find(e => e.d.id === (d && d.id));
    if (entry) finish(entry);
  }

  function init() {
    if (!window.vex?.onPageDialog) throw new Error('PageDialogs: the page-dialog bridge is missing from preload.js');
    window.vex.onPageDialog(show);
    window.vex.onPageDialogClose(close);
  }

  return { init, show, close, waiting, _refresh: refresh };
})();

window.PageDialogs = PageDialogs;
// Listening from the start: a restored tab may ask before the rest of the
// interface has finished starting.
if (window.vex?.onPageDialog) PageDialogs.init();
