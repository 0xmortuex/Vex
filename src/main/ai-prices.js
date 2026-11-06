// === Built-in price ESTIMATES for the models Vex knows a price for =============
//
// This is an ESTIMATE table, not a bill. The numbers are the providers' public
// list prices (US dollars per million tokens) as of PRICES_AS_OF, copied by hand
// from Anthropic's published model table. Prices change: when one is wrong, edit
// it in Settings > AI > "AI spend cap: money budget and prices" (a row there wins
// over this table), or update this file.
//
// A model with no row is NOT given a made-up price: priceFor() returns null and
// the interface says "cost unknown". Only models whose price is known for certain
// are listed; OpenAI, Gemini, OpenRouter and custom models are not listed on
// purpose, so their cost reads "unknown" until the person writes a price row.
const PRICES_AS_OF = '2026-10-06';
const PRICES_NOTE = 'Estimates from public list prices as of ' + PRICES_AS_OF + '. A price you write in Settings wins. Not a bill.';

// model id (exact, or the start of a dated id) -> price per million tokens.
const PRICES = Object.freeze([
  { model: 'claude-fable-5-1', inPerM: 10, outPerM: 50 },
  { model: 'claude-fable-5', inPerM: 10, outPerM: 50 },
  { model: 'claude-opus-5-5', inPerM: 4, outPerM: 20 },
  { model: 'claude-opus-5', inPerM: 5, outPerM: 25 },
  { model: 'claude-opus-4-8', inPerM: 5, outPerM: 25 },
  { model: 'claude-opus-4-7', inPerM: 5, outPerM: 25 },
  { model: 'claude-opus-4-6', inPerM: 5, outPerM: 25 },
  { model: 'claude-sonnet-5-5', inPerM: 2, outPerM: 10 },
  { model: 'claude-sonnet-5', inPerM: 2, outPerM: 10 },
  { model: 'claude-sonnet-4-6', inPerM: 3, outPerM: 15 },
  // Up to 100K tokens in a prompt; longer prompts cost more (0.50 in, 2.50 out).
  { model: 'claude-haiku-5-5', inPerM: 0.10, outPerM: 0.50 },
  { model: 'claude-haiku-4-5', inPerM: 1, outPerM: 5 },
]);

// -> { model, inPerM, outPerM, currency } or null (unknown: never guessed).
function priceFor(modelId) {
  let id = String(modelId == null ? '' : modelId).trim().toLowerCase();
  if (!id) return null;
  if (id.startsWith('anthropic/')) id = id.slice('anthropic/'.length);
  const exact = PRICES.find(r => r.model === id);
  if (exact) return { ...exact, currency: 'USD' };
  // A dated id (claude-haiku-4-5-20251001): the longest row it starts with, followed by a dash and a digit.
  const part = PRICES.filter(r => id.startsWith(r.model + '-') && /^\d{6,}$/.test(id.slice(r.model.length + 1))).sort((a, b) => b.model.length - a.model.length)[0];
  return part ? { ...part, currency: 'USD' } : null;
}

module.exports = { PRICES, PRICES_AS_OF, PRICES_NOTE, priceFor };
