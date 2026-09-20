// === "Is it me or the server?" =============================================
//
// The renderer half of src/main/latency.js: asks for the numbers and shows
// them as a list with a plain sentence at the top, because the sentence is
// what the question was.
const LatencyCheck = {
  // A number people can read, and a bar to see it with.
  row(r) {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const ms = Number.isFinite(r.ms) ? Math.round(r.ms) : null;
    const width = ms == null ? 0 : Math.min(100, Math.round((ms / 400) * 100));
    const colour = ms == null ? 'var(--text-muted)' : ms < 80 ? '#22c55e' : ms < 200 ? '#eab308' : '#ef4444';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name)}</div>
          <div style="height:4px;margin-top:4px;background:var(--surface);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${width}%;background:${colour}"></div>
          </div>
        </div>
        <div style="font-size:11.5px;color:${ms == null ? 'var(--text-muted)' : 'var(--text)'};min-width:74px;text-align:right">${ms == null ? 'no answer' : ms + ' ms'}</div>
      </div>`;
  },

  async open() {
    document.querySelector('.vex-latency-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'vex-latency-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.38);display:grid;place-items:start center;padding-top:11vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Connection check"
           style="width:min(580px,92vw);max-height:70vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1;font-size:13.5px;font-weight:650;color:var(--text)">Is it me or the server?</div>
          <button data-again type="button" style="font-size:11.5px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer">Check again</button>
        </div>
        <div data-verdict style="padding:10px 14px;font-size:12.5px;color:var(--text);border-bottom:1px solid var(--border)">Checking…</div>
        <div data-list style="overflow-y:auto;padding:6px"></div>
        <div style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">
          How long each host takes to accept a connection. Nothing is sent to them, and no account is involved.
        </div>
      </div>`;

    const listEl = overlay.querySelector('[data-list]');
    const verdictEl = overlay.querySelector('[data-verdict]');
    const draw = async () => {
      verdictEl.textContent = 'Checking…';
      listEl.innerHTML = '';
      const res = await window.vex.netLatency();
      if (!res || !res.ok) {
        verdictEl.textContent = (res && res.error) || 'The check could not run';
        return;
      }
      verdictEl.textContent = res.verdict;
      listEl.innerHTML = res.results
        .slice()
        .sort((a, b) => (b.baseline ? 1 : 0) - (a.baseline ? 1 : 0) || (a.ms == null ? 1e9 : a.ms) - (b.ms == null ? 1e9 : b.ms))
        .map(r => this.row(r)).join('');
      return res;
    };

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-again]').addEventListener('click', () => { draw(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    await draw();
    return overlay;
  },
};

if (typeof window !== 'undefined') window.LatencyCheck = LatencyCheck;
if (typeof module !== 'undefined' && module.exports) module.exports = { LatencyCheck };
