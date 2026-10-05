// === A page's alert / confirm / prompt, over its own tab or panel ===
//
// Electron's own box for these belonged to the whole Vex window and disabled
// all of it (src/main/page-dialogs.js says how that froze Vex). Main now sends
// the question here ('page-dialog:show'), and it is asked over the page that
// asked — that tab's or panel's area only. The rest of Vex keeps working; only
// that page waits for the answer, as in Chrome.
//
// A tab or panel that is not on screen gets a marker instead, a card in the
// window's corner names it ("Prime Video asks a question — Open"), and the
// question comes up when it is shown. A question out of sight holds nothing:
// no keys, no focus, no pointer. A page that is neither a tab nor a
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

  // Can the question be SEEN over this page right now? Only then may it take
  // the page's pointer and the keys. The question is drawn in the window's
  // ordinary stacking, so anything in fullscreen is above it: a video in
  // fullscreen in the Prime panel hid its own question, everything else in
  // the window went inert behind the fullscreen page, and Escape left the
  // window's fullscreen while the page stayed the document's fullscreen
  // element (its renderer is waiting for the answer) — nothing in Vex could
  // be clicked (reported 2026-10-05; found live under CDP).
  function onScreen(wv) {
    if (!wv.isConnected || document.body.classList.contains('vex-locked')) return false;
    const fs = document.fullscreenElement;
    if (fs && (fs === wv || !fs.contains(wv))) return false;
    const r = wv.getBoundingClientRect();
    // The part of it inside the window.
    const w = Math.min(r.left + r.width, window.innerWidth) - Math.max(r.left, 0);
    const h = Math.min(r.top + r.height, window.innerHeight) - Math.max(r.top, 0);
    if (w < 40 || h < 40) return false;
    if (typeof wv.checkVisibility === 'function' && !wv.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    return getComputedStyle(wv).visibility !== 'hidden';
  }

  // The asking page is the one in fullscreen: nothing can be drawn over it,
  // so it leaves fullscreen and is asked in its tab or panel, as Chrome does.
  // Vex leaves it from the window's side — the page itself cannot, it is
  // waiting for the answer.
  function leaveFullscreenFor(entry) {
    const fs = document.fullscreenElement;
    if (!fs || !(fs === entry.wv || fs.contains(entry.wv)) || entry.leaving === fs) return;
    entry.leaving = fs;   // once: refresh runs on every change while it leaves
    Promise.resolve(document.exitFullscreen()).catch(err => window.VexProblems?.note('Page dialog', 'Could not leave fullscreen to show a page\'s question', err));
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
    // A click on the dimmed area around the question keeps the keys with the
    // question, so Enter and Escape still answer it.
    overlay.addEventListener('mousedown', (e) => {
      if (e.target !== overlay) return;
      e.preventDefault();
      entry.focusTarget.focus();
    });
    overlay.addEventListener('keydown', (e) => {
      // Only a question on screen answers keys.
      if (overlay.hidden || !entry.visible) return;
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
  const ours = (node) => !!(node && node.nodeType === 1 && (node.classList.contains('vex-page-dialog-mark') || node.closest('.vex-page-dialog-overlay, .vex-page-dialog-mark, .vex-page-dialog-card')));
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
      document.addEventListener('fullscreenchange', onFullscreen);
    } else if (!on && watcher) {
      watcher.disconnect(); watcher = null;
      window.removeEventListener('resize', refresh);
      document.removeEventListener('fullscreenchange', onFullscreen);
    }
  }
  // Something went into fullscreen over the card: it is put back on top.
  function onFullscreen() {
    if (card && !card.hidden && card.popover && card.matches(':popover-open')) { card.hidePopover(); card.showPopover(); }
    refresh();
  }

  // ---- the corner card: a question nobody can see is never silent ----------
  // A question waiting behind a hidden panel, a closed sidebar or a tab in the
  // background is named here, with a way to it. It takes no keys and no focus:
  // the rest of Vex is used as before. It sits in the top layer where the
  // window has one (a popover), so a video in fullscreen does not hide it.
  let card = null;
  function labelOf(entry) {
    const p = entry.place;
    if (p && p.panel) {
      const name = typeof SidebarManager !== 'undefined' && SidebarManager.panelLabel ? SidebarManager.panelLabel(p.panel) : '';
      return name || p.panel;
    }
    if (p && p.tab && typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs)) {
      const tab = TabManager.tabs.find(x => x.id === p.tab);
      if (tab && tab.title) return tab.title;
    }
    return entry.d.origin || t('pageDialogAPage', 'A page');
  }
  function buildCard() {
    card = document.createElement('div');
    card.className = 'vex-page-dialog-card';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    if ('popover' in card) card.popover = 'manual';
    const icon = document.createElement('span');
    icon.className = 'vex-page-dialog-card-icon';
    icon.innerHTML = VexIcons.svg('message', { size: 16 });
    const text = document.createElement('div');
    text.className = 'vex-page-dialog-card-text';
    const title = document.createElement('div');
    title.className = 'vex-page-dialog-card-title';
    const sub = document.createElement('div');
    sub.className = 'vex-page-dialog-card-sub';
    text.append(title, sub);
    const open = document.createElement('button');
    open.className = 'vex-dialog-btn primary vex-page-dialog-card-open';
    open.textContent = t('pageDialogOpen', 'Open');
    open.addEventListener('click', () => { if (card.__entry) openEntry(card.__entry); });
    card.append(icon, text, open);
    card.hidden = true;
    document.body.appendChild(card);
  }
  function updateCard() {
    const away = waiting.filter(e => e.marked);
    if (!away.length) {
      if (card && !card.hidden) {
        if (card.popover && card.matches(':popover-open')) card.hidePopover();
        card.hidden = true;
        card.__entry = null;
      }
      return;
    }
    if (!card || !card.isConnected) buildCard();
    const entry = away[0];
    card.__entry = entry;
    const title = t('pageDialogAsks', '{name} asks a question').replace('{name}', labelOf(entry));
    const more = away.length > 1 ? ' ' + t('pageDialogMore', '(+{n} more)').replace('{n}', String(away.length - 1)) : '';
    // While another page is in fullscreen the rest of the window is inert:
    // the card can be seen but not clicked until fullscreen is left.
    const sub = document.fullscreenElement ? t('pageDialogLeaveFullscreen', 'Press Esc to leave fullscreen and answer')
      : entry.d.origin ? t('pageDialogSays', '{site} says').replace('{site}', entry.d.origin) : t('pageDialogThisPage', 'This page says');
    const titleEl = card.querySelector('.vex-page-dialog-card-title');
    const subEl = card.querySelector('.vex-page-dialog-card-sub');
    // Written only when it changed, so the card is not itself a change to react to.
    if (titleEl.textContent !== title + more) titleEl.textContent = title + more;
    if (subEl.textContent !== sub) subEl.textContent = sub;
    if (card.hidden) {
      card.hidden = false;
      if (card.popover) card.showPopover();
    }
  }

  // "Open" on the card: the panel or tab is shown, and its question with it.
  function openEntry(entry) {
    if (!waiting.includes(entry)) return;
    entry.wantFocus = true;
    if (document.fullscreenElement) {
      Promise.resolve(document.exitFullscreen()).catch(err => window.VexProblems?.note('Page dialog', 'Could not leave fullscreen to show a page\'s question', err));
    }
    const p = entry.place;
    if (p && p.panel) {
      if (SidebarManager.activePanel !== p.panel && SidebarManager.sidePanel !== p.panel) SidebarManager.showPanel(p.panel);
    } else if (p && p.tab) {
      TabManager.switchTab(p.tab);
    }
    refresh();
  }

  function refresh() {
    const shownFor = new Set();
    for (const entry of waiting) {
      if (entry.wv.isConnected) leaveFullscreenFor(entry);
      const visible = onScreen(entry.wv) && !shownFor.has(entry.wv);
      if (visible) {
        shownFor.add(entry.wv);
        const fresh = !entry.overlay;
        if (fresh) build(entry);
        if (!entry.overlay.isConnected) entry.wv.insertAdjacentElement('afterend', entry.overlay);
        const cameBack = !entry.visible;
        if (entry.overlay.hidden) entry.overlay.hidden = false;
        entry.visible = true;
        place(entry);
        holdPage(entry, true);
        entry.marked = false;
        setMarker(entry, false);
        // The page the user is in takes the keys; one in a panel beside it
        // does not pull them away from what they are typing. "Open" on the
        // card always hands them over.
        if (cameBack) {
          const a = document.activeElement;
          if (entry.wantFocus || !a || a === document.body || a === entry.wv) entry.focusTarget.focus();
          entry.wantFocus = false;
        }
      } else {
        // Out of sight it holds nothing: not the keys, not the page's pointer.
        if (entry.overlay && entry.overlay.contains(document.activeElement)) document.activeElement.blur();
        if (entry.overlay && !entry.overlay.hidden) entry.overlay.hidden = true;
        entry.visible = false;
        holdPage(entry, false);
        entry.marked = true;
        setMarker(entry, true);
      }
    }
    updateCard();
    watch(waiting.length > 0);
    if (!waiting.length && timer) { clearInterval(timer); timer = null; }
  }

  function finish(entry) {
    const at = waiting.indexOf(entry);
    if (at >= 0) waiting.splice(at, 1);
    if (entry.overlay) entry.overlay.remove();
    entry.visible = false;
    holdPage(entry, false);
    entry.marked = false;
    setMarker(entry, false);
    refresh();
  }

  // Every question a page asks is noted in Problems (Memory panel › Health),
  // so what a site asks can be seen afterwards: which site (its host, never
  // the address with its query), in which tab or panel, the kind, and the
  // first 200 characters of its text. Kept in this profile only.
  function record(entry) {
    const p = entry.place;
    const where = p && p.panel ? 'the ' + labelOf(entry) + ' panel' : p && p.tab ? 'a tab' : 'a page outside any tab';
    window.VexProblems?.note('Page dialog', entry.d.type + '() from ' + (entry.d.origin || 'a local page') + ' in ' + where,
      String(entry.d.message || '').slice(0, 200));
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
    const entry = { d, wv, overlay: null, place: wv ? placeOf(wv) : null, visible: false };
    record(entry);
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

  return { init, show, close, waiting, _refresh: refresh, _card: () => card, _open: openEntry };
})();

window.PageDialogs = PageDialogs;
// Listening from the start: a restored tab may ask before the rest of the
// interface has finished starting.
if (window.vex?.onPageDialog) PageDialogs.init();
