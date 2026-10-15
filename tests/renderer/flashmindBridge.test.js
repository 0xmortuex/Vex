// FlashMind bridge: the payloads FlashMind imports and the due-cards reading of
// its backup file. The shapes are the ones FlashMind's own source defines
// (js/parser.js, js/export.js, js/decks.js in github.com/0xmortuex/FlashMind);
// nothing here talks to FlashMind or to anything else.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const { FlashMindBridge: F, VexBriefFlashMind: Brief } = require('../../src/renderer/js/flashmind-bridge.js');

// FlashMind's CSV reader, as in its js/parser.js (parseDelimited + parseCSVCards),
// so the file Vex writes is checked against the reader that will take it.
function parseDelimited(text, delim) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim())) rows.push(row);
  return rows;
}
function flashmindParseCSVCards(text) {
  const body = String(text || '').replace(/^﻿/, '').replace(/^(?:#[^\r\n]*(?:\r?\n|$))+/, '');
  const delim = body.split('\n', 1)[0].includes('\t') ? '\t' : ',';
  let rows = parseDelimited(body, delim);
  if (/^(front|question|ön|soru)$/i.test((rows[0][0] || '').trim())) rows = rows.slice(1);
  const DIFF = ['easy', 'medium', 'hard'];
  return rows.filter(r => (r[0] || '').trim() && (r[1] || '').trim()).map((r, i) => ({
    id: i + 1, front: r[0].trim(), back: r[1].trim(),
    difficulty: DIFF.includes((r[2] || '').trim().toLowerCase()) ? r[2].trim().toLowerCase() : 'medium',
    category: (r[3] || '').trim() || 'Imported',
  }));
}
const looksLikeDeck = (o) => o && typeof o === 'object' && typeof o.title === 'string' && (Array.isArray(o.flashcards) || Array.isArray(o.quiz));

const NOTE = [
  '# Biology',
  '',
  'Intro text that is not a card.',
  '',
  '## Cells',
  '- **Mitochondria**: the powerhouse of the cell',
  '**Ribosome:** makes protein',
  'nucleus :: holds the DNA',
  '',
  'Q: What is osmosis?',
  'A: Movement of water',
  'across a membrane.',
  '',
  'Q: Unanswered question',
  '',
  '## Plants',
  '1. Chlorophyll :: green pigment',
  '- **Mitochondria**: a duplicate that must be dropped',
].join('\n');

describe('the address', () => {
  let store;
  beforeEach(() => {
    store = {};
    globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('defaults to the published page and accepts only web addresses', () => {
    expect(F.url()).toBe('https://0xmortuex.github.io/FlashMind/');
    expect(F.setUrl('http://localhost:4173/')).toBe('http://localhost:4173/');
    expect(F.url()).toBe('http://localhost:4173/');
    expect(() => F.setUrl('javascript:alert(1)')).toThrow(/http/);
    expect(() => F.setUrl('file:///c:/x')).toThrow(/http/);
    expect(() => F.setUrl('nonsense')).toThrow(/not a web address/);
    expect(F.setUrl('')).toBe(F.DEFAULT_URL);
  });
});

describe('cards', () => {
  it('finds the cards a note already contains, and invents none', () => {
    const cards = F.parseCards(NOTE);
    expect(cards.map(c => c.front)).toEqual(['Mitochondria', 'Ribosome', 'nucleus', 'What is osmosis?', 'Chlorophyll']);
    expect(cards[0].back).toBe('the powerhouse of the cell');
    expect(cards[1].back).toBe('makes protein');
    expect(cards[3].back).toBe('Movement of water across a membrane.');
    expect(cards[0].category).toBe('Cells');
    expect(cards[4].category).toBe('Plants');
    expect(F.parseCards('Just some prose. Nothing card shaped here.')).toEqual([]);
  });

  it('writes a CSV that FlashMind\'s own reader takes back, awkward characters included', () => {
    const cards = [
      { front: 'Say "hello"', back: 'line one\nline two, with a comma', difficulty: 'hard', category: 'Greetings' },
      { front: 'Plain', back: 'Answer' },
      { front: '', back: 'dropped' },
    ];
    const csv = F.cardsToCsv(cards);
    expect(csv.startsWith('front,back,difficulty,category\n')).toBe(true);
    const back = flashmindParseCSVCards(csv);
    expect(back).toHaveLength(2);
    expect(back[0]).toMatchObject({ front: 'Say "hello"', back: 'line one\nline two, with a comma', difficulty: 'hard', category: 'Greetings' });
    expect(back[1]).toMatchObject({ front: 'Plain', back: 'Answer', difficulty: 'medium', category: 'Vex' });
  });
});

describe('study set and text', () => {
  it('builds a deck FlashMind recognises, with key terms and sections', () => {
    const deck = F.deckJson({ title: 'Biology', body: NOTE, cards: F.parseCards(NOTE) });
    expect(looksLikeDeck(deck)).toBe(true);
    expect(deck.flashcards[0]).toMatchObject({ id: 1, front: 'Mitochondria', difficulty: 'medium' });
    expect(deck.quiz).toEqual([]);
    const cells = deck.notes.sections.find(s => s.title === 'Cells');
    expect(cells.keyTerms.map(k => k.term)).toContain('Mitochondria');
    expect(typeof deck.notes.summary).toBe('string');
    // Round trips as JSON: it is what is written to the file.
    expect(looksLikeDeck(JSON.parse(JSON.stringify(deck)))).toBe(true);
  });

  it('prepares text with its title and source, and shortens a huge one', () => {
    const text = F.studyText({ title: 'T', url: 'https://x.example/p', body: 'Body.' });
    expect(text).toBe('T\nSource: https://x.example/p\n\nBody.');
    const big = F.studyText({ title: 'T', body: 'word '.repeat(40000) });
    expect(big.length).toBeLessThanOrEqual(F.MAX_TEXT + 40);
    expect(big).toMatch(/Shortened to fit/);
  });

  it('offers the cards file only when the note has cards', () => {
    const withCards = F.payloads({ title: 'Biology', url: '', body: NOTE });
    expect(withCards.cards.count).toBe(5);
    expect(withCards.cards.ext).toBe('.csv');
    expect(withCards.deck.mime).toBe('application/json');
    const without = F.payloads({ title: 'Essay', url: 'https://x.example', body: 'Only prose here.' });
    expect(without.cards).toBeNull();
    expect(without.text.content).toMatch(/Only prose here/);
    expect(() => F.payloads({ title: 'x', body: '   ' })).toThrow(/nothing to send/);
  });

  it('puts clips together with the page each came from', () => {
    const body = F.clipsBody([{ text: 'first clip', title: 'Page A', host: 'a.example' }, { text: ' ', title: 'blank' }, { text: 'second clip', host: 'b.example' }]);
    expect(body).toBe('## Page A - a.example\n\nfirst clip\n\n## b.example\n\nsecond clip');
  });

  it('names the file', () => {
    expect(F.fileName('Biology: cells & more!', '.csv')).toBe('Biology_cells_more_flashmind.csv');
    expect(F.fileName('', '.json')).toBe('vex_flashmind.json');
  });
});

// A backup in the shape FlashMind's Export.backupAll writes.
const NOW = new Date(2026, 9, 16, 9, 0, 0).getTime();
const H = 3600 * 1000;
const backup = () => JSON.stringify({
  flashmindBackup: 1,
  exportedAt: new Date(NOW - 2 * 86400000).toISOString(),
  decks: {
    activeId: 'a1',
    deleted: {},
    decks: {
      a1: {
        id: 'a1', createdAt: 1, updatedAt: 2, originalText: 'SECRET SOURCE TEXT',
        data: { title: 'Biology', notes: { summary: 'SECRET NOTES' }, quiz: [], flashcards: [
          { id: 1, front: 'SECRET FRONT 1', back: 'b' }, { id: 2, front: 'f2', back: 'b' }, { id: 3, front: 'f3', back: 'b' }, { id: 4, front: 'f4', back: 'b' },
        ] },
        srs: {
          1: { stab: 3, diff: 5, reps: 2, lapses: 0, due: NOW - 5 * H, last: NOW - 80 * H },
          2: { stab: 3, diff: 5, reps: 2, lapses: 0, due: NOW + 6 * H, last: 1 },
          3: { stab: 9, diff: 5, reps: 4, lapses: 1, due: NOW + 40 * H, last: 1 },
        },
      },
      b2: {
        id: 'b2', createdAt: 1, updatedAt: 2, originalText: '',
        data: { title: 'History', notes: { summary: '' }, quiz: [], flashcards: [{ id: 'x', front: 'f', back: 'b' }] },
        srs: { x: { stab: 1, diff: 5, reps: 1, lapses: 0, due: NOW - 1000, last: 1 } },
      },
    },
  },
  stats: {},
});

describe('cards due today, from a backup file', () => {
  it('refuses a file that is not a FlashMind backup, and says what to do', () => {
    expect(() => F.parseBackup('not json')).toThrow(/not JSON/);
    expect(() => F.parseBackup('{"title":"a deck","flashcards":[]}')).toThrow(/not a FlashMind backup/);
    expect(() => F.parseBackup('{"flashmindBackup":1,"decks":{}}')).toThrow(/no decks/);
  });

  it('keeps only deck names and due times, never a card', () => {
    const data = F.dueData(F.parseBackup(backup()), NOW);
    const kept = JSON.stringify(data);
    expect(kept).not.toMatch(/SECRET/);
    expect(data.decks).toEqual([
      { title: 'Biology', cards: 4, dues: [NOW - 5 * H, NOW + 6 * H, NOW + 40 * H] },
      { title: 'History', cards: 1, dues: [NOW - 1000] },
    ]);
  });

  it('counts what is due now and what is due by the end of today, FlashMind\'s own rule', () => {
    const s = F.dueSummary(F.dueData(F.parseBackup(backup()), NOW), NOW);
    expect(s.dueNow).toBe(2);
    expect(s.dueToday).toBe(3);
    expect(s.cards).toBe(5);
    expect(s.decks[0]).toEqual({ title: 'Biology', due: 1, today: 2 });
    expect(s.ageDays).toBe(2);
    expect(s.stale).toBe(false);
    // Two days later the same file says more is due.
    const later = F.dueSummary(F.dueData(F.parseBackup(backup()), NOW), NOW + 2 * 86400000);
    expect(later.dueToday).toBe(4);
    expect(later.stale).toBe(false);
    const old = F.dueSummary(F.dueData(F.parseBackup(backup()), NOW), NOW + 9 * 86400000);
    expect(old.stale).toBe(true);
  });

  it('writes the brief lines, with a warning when the backup is old', () => {
    const data = F.dueData(F.parseBackup(backup()), NOW);
    const lines = F.briefLines(data, NOW);
    expect(lines[0].text).toBe('3 FlashMind cards due today');
    expect(lines[0].detail).toBe('Biology (2), History (1)');
    expect(lines).toHaveLength(1);
    const stale = F.briefLines(data, NOW + 9 * 86400000);
    expect(stale.at(-1).text).toMatch(/backup 11 days old/);
    const none = F.briefLines({ ...data, decks: [{ title: 'Calm', cards: 3, dues: [NOW + 5 * 86400000] }] }, NOW);
    expect(none[0].text).toBe('No FlashMind cards due today');
  });
});

describe('the brief module', () => {
  let store;
  beforeEach(() => {
    store = {};
    globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('is off until a backup has been chosen, then answers in the brief-extra shape', () => {
    expect(Brief.id).toBe('flashmind-due');
    expect(Brief.isEnabled()).toBe(false);
    expect(Brief.build()).toEqual({ lines: [] });
    const s = F.importDueText(backup(), NOW);
    expect(s.dueToday).toBe(3);
    expect(Brief.isEnabled()).toBe(true);
    const out = Brief.build();
    expect(out.lines.length).toBeGreaterThan(0);
    expect(typeof out.lines[0].text).toBe('string');
    expect(out.lines[0].actions[0].label).toBe('Open FlashMind');
    expect(typeof out.lines[0].actions[0].run).toBe('function');
    expect(localStorage.getItem(F.KEY_DUE)).not.toMatch(/SECRET/);
    F.forgetDue();
    expect(Brief.isEnabled()).toBe(false);
  });
});

describe('no network', () => {
  const FILES = ['flashmind-bridge.js', 'project-compiler.js', 'listen-reader.js'];
  const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/renderer/js', f), 'utf8');

  it('none of the three modules reaches for the network or FlashMind\'s worker', () => {
    for (const f of FILES) {
      const code = read(f).split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      expect(code, f).not.toMatch(/\bfetch\s*\(/);
      expect(code, f).not.toMatch(/XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts/);
      expect(code, f).not.toMatch(/flashmind-worker|workers\.dev/);
      expect(code, f).not.toMatch(/window\.vex\.|ipcRenderer/);
    }
  });

  it('the builders run with every network entry point throwing', () => {
    const boom = () => { throw new Error('network used'); };
    const saved = { fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest, WebSocket: globalThis.WebSocket };
    globalThis.fetch = boom; globalThis.XMLHttpRequest = boom; globalThis.WebSocket = boom;
    try {
      const p = F.payloads({ title: 'Biology', url: 'https://x.example', body: NOTE });
      expect(p.text.content.length).toBeGreaterThan(10);
      F.dueSummary(F.dueData(F.parseBackup(backup()), NOW), NOW);
      F.briefLines(F.dueData(F.parseBackup(backup()), NOW), NOW);
    } finally {
      Object.assign(globalThis, saved);
    }
  });
});
