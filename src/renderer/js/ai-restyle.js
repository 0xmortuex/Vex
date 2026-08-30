// === Vex AI Restyle ===
// Ask the AI to write custom CSS that restyles the CURRENT site to a look you
// describe, then apply it as a per-site Boost. Reuses the existing Boosts store
// (vex.boosts[host].css) and injection (VexBoosts.applyTo) — the AI CSS lives in
// a delimited block inside that css so any hand-written boost CSS is preserved
// and the AI part can be reverted cleanly. Ctrl+K → "AI Restyle This Site".
const AIRestyle = {
  START: '/* VEX-AI-RESTYLE-START */',
  END: '/* VEX-AI-RESTYLE-END */',

  PRESETS: [
    ['Match my dark theme', 'Restyle it into a sleek dark theme: dark backgrounds, light readable text, subtle accent colors, gentle borders.'],
    ['Declutter (reader-like)', 'Declutter the page: hide ads, sidebars, sticky headers, popups and newsletter overlays; widen and center the main content for comfortable reading.'],
    ['Bigger text', 'Increase the base font size and line height noticeably for comfortable reading, without breaking the layout.'],
    ['Compact density', 'Reduce padding, margins and whitespace for a denser, more compact layout that fits more on screen.'],
    ['High contrast', 'Maximize contrast for accessibility: strong text-to-background contrast, clear focus/hover states, no low-contrast grey text.'],
  ],

  _host() { try { const t = TabManager.getActiveTab(); return t && t.url ? new URL(t.url).hostname.replace(/^www\./, '') : ''; } catch { return ''; } },
  _wv() { try { return WebviewManager.getActiveWebview ? WebviewManager.getActiveWebview() : null; } catch { return null; } },
  _stripAi(css) {
    const s = String(css || ''); const i = s.indexOf(this.START), j = s.indexOf(this.END);
    if (i >= 0 && j > i) return (s.slice(0, i) + s.slice(j + this.END.length)).trim();
    return s;
  },
  _hasAi(host) { try { const b = VexBoosts.boosts[host]; return !!(b && b.css && b.css.includes(this.START)); } catch { return false; } },

  _setAi(host, aiCss) {
    try {
      const b = VexBoosts.boosts[host] || (VexBoosts.boosts[host] = { zaps: [], css: '', js: '' });
      b.css = this._stripAi(b.css);
      if (aiCss) b.css = (b.css ? b.css + '\n\n' : '') + this.START + '\n' + aiCss + '\n' + this.END;
      if (!b.css && !b.js && !(b.zaps || []).length) delete VexBoosts.boosts[host];
      VexBoosts.save();
      const wv = this._wv();
      if (wv) VexBoosts.applyTo(wv, 'https://' + host + '/');
    } catch (e) { console.warn('[AIRestyle] apply failed:', e && e.message); }
  },

  _cleanCss(reply) {
    let s = '';
    if (typeof reply === 'string') s = reply;
    else if (reply && typeof reply === 'object') s = reply.content || reply.text || reply.message || reply.reply || '';
    s = String(s || '').trim();
    s = s.replace(/^```(?:css)?\s*/i, '').replace(/\s*```\s*$/i, '');   // strip fences
    return s.trim();
  },

  open() {
    if (typeof VexBoosts === 'undefined') { window.showToast?.('Boosts unavailable'); return; }
    const host = this._host();
    if (!host) { window.showToast?.('Open a website first'); return; }
    document.getElementById('vex-airestyle')?.remove();
    const esc = (s) => window.escapeHtml ? window.escapeHtml(s) : s;
    const chip = "padding:6px 11px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif";
    const prim = "padding:8px 16px;background:var(--primary,var(--accent,#d4a574));color:#111;border:1px solid transparent;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:600;font-family:'Outfit',sans-serif";
    const m = document.createElement('div');
    m.id = 'vex-airestyle';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.5);display:flex;align-items:flex-start;justify-content:center;padding-top:14vh';
    m.innerHTML = `<div style="width:480px;max-width:94vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;box-shadow:0 24px 60px rgba(0,0,0,0.5);color:var(--text)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:15px;font-weight:700;flex:1">🎨 AI Restyle · ${esc(host)}</span><button id="ar-close" style="${chip}">✕</button></div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:12px">AI writes CSS to restyle this site and saves it as a Boost. Pick a look or describe your own.</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${this.PRESETS.map((p, i) => `<button class="ar-preset" data-i="${i}" style="${chip}">${esc(p[0])}</button>`).join('')}</div>
      <textarea id="ar-text" rows="2" placeholder="…or describe the look you want (e.g. 'make it look like Notion')" style="width:100%;box-sizing:border-box;padding:9px 11px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;font-size:12.5px;font-family:'Outfit',sans-serif;resize:vertical"></textarea>
      <div id="ar-msg" style="font-size:11.5px;color:var(--text-muted);min-height:16px;margin:10px 0"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
        ${this._hasAi(host) ? `<button id="ar-revert" style="${chip}">Revert AI style</button>` : ''}
        <button id="ar-apply" style="${prim}">✨ Restyle</button>
      </div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#ar-close').addEventListener('click', () => m.remove());
    const text = m.querySelector('#ar-text');
    m.querySelectorAll('.ar-preset').forEach(b => b.addEventListener('click', () => { text.value = this.PRESETS[+b.dataset.i][1]; }));
    const msg = (t, err) => { const e = m.querySelector('#ar-msg'); if (e) { e.textContent = t; e.style.color = err ? 'var(--danger,#e5556a)' : 'var(--text-muted)'; } };
    m.querySelector('#ar-revert')?.addEventListener('click', () => { this._setAi(host, null); window.showToast?.('AI style removed from ' + host); m.remove(); });
    m.querySelector('#ar-apply').addEventListener('click', async () => {
      const request = (text.value || '').trim();
      if (!request) { msg('Pick a look or type one.', true); return; }
      if (typeof AIRouter === 'undefined' || !AIRouter.callAI) { msg('AI backend not configured — set one in Settings → AI Backend.', true); return; }
      msg('Asking the AI for a stylesheet…');
      const prompt = `You are a CSS expert. Write a CSS stylesheet that restyles the website "${host}" as follows: ${request}. Output ONLY raw CSS — no explanations, no markdown code fences. Use !important where needed to override the site's own styles. Scope rules to body and common containers; keep it robust and do not hide or break primary content, links, buttons or inputs.`;
      let reply;
      try { reply = await AIRouter.callAI('chat', { message: prompt }); }
      catch (e) { msg('AI request failed: ' + (e && e.message || 'unknown'), true); return; }
      const css = this._cleanCss(reply);
      if (!css || css.length < 10) { msg('The AI did not return usable CSS — try rephrasing.', true); return; }
      this._setAi(host, css);
      window.showToast?.('🎨 Restyled ' + host + ' — reopen this to revert');
      m.remove();
    });
  },
};

if (typeof window !== 'undefined') window.AIRestyle = AIRestyle;
