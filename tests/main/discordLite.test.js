// Lighter Discord: the heavy, optional pictures are not fetched; the rest is.
import { describe, expect, it } from 'vitest';
const { isHeavyDiscordMedia } = require('../../src/main/discord-lite.js');

describe('what Lighter Discord leaves out', () => {
  it('animated emoji, avatars and stickers, posted GIFs, the GIF picker, link-preview pictures', () => {
    for (const u of [
      'https://cdn.discordapp.com/emojis/123.gif?size=48',
      'https://cdn.discordapp.com/avatars/1/a_abc.webp?size=80&animated=true',
      'https://media.discordapp.net/attachments/1/2/party.gif',
      'https://media.tenor.com/abc/tenor.gif',
      'https://media2.giphy.com/media/x/giphy.webp',
      'https://images-ext-1.discordapp.net/external/abc/https/example.com/pic.png',
    ]) expect(isHeavyDiscordMedia(u), u).toBe(true);
  });

  it('keeps what Discord needs: still avatars and emoji, posted pictures, its own code and API', () => {
    for (const u of [
      'https://cdn.discordapp.com/avatars/1/abc.webp?size=80',
      'https://cdn.discordapp.com/emojis/123.webp?size=48',
      'https://media.discordapp.net/attachments/1/2/photo.png?width=400',
      'https://discord.com/api/v9/users/@me',
      'https://discord.com/assets/app.js',
      'not a url',
    ]) expect(isHeavyDiscordMedia(u), u).toBe(false);
  });
});
