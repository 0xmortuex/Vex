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
