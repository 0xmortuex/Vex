// === Turning Wiktionary's answer into a few plain sentences ================
//
// Wiktionary's definition API answers per language, and each definition is
// wiki markup already turned into HTML: links, italics, usage labels, and the
// odd HTML comment left in by an editor. A word can also have twenty senses,
// most of them obsolete or dialectal, and the person who double-clicked it
// wants the first few.
//
// So: English only, tags off, comments out, entities back to characters, the
// empty ones dropped, and no more than a card's worth.
const MAX = 5;
const PER_PART = 2;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function plain(html) {
  return String(html == null ? '' : html)
    .replace(/<!--[\s\S]*?-->/g, '')                  // an editor's note is not a definition
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => (name.toLowerCase() in ENTITIES ? ENTITIES[name.toLowerCase()] : m))
    .replace(/\s+/g, ' ')
    .trim();
}

// data: what the API returns — { en: [ { partOfSpeech, definitions: [...] } ] }
function readDefinitions(data, lang = 'en') {
  const parts = (data && data[lang]) || [];
  const out = [];
  for (const part of Array.isArray(parts) ? parts : []) {
    let taken = 0;
    for (const d of (part && part.definitions) || []) {
      const def = plain(d && d.definition);
      if (!def) continue;                              // Wiktionary sends empty ones
      const example = plain((d && (d.examples || [])[0]) || ((d && (d.parsedExamples || [])[0]) || {}).example);
      out.push({ part: plain(part.partOfSpeech).toLowerCase(), def, example });
      if (++taken >= PER_PART || out.length >= MAX) break;
    }
    if (out.length >= MAX) break;
  }
  return out;
}

module.exports = { readDefinitions, plain };
