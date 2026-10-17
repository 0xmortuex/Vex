// === Capture tools: start-up and one Settings section (Wave 2) ==================
//
// Text snippets (js/text-snippets.js, its own Settings section), table and list
// extraction (js/table-extract.js), video transcript / chapters / loop
// (js/video-tools.js), the newsletter lane (js/newsletter-lane.js), resurfaced
// highlights (js/highlight-resurface.js), unfinished-form rescue (js/form-rescue.js)
// and picture redaction (js/redact-tool.js) each own their logic. This file only starts
// them, one at a time so one failing never stops the others, and gives the five
// without a section of their own one place in Settings.
const CaptureTools = {
  MODULES: [
    ['Text snippets', 'VexSnippets'],
    ['Newsletter lane', 'NewsletterLane'],
    ['Resurfaced highlights', 'HighlightResurface'],
    ['Unfinished-form rescue', 'FormRescue'],
  ],

  start() {
    for (const [label, name] of this.MODULES) {
      try { const m = window[name]; if (m && typeof m.start === 'function') m.start(); }
      catch (err) { console.error('[CaptureTools] ' + label + ' could not start:', err); window.VexProblems?.note('Capture tools', label + ' could not start', err); }
    }
    try { this.registerSettings(); }
    catch (err) { console.error('[CaptureTools] settings section failed:', err); window.VexProblems?.note('Capture tools', 'The Settings section could not be added', err); }
  },

  // [label, hint, module name, extra]
  rows() {
    return [
      ['Copy tables and lists from a page', 'Right-click a page, "Copy a table or list from this page…". CSV, Markdown or tabs; local, no AI.', 'TableExtract', null],
      ['Video transcript, chapters and loop', 'Right-click a page with a video. Captions the page already has only; nothing is downloaded.', 'VideoTools', null],
      ['Newsletter lane', 'Gathers newsletters from your Mail accounts (read-only). Unsubscribe only opens the sender’s page.', 'NewsletterLane', { label: 'Also check once a week and tell me in the Attention Inbox', get: (m) => m.weekly(), set: (m, v) => m.setWeekly(v) }],
      ['Bring back old highlights and notes', 'Highlights return after 1, 3, 7 and 21 days; a note from last week returns once. Through the Attention Inbox, never a pop-up.', 'HighlightResurface', null],
      ['Redact pictures', 'A "Redact" button on screenshots: OCR suggests what to cover, you decide. Metadata is stripped.', 'VexPictureRedact', null],
    ];
  },

  registerSettings() {
    const G = window.VexSettingsGroups;
    if (!G || this._registered) return;
    this._registered = true;
    G.register({
      id: 'capture-tools', title: 'Capture tools', keywords: 'table csv video transcript chapters loop newsletter highlights remember redact blur screenshot metadata exif',
      render: (body) => {
        const check = (text, on, set) => {
          const label = document.createElement('label');
          label.style.cssText = 'display:block;margin:4px 0';
          const cb = document.createElement('input');
          cb.type = 'checkbox'; cb.checked = !!on;
          cb.addEventListener('change', () => { try { set(cb.checked); } catch (err) { cb.checked = !cb.checked; window.showToast?.(err.message, 'error'); } });
          label.append(cb, document.createTextNode(' ' + text));
          return label;
        };
        for (const [text, hint, name, extra] of this.rows()) {
          const m = window[name];
          if (!m) continue;
          body.append(check(text, m.enabled(), (v) => m.setEnabled(v)), G.note(hint));
          if (extra) body.append(check(extra.label, extra.get(m), (v) => extra.set(m, v)));
        }
        if (window.VexPictureRedact) body.append(G.button('Remove metadata from a picture file…', () => window.VexPictureRedact.pickAndStrip().catch(err => window.showToast?.(err.message, 'error'))));
      },
    });
  },
};

if (typeof window !== 'undefined') {
  window.CaptureTools = CaptureTools;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => CaptureTools.start());
    else CaptureTools.start();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { CaptureTools };
