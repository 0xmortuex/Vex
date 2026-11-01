// === The Wallpaper Store: its own screen, its Settings section and its Ctrl+K entry ===
//
// Ctrl+K > "Wallpapers" or Settings > Appearance > Wallpapers > "Open the Wallpaper Store".
// A grid of cards (the thumbnails are made when a card scrolls into view and let go of when it
// is far out of view), categories, search, favourites and recent, a preview that shows the
// wallpaper under sample text with the real readability check, and the sliders.
//
// Keys inside the store: arrow keys move over the cards, Enter previews, Ctrl+Enter applies,
// "/" goes to the search box, Escape closes it.
// The logic is js/wallpaper-store.js; the painting js/wallpaper-paint.js.

(function (root) {
  'use strict';

  const L = (s) => (typeof root.VexI18nUI !== 'undefined' && root.VexI18nUI.lookup && root.VexI18nUI.lookup(s)) || s;
  const doc = root.document;
  const W = () => root.VexWallpapers;
  const PAGE = 120;
  const HIDDEN_SHADE = 0.6;      // a shade stronger than this leaves under 40% of the picture showing: the person is told
  const icon = (name, size = 14) => (typeof root.VexIcons !== 'undefined' ? root.VexIcons.svg(name, { size }) : '');
  const toast = (msg, kind) => { root.showToast?.(msg, kind || 'info'); };    // answers to a button the person just pressed
  const fail = (err) => { root.console.error('[wallpapers]', err); toast(err && err.message ? err.message : String(err), 'error'); };

  function el(tag, cls, text) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(label, onClick, { cls = 'btn-secondary', iconName, aria } = {}) {
    const b = el('button', cls);
    b.type = 'button';
    if (iconName) b.innerHTML = icon(iconName, 14);
    b.append(doc.createTextNode((iconName ? ' ' : '') + label));
    if (aria) b.setAttribute('aria-label', aria);
    b.addEventListener('click', onClick);
    return b;
  }

  // --- the store ---------------------------------------------------------------------------

  const Store = {
    open({ select } = {}) {
      const V = W();
      if (!V) throw new Error('Wallpapers are not loaded yet');
      if (!root.VexSettingsGroups) throw new Error('The dialog helpers are not loaded');
      const dlg = root.VexSettingsGroups.dialog({ id: 'vex-wallpaper-store', title: L('Wallpaper Store'), sub: L('Pictures for your New Tab page. Arrow keys move over the cards, Enter previews, Ctrl+Enter applies, / searches, Escape closes.') });
      dlg.overlay.classList.add('vws');
      dlg.overlay.querySelector('.vexsr-card').classList.add('vws-card');
      const ui = { cat: 'all', q: '', sel: null, limit: PAGE, draft: { ...V.DEFAULTS }, io: null, thumbToken: 0 };
      const cur = V.current();
      if (cur) { ui.sel = cur.id; ui.draft = { dim: cur.dim, blur: cur.blur, auto: cur.auto }; }
      if (select && V.get(select)) ui.sel = select;

      // --- parts
      const top = el('div', 'vws-top');
      const search = el('input', 'vws-search');
      search.type = 'search';
      search.placeholder = L('Search wallpapers');
      search.setAttribute('aria-label', L('Search wallpapers'));
      const addBtn = button(L('Use my own picture…'), () => pick(), { iconName: 'upload' });
      const settingsBtn = button(L('Settings'), () => { dlg.close(); if (root.SettingsUI && root.SettingsUI.openSection) root.SettingsUI.openSection('setting-wallpapers'); }, { iconName: 'sliders' });
      top.append(search, addBtn, settingsBtn);

      const cats = el('div', 'vws-cats');
      cats.setAttribute('role', 'group');
      cats.setAttribute('aria-label', L('Wallpaper categories'));
      const status = el('div', 'vws-status');
      status.setAttribute('role', 'status');
      const main = el('div', 'vws-main');
      const gridWrap = el('div', 'vws-gridwrap');
      const grid = el('div', 'vws-grid');
      grid.setAttribute('role', 'listbox');
      grid.setAttribute('aria-label', L('Wallpapers'));
      gridWrap.append(grid);
      const panel = el('aside', 'vws-panel');
      panel.setAttribute('aria-label', L('Preview'));
      main.append(gridWrap, panel);
      dlg.body.append(top, cats, status, main);

      // actions: [[label, onClick], ...] shown as buttons after the sentence
      const say = (text, actions) => {
        status.textContent = text || '';
        for (const [label, fn, cls] of actions || []) status.append(doc.createTextNode(' '), button(label, () => { Promise.resolve().then(fn).catch(fail); }, { cls: cls || 'btn-primary' }));
      };
      const items = () => V.search({ query: ui.q, category: ui.cat });

      // --- categories
      function renderCats() {
        cats.textContent = '';
        const have = V.list();
        const chips = [['all', L('All')], ['fav', L('Favourites')], ['recent', L('Recent')], ['mine', L('My pictures')]];
        if (have.some(i => i.source === 'catalogue')) chips.push(['photos', L('Photos')]);
        for (const c of V.categories()) chips.push([c.id, L(c.title)]);
        for (const [id, label] of chips) {
          const b = el('button', 'vws-chip', label);
          b.type = 'button';
          // A filter button, not a tab: nothing here is a panel of its own, and tabs would promise arrow keys.
          b.dataset.cat = id;
          b.setAttribute('aria-pressed', String(ui.cat === id));
          b.addEventListener('click', () => {
            ui.cat = id; ui.limit = PAGE; renderCats();
            // The row is drawn again: the keyboard stays on the chip that was pressed.
            const again = Array.from(cats.children).find(n => n.dataset.cat === id);
            if (again) again.focus({ preventScroll: true });
            renderGrid();
          });
          cats.append(b);
        }
      }

      // --- the grid; a card's picture exists only while the card is near the screen
      function releaseThumbs() { if (ui.io) { ui.io.disconnect(); ui.io = null; } }
      function renderGrid() {
        const hadFocus = gridWrap.contains(doc.activeElement) || doc.activeElement === doc.body;
        releaseThumbs();
        grid.textContent = '';
        gridWrap.querySelectorAll('.vws-empty, .vws-more').forEach(n => n.remove());
        const list = items();
        if (!list.length) {
          const empty = el('div', 'vws-empty', ui.cat === 'fav' ? L('No favourites yet. Press the heart on a wallpaper to keep it here.')
            : ui.cat === 'recent' ? L('Nothing here yet. Wallpapers you apply show up here.')
              : ui.cat === 'mine' ? L('You have not added a picture of your own yet.')
                : ui.cat === 'photos' ? L('No photo list is set. Settings > Wallpapers can point Vex at a list of free photos.')
                  : L('No wallpaper matches that.'));
          gridWrap.append(empty);
          renderPanel();
          return;
        }
        const shown = list.slice(0, ui.limit);
        const onId = (V.current() || {}).id;
        ui.io = new root.IntersectionObserver((entries) => {
          for (const e of entries) {
            const card = e.target, img = card.querySelector('img');
            if (e.isIntersecting) {
              if (img.dataset.state === 'idle') {
                img.dataset.state = 'loading';
                const id = card.dataset.id, d = V.get(id);
                V.thumbOf(d).then((src) => { if (card.isConnected && img.dataset.state === 'loading') { img.src = src; img.dataset.state = 'shown'; } })
                  .catch((err) => { img.dataset.state = 'idle'; card.classList.add('vws-broken'); root.console.error('[wallpapers] preview failed:', err.message); });
              }
            } else if (img.dataset.state === 'shown') { img.removeAttribute('src'); img.dataset.state = 'idle'; }
          }
        }, { root: gridWrap, rootMargin: '500px 0px' });
        for (const d of shown) {
          const card = el('button', 'vws-card-item');
          card.type = 'button';
          card.dataset.id = d.id;
          card.setAttribute('role', 'option');
          card.setAttribute('aria-selected', String(d.id === ui.sel));
          card.tabIndex = d.id === ui.sel ? 0 : -1;
          card.style.setProperty('--vws-dom', d.dominant || '#444');
          const img = el('img', 'vws-thumb');
          img.alt = '';
          img.decoding = 'async';
          img.dataset.state = 'idle';
          const name = el('span', 'vws-name', d.title);
          const meta = el('span', 'vws-meta', d.source === 'generated' ? L(root.WallpaperData.categoryTitle(d.category)) : (d.author || ''));
          card.append(img, name, meta);
          const badges = el('span', 'vws-badges');
          if (V.isFavourite(d.id)) { const h = el('span', 'vws-badge'); h.innerHTML = icon('heart', 12); h.title = L('Favourite'); badges.append(h); }
          if (d.id === onId) { const c = el('span', 'vws-badge vws-on'); c.innerHTML = icon('check', 12); c.title = L('On your New Tab'); badges.append(c); }
          card.append(badges);
          card.setAttribute('aria-label', d.title + (d.id === onId ? ', ' + L('on your New Tab') : '') + (V.isFavourite(d.id) ? ', ' + L('favourite') : ''));
          card.addEventListener('click', () => choose(d.id, card));
          card.addEventListener('dblclick', () => { choose(d.id, card); apply().catch(fail); });
          grid.append(card);
          ui.io.observe(card);
        }
        if (list.length > shown.length) {
          const more = button(L('Show more') + ' (' + (list.length - shown.length) + ')', () => { ui.limit += PAGE; renderGrid(); });
          more.classList.add('vws-more');
          gridWrap.append(more);
        }
        if (!ui.sel || !list.some(i => i.id === ui.sel)) ui.sel = list[0].id;
        // A redraw (after Apply, a favourite) must not drop the keyboard: focus goes back to the chosen card.
        const chosen = Array.from(grid.querySelectorAll('.vws-card-item')).find(c => c.dataset.id === ui.sel);
        if (chosen) { chosen.tabIndex = 0; chosen.setAttribute('aria-selected', 'true'); if (hadFocus) chosen.focus({ preventScroll: true }); }
        renderPanel();
      }

      function choose(id, card) {
        ui.sel = id;
        const c = V.current();
        ui.draft = c && c.id === id ? { dim: c.dim, blur: c.blur, auto: c.auto } : { ...V.DEFAULTS };
        for (const n of grid.querySelectorAll('.vws-card-item')) { const on = n.dataset.id === id; n.setAttribute('aria-selected', String(on)); n.tabIndex = on ? 0 : -1; }
        if (card) card.focus({ preventScroll: true });
        renderPanel();
      }

      // Arrow keys over the cards.
      grid.addEventListener('keydown', (e) => {
        const cards = Array.from(grid.querySelectorAll('.vws-card-item'));
        const i = cards.indexOf(doc.activeElement);
        if (i < 0) return;
        const cols = cards.filter(c => c.offsetTop === cards[0].offsetTop).length || 1;
        let to = -1;
        if (e.key === 'ArrowRight') to = i + 1; else if (e.key === 'ArrowLeft') to = i - 1;
        else if (e.key === 'ArrowDown') to = i + cols; else if (e.key === 'ArrowUp') to = i - cols;
        else if (e.key === 'Home') to = 0; else if (e.key === 'End') to = cards.length - 1;
        else if (e.key === 'PageDown') to = i + cols * 3; else if (e.key === 'PageUp') to = i - cols * 3;
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); choose(cards[i].dataset.id, cards[i]); apply().catch(fail); return; }
        else return;
        e.preventDefault();
        to = Math.max(0, Math.min(cards.length - 1, to));
        for (const c of cards) c.tabIndex = -1;
        cards[to].tabIndex = 0;
        cards[to].focus();
      });
      // "/" goes to the search box from anywhere in the store (focus may be on the page behind after a card list is redrawn).
      const onSlash = (e) => {
        if (!dlg.overlay.isConnected) { doc.removeEventListener('keydown', onSlash, true); return; }
        if (e.key === '/' && !e.ctrlKey && !e.metaKey && doc.activeElement !== search && !(doc.activeElement && /^(input|textarea|select)$/i.test(doc.activeElement.tagName))) { e.preventDefault(); search.focus(); }
      };
      doc.addEventListener('keydown', onSlash, true);
      let searchTimer = null;
      search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { ui.q = search.value; ui.limit = PAGE; renderGrid(); }, 120); });

      // --- the preview panel
      let previewToken = 0, sliderTimer = null;
      async function renderPanel() {
        const mine = ++previewToken;
        let previewSrc = null;
        panel.textContent = '';
        const d = ui.sel ? V.get(ui.sel) : null;
        if (!d) { panel.append(el('div', 'vws-empty', L('Choose a wallpaper to preview it.'))); return; }
        const box = el('div', 'vws-preview');
        const pic = el('div', 'vws-pv-pic');
        const scrim = el('div', 'vws-pv-scrim');
        const sample = el('div', 'vws-pv-text');
        const plate = el('div', 'vws-pv-plate');
        const s1 = el('div', 'vws-s1', L('Good evening')), s2 = el('div', 'vws-s2', L('Search the web or type an address')), s3 = el('div', 'vws-s3', L('Recent'));
        plate.append(s1, s2, s3);
        sample.append(plate);
        box.append(pic, scrim, sample);
        const read = el('div', 'vws-read');
        read.setAttribute('role', 'status');
        const title = el('h3', 'vws-title', d.title);
        const by = el('div', 'vws-by');
        by.textContent = d.source === 'generated' ? L('Drawn by Vex. Free to use, nothing is downloaded.') : d.source === 'mine' ? L('Your own picture, kept on this computer.') : (L('Photo by') + ' ' + d.author + ' · ' + d.licence);
        panel.append(box, read);
        matchSection(panel, d.id, { compact: true });
        panel.append(title, by);
        if (d.sourceUrl) {
          panel.append(button(L('Open the source page'), () => {
            if (typeof root.TabManager === 'undefined') { fail(new Error('Tabs are not available')); return; }
            root.TabManager.createTab(d.sourceUrl);
          }, { iconName: 'globe' }));
        }

        // sliders
        const sliders = el('div', 'vws-sliders');
        const mk = (label, key, min, max, step, fmt) => {
          const row = el('label', 'vws-slider');
          const name = el('span', 'vws-slider-name', label);
          const val = el('span', 'vws-slider-val', fmt(ui.draft[key]));
          const input = el('input');
          input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = ui.draft[key];
          input.setAttribute('aria-label', label);
          input.addEventListener('input', () => { ui.draft[key] = Number(input.value); val.textContent = fmt(ui.draft[key]); measure(); });
          input.addEventListener('change', () => liveApply());
          row.append(name, val, input);
          return row;
        };
        const auto = el('label', 'vws-check');
        const autoBox = el('input');
        autoBox.type = 'checkbox'; autoBox.checked = ui.draft.auto;
        autoBox.addEventListener('change', () => { ui.draft.auto = autoBox.checked; measure(); liveApply(); });
        auto.append(autoBox, doc.createTextNode(' ' + L('Keep text readable (soft glass behind the text; shade only as a last resort)')));
        sliders.append(mk(L('Dim'), 'dim', 0, 0.9, 0.01, v => Math.round(v * 100) + '%'), mk(L('Blur'), 'blur', 0, 30, 1, v => v + ' px'), auto);
        panel.append(sliders);

        // buttons
        const isOn = (V.current() || {}).id === d.id;
        const actions = el('div', 'vws-actions');
        const applyBtn = button(isOn ? L('Apply changes') : L('Apply'), () => apply().catch(fail), { cls: 'btn-primary', iconName: 'check' });
        const fav = button(V.isFavourite(d.id) ? L('Remove from favourites') : L('Add to favourites'), () => { try { V.toggleFavourite(d.id); renderGrid(); } catch (err) { fail(err); } }, { iconName: 'heart' });
        fav.setAttribute('aria-pressed', String(V.isFavourite(d.id)));
        actions.append(applyBtn, fav);
        panel.append(actions);
        const more = el('div', 'vws-actions');
        more.append(button(L('Use colours from this wallpaper'), () => colours(d.id), { iconName: 'palette' }));
        if (V.current()) more.append(button(L('Remove wallpaper'), () => V.remove().then(() => { say(L('The wallpaper is off. Your New Tab uses the theme again.')); renderGrid(); }).catch(fail), { cls: 'btn-danger', iconName: 'x' }));
        if (d.source === 'mine') more.append(button(L('Delete this picture'), () => del(d), { cls: 'btn-danger', iconName: 'trash' }));
        panel.append(more);

        // The picture behind the sample, drawn from the same source the New Tab gets.
        try {
          const { src } = await V.sourceOf(d);
          if (mine !== previewToken) return;
          previewSrc = src;
          pic.style.backgroundImage = 'url("' + src + '")';
          measure();
        } catch (err) {
          if (mine !== previewToken) return;
          read.textContent = err.message;
          read.className = 'vws-read vws-bad';
        }

        function measure() {
          const P = root.WallpaperPaint;
          if (!P || !previewSrc || mine !== previewToken) return;
          V.summarise(previewSrc, d.id).then((s) => {
            if (mine !== previewToken) return;
            // Exactly what the New Tab will wear: the plan the page itself makes (js/wallpaper-paint.js), plates included.
            const p = P.plan({ summary: s, accent: P.pageColours().accent, dim: ui.draft.dim, auto: ui.draft.auto });
            const alpha = p.shade;
            scrim.style.backgroundColor = P.rgbCss(p.plate, alpha);
            plate.style.background = P.rgbCss(p.plate, p.plateAlpha);
            plate.style.borderColor = P.rgbCss(p.inks[0], 0.16);
            s1.style.color = P.rgbCss(p.inks[0]); s2.style.color = P.rgbCss(p.inks[1]); s3.style.color = P.rgbCss(p.inks[2]);
            pic.style.filter = ui.draft.blur ? 'blur(' + Math.round(ui.draft.blur * 0.5) + 'px)' : '';
            const { worst, ok } = p;
            const hidden = alpha > HIDDEN_SHADE;
            read.className = 'vws-read ' + (ok && !hidden ? 'vws-good' : 'vws-bad');
            read.textContent = (ok ? L('Text reads at') : L('Text is hard to read, only')) + ' ' + worst.toFixed(1) + ':1 · ' + (p.scheme === 'dark' ? L('dark glass') : L('light glass')) + ' ' + Math.round(p.plateAlpha * 100) + '% · ' + L('shade') + ' ' + Math.round(alpha * 100) + '%' + (ok ? '' : ' · ' + L('turn on "Keep text readable" or raise Dim'))
              + (hidden ? ' · ' + L('only') + ' ' + Math.round((1 - alpha) * 100) + '% ' + L('of the picture shows on your New Tab with this shade') : '');
          }).catch((err) => { read.textContent = err.message; read.className = 'vws-read vws-bad'; });
        }
      }

      async function apply() {
        const d = V.get(ui.sel);
        if (!d) throw new Error('Choose a wallpaper first');
        say(L('Applying…'));
        await V.apply(d.id, ui.draft);
        renderGrid();
        await report(d);
      }
      // Says what the person will really see. Success is only claimed when the picture is painted and visible.
      async function report(d) {
        if (!V.enabled()) {
          say(L('Saved, but wallpapers are switched off, so your New Tab does not show it.'), [[L('Turn on'), async () => { V.setEnabled(true); await V.paintStartPages(); await report(d); }]]);
          return;
        }
        const sh = await V.shade();
        if (sh && sh.shows < 1 - HIDDEN_SHADE) {
          // "Keep text readable" shades the picture until the page's text reads at 4.5:1 over its lightest and darkest parts.
          // Over this picture that is nearly all of it. The person chooses: keep the readable text, or see more of the picture.
          const acts = [];
          if (ui.draft.auto) {
            acts.push([L('Show more of it'), async () => { ui.draft.auto = false; ui.draft.dim = Math.max(ui.draft.dim, 0.4); await V.apply(d.id, ui.draft); renderGrid(); await report(d); }]);
          }
          say(L('Applied: ') + d.title + '. ' + L('But only') + ' ' + Math.round(sh.shows * 100) + '% ' + L('of the picture shows: to keep the text on your New Tab readable over it, Vex has to shade it heavily. Showing more can make some text harder to read.'), acts.concat(matchOffer(d)));
          return;
        }
        say(L('Applied: ') + d.title + '. ' + (sh && sh.textOk === false ? L('Some text on your New Tab may be hard to read over it.') : L('Open a New Tab to see it.')), matchOffer(d));
      }
      // "Match Vex to it" / "Not now" after Apply: only when this wallpaper is not matched everywhere yet.
      function matchOffer(d) {
        const SY = root.VexWallpaperSync;
        if (!SY || SY.areasFor(d.id).length === SY.AREA_IDS.length) return [];
        return [
          [L('Match Vex to it'), async () => {
            await SY.setAreas(d.id, SY.AREA_IDS);
            say(L('Vex now matches') + ' ' + d.title + '. ' + L('Undo is in the preview.'));
            renderPanel();
          }],
          [L('Not now'), () => { const t = status.firstChild ? status.firstChild.textContent : ''; say(t); }, 'btn-secondary'],
        ];
      }
      // A slider let go of on the wallpaper that is on: the New Tab follows at once.
      function liveApply() {
        const c = V.current();
        if (!c || c.id !== ui.sel) return;
        clearTimeout(sliderTimer);
        sliderTimer = setTimeout(() => V.apply(c.id, ui.draft).catch(fail), 150);
      }
      async function colours(id) {
        try {
          if (!root.ThemeStudio) throw new Error('The theme editor is not available');
          const file = await V.rasterFile(id);
          dlg.close();
          await root.ThemeStudio.openFromPicture(file);
        } catch (err) { fail(err); }
      }
      async function del(d) {
        const ok = await root.vexConfirm({ title: L('Delete this picture?'), message: '"' + d.title + '" ' + L('will be removed from this computer. The original file you picked is not touched.'), okLabel: L('Delete'), danger: true });
        if (!ok) return;
        try { await V.removeMine(d.id); ui.sel = null; renderCats(); renderGrid(); } catch (err) { fail(err); }
      }
      function pick() {
        const input = doc.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/webp';
        input.style.display = 'none';
        input.addEventListener('change', async () => {
          const file = input.files && input.files[0];
          input.remove();
          if (!file) return;
          say(L('Adding your picture…'));
          try { const d = await V.addPicture(file); ui.cat = 'mine'; ui.sel = d.id; ui.draft = { ...V.DEFAULTS }; renderCats(); renderGrid(); say(L('Added: ') + d.title); }
          catch (err) { say(''); fail(err); }
        });
        doc.body.appendChild(input);
        input.click();
      }

      const unsub = V.onChange(() => { if (!dlg.overlay.isConnected) { unsub(); releaseThumbs(); return; } renderCats(); renderGrid(); });

      renderCats();
      renderGrid();
      search.focus();

      // The photo list is read only now, and only if an address is set.
      if (V.catalogueUrl()) {
        say(L('Looking for the photo list…'));
        V.loadCatalogue().then((r) => {
          if (!dlg.overlay.isConnected) return;
          const info = V.catalogueInfo() || {};
          say(r.entries + ' ' + L('photos') + (info.stale ? ' · ' + L('offline, showing the saved list') : '') + (info.problems && info.problems.length ? ' · ' + info.problems.length + ' ' + L('entries were skipped (see the console)') : ''));
          if (info.problems && info.problems.length) root.console.warn('[wallpapers] skipped list entries:\n' + info.problems.join('\n'));
          renderCats(); renderGrid();
        }).catch((err) => { if (dlg.overlay.isConnected) say(L('The photo list could not be read: ') + err.message); });
      }
      return dlg;
    },
  };

  // "Match Vex to this wallpaper" (js/wallpaper-sync.js): one big button that matches every part of
  // Vex, and one switch per part, each working at once. Only ever on a click.
  //   opts.compact  the store: the big button, a "Choose the parts" button that opens the switches, Undo
  //   otherwise     Settings: title, note, the big button, Undo and the switches, all in view
  function matchSection(into, id, opts = {}) {
    const SY = root.VexWallpaperSync;
    if (!SY) return;
    const compact = !!opts.compact;
    const sec = el('div', 'vws-match' + (compact ? ' vws-match-compact' : ''));
    if (!compact) {
      sec.append(el('h4', 'vws-match-title', L('Match Vex to this wallpaper')));
      sec.append(el('p', 'vws-match-note', L('Turn on the parts of Vex that should wear this wallpaper\'s colours. The rest keeps your theme.')));
    }
    let on = [];
    try { on = SY.areasFor(id); } catch (err) { fail(err); }
    const boxes = new Map();
    let busy = Promise.resolve();
    const refresh = () => { let can = false; try { can = SY.canUndo(); } catch (err) { fail(err); } undoBtn.disabled = !can; };
    const undoBtn = button(L('Undo'), () => {
      busy = busy.then(() => SY.undo()).then(() => { for (const b of boxes.values()) b.checked = false; refresh(); toast(L('Your earlier theme is back.'), 'success'); }).catch(fail);
    }, { iconName: 'undo' });
    const send = (done) => {
      const picked = SY.AREA_IDS.filter(a => boxes.get(a).checked);
      busy = busy.then(() => SY.setAreas(id, picked)).then(refresh).then(() => { if (done) toast(done, 'success'); }).catch(fail);
    };
    const list = el('div', 'vws-match-list');
    list.id = 'vws-match-list-' + (compact ? 'store' : 'settings');
    for (const a of SY.AREAS) {
      const row = el('label', 'vws-match-row');
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.checked = on.includes(a.id);
      box.addEventListener('change', () => send());
      boxes.set(a.id, box);
      const text = el('span', 'vws-match-text');
      text.append(el('span', 'vws-match-label', L(a.label)), el('span', 'vws-match-hint', L(a.hint)));
      row.append(box, text);
      list.append(row);
    }
    // The big button: every part at once.
    const all = button(L('Match Vex to this wallpaper'), () => {
      for (const b of boxes.values()) b.checked = true;
      send(L('Vex now matches this wallpaper. Undo puts your old theme back.'));
    }, { cls: 'btn-primary vws-match-all', iconName: 'palette' });
    const actions = el('div', 'vws-actions');
    if (compact) {
      const partial = on.length > 0 && on.length < SY.AREA_IDS.length;
      const parts = button(L('Choose the parts'), () => {
        const open = parts.getAttribute('aria-expanded') !== 'true';
        parts.setAttribute('aria-expanded', String(open));
        list.hidden = !open;
      }, { iconName: 'sliders' });
      parts.setAttribute('aria-expanded', String(partial));
      parts.setAttribute('aria-controls', list.id);
      list.hidden = !partial;
      actions.append(parts, undoBtn);
      sec.append(all, actions, list);
    } else {
      actions.append(all, undoBtn);
      sec.append(actions, list);
    }
    refresh();
    into.append(sec);
    return sec;
  }

  // --- Settings > Appearance > Wallpapers ------------------------------------------------------

  function renderSettings(body) {
    const V = W(), G = root.VexSettingsGroup;
    if (!V) { body.textContent = L('Wallpapers are not loaded yet.'); return; }
    const again = () => { body.textContent = ''; renderSettings(body); };
    // The section shows what is true now: a wallpaper applied in the store (open on top of Settings) shows here when it closes.
    if (!body.dataset.vwsLive) {
      body.dataset.vwsLive = '1';
      const unsub = V.onChange(() => { if (!body.isConnected) { unsub(); delete body.dataset.vwsLive; return; } again(); });
    }
    const c = V.current();
    body.append(G.note(c ? L('Want Vex itself to look like this wallpaper? "Match Vex to this wallpaper" below paints the tabs, the toolbar and search bar, the side bar and more in its colours, in one click. You can also pick the parts.') : L('Choose a wallpaper in the store, then match Vex to it: the tabs, toolbar, side bar and more take its colours, in one click.')));
    body.append(G.note(L('Pictures for your New Tab page: 74 drawn by Vex, free photos from a list you can point Vex at, and your own pictures. Nothing is downloaded until you open the store with a list address set.')));
    body.append(G.field(L('Now'), el('span', 'vws-now', c ? c.title : L('No wallpaper'))));
    const row = el('div', 'vws-set-actions');
    row.append(button(L('Open the Wallpaper Store'), () => { try { Store.open(); } catch (err) { fail(err); } }, { cls: 'btn-primary', iconName: 'palette' }));
    if (c) row.append(button(L('Remove wallpaper'), () => V.remove().then(again).catch(fail), { iconName: 'x' }));
    body.append(row);
    if (c) matchSection(body, c.id);
    body.append(G.toggle(L('Show the wallpaper on the New Tab'), V.enabled(), (on) => { try { V.setEnabled(on); if (typeof root.VexUsage !== 'undefined') root.VexUsage.touch(V.FEATURE); } catch (err) { fail(err); } }));

    const url = el('input', 'set-input');
    url.type = 'url';
    url.placeholder = 'https://example.com/wallpaper-catalogue.json';
    url.value = V.catalogueUrl();
    url.setAttribute('aria-label', L('Photo list address'));
    body.append(G.field(L('Photo list address'), url));
    const urow = el('div', 'vws-set-actions');
    urow.append(
      button(L('Save address'), () => { try { V.setCatalogueUrl(url.value); toast(url.value.trim() ? L('Saved. Open the store to read the list.') : L('Cleared. Vex fetches no photos.'), 'success'); } catch (err) { fail(err); } }),
      button(L('Check the list now'), async () => {
        try { V.setCatalogueUrl(url.value); const r = await V.loadCatalogue({ force: true }); toast(r.configured ? r.entries + ' ' + L('photos in the list') + (r.problems && r.problems.length ? ' · ' + r.problems.length + ' ' + L('skipped') : '') : L('No address is set'), r.configured ? 'success' : 'info'); }
        catch (err) { fail(err); }
      }),
    );
    body.append(urow);
    body.append(G.note(L('The list is a small JSON file you host yourself; every photo in it must be free to use (CC0, public domain, Pexels or Unsplash licence) and name its author. Vex checks each entry and skips any it cannot verify. Left empty, Vex never contacts anything for wallpapers.')));

    const stat = el('div', 'vws-stat');
    body.append(stat);
    V.stats().then((s) => {
      stat.textContent = L('Kept on this computer:') + ' ' + (s.cacheBytes / 1048576).toFixed(1) + ' MB ' + L('of downloaded photos') + ' (' + L('at most') + ' ' + Math.round(s.cacheMax / 1048576) + ' MB), ' + s.mineFiles + ' ' + L('of your own pictures') + '.';
      if (s.cacheFiles || s.catalogue) stat.append(doc.createTextNode(' '), button(L('Clear downloaded photos'), () => V.clearCache().then(again).catch(fail)));
    }).catch((err) => { stat.textContent = err.message; });
  }

  const UI = { open: (o) => Store.open(o), renderSettings, Store };
  root.VexWallpaperStore = UI;
  if (typeof module !== 'undefined' && module.exports) module.exports = { VexWallpaperStore: UI };

  if (doc) {
    if (root.VexSettingsGroups) {
      root.VexSettingsGroups.register({ id: 'wallpapers', title: 'Wallpapers', keywords: 'wallpaper background picture photo new tab store gradient image theme pack', render: (body) => renderSettings(body) });
    }
    if (typeof VexExtras !== 'undefined') {
      VexExtras.registerCommand({ id: 'wallpapers', label: 'Wallpapers', hint: 'The Wallpaper Store: pictures for your New Tab page', icon: 'palette', action: () => { try { Store.open(); } catch (err) { fail(err); } } });
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
