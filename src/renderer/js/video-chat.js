// === Chatting with a YouTube video ==========================================
//
// On a video page the AI used to read the page around the player — the title,
// the comments, the recommendations — and nothing that was said in the video.
// Now, on YouTube, it reads the captions instead, with a [m:ss] stamp every
// couple of minutes (AgentTools.youtubeTranscript), and is asked to cite
// moments that way. Every [m:ss] in its answer becomes a button that jumps
// the video in the tab to that moment.
const VideoChat = {
  STAMP: /\[((?:\d{1,2}:)?\d{1,2}:\d{2})\]/g,

  isVideo(url) { return !!AgentTools.youtubeId(url); },

  seconds(stamp) {
    return String(stamp).split(':').map(Number).reduce((total, n) => total * 60 + n, 0);
  },

  // The page context the AI gets, with the transcript in place of the page.
  // A video with no captions keeps the page text, and says so to the AI.
  async contextFor(pageContext) {
    if (!pageContext || !this.isVideo(pageContext.url)) return pageContext;
    try {
      const t = await AgentTools.youtubeTranscript(pageContext.url);
      return {
        ...pageContext,
        text: 'Transcript of this video, with [m:ss] timestamps. When you mention a moment, give its timestamp in the same [m:ss] form.\n\n' + t.text,
        wordCount: t.text.split(/\s+/).length,
      };
    } catch (err) {
      return { ...pageContext, text: '(No transcript: ' + err.message + ')\n\n' + (pageContext.text || '') };
    }
  },

  // Stamps in rendered HTML → buttons. Only on a video page, so "[3:15]" in
  // an answer about anything else stays text.
  linkify(html, url) {
    if (!this.isVideo(url)) return html;
    return String(html).replace(this.STAMP, (all, stamp) => `<button type="button" class="ai-stamp" data-t="${this.seconds(stamp)}" title="Jump the video to ${stamp}">${stamp}</button>`);
  },

  async seek(seconds) {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) throw new Error('No page is open');
    const found = await window.vexGuestEval(wv, `(() => { const v = document.querySelector('video'); if (!v) return false; v.currentTime = ${Number(seconds)}; v.play().catch(() => {}); return true; })()`);
    if (!found) throw new Error('There is no video on this page');
    return true;
  },
};

if (typeof window !== 'undefined') window.VideoChat = VideoChat;
if (typeof module !== 'undefined' && module.exports) module.exports = { VideoChat };
