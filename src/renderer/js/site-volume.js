// === The volume you keep a site at =========================================
//
// YouTube at 40%, Spotify at 80%, one noisy site at 10%: setting it per tab
// meant setting it again on every visit, because a page's volume belongs to
// its media elements and those are new each time. Vex remembers the figure
// per site and puts it back when the site opens, including on media the page
// adds later (a playlist's next track, a video that autoplays on scroll).

// Run a script in every frame of a guest page, when the main process offers
// it (page:eval-all-frames), else in the top frame only. A player embedded in
// an iframe was never reached by the page volume, Master Volume or Night mode,
// because webview.executeJavaScript runs in the top frame alone (found
// 2026-09-29). → { all, results: [{ ok, value } | { ok: false, error }] };
// `all` false means embedded frames were not reached, and callers must not
// claim they were. Shared by master-volume.js and night-audio.js.
async function vexGuestEvalFrames(wv, code, userGesture, timeoutMs) {
  if (window.vex && typeof window.vex.evalAllFrames === 'function') {
    // A tab closed in the meantime has no page left: getWebContentsId throws
    // "must be attached to the DOM" (found 2026-09-29).
    if (wv.isConnected === false) throw new Error('The tab was closed');
    const r = await window.vex.evalAllFrames(wv.getWebContentsId(), code, !!userGesture);
    if (!r || !r.ok) throw new Error((r && r.error) || 'The page did not answer');
    return { all: true, results: r.results };
  }
  return { all: false, results: [{ ok: true, value: await window.vexGuestEval(wv, code, userGesture, timeoutMs) }] };
}

// Call fn(webview) when an embedded frame of a page finishes loading after
// the page itself. The page volume, Master Volume and Night mode were run
// once, at load, so a player iframe the page added later never got them
// (found 2026-09-29). <webview> events do not bubble, but they do pass
// through the document on the way down, so one capturing listener hears every
// tab and panel. A page's ad and tracker frames land in bursts, so each
// webview is answered once the burst has settled.
function vexOnLateFrame(fn, settleMs = 400) {
  const timers = new WeakMap();
  document.addEventListener('did-frame-finish-load', (e) => {
    const wv = e.target;
    if (e.isMainFrame || !wv || wv.tagName !== 'WEBVIEW') return;
    clearTimeout(timers.get(wv));
    timers.set(wv, setTimeout(() => { timers.delete(wv); if (wv.isConnected !== false) fn(wv); }, settleMs));
  }, true);
}

const SiteVolume = {
  KEY: 'vex.siteVolume',

  all() { try { const o = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } },
  host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  get(url) { const v = this.all()[this.host(url)]; return Number.isFinite(v) ? v : null; },

  set(url, percent) {
    const host = this.host(url);
    if (!host) throw new Error('That is not a web page');
    const v = Math.min(100, Math.max(0, Math.round(Number(percent))));
    if (!Number.isFinite(v)) throw new Error('Give a number from 0 to 100');
    const all = this.all();
    if (v === 100) delete all[host]; else all[host] = v;     // 100% is "nothing to remember"
    localStorage.setItem(this.KEY, JSON.stringify(all));
    return v;
  },

  forget(host) { const all = this.all(); delete all[host]; localStorage.setItem(this.KEY, JSON.stringify(all)); },

  // Runs in the page: sets what is there now, and anything that starts later.
  // Master Volume below 100% turns every page down by its share
  // (master-volume.js), so the figure kept here is scaled by it, never raised:
  // the two used to overwrite each other (found 2026-09-29).
  script(percent) {
    return `(() => {
      window.__vexVolume = ${Number(percent) / 100};
      const want = () => window.__vexVolume * (window.__vexMV && typeof window.__vexMV.g === 'number' ? Math.min(1, window.__vexMV.g) : 1);
      const set = (m) => { try { m.volume = want(); m.dataset.vexVolAt = String(Date.now()); } catch (e) {} };
      const media = document.querySelectorAll('video,audio');
      media.forEach(set);
      if (!window.__vexVolumeWired) {
        window.__vexVolumeWired = true;
        for (const type of ['play', 'loadedmetadata', 'volumechange']) {
          document.addEventListener(type, (e) => {
            const m = e.target;
            if (!(m instanceof HTMLMediaElement)) return;
            if (type === 'volumechange') {
              // The page putting its own figure back, in the first seconds of
              // a track, is corrected. Anything later is you moving the site's
              // own slider, and that wins.
              if (Math.abs(m.volume - want()) < 0.01) return;
              if (!m.dataset.vexVolAt || Date.now() - Number(m.dataset.vexVolAt) > 5000) return;
            }
            set(m);
          }, true);
        }
      }
      return { media: media.length, frames: document.querySelectorAll('iframe,frame').length };
    })()`;
  },

  // Set it on one open page now, in every frame the main process can reach.
  // → { media, unreachedFrames }: how many players took it, and how many
  // embedded frames were not reached, so a caller does not claim them.
  async applyTo(wv, percent) {
    const r = await vexGuestEvalFrames(wv, this.script(percent));
    let media = 0, frames = 0;
    for (const f of r.results) if (f.ok && f.value) { media += f.value.media || 0; frames += f.value.frames || 0; }
    return { media, unreachedFrames: r.all ? r.results.filter(f => !f.ok).length : frames };
  },

  async apply(tabId, url) {
    const v = this.get(url);
    if (v == null) return false;
    const wv = WebviewManager.webviews.get(tabId);
    if (!wv) return false;
    try { await this.applyTo(wv, v); return true; }
    catch (err) { window.VexProblems?.note('Site volume', 'Could not set the volume on ' + this.host(url), err); return false; }
  },

  init() {
    document.addEventListener('vex:tab-navigated', (e) => this.apply(e.detail.tabId, e.detail.url));
    vexOnLateFrame((wv) => {
      let url = '';
      try { url = wv.getURL(); } catch { return; }       // closed while the frames settled
      const v = this.get(url);
      if (v == null) return;
      this.applyTo(wv, v).catch(err => window.VexProblems?.note('Site volume', 'Could not set the volume on ' + this.host(url), err));
    });
  },
};

if (typeof window !== 'undefined') { window.SiteVolume = SiteVolume; window.vexGuestEvalFrames = vexGuestEvalFrames; window.vexOnLateFrame = vexOnLateFrame; }
if (typeof module !== 'undefined' && module.exports) module.exports = { SiteVolume, vexGuestEvalFrames, vexOnLateFrame };
