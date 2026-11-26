'use strict';

// Build the Proof Foundry upload kit for one Lights Out release.
//
//   node scripts/build-proof-foundry-kit.js [--release-dir <dir>] [--out <dir>]
//        [--download-base github|<https://downloads.theprooffoundry.com/...>/]
//        [--published-at YYYY-MM-DD] [--with-binaries]
//
// --release-dir holds BUILD-MANIFEST.json and SHA256SUMS.txt (and, for
// --with-binaries, the installer and portable ZIP). Default: ../dist-native.
// For the public kit, use the files attached to the published GitHub release
// (CI builds them; a local build of the same commit has different hashes).
//
// Output (default ../dist-proof-foundry/lights-out-v<version>/):
//   site/lights-out/...                 -> https://theprooffoundry.com/lights-out/
//   site/truth/products/lights-out.json -> https://theprooffoundry.com/truth/products/lights-out.json
//   downloads/...                       -> the download host (only with --with-binaries)
//   UPLOAD.md, KIT-MANIFEST.json, and Lights-Out-ProofFoundry-site-v<version>.zip
//
// The kit is a folder to upload by hand. This script never uploads anything.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const policy = require('../updaterPolicy');
const { VARIANT_WIDTHS, variantName } = require('./product-image-variants');

const ROOT = path.resolve(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs');
const REPO_URL = 'https://github.com/lazelife420-spec/Lights-out';
// Everything under docs/assets the page uses (og:image is an absolute URL, so the
// social card is listed explicitly; src/href assets are also checked below).
const SITE_ASSETS = ['icon-512.png', 'brand/lights-out-wordmark.svg', 'brand/lights-out-icon.svg', 'brand/lights-out-social-card.png'];
const PRODUCT_SHOTS = ['tonight', 'running', 'night-modes', 'schedule', 'proof'];

function arg(name, fallback = null) {
  const at = process.argv.indexOf(name);
  return at > 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith('--') ? process.argv[at + 1] : fallback;
}

// Every relative assets/ path in src, href and each srcset candidate.
function referencedAssets(page) {
  const refs = [];
  for (const m of page.matchAll(/\b(src|href|srcset)="([^"]+)"/g)) {
    const urls = m[1] === 'srcset' ? m[2].split(',').map(part => part.trim().split(/\s+/)[0]) : [m[2]];
    refs.push(...urls.filter(url => url.startsWith('assets/')));
  }
  return [...new Set(refs)];
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function readRelease(releaseDir, version) {
  const manifestPath = path.join(releaseDir, 'BUILD-MANIFEST.json');
  const sumsPath = path.join(releaseDir, 'SHA256SUMS.txt');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(sumsPath)) throw new Error(`BUILD-MANIFEST.json and SHA256SUMS.txt are required in ${releaseDir}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== version) throw new Error(`Release is v${manifest.version} but package.json is v${version}`);
  const sums = new Map(fs.readFileSync(sumsPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const [hash, name] = line.trim().split(/\s+\*?/);
    return [name, hash.toLowerCase()];
  }));
  const setupName = `Lights-Out-Setup-v${version}.exe`;
  const portableName = policy.portableNameFor(version);
  const artifact = name => {
    const entry = (manifest.artifacts || []).find(a => a.name === name);
    if (!entry) throw new Error(`BUILD-MANIFEST.json has no ${name}`);
    if (sums.get(name) !== String(entry.sha256).toLowerCase()) throw new Error(`SHA256SUMS.txt disagrees with BUILD-MANIFEST.json for ${name}`);
    return { name, sha256: entry.sha256.toLowerCase(), bytes: entry.bytes };
  };
  return { manifest, setup: artifact(setupName), portable: artifact(portableName), sumsPath, manifestPath };
}

function downloadBase(option, version) {
  if (!option || option === 'github') return `${REPO_URL}/releases/download/v${version}/`;
  const base = option.endsWith('/') ? option : option + '/';
  if (!policy.isValidDownloadUrl(base + 'x')) throw new Error(`--download-base must be https://${policy.DOWNLOAD_HOST}/... (got ${option})`);
  return base;
}

function fillPage(html, release, base, version) {
  const fills = {
    'version-label': `v${version}`,
    'sha256-setup': release.setup.sha256,
    'sha256-portable': release.portable.sha256
  };
  const hrefs = {
    setup: base + release.setup.name,
    portable: base + release.portable.name,
    release: `${REPO_URL}/releases/tag/v${version}`
  };
  let out = html.replace(/(<([a-z0-9]+)\b[^>]*\bdata-fill="([a-z0-9-]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (whole, open, tag, key, inner, close) => {
    if (!(key in fills)) throw new Error(`Unknown data-fill "${key}"`);
    return open + escapeHtml(fills[key]) + close;
  });
  out = out.replace(/(<a\b[^>]*\bdata-href="([a-z-]+)"[^>]*\bhref=")([^"]*)(")/g, (whole, start, key, old, end) => {
    if (!(key in hrefs)) throw new Error(`Unknown data-href "${key}"`);
    return start + escapeHtml(hrefs[key]) + end;
  });
  out = out.replace(/("downloadUrl": ")[^"]*(")/, `$1${base + release.portable.name}$2`);
  if (out.includes('Listed in SHA256SUMS.txt on the release page')) throw new Error('A checksum placeholder was not filled');
  return out;
}

function truthRecord(release, base, version, { publishedAt, verification }) {
  const sumsUrl = base + 'SHA256SUMS.txt';
  const artifact = (a, distType) => ({
    filename: a.name, sizeBytes: a.bytes, sha256: a.sha256, downloadUrl: base + a.name, sha256Url: sumsUrl,
    signingStatus: 'UNSIGNED', platform: 'Windows', distType
  });
  return {
    schemaVersion: 1,
    id: 'lights-out',
    name: 'Lights Out',
    state: 'available',
    status: 'PUBLIC_RELEASE',
    version,
    platforms: ['Windows'],
    packageId: null,
    pageUrl: '/lights-out/',
    truthUrl: '/truth/products/lights-out.json',
    release: {
      releaseStatus: 'PUBLIC_RELEASE',
      publicVersion: version,
      candidateVersion: null,
      publishedAt,
      sourceCommit: release.manifest.sourceCommit,
      withdrawnVersion: null,
      withdrawalReason: null
    },
    download: {
      available: true,
      url: base + release.portable.name,
      sha256: release.portable.sha256,
      sha256Url: sumsUrl,
      label: `Download Lights Out v${version}`
    },
    artifacts: [
      artifact(release.portable, 'Portable ZIP (unsigned)'),
      artifact(release.setup, 'Windows installer EXE (unsigned)')
    ],
    verification,
    evidence: [
      { label: `v${version} release notes`, url: `${REPO_URL}/releases/tag/v${version}` },
      { label: `v${version} changelog`, url: `${REPO_URL}/blob/v${version}/CHANGELOG.md` },
      { label: `v${version} qualification evidence and limits`, url: `${REPO_URL}/blob/v${version}/docs/RELEASE_QUALIFICATION_${version}.md` }
    ]
  };
}

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  }).sort();
}

