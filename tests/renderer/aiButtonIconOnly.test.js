// @vitest-environment jsdom
// The toolbar's AI button is an icon like the buttons beside it, with its name in the tooltip and for screen readers (it showed the icon AND the word "AI").
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');
const btn = doc.getElementById('btn-toggle-ai');

describe('the AI button', () => {
  it('has its icon and no visible word', () => {
    expect(btn).toBeTruthy();
    expect(btn.querySelector('svg')).toBeTruthy();
    expect(btn.textContent.trim()).toBe('');
    expect(btn.querySelector('span')).toBeNull();
  });
  it('is still named, for the tooltip and for a screen reader', () => {
    expect(btn.getAttribute('title')).toMatch(/AI Panel/);
    expect(btn.getAttribute('aria-label')).toBe('AI panel');
  });
});
