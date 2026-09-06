// Windows ICO supports PNG payloads: use sharp for both rasterization and ICO.
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
async function buildIcons(output = path.resolve(__dirname, '../assets')) {
  const input = path.resolve(__dirname, '../assets/icon.svg');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map(size => sharp(input, { density: 384 }).resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const at = 6 + i * 16;
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(pngs[i].length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += pngs[i].length;
  });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'icon.ico'), Buffer.concat([header, ...pngs]));
  await sharp(input, { density: 384 }).resize(512, 512).png().toFile(path.join(output, 'icon.png'));
}
if (require.main === module) buildIcons(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { buildIcons };
