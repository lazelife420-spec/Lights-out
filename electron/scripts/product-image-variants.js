#!/usr/bin/env node
'use strict';
// Smaller WebP copies of the product screenshots for the product page's
// srcset. The page shows them at 260-840 CSS px, so a 1600 px file is
// 2-3x more image than most visitors need.
//
// Used by capture-product-screenshots.js after each capture. Run on its own
// to regenerate the variants from the existing 1600 px PNGs:
//   node scripts/product-image-variants.js [--dir <docs/assets/product>]

const fs = require('fs');
const path = require('path');

const VARIANT_WIDTHS = Object.freeze([800, 1200]);
const WEBP_QUALITY = 84;

function variantName(name, width) {
  return `${name}-${width}.webp`;
}

async function writeVariants(sharp, source, outDir, name) {
  const written = [];
  for (const width of VARIANT_WIDTHS) {
    const file = path.join(outDir, variantName(name, width));
    await sharp(source).resize({ width }).webp({ quality: WEBP_QUALITY }).toFile(file);
    written.push(file);
  }
  return written;
}

async function main() {
  const dirIndex = process.argv.indexOf('--dir');
  const dir = path.resolve(dirIndex > 0 ? process.argv[dirIndex + 1] : path.join(__dirname, '..', '..', 'docs', 'assets', 'product'));
  const sharp = require('sharp');
  const pngs = fs.readdirSync(dir).filter(f => /^[a-z-]+\.png$/.test(f));
  if (!pngs.length) throw new Error(`No product PNGs in ${dir}`);
  for (const png of pngs) {
    const name = png.replace(/\.png$/, '');
    const files = await writeVariants(sharp, path.join(dir, png), dir, name);
    console.log(`  ${name}: ${files.map(f => `${path.basename(f)} ${Math.round(fs.statSync(f).size / 1024)} KB`).join(', ')}`);
  }
}

module.exports = { VARIANT_WIDTHS, variantName, writeVariants };

if (require.main === module) {
  main().catch(err => { console.error(err.message || err); process.exit(1); });
}
