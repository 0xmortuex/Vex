// Screen-share source picker. Electron has no built-in getDisplayMedia picker,
// so main.js (setDisplayMediaRequestHandler) enumerates screens + windows via
// desktopCapturer and asks us to show the chooser. The user picks one, we send
// the source id back, and main hands it to the page (e.g. Discord Go Live).
(function () {
  if (!window.vex || typeof window.vex.onScreenPickerOpen !== 'function') return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function injectStyles() {
    if (document.getElementById('scrpick-styles')) return;
    const st = document.createElement('style');
    st.id = 'scrpick-styles';
    st.textContent = `
      .scrpick-ov{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(8,10,14,0.74);backdrop-filter:blur(4px);font-family:inherit;}
      .scrpick-card{width:760px;max-width:92vw;max-height:84vh;display:flex;flex-direction:column;background:var(--surface,#1b1b24);border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,0.6);overflow:hidden;}
      .scrpick-title{padding:16px 20px;font-size:15px;font-weight:700;color:var(--text,#e9e9ee);border-bottom:1px solid var(--border,rgba(255,255,255,0.08));}
      .scrpick-sub{font-weight:400;font-size:12px;color:var(--text-muted,#9a9aa5);margin-left:8px;}
      .scrpick-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;padding:18px;overflow-y:auto;}
      .scrpick-item{display:flex;flex-direction:column;gap:8px;padding:8px;border:1px solid var(--border,rgba(255,255,255,0.1));border-radius:10px;background:transparent;cursor:pointer;text-align:left;color:var(--text,#e9e9ee);font-family:inherit;}
      .scrpick-item:hover{border-color:var(--primary,#6366f1);background:color-mix(in srgb,var(--primary,#6366f1) 12%,transparent);}
      .scrpick-thumb{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px;background:#000;}
      .scrpick-name{display:flex;align-items:center;gap:6px;font-size:12px;line-height:1.3;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
      .scrpick-name img{width:16px;height:16px;flex:0 0 16px;border-radius:3px;}
      .scrpick-badge{font-size:10px;color:var(--text-muted,#9a9aa5);}
      .scrpick-actions{display:flex;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--border,rgba(255,255,255,0.08));}
      .scrpick-cancel{border:1px solid var(--border,rgba(255,255,255,0.14));background:transparent;color:var(--text,#e9e9ee);border-radius:9px;padding:8px 16px;font-size:13px;font-family:inherit;cursor:pointer;}
      .scrpick-cancel:hover{background:rgba(255,255,255,0.06);}
    `;
    document.head.appendChild(st);
  }

  window.vex.onScreenPickerOpen((payload) => {
    if (!payload || !Array.isArray(payload.sources)) return;
    injectStyles();
    document.querySelectorAll('.scrpick-ov').forEach(e => e.remove());

    const screens = payload.sources.filter(s => s.isScreen);
    const wins = payload.sources.filter(s => !s.isScreen);
    const ordered = screens.concat(wins);

    const ov = document.createElement('div');
    ov.className = 'scrpick-ov';
    const card = document.createElement('div');
    card.className = 'scrpick-card';
    card.innerHTML = `<div class="scrpick-title">Choose what to share<span class="scrpick-sub">Screen or window</span></div><div class="scrpick-grid"></div><div class="scrpick-actions"><button class="scrpick-cancel">Cancel</button></div>`;
    ov.appendChild(card);

    let done = false;
    const choose = (sourceId) => { if (done) return; done = true; try { window.vex.chooseScreenSource(payload.id, sourceId); } catch {} ov.remove(); };

    const grid = card.querySelector('.scrpick-grid');
    ordered.forEach((s) => {
      const item = document.createElement('button');
      item.className = 'scrpick-item';
      item.innerHTML =
        `<img class="scrpick-thumb" src="${s.thumbnail || ''}" alt="">` +
        `<span class="scrpick-name">${s.icon ? `<img src="${s.icon}" alt="">` : ''}${esc(s.name)}</span>` +
        `<span class="scrpick-badge">${s.isScreen ? 'Screen' : 'Window'}</span>`;
      item.addEventListener('click', () => choose(s.id));
      grid.appendChild(item);
    });

    card.querySelector('.scrpick-cancel').addEventListener('click', () => choose(null));
    ov.addEventListener('click', (e) => { if (e.target === ov) choose(null); });
    document.addEventListener('keydown', function onEsc(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', onEsc); choose(null); } });

    document.body.appendChild(ov);
  });
})();
