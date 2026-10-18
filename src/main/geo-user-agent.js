// === Telling OpenStreetMap who is asking ======================================
//
// A postcode in the weather picker is looked up at nominatim.openstreetmap.org (js/geo-search.js). Its usage policy
// asks for a User-Agent that identifies the application, with a way to reach its makers. Electron's default one names
// the app only as "vex/<version>" inside a Chrome string. This sets the same line the polite fetch uses
// ("Vex/<version> (+https://github.com/0xmortuex/Vex)") on THAT request only: the search endpoint of that one host, as
// a fetch/XHR, made by one of Vex's own pages (the page that asked is a file: page). A website the person opens on that
// host, or a request from any other page, is left exactly as it was.
const HOST = 'nominatim.openstreetmap.org';

// `pageUrl`: the address of the page that made the request (main.js _pageUrlOf(details.webContentsId)).
function isVexGeoRequest(details, pageUrl) {
  if (!details || typeof details.url !== 'string') return false;
  let u;
  try { u = new URL(details.url); } catch { return false; }
  if (u.protocol !== 'https:' || u.hostname !== HOST || u.pathname !== '/search') return false;
  if (details.resourceType !== 'xhr') return false;
  return typeof pageUrl === 'string' && pageUrl.toLowerCase().startsWith('file:');
}

// Mutates `headers`; returns true when it set the User-Agent.
function applyGeoUserAgent(headers, details, userAgent, pageUrl) {
  if (typeof userAgent !== 'string' || !userAgent.trim()) throw new Error('applyGeoUserAgent needs a User-Agent that says who is asking');
  if (!isVexGeoRequest(details, pageUrl)) return false;
  for (const k of Object.keys(headers)) if (k.toLowerCase() === 'user-agent') delete headers[k];
  headers['User-Agent'] = userAgent;
  return true;
}

module.exports = { HOST, isVexGeoRequest, applyGeoUserAgent };
