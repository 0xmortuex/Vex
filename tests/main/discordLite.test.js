// Lighter Discord: the animated versions of decorations are not fetched;
// anything someone posts or links always is.
import { describe, expect, it } from 'vitest';
const { isHeavyDiscordMedia, stillVersionOf } = require('../../src/main/discord-lite.js');

describe('what Lighter Discord leaves out', () => {
  it('animated emoji, avatars, stickers, server icons and banners', () => {
    for (const u of [
      'https://cdn.discordapp.com/emojis/123.gif?size=48',
      'https://cdn.discordapp.com/avatars/1/a_abc.webp?size=80&animated=true',
      'https://cdn.discordapp.com/guilds/5/users/6/avatars/a_x.gif',
      'https://media.discordapp.net/stickers/99.gif',
      'https://cdn.discordapp.com/icons/5/a_icon.gif?size=96',
      'https://cdn.discordapp.com/banners/5/a_b.webp?animated=true',
    ]) expect(isHeavyDiscordMedia(u), u).toBe(true);
  });

  it('never what someone posted or linked — it showed "Image failed to load" (reported 2026-09-20)', () => {
    for (const u of [
      'https://media.discordapp.net/attachments/1/2/party.gif',
      'https://cdn.discordapp.com/attachments/1/2/photo.png',
      'https://media.tenor.com/abc/tenor.gif',
      'https://media2.giphy.com/media/x/giphy.webp',
      'https://images-ext-1.discordapp.net/external/abc/https/example.com/pic.png',
      'https://media.discordapp.net/attachments/1/2/clip.webp?animated=true',
    ]) expect(isHeavyDiscordMedia(u), u).toBe(false);
  });

  it('keeps still decorations and Discord itself', () => {
    for (const u of [
      'https://cdn.discordapp.com/avatars/1/abc.webp?size=80',
      'https://cdn.discordapp.com/emojis/123.webp?size=48',
      'https://discord.com/api/v9/users/@me',
      'https://discord.com/assets/app.js',
      'not a url',
    ]) expect(isHeavyDiscordMedia(u), u).toBe(false);
  });
});

// It used to cancel the request and rely on Discord drawing its own still
// version. Where that did not happen the emoji was simply missing, which
// reads as Discord being broken — so the still picture is fetched instead.
describe('the still version it asks for instead', () => {
  it('turns an animated decoration into the same picture, not moving', () => {
    expect(stillVersionOf('https://cdn.discordapp.com/emojis/123.gif?size=48'))
      .toBe('https://cdn.discordapp.com/emojis/123.png?size=48');
    expect(stillVersionOf('https://cdn.discordapp.com/avatars/1/a_abc.webp?size=80&animated=true'))
      .toBe('https://cdn.discordapp.com/avatars/1/a_abc.webp?size=80');
    expect(stillVersionOf('https://media.discordapp.net/stickers/99.gif'))
      .toBe('https://media.discordapp.net/stickers/99.png');
  });

  it('leaves alone everything Lighter Discord leaves alone', () => {
    expect(stillVersionOf('https://media.discordapp.net/attachments/1/2/party.gif')).toBeNull();
    expect(stillVersionOf('https://cdn.discordapp.com/emojis/123.webp?size=48')).toBeNull();
    expect(stillVersionOf('not a url')).toBeNull();
  });
});
