// === Private routing: all of Vex through one route ========================
//
// Vex could already send a container through Tor or a proxy (js/container-
// routing.js), which is the right shape for "this account goes through Tor"
// and the wrong shape for what people mean when they say VPN: send
// EVERYTHING through it, and tell me whether it is actually working.
//
// So this is the other half. One screen, three choices — direct, Tor, or a
// proxy you name — applied to every browsing session at once and put back
// after a restart. And a Check button that is the point of the whole thing:
// it asks what address the internet sees through the route, asks the same
// question again through a session with no route at all, and shows you both.
// A claim that traffic is routed is worth nothing; two addresses side by side
// are worth something.
//
// What this is NOT, said plainly in the screen itself: it is not a VPN
// service and Vex does not run one. It routes the browser. Anything outside
// Vex goes the way it always did.
const PrivateRouting = {
  _el: null,

  _esc(s) { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s); },

  async state() {
    if (!window.vex || typeof window.vex.routingGetAll !== 'function') return { mode: 'direct' };
    try { return (await window.vex.routingGetAll()) || { mode: 'direct' }; }
    catch { return { mode: 'direct' }; }
  },

  // Everything in Vex goes this way now. Returns what main said.
  async set(mode, custom) {
    if (!window.vex || typeof window.vex.routingSetAll !== 'function') throw new Error('Routing is not available in this build');
    if (mode === 'proxy' && !/^(socks5|socks4|http|https):\/\/[^\s]+$/i.test(String(custom || '').trim())) {
      throw new Error('A proxy address looks like socks5://127.0.0.1:1080 or http://host:port');
    }
    const r = await window.vex.routingSetAll(mode, mode === 'proxy' ? String(custom).trim() : null);
    if (!r || !r.ok) throw new Error((r && r.error) || 'That route could not be applied');
    this.mark(mode);
    return r;
  },

  // The toolbar says so while everything is routed — a route you forgot is on
  // is slow browsing with no explanation.
  mark(mode) {
    const btn = document.getElementById('btn-routing');
    if (!btn) return;
    const on = mode && mode !== 'direct';
    btn.hidden = !on;
    btn.title = on
      ? (mode === 'tor' ? 'Everything is going through Tor — click to change' : 'Everything is going through your proxy — click to change')
      : 'Private routing';
  },

  async init() {
    const st = await this.state();
    this.mark(st.mode);
    document.getElementById('btn-routing')?.addEventListener('click', () => this.open());
    return st;
  },

  // ---- The screen ---------------------------------------------------------

  async open() {
    if (typeof document === 'undefined') return null;
    this.close();
    const st = await this.state();
    const el = document.createElement('div');
    el.className = 'vexroute-backdrop';
    el.innerHTML = `
      <div class="vexroute" role="dialog" aria-modal="true" aria-label="Private routing">
        <div class="vexroute-head">
          <div style="flex:1">
            <h2>Private routing</h2>
            <p>Send everything Vex does through Tor or through a proxy of your own. This routes the browser — Vex is not a VPN service and does not run one, and anything outside Vex goes the way it always did.</p>
          </div>
          <button class="vexroute-close" aria-label="Close">&times;</button>
        </div>
        <div class="vexroute-body">
          <button class="vexroute-opt${st.mode === 'direct' ? ' on' : ''}" data-mode="direct">
            <span class="vexroute-name">Direct</span>
            <span class="vexroute-note">No proxy. The ordinary way, and the fastest.</span>
          </button>
          <button class="vexroute-opt${st.mode === 'tor' ? ' on' : ''}" data-mode="tor">
            <span class="vexroute-name">Through Tor</span>
            <span class="vexroute-note">Vex downloads and runs Tor itself. Slow by nature, and the strongest thing here: the sites you visit see an exit node, not you.</span>
          </button>
          <div class="vexroute-opt vexroute-proxy${st.mode === 'proxy' ? ' on' : ''}">
            <span class="vexroute-name">Through a proxy you name</span>
            <span class="vexroute-note">Your own SOCKS5 or HTTP proxy — a VPN provider's, a server of yours, anything that speaks either.</span>
            <div class="vexroute-row">
              <input id="vexroute-proxy" type="text" spellcheck="false" placeholder="socks5://127.0.0.1:1080" value="${this._esc(st.mode === 'proxy' ? (st.custom || '') : '')}">
              <button data-mode="proxy" class="vexroute-go">Use it</button>
            </div>
          </div>
        </div>
        <div class="vexroute-check">
          <button id="vexroute-test">Check it</button>
          <span id="vexroute-result">Asks what address the internet sees, through the route and without it, and shows you both.</span>
        </div>
      </div>`;
    document.body.appendChild(el);
    this._el = el;
    el.querySelector('.vexroute-close').addEventListener('click', () => this.close());
    el.addEventListener('mousedown', (e) => { if (e.target === el) this.close(); });
    this._onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } };
    window.addEventListener('keydown', this._onKey, true);
    el.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', async () => {
      const mode = b.dataset.mode;
      const custom = el.querySelector('#vexroute-proxy')?.value;
      const said = el.querySelector('#vexroute-result');
      said.textContent = mode === 'tor' ? 'Starting Tor — this takes a few seconds…' : 'Applying…';
      try {
        await this.set(mode, custom);
        el.querySelectorAll('.vexroute-opt').forEach(o => o.classList.remove('on'));
        (mode === 'proxy' ? el.querySelector('.vexroute-proxy') : b).classList.add('on');
        said.textContent = mode === 'direct' ? 'Direct again.' : 'Applied. Check it to see whether it is really working.';
      } catch (err) { said.textContent = (err && err.message) || 'That did not work'; }
    }));
    el.querySelector('#vexroute-test').addEventListener('click', () => this.check());
    return el;
  },

  close() {
    if (this._onKey) { window.removeEventListener('keydown', this._onKey, true); this._onKey = null; }
    if (this._el) { this._el.remove(); this._el = null; }
  },

  // What the internet sees, through the route and without it.
  async check() {
    const said = this._el && this._el.querySelector('#vexroute-result');
    if (said) said.textContent = 'Asking…';
    if (!window.vex || typeof window.vex.routingCheck !== 'function') {
      if (said) said.textContent = 'This build cannot run the check.';
      return null;
    }
    let r;
    try { r = await window.vex.routingCheck(); }
    catch (err) { if (said) said.textContent = (err && err.message) || 'The check failed'; return null; }
    const st = await this.state();
    if (said) said.textContent = this.say(r, st.mode);
    return r;
  },

  // The result, in words. Deliberately says "the same address" rather than
  // "not working": a proxy in your own house is meant to show your own
  // address, and calling that a failure would be wrong.
  say(r, mode) {
    if (!r) return 'The check did not answer.';
    const took = r.ms != null ? ' (' + (r.ms >= 1000 ? (r.ms / 1000).toFixed(1) + ' s' : r.ms + ' ms') + ')' : '';
    // Nothing is routed, so there is no route to judge: say what the internet
    // sees and stop. Calling that "the route works" would be nonsense.
    if (!mode || mode === 'direct') {
      return r.ok
        ? 'Nothing is routed at the moment: the internet sees ' + r.ip + took + '. Pick Tor or a proxy above, then check again.'
        : 'Could not reach the internet to ask' + (r.error ? ' — ' + r.error : '') + '.';
    }
    if (!r.ok) return 'Nothing came back through the route' + (r.error ? ' — ' + r.error : '') + '. That usually means the proxy refused the connection, or Tor has not finished starting.';
    if (!r.directIp) return 'Through the route the internet sees ' + r.ip + took + '. Nothing came back on the unrouted comparison, so there is nothing to compare it with.';
    if (r.changed) return 'Working: through the route the internet sees ' + r.ip + ', and without it ' + r.directIp + took + '.';
    return 'Traffic is going through it — both come back as ' + r.ip + took + '. A proxy on your own machine or network comes out at the same address, so that is expected there; from a proxy elsewhere it would mean it is not hiding anything.';
  },
};

if (typeof window !== 'undefined') window.PrivateRouting = PrivateRouting;
if (typeof module !== 'undefined' && module.exports) module.exports = { PrivateRouting };
