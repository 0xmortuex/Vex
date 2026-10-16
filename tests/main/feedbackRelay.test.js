// src/main/feedback-relay.js: what a version review sends, and nothing else. Local stand-ins only.
import { describe, it, expect, vi } from 'vitest';

const { createFeedbackRelay, checkRelayUrl, buildPayload, validatePayload, ALLOWED_KEYS, CATEGORIES, CHIPS } = require('../../src/main/feedback-relay');

const ID = 'ab'.repeat(16);
const review = { version: '2.40.0', date: '2026-10-16T10:00:00.000Z', sent: 123, ratings: { speed: 5, ai: 1 }, chips: ['bug'], comment: 'hello there friend', history: ['https://secret.example'], note: 'x' };

describe('the payload', () => {
  it('has exactly the allowed fields and drops everything else from the stored review', () => {
    const p = buildPayload(review, ID);
    expect(Object.keys(p).sort()).toEqual(['chips', 'comment', 'installId', 'ratings', 'version']);
    expect(Object.keys(p).sort()).toEqual([...ALLOWED_KEYS].sort());
    expect(p).toEqual({ installId: ID, version: '2.40.0', ratings: { speed: 5, ai: 1 }, chips: ['bug'], comment: 'hello there friend' });
    expect(JSON.stringify(p)).not.toMatch(/secret|history|2026|sent/);
  });
  it('refuses extra fields, unknown categories and tags, bad ranges, long comments and empty reviews', () => {
    const base = buildPayload(review, ID);
    expect(() => validatePayload({ ...base, date: 'x' })).toThrow(/never sent/);
    expect(() => validatePayload({ ...base, ratings: { color: 3 } })).toThrow(/Unknown rating/);
    expect(() => validatePayload({ ...base, ratings: { speed: 9 } })).toThrow(/1 to 5/);
    expect(() => validatePayload({ ...base, chips: ['x'] })).toThrow(/Unknown tag/);
    expect(() => validatePayload({ ...base, comment: 'y'.repeat(501) })).toThrow(/longer/);
    expect(() => validatePayload({ ...base, installId: 'short' })).toThrow(/anonymous id/);
    expect(() => validatePayload({ ...base, ratings: {}, comment: 'tiny' })).toThrow(/empty/);
  });
  it('covers every category and tag the card offers', () => {
    const { VersionReview } = require('../../src/renderer/js/version-review.js');
    expect(VersionReview.CATEGORIES.map(c => c.id)).toEqual(CATEGORIES);
    expect(VersionReview.CHIPS.map(c => c.id)).toEqual(CHIPS);
  });
});

describe('the relay address', () => {
  it('is https only, without credentials, query or fragment, and not on this machine', () => {
    expect(checkRelayUrl('https://r.example.workers.dev/')).toBe('https://r.example.workers.dev');
    for (const bad of ['', 'http://r.example', 'https://u:p@r.example', 'https://r.example/?token=1', 'https://r.example/#x', 'https://localhost', 'https://192.168.1.5', 'nope'])
      expect(() => checkRelayUrl(bad), bad).toThrow();
  });
});

describe('send', () => {
  it('posts the validated payload once with an egress hint and no credentials', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const relay = createFeedbackRelay({ fetch });
    await relay.send('https://r.example/', buildPayload(review, ID));
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://r.example/v1/review');
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', egress: { feature: 'Version review', kind: 'fetch' } });
    expect(Object.keys(JSON.parse(init.body)).sort()).toEqual([...ALLOWED_KEYS].sort());
  });
  it('sends nothing for a bad address or a payload with extra fields, and raises relay errors', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'Too many' }), { status: 429 }));
    const relay = createFeedbackRelay({ fetch });
    await expect(relay.send('http://r.example', buildPayload(review, ID))).rejects.toThrow(/https/);
    await expect(relay.send('https://r.example', { ...buildPayload(review, ID), url: 'https://x' })).rejects.toThrow(/never sent/);
    expect(fetch).not.toHaveBeenCalled();
    await expect(relay.send('https://r.example', buildPayload(review, ID))).rejects.toThrow(/Too many/);
  });
});
