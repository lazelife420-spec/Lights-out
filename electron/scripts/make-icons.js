// Renders the refined Lights Out brand SVGs (assets/brand/*) into multi-resolution
// PNGs and a Windows .ico. Run with: node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');
const brand = path.join(assets, 'brand');
const iconSvg = path.join(brand, 'lights-out-icon.svg');
const iconSmallSvg = path.join(brand, 'lights-out-icon-small.svg');
const logoSvg = path.join(brand, 'lights-out-icon.svg');
const wordmarkSvg = path.join(brand, 'lights-out-wordmark-transparent.svg');
const traySvg = path.join(brand, 'lights-out-tray.svg');

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
// Sizes at or below this threshold use the simplified small icon (badge + bold ring,
// no fine lamp detail) so they stay crisp when rasterized down. Larger sizes use the
// full detailed lamp icon.
const smallIconMaxSize = 32;

async function render(svgPath, size) {
  return sharp(svgPath, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

(async () => {
  const pngToIco = (await import('png-to-ico')).default;
  const svg = fs.readFileSync(iconSvg);

  // Multi-size PNG buffers for the ICO. Small sizes use the simplified mark so the
  // taskbar / titlebar / 32px renders stay crisp; large sizes use the detailed lamp icon.
  const pngBuffers = [];
  for (const size of icoSizes) {
    const src = size <= smallIconMaxSize ? iconSmallSvg : iconSvg;
    pngBuffers.push(await render(src, size));
  }
  const ico = await pngToIco(pngBuffers);
  fs.writeFileSync(path.join(assets, 'icon.ico'), ico);
  console.log('Wrote assets/icon.ico');

  // App / store icon PNG.
  await sharp(svg, { density: 384 }).resize(512, 512).png().toFile(path.join(assets, 'icon-512.png'));
  console.log('Wrote assets/icon-512.png');

  // Transparent brand logo PNG for the UI.
  await sharp(fs.readFileSync(logoSvg), { density: 384 })
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(assets, 'logo-512.png'));
  console.log('Wrote assets/logo-512.png');

  // Pre-rendered tray glyph from the dedicated transparent tray mark for crisp 16px compositing.
  await sharp(fs.readFileSync(traySvg), { density: 384 })
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(assets, 'tray-32.png'));
  console.log('Wrote assets/tray-32.png');

  // Transparent full wordmark PNG for About / splash / docs (composites on dark chrome).
  await sharp(fs.readFileSync(wordmarkSvg), { density: 384 })
    .resize(1272, 440, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(assets, 'wordmark-1272.png'));
  console.log('Wrote assets/wordmark-1272.png');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
