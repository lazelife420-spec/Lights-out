const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const crypto = require('crypto');

const TMP_DIR = 'C:/Users/KickA/AppData/Local/Temp/lightsout-settings-native-proof-ldhAjY';
const OUT_DIR = path.resolve(__dirname, '../docs/proof/v11.1.2/settings-runtime');

function copy(src, destRel) {
  const dest = path.join(OUT_DIR, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const screenshotsDir = path.join(TMP_DIR, 'screenshots');
  const files = fs.readdirSync(screenshotsDir).filter(f => f.endsWith('.png')).sort();
  const manifest = [];
  for (const f of files) {
    const meta = await sharp(path.join(screenshotsDir, f)).metadata();
    const size = fs.statSync(path.join(screenshotsDir, f)).size;
    manifest.push({ file: f, width: meta.width, height: meta.height, size });
    copy(path.join(screenshotsDir, f), `screenshots/${f}`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'screenshot-manifest.json'), JSON.stringify(manifest, null, 2));

  copy(path.join(TMP_DIR, 'report.json'), 'report.json');

  for (const scenario of ['clean-startup', 'legacy-set', 'legacy-help']) {
    const scenarioDir = path.join(TMP_DIR, scenario);
    if (fs.existsSync(path.join(scenarioDir, 'seed-settings.json'))) {
      copy(path.join(scenarioDir, 'seed-settings.json'), `migration/${scenario}-seed-settings.json`);
    }
    if (fs.existsSync(path.join(scenarioDir, 'settings.json'))) {
      copy(path.join(scenarioDir, 'settings.json'), `migration/${scenario}-final-settings.json`);
    }
  }

  const allFiles = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + '/');
      else allFiles.push(rel);
    }
  }
  walk(OUT_DIR);

  const sums = [];
  for (const f of allFiles.sort()) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT_DIR, f))).digest('hex');
    sums.push(`${hash}  ${f}`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'SHA256SUMS.txt'), sums.join('\n') + '\n');

  console.log('Artifacts preserved to', OUT_DIR);
  console.log('Total files:', allFiles.length);
})();
