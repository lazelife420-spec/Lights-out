const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const androidRes = path.join(root, 'android', 'app', 'src', 'main', 'res');
const sourceSvg = path.join(root, '..', 'electron', 'assets', 'icon.svg');

const legacySizes = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192
};

const adaptiveForegroundSizes = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432
};

async function generate() {
  if (!fs.existsSync(sourceSvg)) {
    console.error('Source icon not found:', sourceSvg);
    process.exit(1);
  }

  const svgBuffer = fs.readFileSync(sourceSvg);

  // Legacy launcher icons (full icon with background).
  for (const [density, size] of Object.entries(legacySizes)) {
    const dir = path.join(androidRes, `mipmap-${density}`);
    const out = path.join(dir, 'ic_launcher.png');
    const roundOut = path.join(dir, 'ic_launcher_round.png');
    await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toFile(out);
    await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toFile(roundOut);
    console.log('Wrote', out, `${size}x${size}`);
  }

  // Adaptive foreground icons (same icon, will sit on dark background).
  for (const [density, size] of Object.entries(adaptiveForegroundSizes)) {
    const dir = path.join(androidRes, `mipmap-${density}`);
    const out = path.join(dir, 'ic_launcher_foreground.png');
    await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toFile(out);
    console.log('Wrote', out, `${size}x${size}`);
  }

  // Update adaptive background color to match the dark premium brand.
  const bgXml = path.join(androidRes, 'values', 'ic_launcher_background.xml');
  fs.writeFileSync(bgXml, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#060912</color>
</resources>
`);
  console.log('Wrote', bgXml, '#060912');

  console.log('Android icon generation complete.');
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
