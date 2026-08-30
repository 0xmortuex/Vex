// === Vex Setup Gallery ===
// Save, share, and swap whole Vex setups (panels, shortcuts, theme, Glass/
// Classic) as portable VEXSETUP1 codes — reusing the onboarding wizard's own
// encode/decode. Keep a personal library of setups and switch between them.
// Ctrl+K → "Setup Gallery".
const SetupGallery = {
  KEY: 'vex.savedSetups',
  _saved() { try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  _persist(a) { try { localStorage.setItem(this.KEY, JSON.stringify(a.slice(0, 50))); } catch {} },

  _encode() { try { return (typeof Onboarding !== 'undefined' && Onboarding._encodeSetupCode) ? Onboarding._encodeSetupCode() : ''; } catch { return ''; } },
  _decode(code) { try { return (typeof Onboarding !== 'undefined' && Onboarding._decodeSetupCode) ? Onboarding._decodeSetupCode(code) : null; } catch { return null; } },
  _apply(data) { try { if (typeof Onboarding !== 'undefined' && Onboarding._applySetupCode) { Onboarding._applySetupCode(data); return true; } } catch {} return false; },

  async open() {
    document.getElementById('vex-setupgallery')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-setupgallery';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:560px;max-width:95vw;max-height:84vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;padding:18px 20px 10px">
        <span style="font-size:15px;font-weight:700;color:var(--text);flex:1">🎨 Setup Gallery</span>
        <button id="sg-close" style="${this._chip()}">✕</button>
      </div>
      <div id="sg-body" style="overflow-y:auto;padding:4px 20px 20px;font-size:12.5px;color:var(--text)"></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#sg-close').addEventListener('click', () => m.remove());
    this._paint(m);
  },

  _chip() { return "padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif"; },
  _primary() { return "padding:6px 12px;background:var(--primary,var(--accent,#d4a574));color:#111;border:1px solid transparent;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;font-family:'Outfit',sans-serif"; },

  _paint(m) {
    const body = m.querySelector('#sg-body'); if (!body) return;
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');
    const saved = this._saved();
    body.innerHTML = `
      <div style="font-weight:700;margin:6px 0 8px">Your saved setups <span style="font-size:11px;color:var(--text-muted);font-weight:400">· ${saved.length}</span></div>
      <div id="sg-list">${saved.length ? saved.map((s, i) => `
        <div data-i="${i}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:9px;margin-bottom:6px;background:var(--bg)">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}</span>
          <button data-act="apply" style="${this._chip()}">Apply</button>
          <button data-act="copy" title="Copy its code" style="${this._chip()}">Copy</button>
          <button data-act="del" title="Delete" style="${this._chip()}">✕</button>
        </div>`).join('') : '<div style="color:var(--text-muted);margin-bottom:6px">No saved setups yet.</div>'}</div>
      <div style="display:flex;gap:8px;margin:8px 0 18px">
        <input id="sg-name" placeholder="Name this setup…" style="flex:1;padding:8px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;font-size:12.5px;font-family:'Outfit',sans-serif">
        <button id="sg-save" style="${this._primary()}">Save current</button>
      </div>

      <div style="font-weight:700;margin:6px 0 8px">Import a shared setup</div>
      <div style="display:flex;gap:8px;margin-bottom:6px">
        <input id="sg-import" placeholder="Paste a VEXSETUP1.… code" style="flex:1;padding:8px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;font-size:12.5px;font-family:'Outfit',sans-serif">
        <button id="sg-apply-code" style="${this._primary()}">Apply</button>
      </div>
      <div id="sg-msg" style="font-size:11.5px;color:var(--text-muted);min-height:16px;margin-bottom:16px"></div>

      <div style="font-weight:700;margin:6px 0 8px">Share your current setup</div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:6px">Copy this code and send it — anyone can paste it into their Vex to match your panels, shortcuts and theme.</div>
      <div style="display:flex;gap:8px">
        <input id="sg-export" readonly value="${esc(this._encode())}" style="flex:1;padding:8px 10px;background:var(--bg);color:var(--text-muted);border:1px solid var(--border);border-radius:8px;font-size:11px;font-family:monospace">
        <button id="sg-copy-export" style="${this._chip()}">Copy</button>
      </div>`;

    const msg = (t, ok) => { const e = body.querySelector('#sg-msg'); if (e) { e.textContent = t; e.style.color = ok ? '#4caf50' : 'var(--danger,#e5556a)'; } };

    body.querySelector('#sg-save').addEventListener('click', () => {
      const name = (body.querySelector('#sg-name').value || '').trim() || ('Setup ' + (saved.length + 1));
      const code = this._encode(); if (!code) { msg('Could not read the current setup.'); return; }
      const a = this._saved(); a.unshift({ name, code, at: Date.now() }); this._persist(a); this._paint(m);
    });
    body.querySelector('#sg-apply-code').addEventListener('click', () => {
      const code = (body.querySelector('#sg-import').value || '').trim();
      const d = this._decode(code);
      if (!d) { msg('That is not a valid setup code (must start with VEXSETUP1.).'); return; }
      if (this._apply(d)) msg('✓ Applied — your setup was updated.', true); else msg('Could not apply that setup.');
    });
    body.querySelector('#sg-copy-export').addEventListener('click', () => { try { navigator.clipboard.writeText(this._encode()); window.showToast?.('Setup code copied'); } catch {} });
    body.querySelectorAll('#sg-list [data-i]').forEach(row => {
      const i = parseInt(row.dataset.i, 10); const item = this._saved()[i]; if (!item) return;
      row.querySelector('[data-act="apply"]').addEventListener('click', () => { const d = this._decode(item.code); if (d && this._apply(d)) window.showToast?.('Applied “' + item.name + '”'); });
      row.querySelector('[data-act="copy"]').addEventListener('click', () => { try { navigator.clipboard.writeText(item.code); window.showToast?.('Code copied'); } catch {} });
      row.querySelector('[data-act="del"]').addEventListener('click', () => { const a = this._saved(); a.splice(i, 1); this._persist(a); this._paint(m); });
    });
  },
};

if (typeof window !== 'undefined') window.SetupGallery = SetupGallery;
