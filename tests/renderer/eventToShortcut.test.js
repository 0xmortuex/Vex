import { describe, it, expect } from 'vitest';
import ShortcutsRegistry from '../../src/renderer/js/shortcuts-registry.js';

const { eventToShortcut } = ShortcutsRegistry;

// Tiny KeyboardEvent shape — only the fields eventToShortcut reads.
const ev = (overrides = {}) => ({
  key: 'A',
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...overrides,
});

describe('eventToShortcut', () => {
  describe('null guards', () => {
    it('returns null for null/undefined event', () => {
      expect(eventToShortcut(null)).toBeNull();
      expect(eventToShortcut(undefined)).toBeNull();
    });

    it('returns null when event has no key', () => {
      expect(eventToShortcut({})).toBeNull();
      expect(eventToShortcut({ ctrlKey: true })).toBeNull();
    });

    it('returns null for modifier-only events (Control/Alt/Shift/Meta)', () => {
      for (const k of ['Control', 'Alt', 'Shift', 'Meta']) {
        expect(eventToShortcut(ev({ key: k }))).toBeNull();
      }
    });
  });

  describe('plain keys', () => {
    it('uppercases single lowercase letters', () => {
      expect(eventToShortcut(ev({ key: 'a' }))).toBe('A');
      expect(eventToShortcut(ev({ key: 'z' }))).toBe('Z');
    });

    it('keeps already-uppercase single letters', () => {
      expect(eventToShortcut(ev({ key: 'A' }))).toBe('A');
    });

    it('preserves function keys verbatim', () => {
      expect(eventToShortcut(ev({ key: 'F11' }))).toBe('F11');
      expect(eventToShortcut(ev({ key: 'F1' }))).toBe('F1');
    });

    it('preserves multi-char named keys (Escape, Enter, Tab)', () => {
      expect(eventToShortcut(ev({ key: 'Escape' }))).toBe('Escape');
      expect(eventToShortcut(ev({ key: 'Enter' }))).toBe('Enter');
      expect(eventToShortcut(ev({ key: 'Tab' }))).toBe('Tab');
    });

    it('maps Space character to "Space"', () => {
      expect(eventToShortcut(ev({ key: ' ' }))).toBe('Space');
    });

    it('shortens arrow-key names (ArrowLeft/Right/Up/Down → Left/Right/Up/Down)', () => {
      expect(eventToShortcut(ev({ key: 'ArrowLeft' }))).toBe('Left');
      expect(eventToShortcut(ev({ key: 'ArrowRight' }))).toBe('Right');
      expect(eventToShortcut(ev({ key: 'ArrowUp' }))).toBe('Up');
      expect(eventToShortcut(ev({ key: 'ArrowDown' }))).toBe('Down');
    });
  });

  describe('modifier combinations', () => {
    it('Ctrl+T', () => {
      expect(eventToShortcut(ev({ key: 't', ctrlKey: true }))).toBe('Ctrl+T');
    });

    it('Alt+T', () => {
      expect(eventToShortcut(ev({ key: 't', altKey: true }))).toBe('Alt+T');
    });

    it('Shift+T', () => {
      expect(eventToShortcut(ev({ key: 't', shiftKey: true }))).toBe('Shift+T');
    });

    it('Ctrl+Shift+A — modifier order is Ctrl, Alt, Shift', () => {
      expect(eventToShortcut(
        ev({ key: 'a', ctrlKey: true, shiftKey: true })
      )).toBe('Ctrl+Shift+A');
    });

    it('Ctrl+Alt+Shift+A — full modifier stack in canonical order', () => {
      expect(eventToShortcut(
        ev({ key: 'a', ctrlKey: true, altKey: true, shiftKey: true })
      )).toBe('Ctrl+Alt+Shift+A');
    });

    it('Ctrl+Down — modifier with arrow shortname', () => {
      expect(eventToShortcut(
        ev({ key: 'ArrowDown', ctrlKey: true })
      )).toBe('Ctrl+Down');
    });

    it('Ctrl+F11 — modifier with function key', () => {
      expect(eventToShortcut(ev({ key: 'F11', ctrlKey: true }))).toBe('Ctrl+F11');
    });
  });

  describe('cross-platform meta key', () => {
    it('treats metaKey (Cmd on macOS) as Ctrl for cross-platform parity', () => {
      expect(eventToShortcut(ev({ key: 't', metaKey: true }))).toBe('Ctrl+T');
    });

    it('does not double-add Ctrl when both ctrlKey and metaKey are set', () => {
      expect(
        eventToShortcut(ev({ key: 't', ctrlKey: true, metaKey: true }))
      ).toBe('Ctrl+T');
    });
  });

  describe('round-trip with default-shortcut strings', () => {
    it('produces strings that match the registry default format (e.g. "Ctrl+K")', () => {
      const all = ShortcutsRegistry.getAllShortcuts ? null : null;
      // We just want to confirm the format matches what users see in defaults.
      expect(eventToShortcut(ev({ key: 'k', ctrlKey: true }))).toBe('Ctrl+K');
      expect(eventToShortcut(ev({ key: 'b', ctrlKey: true }))).toBe('Ctrl+B');
      expect(eventToShortcut(
        ev({ key: 'a', ctrlKey: true, shiftKey: true })
      )).toBe('Ctrl+Shift+A');
    });
  });
});
