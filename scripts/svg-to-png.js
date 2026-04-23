// Rasterize assets/icon.svg -> assets/icon-source.png (1024x1024) so that
// electron-icon-builder (which uses Jimp, and Jimp can't read SVG) has a
// raster source to work from. Runs as the first step of `npm run build-icons`.

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const svgPath = path.join(__dirname, '..', 'assets', 'icon.svg');
const pngPath = path.join(__dirname, '..', 'assets', 'icon-source.png');

if (!fs.existsSync(svgPath)) {
  console.error(`[svg-to-png] source not found: ${svgPath}`);
  process.exit(1);
}

sharp(svgPath, { density: 384 })
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(pngPath)
  .then(() => {
    console.log(`[svg-to-png] wrote ${pngPath} (1024x1024)`);
  })
  .catch((err) => {
    console.error('[svg-to-png] failed:', err);
    process.exit(1);
  });
