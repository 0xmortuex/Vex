// === Preload script for webviews — video detection for PiP ===
// This script is injected into webview content to detect video elements

(function () {
  'use strict';

  let videoCheckInterval = null;
  let lastVideoCount = 0;

  function checkForVideos() {
    const videos = document.querySelectorAll('video');
    const hasVideo = videos.length > 0;
    const playingVideo = Array.from(videos).find(v => !v.paused && !v.ended && v.readyState > 2);

    if (videos.length !== lastVideoCount) {
      lastVideoCount = videos.length;
      window.postMessage({
        type: 'vex-video-detected',
        hasVideo,
        hasPlayingVideo: !!playingVideo,
        videoCount: videos.length
      }, '*');
    }
  }

  // Check periodically
  videoCheckInterval = setInterval(checkForVideos, 2000);

  // Initial check after load
  if (document.readyState === 'complete') {
    checkForVideos();
  } else {
    window.addEventListener('load', checkForVideos);
  }

  // Listen for PiP request from parent
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'vex-request-pip') {
      const videos = document.querySelectorAll('video');
      const video = Array.from(videos).find(v => !v.paused) || videos[0];

      if (video && document.pictureInPictureEnabled) {
        video.requestPictureInPicture().catch(() => {
          // PiP not supported, signal fallback
          window.postMessage({ type: 'vex-pip-fallback' }, '*');
        });
      } else {
        // No PiP API support, signal fallback
        window.postMessage({ type: 'vex-pip-fallback' }, '*');
      }
    }
  });
})();
