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
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '');
  // NOTE: Do NOT strip <style> blocks — email HTML (especially marketing /
  // invoice templates) uses <style> for table widths, colors, layout. Killing
  // them produces "flat text" emails. DOMPurify keeps <style> tags by default
  // while still sanitizing their CSS contents (drops @import, expression(),
  // behavior, javascript: URLs, etc.), which is what we want here.
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
    // Wrap loose content (e.g. a fragment that starts with <style><table>…)
    // in <body> so <style> survives instead of being dropped as out-of-place.
    FORCE_BODY: true,
  });
  console.log('[Vex] Gmail sanitize input length:', html?.length, 'output length:', result?.length);
  return result;
}

module.exports = { sanitize };
