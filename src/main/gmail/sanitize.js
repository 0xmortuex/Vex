// === Gmail HTML sanitizer (main process) ===
// Preload runs in Electron's sandboxed context and cannot require npm modules,
// so DOMPurify + jsdom live in the main process and sanitized HTML is handed
// to the renderer via the `gmail:get-message` IPC response.

const createDOMPurify = require('dompurify');
const { Window } = require('happy-dom');

// happy-dom is pure-CJS (no ESM transitive deps) and noticeably lighter than
// jsdom. jsdom pulled in html-encoding-sniffer → encoding-lite, which went
// ESM-only in a recent release and crashed Electron's main process with
// ERR_REQUIRE_ESM. DOMPurify officially supports both backends.
const window = new Window();
const DOMPurify = createDOMPurify(window);

function preStripBlocks(html) {
  if (!html) return '';
  return String(html)
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '');
}

function sanitize(html) {
  if (!html) return '';
  const cleaned = preStripBlocks(html);
  const result = DOMPurify.sanitize(cleaned, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data|cid):)/i,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta'],
    FORBID_ATTR: [
      'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout',
      'onfocus', 'onblur', 'onsubmit', 'onreset', 'onchange',
      'onkeydown', 'onkeyup', 'onkeypress',
    ],
    ADD_ATTR: ['target'],
  });
  console.log('[Vex] Gmail sanitize input length:', html?.length, 'output length:', result?.length);
  return result;
}

module.exports = { sanitize };
