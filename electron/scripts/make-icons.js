// Renders the Lights Out brand SVGs (assets/brand/*) into every raster the app ships:
// the multi-frame Windows icon, the app PNGs, the tray glyphs and the pre-rendered
// taskbar overlay badges and thumbnail-toolbar glyphs. Run with: npm run icons
// The runtime never needs sharp: everything main.js loads is committed output of this.
const fs = require('fs');
const path = require('path');
const taskbar = require('../taskbarPresence');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');
const brand = path.join(assets, 'brand');
const appIconDir = path.join(brand, 'app-icon');
const logoSvg = path.join(brand, 'lights-out-icon.svg');
const wordmarkSvg = path.join(brand, 'lights-out-wordmark-transparent.svg');
const traySvg = path.join(brand, 'lights-out-tray.svg');

// Every size Windows takes from an .ico: the window icons at 100/125/150/200% scale
// (SM_CXSMICON 16/20/24/32, SM_CXICON 32/40/48/64), the Windows 11 taskbar (24/30/36),
// Alt+Tab, Start and Explorer views (48/64/96/128/256). A missing size is resampled
// from a neighbour by Windows and comes out blurred.
const ICO_SIZES = Object.freeze([16, 20, 24, 30, 32, 36, 40, 48, 64, 96, 128, 256]);

// One mark at every size: the lit teal lamp on the night badge. The small masters are
// drawn on their own pixel grid (assets/brand/app-icon/lights-out-app-<size>.svg) and
// the 256 master carries the depth and glow for 64px and up.
const APP_ICON_MASTERS = Object.freeze([16, 20, 24, 32, 48, 256]);

// The master a frame is rendered from: its own size when one is drawn, otherwise the
// next larger small master (30 from 32, 36/40 from 48), and the detailed master above 48.
function appIconMasterFor(size) {
  if (APP_ICON_MASTERS.includes(size)) return size;
  if (size > 48) return 256;
  return APP_ICON_MASTERS.find(master => master >= size);
}

function appIconMasterPath(master) {
  return path.join(appIconDir, `lights-out-app-${master}.svg`);
}

// Overlay badge colours are the tray dot colours (amber = Test Mode, rose = REAL).
const OVERLAY_COLORS = Object.freeze({ test: '#f5b83d', real: '#ff5c7a' });
const OVERLAY_INK = '#0b0f14';
const THUMB_INK_COLORS = Object.freeze({ white: '#ffffff', black: '#1b1b1b' });

// Glyphs are drawn on a 16-unit grid; each size renders the same SVG at its own density.
function overlaySvg(kind, paused) {
  const ink = OVERLAY_INK;
  const power = `<path d="M5.35 5.45a3.7 3.7 0 1 0 5.3 0" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`
    + `<line x1="8" y1="3.4" x2="8" y2="7.6" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`;
  // Test Mode: the power symbol struck through (nothing will power off).
  const strike = `<line x1="3.9" y1="12.1" x2="12.1" y2="3.9" stroke="${OVERLAY_COLORS[kind]}" stroke-width="3" stroke-linecap="round"/>`
    + `<line x1="4.3" y1="11.7" x2="11.7" y2="4.3" stroke="${ink}" stroke-width="1.4" stroke-linecap="round"/>`;
  const pause = `<rect x="5.2" y="4.7" width="2.1" height="6.6" rx="0.5" fill="${ink}"/><rect x="8.7" y="4.7" width="2.1" height="6.6" rx="0.5" fill="${ink}"/>`;
  const glyph = paused ? pause : kind === 'test' ? power + strike : power;
  // A dark keyline separates the badge from the teal app icon underneath.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">`
    + `<circle cx="8" cy="8" r="7.75" fill="${ink}"/><circle cx="8" cy="8" r="6.75" fill="${OVERLAY_COLORS[kind]}"/>${glyph}</svg>`;
}

function thumbSvg(glyph, inkName) {
  const ink = THUMB_INK_COLORS[inkName];
  const shapes = {
    pause: `<rect x="4.25" y="3.5" width="2.6" height="9" rx="0.6" fill="${ink}"/><rect x="9.15" y="3.5" width="2.6" height="9" rx="0.6" fill="${ink}"/>`,
    resume: `<path d="M5.2 3.4v9.2l7.3-4.6z" fill="${ink}" stroke="${ink}" stroke-width="0.8" stroke-linejoin="round"/>`,
    // A clock with a plus: snooze adds five minutes.
    snooze: `<circle cx="7" cy="9" r="4.6" fill="none" stroke="${ink}" stroke-width="1.5"/>`
      + `<path d="M7 6.7V9l1.7 1.2" fill="none" stroke="${ink}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<path d="M12.7 1.6v4.2M10.6 3.7h4.2" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/>`,
    cancel: `<path d="M4.3 4.3l7.4 7.4M11.7 4.3l-7.4 7.4" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${shapes[glyph]}</svg>`;
}

async function renderSvg(sharp, svg, designSize, size) {
  // 4x supersampling from a size-correct master, then a lanczos downscale.
  return sharp(Buffer.isBuffer(svg) ? svg : Buffer.from(svg), { density: 72 * (size / designSize) * 4 })
    .resize(size, size, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function main() {
  const sharp = require('sharp');
  const pngToIco = (await import('png-to-ico')).default;

  const masters = new Map(APP_ICON_MASTERS.map(master => [master, fs.readFileSync(appIconMasterPath(master))]));
  const appIcon = async size => {
    const master = appIconMasterFor(size);
    return renderSvg(sharp, masters.get(master), master, size);
  };

  // Windows icon: every frame drawn from its own master (32bpp DIB frames, which the
  // pinned NSIS and rcedit both accept).
  const frames = [];
  for (const size of ICO_SIZES) frames.push(await appIcon(size));
  fs.writeFileSync(path.join(assets, 'icon.ico'), await pngToIco(frames));
  console.log(`Wrote assets/icon.ico (${ICO_SIZES.join(', ')})`);

  // App / store / companion icon PNG, and the crisp toast logo (Windows shows it at
  // 48-96px; the .ico would hand the toast a 32px frame to stretch).
  fs.writeFileSync(path.join(assets, 'icon-512.png'), await appIcon(512));
  console.log('Wrote assets/icon-512.png');
  fs.writeFileSync(path.join(assets, 'icon-256.png'), await appIcon(256));
  console.log('Wrote assets/icon-256.png');

  // Transparent brand logo PNG for the UI.
  await sharp(fs.readFileSync(logoSvg), { density: 384 })
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(assets, 'logo-512.png'));
  console.log('Wrote assets/logo-512.png');

  // Pre-rendered tray glyph from the dedicated transparent tray mark for crisp 16px compositing.
  const tray32Buf = await sharp(fs.readFileSync(traySvg), { density: 384 })
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(assets, 'tray-32.png'), tray32Buf);
  console.log('Wrote assets/tray-32.png');

  // Pre-rendered 16px tray status icons (idle, test, real) so runtime never needs sharp/libvips.
  const base16 = await sharp(tray32Buf).resize(16, 16).png().toBuffer();
  const trayVariants = [
    ['tray-idle-16.png', '#6b7685', 0.5],
    ['tray-test-16.png', OVERLAY_COLORS.test, 0.95],
    ['tray-real-16.png', OVERLAY_COLORS.real, 0.95]
  ];
  for (const [filename, color, opacity] of trayVariants) {
    const dotSvg = `<svg width="16" height="16"><circle cx="13" cy="13" r="3" fill="${color}" opacity="${opacity}"/></svg>`;
    const dotBuf = await sharp(Buffer.from(dotSvg)).png().toBuffer();
    await sharp(base16)
      .composite([{ input: dotBuf, blend: 'over' }])
      .png()
      .toFile(path.join(assets, filename));
    console.log(`Wrote assets/${filename}`);
  }

  // Taskbar overlay badges and thumbnail-toolbar glyphs, one PNG per small-icon size
  // (main.js picks the one matching the display scale; see taskbarPresence.js).
  const taskbarDir = path.join(assets, 'taskbar');
  fs.mkdirSync(taskbarDir, { recursive: true });
  let written = 0;
  for (const size of taskbar.TASKBAR_ICON_SIZES) {
    for (const kind of taskbar.OVERLAY_KINDS) {
      for (const paused of [false, true]) {
        fs.writeFileSync(path.join(taskbarDir, taskbar.overlayAssetFile(kind, paused, size)), await renderSvg(sharp, overlaySvg(kind, paused), 16, size));
        written++;
      }
    }
    for (const glyph of taskbar.THUMB_GLYPHS) {
      for (const ink of taskbar.THUMB_INKS) {
        fs.writeFileSync(path.join(taskbarDir, taskbar.thumbAssetFile(glyph, ink, size)), await renderSvg(sharp, thumbSvg(glyph, ink), 16, size));
        written++;
      }
    }
  }
  console.log(`Wrote ${written} taskbar overlay and thumbnail-toolbar PNGs to assets/taskbar`);

  // Transparent full wordmark PNG for About / splash / docs (composites on dark chrome).
  await sharp(fs.readFileSync(wordmarkSvg), { density: 384 })
    .resize(1272, 440, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(assets, 'wordmark-1272.png'));
  console.log('Wrote assets/wordmark-1272.png');
}

module.exports = { ICO_SIZES, APP_ICON_MASTERS, appIconMasterFor, appIconMasterPath, OVERLAY_COLORS };

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
