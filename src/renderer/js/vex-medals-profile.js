// The profile page and its Settings group (data: js/vex-medals.js).
//
// A local profile only: a display name, a preset avatar, a level made from
// medals and a shelf. Nothing here is shared, uploaded or compared with
// anyone; "Export as image" renders a PNG on this computer and saves it.
//
// The "Unlock all medals" switch is display only. It never writes to the
// earned record, never raises an award event, and the profile keeps showing
// how many were earned for real.
(function () {
  'use strict';
  const V = window.VexMedals;
  if (!V) return;
  const esc = V.esc;
  const TITLES = ['Newcomer', 'Settling in', 'Regular', 'Explorer', 'Pathfinder', 'Craftsperson', 'Veteran', 'Expert', 'Master', 'Legend'];
  const levelTitle = (l) => TITLES[Math.min(TITLES.length - 1, Math.floor((l - 1) / 3))];
  const state = { tier: 'all', cat: 'all', root: null, prevFocus: null };

  function displayName() {
    const p = V.profile().name;
    if (p) return p;
    try { return localStorage.getItem('vex.userName') || ''; } catch { return ''; }
  }
  function featuresTriedLine() {
    const F = window.VexFeatures;
    if (!F || !Array.isArray(F.ITEMS)) return null;
    const open = F.ITEMS.filter(i => i.cmd || i.panel);
    return { used: open.filter(i => F.used(i)).length, of: open.length };
  }
  const when = (t) => { try { return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } };

  function card(def) {
    const real = V.has(def.id);
    const shown = V.isShown(def.id);
    const p = V.progressOf(def.id);
    if (shown) {
      const note = real ? 'Earned ' + when(V.stats().recent.find(r => r.id === def.id)?.at) : 'Shown with Unlock all medals';
      return `<div class="vm-card" role="listitem" data-medal="${esc(def.id)}"><span class="vm-tier">${esc(V.TIER_NAMES[def.tier])}</span>${V.artOf(def, { size: 76 })}<h4>${esc(def.title)}</h4><p>${esc(def.desc)}</p><p>${esc(note)}</p></div>`;
    }
    const title = def.hidden ? 'Hidden medal' : def.title;
    const hint = def.hidden ? 'A surprise. Keep using Vex.' : (def.hint || def.desc);
    const prog = p && !def.hidden ? `<div class="vm-prog">${V.ring(p.n, p.of, 30)}<span>${p.n} of ${p.of}</span></div>` : '';
    return `<div class="vm-card vm-locked" role="listitem" data-medal="${esc(def.id)}"><span class="vm-tier">${esc(V.TIER_NAMES[def.tier])}</span>${V.artOf(def, { size: 76, locked: true, label: 'Locked medal: ' + title })}<h4>${esc(title)}</h4><p>${esc(hint)}</p>${prog}</div>`;
  }

  function render() {
    const rootEl = state.root;
    if (!rootEl) return;
    const lv = V.levelInfo();
    const st = V.stats();
    const prof = V.profile();
    const all = V.list();
    const pct = lv.max ? 100 : Math.round((lv.into / Math.max(1, lv.span)) * 100);
    const tried = featuresTriedLine();
    const recent = st.recent.slice(0, 8).map(r => V.get(r.id)).filter(Boolean);
    const inprog = all.filter(m => !V.has(m.id) && !m.hidden && V.progressOf(m.id)).slice(0, 8);
    const shelf = all.filter(m => (state.tier === 'all' || m.tier === state.tier) && (state.cat === 'all' || m.cat === state.cat));
    shelf.sort((a, b) => (V.isShown(b.id) - V.isShown(a.id)) || (V.TIERS.indexOf(a.tier) - V.TIERS.indexOf(b.tier)));

    const unlockLine = V.unlockAll()
      ? `<span class="vm-honest">${st.earned} earned for real. The rest are shown because Unlock all medals is on.</span>`
      : `<span class="vm-honest">${st.earned} earned for real</span>`;

    rootEl.querySelector('.vm-profile').innerHTML = `
      <div class="vm-head">
        ${V.avatarSvg(prof.avatar, 72)}
        <div class="vm-head-main">
          <label class="vm-sr" for="vm-name" style="position:absolute;left:-9999px">Display name</label>
          <input id="vm-name" class="vm-name" type="text" maxlength="32" placeholder="Your name" value="${esc(displayName())}" aria-label="Display name">
          <div class="vm-level">Level ${lv.level}${lv.max ? ' (top level)' : ''} &middot; ${esc(levelTitle(lv.level))}${lv.shownByDisplay ? ' &middot; counted with every medal shown' : ''}</div>
          <div class="vm-xp" role="progressbar" aria-label="Progress to the next level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
          <div class="vm-avatars" role="radiogroup" aria-label="Avatar">
            ${V.AVATARS.map(a => `<button type="button" class="vm-avatar-pick" role="radio" aria-checked="${a.id === prof.avatar}" data-avatar="${a.id}" aria-label="${esc(a.name)}">${V.avatarSvg(a.id, 30)}</button>`).join('')}
          </div>
        </div>
        <button type="button" class="btn-secondary vm-close" id="vm-close">Close</button>
      </div>
      <div class="vm-stats">
        <div class="vm-stat"><b>${V.unlockAll() ? st.shown : st.earned} / ${st.total}</b><span>Medals</span>${unlockLine}</div>
        <div class="vm-stat"><b>${lv.xp}</b><span>Points</span></div>
        <div class="vm-stat"><b>${V.streak()}</b><span>Days in a row</span></div>
        <div class="vm-stat"><b>${V.activeDays()}</b><span>Days used</span></div>
        <div class="vm-stat"><b>${V.counter('pages')}</b><span>Pages opened</span></div>
        ${tried ? `<div class="vm-stat"><b>${tried.used} / ${tried.of}</b><span>Features tried</span></div>` : ''}
      </div>
      ${recent.length ? `<div class="vm-h">Recent medals</div><div class="vm-strip" role="list">${recent.map(m => `<div class="vm-mini" role="listitem">${V.artOf(m, { size: 56 })}<div>${esc(m.title)}</div></div>`).join('')}</div>` : ''}
      ${inprog.length ? `<div class="vm-h">In progress</div><div class="vm-shelf" role="list">${inprog.map(card).join('')}</div>` : ''}
      <div class="vm-h">Shelf</div>
      <div class="vm-filters">
        ${['all'].concat(V.TIERS).map(t => `<button type="button" class="vm-chip" data-tier="${t}" aria-pressed="${state.tier === t}">${t === 'all' ? 'All tiers' : esc(V.TIER_NAMES[t]) + ' ' + st.byTier[t].have + '/' + st.byTier[t].all}</button>`).join('')}
        <select class="vm-select" id="vm-cat" aria-label="Group"><option value="all">All groups</option>${V.CATS.map(c => `<option value="${c.id}"${state.cat === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div class="vm-shelf" role="list">${shelf.map(card).join('') || '<p class="vm-set-note">No medals match.</p>'}</div>
      <div class="vm-actions"><button type="button" class="btn-primary" id="vm-export">Export as image</button></div>`;

    const q = (s) => rootEl.querySelector(s);
    q('#vm-close').addEventListener('click', close);
    q('#vm-name').addEventListener('change', (e) => { V.setProfile({ name: e.target.value }); V.runChecks && V.runChecks(); });
    rootEl.querySelectorAll('[data-avatar]').forEach(b => b.addEventListener('click', () => { V.setProfile({ avatar: b.dataset.avatar }); render(); const n = rootEl.querySelector('[data-avatar="' + b.dataset.avatar + '"]'); if (n) n.focus(); }));
    rootEl.querySelectorAll('[data-tier]').forEach(b => b.addEventListener('click', () => { state.tier = b.dataset.tier; render(); const n = rootEl.querySelector('[data-tier="' + state.tier + '"]'); if (n) n.focus(); }));
    q('#vm-cat').addEventListener('change', (e) => { state.cat = e.target.value; render(); const n = rootEl.querySelector('#vm-cat'); if (n) n.focus(); });
    q('#vm-export').addEventListener('click', () => exportImage().catch(err => window.showToast?.('Could not export the image: ' + ((err && err.message) || err), 'error')));
  }

  function open() {
    if (state.root) return;
    state.prevFocus = document.activeElement;
    const o = document.createElement('div');
    o.className = 'vm-overlay';
    o.innerHTML = '<div class="vm-profile" role="dialog" aria-modal="true" aria-label="Your profile and medals"></div>';
    o.addEventListener('mousedown', (e) => { if (e.target === o) close(); });
    o.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    document.body.appendChild(o);
    state.root = o;
    render();
    // Opening it is a real action: it earns its own medal.
    try { V.award('meet-your-profile'); } catch { /* not defined */ }
    const c = o.querySelector('#vm-close');
    if (c) c.focus();
  }
  function close() {
    if (!state.root) return;
    state.root.remove();
    state.root = null;
    try { if (state.prevFocus && state.prevFocus.focus) state.prevFocus.focus(); } catch { /* gone */ }
  }

  // --- export: one self-contained SVG, drawn to a canvas, saved locally ----------
  function exportSvg() {
    const lv = V.levelInfo();
    const st = V.stats();
    const prof = V.profile();
    const shown = V.list().filter(m => V.isShown(m.id));
    const cols = 8, cell = 112, padX = 40, W = padX * 2 + cols * cell;
    const rows = Math.max(1, Math.ceil(shown.length / cols));
    const top = 150, H = top + rows * (cell + 18) + 50;
    const name = displayName() || 'Vex profile';
    let body = `<rect width="${W}" height="${H}" fill="#14161c"/>`
      + `<g transform="translate(${padX} 28)">${V.avatarSvg(prof.avatar, 84).replace(/^<svg /, '<svg x="0" y="0" ')}</g>`
      + `<text x="${padX + 104}" y="64" fill="#f4f4f8" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="600">${esc(name)}</text>`
      + `<text x="${padX + 104}" y="94" fill="#b9bccb" font-family="Segoe UI, Arial, sans-serif" font-size="16">Level ${lv.level} - ${esc(levelTitle(lv.level))} - ${V.unlockAll() ? shown.length : st.earned} of ${st.total} medals${V.unlockAll() ? ' (' + st.earned + ' earned for real)' : ''}</text>`;
    shown.forEach((m, i) => {
      const x = padX + (i % cols) * cell, y = top + Math.floor(i / cols) * (cell + 18);
      body += `<g transform="translate(${x + 16} ${y})">${V.artOf(m, { size: 80 }).replace(/^<svg /, '<svg x="0" y="0" ')}</g>`
        + `<text x="${x + cell / 2}" y="${y + 100}" text-anchor="middle" fill="#dfe1ec" font-family="Segoe UI, Arial, sans-serif" font-size="11">${esc(m.title.length > 18 ? m.title.slice(0, 17) + '.' : m.title)}</text>`;
    });
    body += `<text x="${padX}" y="${H - 18}" fill="#7d8194" font-family="Segoe UI, Arial, sans-serif" font-size="12">Made locally in Vex</text>`;
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`, W, H };
  }
  async function exportImage() {
    const { svg, W, H } = exportSvg();
    const img = new Image();
    const loaded = new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('The picture could not be drawn')); });
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await loaded;
    const c = document.createElement('canvas');
    c.width = W * 2; c.height = H * 2;
    const g = c.getContext('2d');
    g.scale(2, 2);
    g.drawImage(img, 0, 0, W, H);
    const blob = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('The picture was empty'))), 'image/png'));
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = 'vex-medals.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    window.showToast?.('Saved vex-medals.png to your downloads');
  }

  // --- Settings group (injected; index.html only needs the script tags) -----------------
  function injectSettings() {
    if (document.getElementById('settings-medals')) return;
    const anchor = document.getElementById('settings-ainews') || document.getElementById('settings-pagewatch');
    if (!anchor || !anchor.parentNode) return;
    const g = document.createElement('div');
    g.className = 'setting-group';
    g.id = 'settings-medals';
    g.innerHTML = `<label class="setting-label">Profile and medals</label>
      <p class="vm-set-note" id="vm-set-summary"></p>
      <div class="vm-set-row"><button type="button" class="btn-primary" id="vm-open">Open my profile</button></div>
      <div class="setting-toggle-row">
        <span>Unlock all medals</span>
        <label class="toggle"><input type="checkbox" id="setting-unlock-all-medals" aria-label="Unlock all medals"><span class="toggle-slider"></span></label>
      </div>
      <p class="vm-set-note">Shows every medal on your profile with its full art. It changes only what is shown: the medals you really earned are kept separately and come back exactly as they were when you switch this off.</p>`;
    anchor.parentNode.insertBefore(g, anchor);
    const box = g.querySelector('#setting-unlock-all-medals');
    const sum = g.querySelector('#vm-set-summary');
    const refresh = () => { const s = V.stats(); sum.textContent = s.earned + ' of ' + s.total + ' medals earned for real. Level ' + V.levelInfo().level + '.'; box.checked = V.unlockAll(); };
    refresh();
    box.addEventListener('change', () => {
      V.setUnlockAll(box.checked);
      // One summary, never one toast per medal.
      window.showToast?.(box.checked ? 'All medals are shown on your profile. ' + V.stats().earned + ' earned for real.' : 'Your profile shows the medals you earned again.');
      refresh();
      if (state.root) render();
    });
    g.querySelector('#vm-open').addEventListener('click', open);
    V.on((name) => { if (name === 'vex:medal-awarded') refresh(); });
  }

  function registerCommand() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return false;
    if (CommandBar.commands.some(c => c.id === 'profile-medals')) return true;
    CommandBar.commands.push({
      id: 'profile-medals',
      label: 'My Profile and Medals',
      hint: 'Your level, your medals and what is still ahead of you',
      icon: 'user',
      action: open,
    });
    return true;
  }

  const boot = () => {
    try { injectSettings(); } catch (err) { window.VexProblems?.note('Medals', 'Could not add the profile settings', err); }
    if (!registerCommand()) setTimeout(registerCommand, 1500);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.VexProfile = { open, close, render, exportSvg, exportImage };
})();
