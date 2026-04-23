// === Gmail HTML sanitizer (main process) ===
// Preload runs in Electron's sandboxed context and cannot require npm modules,
// so DOMPurify + jsdom live in the main process and sanitized HTML is handed
// to the renderer via the `gmail:get-message` IPC response.

const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

// Pinned to jsdom@^22.0.0: the last major that ships pure-CJS transitives.
// jsdom@26+ pulls html-encoding-sniffer@4+ which pulls an ESM-only
// encoding-lite, and happy-dom@20 is itself ESM-only — both crash Electron's
// CJS main process with ERR_REQUIRE_ESM. jsdom@22 stays on html-encoding-
// sniffer@3.x so require() resolves cleanly.
const { window } = new JSDOM('');
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
