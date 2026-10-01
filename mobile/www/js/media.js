// === Vex Mobile — video and audio ===
//
// Samsung Internet's "video assistant" is three things: the video keeps
// playing in a small window when you leave the page, sound keeps going when
// you leave the app, and the picture can be brightened past what the site
// allows. All three are here, plus a mute for the tab that starts playing
// something you did not ask for.

const VexMedia = (() => {
  /**
   * Which video on the page the bar is about. One definition, used by both the
   * probe and the controls — they used to disagree, so on a news page full of
   * clips the bar could show one video's state and pause another.
   *
   * Playing beats paused; between two in the same state, the bigger one wins.
   * The width comparison is deliberately inside the same-state branch: a wide
   * paused clip further down the page used to outrank the one actually playing,
   * which made the bar report "nothing is playing" while something was.
   */
  const PICK = `(function(){
    var best = null;
    var videos = document.querySelectorAll('video');
    for (var i = 0; i < videos.length; i++) {
      var video = videos[i];
      if (video.readyState < 2) continue;
      if (!best) { best = video; continue; }
      if (!video.paused && best.paused) { best = video; continue; }
      if (video.paused === best.paused && video.clientWidth > best.clientWidth) best = video;
    }
    return best;
  })()`;

  // Runs in the page. Returns what is playing, so the chrome knows whether to
  // offer the pop-up window at all.
  const PROBE = `(function(){
  var best = ${PICK};
  if (!best) return JSON.stringify({ playing: false });
  return JSON.stringify({
    playing: !best.paused,
    width: best.videoWidth || best.clientWidth || 16,
    height: best.videoHeight || best.clientHeight || 9,
    duration: Math.round(best.duration || 0),
    current: Math.round(best.currentTime || 0),
    muted: !!best.muted
  });
})()`;

  const control = action => `(function(){
  var target = ${PICK};
  if (!target) return 'none';
  ${action}
  return 'ok';
})()`;

  // Runs in the page. Where the video in front comes from: the element's own
  // address and every <source> under it, plus the page title to name the file.
  // Any video will do here — one that has not started has a source too — but
  // the one the bar is about comes first.
  const SOURCES = `(function(){
  var target = ${PICK} || document.querySelector('video');
  if (!target) return JSON.stringify({ found: false, title: document.title || '' });
  var sources = [];
  var nodes = target.querySelectorAll('source');
  for (var i = 0; i < nodes.length; i++) if (nodes[i].src) sources.push(nodes[i].src);
  return JSON.stringify({
    found: true,
    src: target.currentSrc || target.src || '',
    sources: sources,
    title: document.title || ''
  });
})()`;

  const PLAYLIST = /\.m3u8(?:[?#]|$)/i;
  const MANIFEST = /\.mpd(?:[?#]|$)/i;
  const FILE_TYPE = /\.(mp4|m4v|webm|mov|mkv|3gp|ogv)(?:[?#]|$)/i;

  /** A file name from the page title: no path characters, not too long. */
  function nameFor(title) {
    const clean = String(title || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    return (clean.slice(0, 80).trim() || 'video');
  }

  function parse(result) {
    if (result == null) return null;
    let value = result;
    for (let attempt = 0; attempt < 2 && typeof value === 'string'; attempt++) {
      try { value = JSON.parse(value); } catch { return null; }
    }
    return value && typeof value === 'object' ? value : null;
  }

  return {
    async state(tabId) {
      try {
        const { result } = await VexBridge.evaluate(tabId, PROBE);
        return parse(result) || { playing: false };
      } catch { return { playing: false }; }
    },

    play(tabId) { return VexBridge.evaluate(tabId, control('target.play();')); },
    pause(tabId) { return VexBridge.evaluate(tabId, control('target.pause();')); },
    mute(tabId, muted) { return VexBridge.evaluate(tabId, control('target.muted = ' + (muted ? 'true' : 'false') + ';')); },
    seek(tabId, seconds) { return VexBridge.evaluate(tabId, control('target.currentTime += ' + Number(seconds) + ';')); },
    speed(tabId, rate) { return VexBridge.evaluate(tabId, control('target.playbackRate = ' + Number(rate) + ';')); },

    // The site's own player often caps how bright a dark scene can get; a CSS
    // filter on the element does not care.
    brightness(tabId, value) {
      const amount = Math.max(0.5, Math.min(2.5, Number(value) || 1));
      return VexBridge.evaluate(tabId, control("target.style.filter = 'brightness(" + amount + ")';"));
    },

    /** The floating window. Android's picture-in-picture, sized to the video. */
    async popOut(tabId) {
      const video = await this.state(tabId);
      if (!video.playing) throw new Error('Nothing is playing on this page');
      await VexBridge.enterPictureInPicture(video.width || 16, video.height || 9);
      return true;
    },

    /**
     * Where the video on this page can be saved from.
     *
     * { kind: 'file', url } — the element plays an ordinary file, which the
     *   download queue can fetch like any other.
     * { kind: 'stream', url } — an HLS playlist, from the element or, for a
     *   player that hands its <video> a blob: URL, from the page's requests.
     * { kind: 'none', why } — nothing Vex can put back together, said plainly.
     */
    async findSource(tab) {
      let info = null;
      try { info = parse((await VexBridge.evaluate(tab.id, SOURCES)).result); } catch { info = null; }
      const title = (info && info.title) || tab.title || '';
      const candidates = info && info.found ? [info.src].concat(info.sources || []).filter(Boolean) : [];
      const web = candidates.filter(url => /^https?:/i.test(url));
      const playlist = web.find(url => PLAYLIST.test(url));
      const direct = web.find(url => !PLAYLIST.test(url) && !MANIFEST.test(url));
      if (direct) return { kind: 'file', url: direct, title };
      if (playlist) return { kind: 'stream', url: playlist, title };
      let seen = '';
      try { seen = await VexBridge.mediaStream(tab.id); } catch { seen = ''; }
      if (seen) return { kind: 'stream', url: seen, title };
      if (!info || !info.found) return { kind: 'none', title, why: 'There is no video on this page' };
      if (web.some(url => MANIFEST.test(url))) {
        return { kind: 'none', title, why: 'This site streams in DASH, with the picture and the sound apart — Vex cannot join them yet' };
      }
      return {
        kind: 'none', title,
        why: 'This video is assembled by the site’s own player from pieces nobody else is given — YouTube and Netflix work this way — so there is no file to save'
      };
    },

    /** "Download this video", from the video bar's sheet. */
    async download(tab) {
      if (!tab || !tab.url || tab.url === 'about:blank') { VexUI.toast('Open a page first'); return null; }
      const found = await this.findSource(tab);
      const name = nameFor(found.title);
      if (found.kind === 'file') {
        const match = found.url.match(FILE_TYPE);
        return VexDownloads.queue(tab, found.url, name + '.' + (match ? match[1].toLowerCase() : 'mp4'));
      }
      if (found.kind === 'stream') return VexDownloads.stream(tab, found.url, name);
      VexUI.toast(found.why, 6000);
      return null;
    },

    nameFor,

    async setBackgroundAudio(enabled) {
      await VexStore.set('vex.backgroundAudio', !!enabled);
      await VexBridge.setBackgroundAudio(!!enabled);
    },

    backgroundAudio() { return VexStore.get('vex.backgroundAudio', false) === true; },

    async setKeepAwake(enabled) {
      await VexStore.set('vex.keepAwake', !!enabled);
      await VexBridge.setKeepAwake(!!enabled);
    }
  };
})();

if (typeof window !== 'undefined') window.VexMedia = VexMedia;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMedia };
