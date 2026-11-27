'use strict';
// The Windows app icon (assets/icon.ico): one mark at every size, a drawn frame
// for every size Windows asks for, frames NSIS and rcedit both accept, and the
// committed icon in sync with its brand masters. Also guards the brand-SVG
// filter bug that silently dropped the power notch (zero-width line filtered
// with an objectBoundingBox region).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const icons = require('../scripts/make-icons');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');

function readIco(file) {
  const ico = fs.readFileSync(file);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1, 'icon resource');
  const count = ico.readUInt16LE(4);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const dir = 6 + i * 16;
    const size = ico.readUInt8(dir) || 256;
    const bytes = ico.readUInt32LE(dir + 8);
    const offset = ico.readUInt32LE(dir + 12);
    frames.push({ size, bytes, offset, data: ico.subarray(offset, offset + bytes) });
  }
  return frames;
}

// 32bpp bottom-up DIB frame -> top-down RGBA.
function decodeDib(frame) {
  const header = frame.data.readUInt32LE(0);
  const width = frame.data.readInt32LE(4);
  const bpp = frame.data.readUInt16LE(14);
  assert.equal(header, 40, `${frame.size}px frame is a BITMAPINFOHEADER DIB`);
  assert.equal(bpp, 32, `${frame.size}px frame is 32bpp`);
  assert.equal(width, frame.size);
  const rgba = Buffer.alloc(width * width * 4);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const src = 40 + ((width - 1 - y) * width + x) * 4;
      const dst = (y * width + x) * 4;
      rgba[dst] = frame.data[src + 2];
      rgba[dst + 1] = frame.data[src + 1];
      rgba[dst + 2] = frame.data[src];
      rgba[dst + 3] = frame.data[src + 3];
    }
  }
  return { width, rgba };
}

const isBrandTeal = (rgba, i) => rgba[i + 3] > 200 && rgba[i + 1] > 200 && rgba[i + 2] > 160 && rgba[i] < 140;

test('icon.ico has a frame for every Windows icon size (16/20/24/30/32/36/40/48/64/96/128/256)', () => {
  assert.deepEqual([...icons.ICO_SIZES], [16, 20, 24, 30, 32, 36, 40, 48, 64, 96, 128, 256]);
  const frames = readIco(path.join(assets, 'icon.ico'));
  assert.deepEqual(frames.map(frame => frame.size), [...icons.ICO_SIZES], 'no size left for Windows to resample');
  for (const frame of frames) decodeDib(frame); // every frame a 32bpp DIB (pinned NSIS + rcedit)
});

// Owner direction 2026-11-27: the small frames carry the logo's broken O (the
// mark people recognised), not a shrunken lamp.
test('the small taskbar frames show the lit broken O with a dark centre', () => {
  const frames = readIco(path.join(assets, 'icon.ico'));
  for (const size of [16, 20, 24, 32, 48]) {
    const { width, rgba } = decodeDib(frames.find(frame => frame.size === size));
    let ring = 0;
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) if (isBrandTeal(rgba, (y * width + x) * 4)) ring++;
    assert.ok(ring >= Math.round(width * width * 0.12), `${size}px: bright ring present (${ring} teal px)`);
    // The centre of the O is the night badge, not teal.
    const c = Math.floor(width / 2), ci = (c * width + c) * 4;
    assert.ok(!isBrandTeal(rgba, ci), `${size}px: dark centre`);
    // Rounded badge: the outermost corner pixel is not opaque.
    assert.ok(rgba[3] < 200, `${size}px: rounded corner`);
  }
});

test('every frame is drawn from its committed brand master (assets in sync with sources)', async () => {
  for (const master of icons.APP_ICON_MASTERS) assert.ok(fs.existsSync(icons.appIconMasterPath(master)), `master ${master}`);
  assert.equal(icons.appIconMasterFor(16), 16);
  assert.equal(icons.appIconMasterFor(30), 32, '30 renders down from the 32 master');
  assert.equal(icons.appIconMasterFor(36), 48);
  assert.equal(icons.appIconMasterFor(40), 48);
  assert.equal(icons.appIconMasterFor(64), 256);
  const frames = readIco(path.join(assets, 'icon.ico'));
  for (const size of [16, 32, 48, 256]) {
    const master = icons.appIconMasterFor(size);
    const expected = await sharp(fs.readFileSync(icons.appIconMasterPath(master)), { density: 72 * (size / master) * 4 })
      .resize(size, size, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha().raw().toBuffer();
    const { rgba } = decodeDib(frames.find(frame => frame.size === size));
    let diff = 0;
    for (let i = 0; i < rgba.length; i++) diff += Math.abs(rgba[i] - expected[i]);
    assert.ok(diff / rgba.length < 2, `${size}px frame matches lights-out-app-${master}.svg (mean diff ${(diff / rgba.length).toFixed(2)}); run npm run icons`);
  }
});

test('the 512/256 app PNGs are the same mark', async () => {
  for (const [file, size] of [['icon-512.png', 512], ['icon-256.png', 256]]) {
    const meta = await sharp(path.join(assets, file)).metadata();
    assert.equal(meta.width, size);
    assert.equal(meta.height, size);
  }
  const small = await sharp(path.join(assets, 'icon-512.png')).resize(256, 256).ensureAlpha().raw().toBuffer();
  const direct = await sharp(path.join(assets, 'icon-256.png')).ensureAlpha().raw().toBuffer();
  let diff = 0;
  for (let i = 0; i < small.length; i++) diff += Math.abs(small[i] - direct[i]);
  assert.ok(diff / small.length < 6, 'icon-512 and icon-256 are renders of one master');
});

test('brand SVG filters never use an objectBoundingBox region on the zero-width power notch', async () => {
  for (const name of ['lights-out-icon.svg', 'lights-out-icon-small.svg']) {
    const svg = fs.readFileSync(path.join(assets, 'brand', name), 'utf8');
    assert.match(svg, /<filter id="f-ring" filterUnits="userSpaceOnUse"/, `${name}: f-ring region in user space`);
    assert.match(svg, /<line [^>]*filter="url\(#f-ring\)"/, `${name}: the notch is still drawn with the glow`);
  }
  for (const svg of fs.readdirSync(path.join(assets, 'brand', 'app-icon'))) {
    const text = fs.readFileSync(path.join(assets, 'brand', 'app-icon', svg), 'utf8');
    for (const filter of text.match(/<filter [^>]*>/g) || []) assert.match(filter, /filterUnits="userSpaceOnUse"/, `${svg}: ${filter}`);
  }
  // Rendered: the notch survives (bright teal in the top-centre gap of the ring).
  const count = async (file, size, [x0, y0, x1, y1]) => {
    const { data, info } = await sharp(path.join(assets, 'brand', file), { density: 384 }).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let bright = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 1] > 180 && data[i + 3] > 200) bright++;
    }
    return bright;
  };
  // Before the fix these regions held 10 and 166 bright pixels (the ring's glow only).
  assert.ok(await count('lights-out-icon-small.svg', 32, [14, 3, 18, 13]) >= 20, 'small icon notch rendered');
  assert.ok(await count('lights-out-icon.svg', 256, [140, 100, 156, 132]) >= 280, 'full icon notch rendered');
});
