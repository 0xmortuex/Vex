// === The volume you keep a site at =========================================
//
// YouTube at 40%, Spotify at 80%, one noisy site at 10%: setting it per tab
// meant setting it again on every visit, because a page's volume belongs to
// its media elements and those are new each time. Vex remembers the figure
// per site and puts it back when the site opens, including on media the page
// adds later (a playlist's next track, a video that autoplays on scroll).
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
  script(percent) {
    return `(() => {
      window.__vexVolume = ${Number(percent) / 100};
      const set = (m) => { try { m.volume = window.__vexVolume; m.dataset.vexVolAt = String(Date.now()); } catch (e) {} };
      document.querySelectorAll('video,audio').forEach(set);
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
              if (Math.abs(m.volume - window.__vexVolume) < 0.01) return;
              if (!m.dataset.vexVolAt || Date.now() - Number(m.dataset.vexVolAt) > 5000) return;
            }
            set(m);
          }, true);
        }
      }
      return true;
    })()`;
  },

  async apply(tabId, url) {
    const v = this.get(url);
    if (v == null) return false;
    const wv = WebviewManager.webviews.get(tabId);
    if (!wv) return false;
    try { await window.vexGuestEval(wv, this.script(v)); return true; }
    catch (err) { window.VexProblems?.note('Site volume', 'Could not set the volume on ' + this.host(url), err); return false; }
  },

  init() {
    document.addEventListener('vex:tab-navigated', (e) => this.apply(e.detail.tabId, e.detail.url));
  },
};

if (typeof window !== 'undefined') window.SiteVolume = SiteVolume;
if (typeof module !== 'undefined' && module.exports) module.exports = { SiteVolume };
