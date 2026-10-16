// === The Central Bank of Turkey's daily rates, fetched only when you ask ======
//
// "TL equivalent" (js/tl-equivalent.js) shows what a USD or EUR price is in
// lira. The rate comes from the bank's own daily table:
//
//   https://www.tcmb.gov.tr/kurlar/today.xml
//
// One fixed address, one GET, no credentials, nothing about you in it. It runs
// only when you press "Fetch today's rates"; nothing here is on a timer. The
// answer is parsed here and handed back as plain numbers with the bank's date,
// so the window never sees (or renders) the XML.
//
// createFxRates({ fetch }) so tests can pass a local stand-in.

const TCMB_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';
const MAX_BYTES = 256 * 1024;
const WANTED = ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'SAR', 'AED'];

// The bank's table -> { date: 'YYYY-MM-DD', rates: { USD: { buying, selling, unit } ... } }
// Throws saying what is wrong with the table rather than returning a partial one.
function parseTcmb(xml) {
  const text = String(xml == null ? '' : xml);
  const head = /<Tarih_Date\b[^>]*\bTarih="(\d{2})\.(\d{2})\.(\d{4})"/.exec(text);
  if (!head) throw new Error('The bank\'s table has no date, so the rates were not used');
  const date = head[3] + '-' + head[2] + '-' + head[1];
  const rates = {};
  const re = /<Currency\b[^>]*\bKod="([A-Z]{3})"[^>]*>([\s\S]*?)<\/Currency>/g;
  let m;
  while ((m = re.exec(text))) {
    const code = m[1];
    if (!WANTED.includes(code)) continue;
    const num = (tag) => {
      const t = new RegExp('<' + tag + '>\\s*([0-9]+(?:\\.[0-9]+)?)\\s*</' + tag + '>').exec(m[2]);
      return t ? Number(t[1]) : NaN;
    };
    const unit = num('Unit') || 1;
    const buying = num('ForexBuying');
    const selling = num('ForexSelling');
    if (!(selling > 0) || !(buying > 0)) continue;
    rates[code] = { buying: buying / unit, selling: selling / unit };
  }
  if (!rates.USD || !rates.EUR) throw new Error('The bank\'s table did not hold the dollar and the euro, so the rates were not used');
  return { date, rates };
}

function createFxRates({ fetch } = {}) {
  if (typeof fetch !== 'function') throw new Error('createFxRates needs a fetch');
  async function tcmb() {
    const res = await fetch(TCMB_URL, { headers: { Accept: 'application/xml, text/xml' }, redirect: 'error', credentials: 'omit', timeoutMs: 15000, maxBytes: MAX_BYTES, egress: { feature: 'TL equivalent', kind: 'fetch' } });
    if (!res.ok) throw new Error('The bank answered ' + res.status);
    const parsed = parseTcmb(await res.text());
    return { ...parsed, source: 'TCMB', fetchedAt: Date.now() };
  }
  return { tcmb };
}

module.exports = { createFxRates, parseTcmb, TCMB_URL };