function build({ releaseDir, outRoot, downloadOption, publishedAt, withBinaries, zip = true }) {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const version = pkg.version;
  const release = readRelease(releaseDir, version);
  const base = downloadBase(downloadOption, version);
  const kit = path.join(outRoot, `lights-out-v${version}`);
  fs.rmSync(kit, { recursive: true, force: true });

  // 1. Product page and its assets.
  const page = fillPage(fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8'), release, base, version);
  fs.mkdirSync(path.join(kit, 'site', 'lights-out'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'site', 'lights-out', 'index.html'), page);
  for (const asset of SITE_ASSETS) copy(path.join(DOCS, 'assets', asset), path.join(kit, 'site', 'lights-out', 'assets', asset));
  for (const shot of PRODUCT_SHOTS) {
    const files = [`${shot}.webp`, `${shot}.png`, ...VARIANT_WIDTHS.map(width => variantName(shot, width))];
    for (const file of files) copy(path.join(DOCS, 'assets', 'product', file), path.join(kit, 'site', 'lights-out', 'assets', 'product', file));
  }
  const missing = referencedAssets(page).filter(rel => !fs.existsSync(path.join(kit, 'site', 'lights-out', rel)));
  if (missing.length) throw new Error(`Page references missing assets: ${missing.join(', ')}`);

  // 2. Binaries for the download host (optional).
  const verifiedLocally = [];
  if (withBinaries) {
    for (const a of [release.setup, release.portable]) {
      const from = path.join(releaseDir, a.name);
      if (!fs.existsSync(from)) throw new Error(`--with-binaries needs ${a.name} in ${releaseDir}`);
      if (sha256File(from) !== a.sha256) throw new Error(`${a.name} does not match its published SHA-256`);
      copy(from, path.join(kit, 'downloads', a.name));
      verifiedLocally.push(a.name);
    }
    copy(release.sumsPath, path.join(kit, 'downloads', 'SHA256SUMS.txt'));
  }

  // 3. Machine truth record the in-app updater reads.
  const today = new Date().toISOString().slice(0, 10);
  const truth = truthRecord(release, base, version, {
    publishedAt: publishedAt || today,
    verification: {
      status: verifiedLocally.length ? 'VERIFIED' : 'HASHES_FROM_RELEASE_MANIFEST',
      checkedAt: today,
      verificationType: ['ARTIFACT_HASH_PUBLISHED', ...(verifiedLocally.length ? ['ARTIFACT_HASH_VERIFIED'] : [])],
      receiptId: null,
      receiptUrl: null
    }
  });
  fs.mkdirSync(path.join(kit, 'site', 'truth', 'products'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'site', 'truth', 'products', 'lights-out.json'), JSON.stringify(truth, null, 2) + '\n');

  // What a client one release older would conclude from this record.
  const previous = `${version.split('.')[0]}.${Math.max(0, Number(version.split('.')[1]) - 1)}.0`;
  const updaterView = policy.resolveTruth(truth, previous);
  const sameVersionView = policy.resolveTruth(truth, version);
  if (sameVersionView.available) throw new Error('The record would offer this version to itself');

  // 4. Upload instructions.
  const hostedOnPf = base.startsWith(`https://${policy.DOWNLOAD_HOST}/`);
  const steps = [
    `# Proof Foundry upload kit — Lights Out v${version}`,
    '',
    `Source commit: \`${release.manifest.sourceCommit}\` · built from \`${path.basename(releaseDir)}\``,
    '',
    '## What goes where',
    '',
    '| Upload this folder | To | Live URL |',
    '| --- | --- | --- |',
    '| `site/lights-out/` | the site root, as `lights-out/` | https://theprooffoundry.com/lights-out/ |',
    '| `site/truth/products/lights-out.json` | `truth/products/lights-out.json` | https://theprooffoundry.com/truth/products/lights-out.json |',
    ...(withBinaries ? [`| \`downloads/\` (installer, portable ZIP, SHA256SUMS.txt) | the folder behind \`${base}\` | ${base} |`] : []),
    '',
    `Or upload \`Lights-Out-ProofFoundry-site-v${version}.zip\`, which contains \`site/\` exactly as above.`,
    '',
    '## Order',
    '',
    hostedOnPf
      ? `1. Upload \`downloads/\` first and open ${base}${release.portable.name} to confirm it downloads.`
      : `1. Make sure the GitHub release v${version} is published (CI does this when the v${version} tag is pushed) — the page and record link to its files.`,
    '2. Upload `site/lights-out/` (page and images).',
    '3. Upload `site/truth/products/lights-out.json` last: it is what tells installed apps a new version exists.',
    '4. Open https://theprooffoundry.com/lights-out/ and check the version, both buttons and both SHA-256 values.',
    '',
    '## Checksums',
    '',
    `- ${release.setup.name}: \`${release.setup.sha256}\``,
    `- ${release.portable.name}: \`${release.portable.sha256}\``,
    '',
    '## In-app updates',
    '',
    hostedOnPf
      ? `Installed v11.3+ apps will see this release: the record points at ${policy.DOWNLOAD_HOST}, the only host the in-app updater trusts.`
      : `This record points at GitHub Releases, like the live record. Installed v11.3+ apps only download updates from https://${policy.DOWNLOAD_HOST}/, so with this record their in-app check reports ${updaterView.code || 'no update'} and does not offer the download (users still get it from the product page). To make in-app updates download directly, upload the binaries to the download host and rebuild with \`--with-binaries --download-base https://${policy.DOWNLOAD_HOST}/lights-out/v${version}/\`.`,
    ''
  ];
  fs.writeFileSync(path.join(kit, 'UPLOAD.md'), steps.join('\n'));

  // 5. Zip the site and record every file's hash.
  const zipName = `Lights-Out-ProofFoundry-site-v${version}.zip`;
  const zipped = zip && process.platform === 'win32' && spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${path.join(kit, 'site').replace(/'/g, "''")}' -DestinationPath '${path.join(kit, zipName).replace(/'/g, "''")}' -Force`], { stdio: 'inherit' }).status === 0;
  const files = listFiles(kit).filter(f => f !== 'KIT-MANIFEST.json');
  fs.writeFileSync(path.join(kit, 'KIT-MANIFEST.json'), JSON.stringify({
    schema: 'lights-out.proof-foundry-kit/v1', version, sourceCommit: release.manifest.sourceCommit,
    downloadBase: base, files: files.map(f => ({ path: f, bytes: fs.statSync(path.join(kit, f)).size, sha256: sha256File(path.join(kit, f)) }))
  }, null, 2) + '\n');
  return { kit, version, base, updaterView, zipped, files: files.length };
}

if (require.main === module) {
  try {
    const result = build({
      releaseDir: path.resolve(arg('--release-dir', path.join(ROOT, 'dist-native'))),
      outRoot: path.resolve(arg('--out', path.join(ROOT, 'dist-proof-foundry'))),
      downloadOption: arg('--download-base', 'github'),
      publishedAt: arg('--published-at'),
      withBinaries: process.argv.includes('--with-binaries')
    });
    console.log(`Proof Foundry kit for v${result.version}: ${result.kit}`);
    console.log(`  ${result.files} files${result.zipped ? ' + site ZIP' : ''}; downloads from ${result.base}`);
    if (!result.updaterView.available) console.log(`  Note: installed apps will report "${result.updaterView.code}" for this record (see UPLOAD.md).`);
  } catch (error) {
    console.error(`Kit not built: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { build, fillPage, truthRecord, readRelease, downloadBase, referencedAssets };
