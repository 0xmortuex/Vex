// The in-game overlay page (renderer/game-overlay.html). It runs in the overlay's own window with a tight preload
// (preload-game-overlay.js): it can switch itself, set its see-through level, ask for a page view, save its notes and
// timer, and press the music buttons. It reads nothing about any other program.
//
// Nothing here polls. The clock redraws only while a timer is running AND the window is visible; the music line is
// read when the panel opens or a button is pressed.
(function () {
  'use strict';
  const api = window.vexGameOverlay;
  if (!api) { document.body.textContent = 'The overlay could not start (no bridge).'; throw new Error('vexGameOverlay is missing'); }

  // Turkish when Vex is in Turkish (main hands over the language); English is the page as written.
  const TR = {
    'Vex overlay': 'Vex katmanı', 'Overlay panels': 'Katman bölmeleri', 'See-through': 'Saydamlık',
    'Guide': 'Rehber', 'Discord': 'Discord', 'Notes': 'Notlar', 'Timer': 'Zamanlayıcı', 'Music': 'Müzik', 'Search': 'Ara',
    'Click-through on': 'Tıklama geçişi açık', 'Click-through off': 'Tıklama geçişi kapalı',
    'Make mouse clicks go through to the game': 'Fare tıklamaları oyuna geçsin', 'Stop clicks going through': 'Tıklamalar oyuna geçmesin',
    'Small bar': 'Küçük çubuk', 'Full size': 'Tam boy', 'Hide (Esc)': 'Gizle (Esc)',
    'Notes for this game. Saved on this computer.': 'Bu oyun için notlar. Bu bilgisayara kaydedilir.',
    'Write a note...': 'Bir not yaz...',
    'Start': 'Başlat', 'Pause': 'Duraklat', 'Reset': 'Sıfırla', 'Stopwatch': 'Kronometre', 'Countdown': 'Geri sayım',
    'Time is up.': 'Süre doldu.', 'Previous': 'Önceki', 'Play / pause': 'Oynat / duraklat', 'Next': 'Sonraki',
    'Controls the Spotify panel in Vex. Vex never plays anything by itself.': 'Vex içindeki Spotify panelini yönetir. Vex kendi kendine hiçbir şey çalmaz.',
    'Nothing playing': 'Çalan bir şey yok', 'Search the web': 'Web\'de ara',
    'Type a search and press Enter. Results open here.': 'Bir arama yaz ve Enter\'a bas. Sonuçlar burada açılır.',
    'Uses the sign-in of the Discord panel in Vex. If you are not signed in, sign in there once.': 'Vex\'teki Discord panelinin oturumunu kullanır. Oturum açık değilse bir kez orada aç.',
    'Esc hides this window. Drag the top bar to move it.': 'Esc bu pencereyi gizler. Taşımak için üst çubuğu sürükle.',
    'Overlay ready. Press {key} to open it.': 'Katman hazır. Açmak için {key} tuşlarına bas.',
    'No guide address is set for this game. Add one in Settings, Game overlay.': 'Bu oyun için rehber adresi yok. Ayarlar, Oyun katmanı bölümünden ekle.',
    'Loading...': 'Yükleniyor...', 'Search': 'Ara', 'Search...': 'Ara...',
  };
  let lang = 'en';
  const t = (s) => (lang === 'tr' && TR[s]) || s;
  const $ = (id) => document.getElementById(id);
  const icon = (name, size) => (window.VexIcons ? window.VexIcons.svg(name, { size: size || 16 }) : '');
  const PANEL_ICON = { guide: 'book', discord: 'message', notes: 'note', timer: 'timer', music: 'music', search: 'search' };
  const PANEL_LABEL = { guide: 'Guide', discord: 'Discord', notes: 'Notes', timer: 'Timer', music: 'Music', search: 'Search' };
  const VIEW_PANELS = ['guide', 'discord', 'search'];

  let state = null;           // the last state main sent
  let panels = [];
  let active = null;
  let timer = { mode: 'stopwatch', running: false, startedAt: 0, elapsedMs: 0, durationMs: 0 };
  let tick = null;
  let solid = false;
  let notesTimer = null;

  function setText(id, text) { const el = $(id); if (el) el.textContent = text; }
  function fail(err) { console.error('[overlay]', err); return (err && err.message) || String(err); }
  // ipcRenderer.invoke wraps a main-process error as "Error invoking remote method '...': Error: <text>".
  function plain(err) { return String(fail(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); }

  // ---- theme ----------------------------------------------------------------------
  function applyTokens(tokens) {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(tokens || {})) {
      if (k === 'data-theme' || k === 'data-gui-style') { root.setAttribute(k, v); document.body.setAttribute(k, v); }
      else root.style.setProperty(k, v);
    }
  }

  // ---- labels ---------------------------------------------------------------------
  function paintLabels() {
    document.documentElement.lang = lang === 'tr' ? 'tr' : 'en';
    document.title = t('Vex overlay');
    setText('title', t('Vex overlay'));
    setText('opacityLabel', t('See-through'));
    $('barIcon').innerHTML = icon('gamepad', 16);
    $('btnHide').innerHTML = icon('x', 16); $('btnHide').title = t('Hide (Esc)'); $('btnHide').setAttribute('aria-label', t('Hide (Esc)'));
    $('opacity').setAttribute('aria-label', t('See-through'));
    $('tabs').setAttribute('aria-label', t('Overlay panels'));
    $('discordNote').textContent = t('Uses the sign-in of the Discord panel in Vex. If you are not signed in, sign in there once.');
    $('notesNote').textContent = t('Notes for this game. Saved on this computer.');
    $('notes').placeholder = t('Write a note...'); $('notes').setAttribute('aria-label', t('Notes'));
    $('timerReset').textContent = t('Reset');
    $('musicPrev').innerHTML = icon('skip-back', 16) + ' ' + t('Previous');
    $('musicPlay').innerHTML = icon('play', 16) + ' ' + t('Play / pause');
    $('musicNext').innerHTML = icon('skip', 16) + ' ' + t('Next');
    $('musicNote').textContent = t('Controls the Spotify panel in Vex. Vex never plays anything by itself.');
    $('searchQ').placeholder = t('Search...'); $('searchQ').setAttribute('aria-label', t('Search the web'));
    $('searchGo').textContent = t('Search');
    $('miniQ').placeholder = t('Search...'); $('miniQ').setAttribute('aria-label', t('Search the web'));
    $('miniPrev').innerHTML = icon('skip-back', 14); $('miniPrev').setAttribute('aria-label', t('Previous')); $('miniPrev').title = t('Previous');
    $('miniPlay').innerHTML = icon('play', 14); $('miniPlay').setAttribute('aria-label', t('Play / pause')); $('miniPlay').title = t('Play / pause');
    $('miniNext').innerHTML = icon('skip', 14); $('miniNext').setAttribute('aria-label', t('Next')); $('miniNext').title = t('Next');
    setText('msg-search', t('Type a search and press Enter. Results open here.'));
    setText('foot', t('Esc hides this window. Drag the top bar to move it.'));
    paintToggles();
    paintTimerButtons();
    buildTabs();
  }

  function paintToggles() {
    const ct = !!(state && state.clickThrough);
    const compact = !!(state && state.compact);
    document.body.dataset.clickthrough = String(ct);
    document.body.dataset.mode = compact ? 'compact' : 'expanded';
    const b = $('btnClick');
    b.innerHTML = icon(ct ? 'lock' : 'unlock', 16);
    b.setAttribute('aria-pressed', String(ct));
    const label = ct ? t('Stop clicks going through') : t('Make mouse clicks go through to the game');
    b.title = label; b.setAttribute('aria-label', label);
    const lockText = document.createElement('span');
    lockText.textContent = t('Click-through on');
    $('lockState').innerHTML = icon('lock', 12);
    $('lockState').appendChild(lockText);
    const c = $('btnCompact');
    c.innerHTML = icon(compact ? 'maximize' : 'minimize', 16);
    c.setAttribute('aria-pressed', String(compact));
    c.title = compact ? t('Full size') : t('Small bar'); c.setAttribute('aria-label', c.title);
    if (state && document.activeElement !== $('opacity')) $('opacity').value = String(Math.round(state.opacity * 100));
    const gameName = state && state.game ? state.game : '';
    setText('game', gameName);
    $('mini').hidden = !compact;
    $('miniTime').hidden = !panels.includes('timer');
    $('miniMusic').hidden = !panels.includes('music');
    $('miniSearch').hidden = !(panels.includes('search') && state && state.hasSearch);
  }

  // ---- tabs -----------------------------------------------------------------------
  function buildTabs() {
    const nav = $('tabs');
    nav.textContent = '';
    for (const p of panels) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tab'; b.id = 'tab-' + p; b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', 'p-' + p);
      b.setAttribute('aria-selected', String(p === active));
      b.tabIndex = p === active ? 0 : -1;
      b.innerHTML = icon(PANEL_ICON[p], 14) + '<span></span>';
      b.lastChild.textContent = t(PANEL_LABEL[p]);
      b.addEventListener('click', () => select(p));
      b.addEventListener('keydown', (e) => {
        const i = panels.indexOf(p);
        if (e.key === 'ArrowRight') { e.preventDefault(); select(panels[(i + 1) % panels.length], true); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); select(panels[(i + panels.length - 1) % panels.length], true); }
      });
      nav.appendChild(b);
    }
    for (const p of Object.keys(PANEL_LABEL)) { const s = $('p-' + p); if (s) { s.hidden = p !== active; s.setAttribute('aria-labelledby', 'tab-' + p); } }
  }

  function select(p, focusTab) {
    if (!panels.includes(p)) return;
    active = p;
    buildTabs();
    if (focusTab) $('tab-' + p).focus();
    if (p === 'music') musicStatus();
    if (p === 'timer') paintTimer();
    syncView();
  }

  // ---- page views (guide, Discord, search results) ------------------------------------
  let syncing = false;
  function syncView() {
    if (syncing) return;
    syncing = true;
    requestAnimationFrame(async () => {
      syncing = false;
      if (!state || state.status !== 'shown' || state.compact || document.body.dataset.hint === 'true') return;
      try {
        if (!VIEW_PANELS.includes(active)) { await api.showPanel('none', {}); return; }
        const slot = $('slot-' + active);
        const r = slot.getBoundingClientRect();
        const rect = { x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top)), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
        const res = await api.showPanel(active, rect);
        setText('msg-' + active, res && res.empty ? t('Type a search and press Enter. Results open here.') : '');
      } catch (err) {
        setText('msg-' + active, plain(err));
      }
    });
  }
  new ResizeObserver(syncView).observe($('stage'));

  // ---- timer ----------------------------------------------------------------------
  function elapsed() { return timer.running ? timer.elapsedMs + (Date.now() - timer.startedAt) : timer.elapsedMs; }
  function fmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    const two = (n) => String(n).padStart(2, '0');
    return (h ? h + ':' : '') + two(m) + ':' + two(r);
  }
  function remaining() { return timer.mode === 'timer' ? timer.durationMs - elapsed() : null; }
  function paintTimer() {
    const rem = remaining();
    const shown = timer.mode === 'timer' ? Math.max(0, rem) : elapsed();
    $('timerRead').textContent = fmt(shown);
    $('miniTime').textContent = fmt(shown);
    const done = timer.mode === 'timer' && rem <= 0 && (timer.running || timer.elapsedMs > 0);
    $('timerRead').dataset.done = String(done);
    setText('timerDone', done ? t('Time is up.') : '');
    if (done && timer.running) { timer = { ...timer, running: false, elapsedMs: timer.durationMs }; saveTimer(); paintTimerButtons(); stopTick(); }
  }
  function paintTimerButtons() {
    $('timerStart').textContent = timer.running ? t('Pause') : t('Start');
    $('timerMode').textContent = timer.mode === 'timer' ? t('Countdown') : t('Stopwatch');
    $('timerMode').setAttribute('aria-pressed', String(timer.mode === 'timer'));
    $('timerPresets').hidden = timer.mode !== 'timer';
    const p = $('timerPresets');
    if (!p.childElementCount) {
      for (const min of [5, 10, 15, 25, 45]) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn'; b.textContent = min + ' min';
        b.addEventListener('click', () => { timer = { mode: 'timer', running: false, startedAt: 0, elapsedMs: 0, durationMs: min * 60000 }; saveTimer(); paintTimer(); paintTimerButtons(); });
        p.appendChild(b);
      }
    }
  }
  // One redraw every quarter second, only while a timer runs and the window is visible; each pass schedules the next.
  function startTick() {
    if (tick || document.visibilityState !== 'visible') return;
    const pass = () => { paintTimer(); tick = timer.running ? setTimeout(pass, 250) : null; };
    tick = setTimeout(pass, 250);
  }
  function stopTick() { if (tick) { clearTimeout(tick); tick = null; } }
  function saveTimer() { api.saveTimer(timer).catch((err) => setText('timerDone', plain(err))); }
  function toggleTimer() {
    if (timer.mode === 'timer' && timer.durationMs <= 0) timer = { ...timer, durationMs: 25 * 60000 };
    if (timer.running) { timer = { ...timer, running: false, elapsedMs: elapsed() }; stopTick(); }
    else { if (timer.mode === 'timer' && elapsed() >= timer.durationMs) timer = { ...timer, elapsedMs: 0 }; timer = { ...timer, running: true, startedAt: Date.now() }; startTick(); }
    saveTimer(); paintTimer(); paintTimerButtons();
  }
  $('timerStart').addEventListener('click', toggleTimer);
  $('miniTime').addEventListener('click', toggleTimer);
  $('timerReset').addEventListener('click', () => { timer = { ...timer, running: false, startedAt: 0, elapsedMs: 0 }; stopTick(); saveTimer(); paintTimer(); paintTimerButtons(); });
  $('timerMode').addEventListener('click', () => {
    timer = { mode: timer.mode === 'timer' ? 'stopwatch' : 'timer', running: false, startedAt: 0, elapsedMs: 0, durationMs: timer.mode === 'timer' ? 0 : 25 * 60000 };
    stopTick(); saveTimer(); paintTimer(); paintTimerButtons();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { paintTimer(); if (timer.running) startTick(); } else { stopTick(); flushNotes(); }
  });

  // ---- notes ----------------------------------------------------------------------
  function flushNotes() {
    if (notesTimer) { clearTimeout(notesTimer); notesTimer = null; }
    api.saveNotes($('notes').value).catch((err) => { $('notesNote').textContent = plain(err); });
  }
  $('notes').addEventListener('input', () => { if (notesTimer) clearTimeout(notesTimer); notesTimer = setTimeout(flushNotes, 600); });

  // ---- music ----------------------------------------------------------------------
  async function musicDo(action) {
    $('musicError').textContent = '';
    try {
      const r = await api.music(action);
      const line = r.title ? r.title + (r.artist ? ' - ' + r.artist : '') : '';
      $('musicNow').textContent = line || t('Nothing playing');
      return r;
    } catch (err) { $('musicError').textContent = plain(err); return null; }
  }
  function musicStatus() { return musicDo('status'); }
  for (const [id, action] of [['musicPrev', 'prev'], ['musicPlay', 'toggle'], ['musicNext', 'next'], ['miniPrev', 'prev'], ['miniPlay', 'toggle'], ['miniNext', 'next']]) {
    $(id).addEventListener('click', () => musicDo(action));
  }

  // ---- search ---------------------------------------------------------------------
  async function doSearch(q) {
    const text = String(q || '').trim();
    if (!text) return;
    try {
      await api.search(text);
      if (state && state.compact) await api.setCompact(false);
      if (panels.includes('search')) select('search'); else if (panels.includes('guide')) select('guide');
      else setText('msg-search', t('Search'));
      $('searchQ').value = text;
      syncView();
    } catch (err) { setText('msg-' + (active || 'search'), plain(err)); }
  }
  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); doSearch($('searchQ').value); });
  $('miniSearch').addEventListener('submit', (e) => { e.preventDefault(); doSearch($('miniQ').value); $('miniQ').value = ''; });

  // ---- window controls -------------------------------------------------------------
  $('btnHide').addEventListener('click', () => api.hide().catch((err) => console.error(plain(err))));
  $('btnClick').addEventListener('click', () => api.setClickThrough(!(state && state.clickThrough)).catch((err) => console.error(plain(err))));
  $('btnCompact').addEventListener('click', () => api.setCompact(!(state && state.compact)).catch((err) => console.error(plain(err))));
  $('opacity').addEventListener('input', () => api.setOpacity(Number($('opacity').value) / 100).catch((err) => console.error(plain(err))));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); api.hide().catch((err) => console.error(plain(err))); } });

  // While click-through, only the elements marked data-solid let the mouse in (so the lock can be undone); everything
  // else passes clicks to the game. Main is told only when the pointer enters or leaves such an element.
  document.addEventListener('mousemove', (e) => {
    if (!state || !state.clickThrough) return;
    const over = !!(e.target.closest && e.target.closest('[data-solid]'));
    if (over !== solid) { solid = over; api.setInteractive(over).catch((err) => console.error(plain(err))); }
  });
  document.addEventListener('mouseleave', () => { if (solid) { solid = false; api.setInteractive(false).catch((err) => console.error(plain(err))); } });

  // ---- state from main --------------------------------------------------------------
  function apply(next) {
    const before = state;
    state = next;
    if (next.tokens) applyTokens(next.tokens);
    if (next.lang && next.lang !== lang) { lang = next.lang; }
    if (Array.isArray(next.panels)) {
      const changed = next.panels.join() !== panels.join();
      panels = next.panels;
      if (!panels.includes(active)) active = panels[0] || null;
      if (changed || !before) buildTabs();
    }
    document.body.dataset.hint = next.hint ? 'true' : 'false';
    $('hintBox').hidden = !next.hint;
    paintLabels();
    if (next.hint) { $('mini').hidden = true; setText('hintText', t('Overlay ready. Press {key} to open it.').replace('{key}', next.hint)); }
    if (active) { for (const p of Object.keys(PANEL_LABEL)) { const s = $('p-' + p); if (s) s.hidden = p !== active; } }
    if (!before || before.status !== 'shown' || before.compact !== next.compact) syncView();
    if (next.status !== 'shown') stopTick();
  }

  api.onState((s) => apply(s));

  api.get().then((first) => {
    if (first.lang) lang = first.lang;
    if (first.timer) timer = first.timer;
    $('notes').value = first.notes || '';
    panels = first.panels;
    active = panels[0] || null;
    apply(first);
    paintTimer(); paintTimerButtons();
    if (timer.running) startTick();
  }).catch((err) => { document.body.textContent = plain(err); throw err; });
})();
