const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const androidRes = path.join(root, 'android', 'app', 'src', 'main', 'res');
const sourceSvg = path.join(root, '..', 'electron', 'assets', 'icon.svg');
const isCheckMode = process.argv.includes('--check');

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

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ensureSourceExists() {
  if (!fs.existsSync(sourceSvg)) {
    fail(`Source icon not found: ${sourceSvg}`);
  }
}

function compareOrWrite(filePath, expectedBuffer, modeSummary) {
  const exists = fs.existsSync(filePath);
  if (isCheckMode) {
    if (!exists) {
      modeSummary.missing += 1;
      console.error(`Missing: ${filePath}`);
      return;
    }
    const actual = fs.readFileSync(filePath);
    if (!actual.equals(expectedBuffer)) {
      modeSummary.mismatched += 1;
      console.error(`Mismatch: ${filePath}`);
      return;
    }
    modeSummary.checked += 1;
    console.log(`Checked: ${filePath}`);
    return;
  }

  fs.writeFileSync(filePath, expectedBuffer);
  modeSummary.written += 1;
  console.log(`Wrote: ${filePath}`);
}

async function renderPng(svgBuffer, size) {
  return sharp(svgBuffer, { density: 384 }).resize(size, size).png().toBuffer();
}

async function generate() {
  ensureSourceExists();
  const svgBuffer = fs.readFileSync(sourceSvg);
  const summary = { checked: 0, written: 0, missing: 0, mismatched: 0 };

  // Legacy launcher icons (full icon with background).
  for (const [density, size] of Object.entries(legacySizes)) {
    const dir = path.join(androidRes, `mipmap-${density}`);
    const icon = await renderPng(svgBuffer, size);
    compareOrWrite(path.join(dir, 'ic_launcher.png'), icon, summary);
    compareOrWrite(path.join(dir, 'ic_launcher_round.png'), icon, summary);
  }

  // Adaptive foreground icons (same icon, sits on dark background).
  for (const [density, size] of Object.entries(adaptiveForegroundSizes)) {
    const dir = path.join(androidRes, `mipmap-${density}`);
    const fg = await renderPng(svgBuffer, size);
    compareOrWrite(path.join(dir, 'ic_launcher_foreground.png'), fg, summary);
  }

  // Adaptive background color to match dark premium brand.
  const bgXmlPath = path.join(androidRes, 'values', 'ic_launcher_background.xml');
  const bgXml = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#060912</color>
</resources>
`);
  compareOrWrite(bgXmlPath, bgXml, summary);

  if (isCheckMode) {
    const failed = summary.missing + summary.mismatched;
    console.log(`Icon check summary: checked=${summary.checked}, missing=${summary.missing}, mismatched=${summary.mismatched}`);
    if (failed > 0) {
      fail(`Icon check failed: ${failed} file(s) missing or mismatched.`);
    }
    console.log('Icon check passed.');
    return;
  }

  console.log(`Icon generation summary: written=${summary.written}`);
  console.log('Android icon generation complete.');
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
