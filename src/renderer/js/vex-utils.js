// Shared renderer utilities — escapeHtml + VexUI building blocks.
//
// escapeHtml was previously redefined as a private `_esc`/`escapeHtml` helper
// in ~15 panel modules; they now delegate here. VexUI.emptyState renders the
// unified panel empty state (SVG icon + title + optional hint) so panels stop
// shipping ad-hoc one-line placeholders.
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Small stroke-icon set matching the top-bar/sidebar SVG vocabulary
  // (24-viewbox, currentColor stroke, round caps).
  const I = (paths) =>
    `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  const ICONS = {
    inbox: I('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
    history: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
    search: I('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>'),
    note: I('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>'),
    download: I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
    bookmark: I('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
    bell: I('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
    moon: I('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
    sparkle: I('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>'),
    clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
    rss: I('<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>'),
    highlight: I('<path d="m9 11 6 6"/><path d="M12.5 6.5 4 15l-1 6 6-1 8.5-8.5a2.5 2.5 0 0 0 0-3.5l-1.5-1.5a2.5 2.5 0 0 0-3.5 0z"/>'),
  };

  const VexUI = {
    ICONS,

    // Unified panel empty state. Returns an HTML string.
    //   VexUI.emptyState('download', 'No downloads yet')
    //   VexUI.emptyState('history', 'No history found', 'Try a different filter')
    emptyState(icon, title, hint) {
      return `
        <div class="vex-empty">
          <div class="vex-empty-icon">${ICONS[icon] || ICONS.inbox}</div>
          <div class="vex-empty-title">${escapeHtml(title)}</div>
          ${hint ? `<div class="vex-empty-hint">${escapeHtml(hint)}</div>` : ''}
        </div>`;
    },
  };

  if (typeof window !== 'undefined') {
    window.escapeHtml = escapeHtml;
    window.VexUI = VexUI;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml, VexUI };
  }
})();
