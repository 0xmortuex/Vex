'use strict';
// === Reading a JSON store that may, one day, carry a schema version ==========
//
// permissions.json, site-rules.json, recall.json, downloaded-files.json, privacy.json, hid-grants.json,
// permission-hygiene.json and sidebar-config.json were written as the bare value (a flat map, a bare array) with no
// schema version. Changing their format is risky and nothing needs it today. What IS cheap is making the READERS
// tolerant now, so that a later release can write { v: 2, data: ... } without older files, or files written by
// the other side of a downgrade, being misread:
//
//   unwrap(parsed)     the stored value itself, whether it was written bare or inside { v, data }
//   versionOf(parsed)  the schema version: the envelope's v, or 0 for the bare shape written today
//   wrap(data, v)      the envelope, for a future writer. NOTHING writes it yet: no on-disk format changed.
//
// Only an object whose keys are exactly "v" (a whole number from 1) and "data" is an envelope. A bare store can never
// look like one: a permission key is "origin::permission", a site rule is keyed by host name, the others are arrays or
// carry several named fields.
function isEnvelope(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const keys = Object.keys(parsed);
  return keys.length === 2 && keys.includes('v') && keys.includes('data') && Number.isInteger(parsed.v) && parsed.v >= 1;
}

function unwrap(parsed) { return isEnvelope(parsed) ? parsed.data : parsed; }
function versionOf(parsed) { return isEnvelope(parsed) ? parsed.v : 0; }
function wrap(data, v) {
  if (!Number.isInteger(v) || v < 1) throw new Error('A schema version is a whole number from 1');
  return { v, data };
}

module.exports = { isEnvelope, unwrap, versionOf, wrap };
