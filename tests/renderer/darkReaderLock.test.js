// Once Dark Reader worked in Vex (v2.33.2), it recoloured Vex's own New Tab
// page in its flat grey over Vex's theme (2026-09-28): the page is a local
// file and extensions may read local files. Dark Reader leaves alone a page
// that carries <meta name="darkreader-lock">, so every page of Vex's own does.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/renderer');

describe("Vex's own pages are not recoloured by Dark Reader", () => {
  it('every page carries the lock in its head', () => {
    const pages = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
    expect(pages).toContain('start.html');
    for (const f of pages) {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      const head = html.slice(0, html.indexOf('</head>'));
      expect(head, f).toMatch(/<meta name="darkreader-lock">/);
    }
  });
});
