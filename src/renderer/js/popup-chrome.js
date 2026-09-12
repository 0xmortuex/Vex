document.querySelectorAll('[data-act]').forEach(button => button.addEventListener('click', () => window.popupChrome.action(button.dataset.act)));
window.popupChrome.onUrl(url => { const element = document.getElementById('url'); element.textContent = url; element.title = url; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.popupChrome.action('close'); });

// The bar follows the user's colours: main reads the resolved tokens off the
// main window (theme + GUI style) and sends them here, where they override the
// dark defaults in popup-chrome.html. Values land in CSS, so only plain colour
// syntax is accepted — anything else is ignored and the default stays.
window.popupChrome.onPalette(palette => {
  const VARS = { surface: '--surface', bg: '--bg', bg2: '--bg-2', border: '--border', text: '--text', textMuted: '--text-muted', primary: '--primary', danger: '--danger' };
  const safe = value => typeof value === 'string' && /^[#a-zA-Z0-9(),.%\s/-]{3,120}$/.test(value.trim()) ? value.trim() : '';
  for (const [key, cssVar] of Object.entries(VARS)) {
    const value = safe(palette[key]);
    if (value) document.documentElement.style.setProperty(cssVar, value);
  }
  const primary = safe(palette.primary);
  if (primary) document.documentElement.style.setProperty('--primary-hover', `color-mix(in srgb, ${primary} 82%, #000)`);
});
