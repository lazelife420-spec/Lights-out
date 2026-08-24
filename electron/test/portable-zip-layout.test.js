const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'scripts', 'new-portable-zip.ps1');
const powershell = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('portable ZIP extracts into one Lights Out folder without mutating its source', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-portable-layout-'));
  const source = path.join(root, 'win-unpacked');
  const destination = path.join(root, 'Lights-Out-Portable-test.zip');
  const extracted = path.join(root, 'extracted');
  const files = [
    ['Lights Out.exe', 'launcher'],
    [path.join('locales', 'en-US.pak'), 'locale'],
    [path.join('resources', 'app', 'main.js'), 'main']
  ];

  try {
    for (const [relativePath, content] of files) {
      const target = path.join(source, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    const before = files.map(([relativePath]) => sha256(path.join(source, relativePath)));

    const result = spawnSync(powershell, [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', script,
      '-SourceRoot', source,
      '-DestinationPath', destination,
      '-RootFolderName', 'Lights Out'
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Portable ZIP root: Lights Out\/ \(3 files\)/);

    const extractZip = (await import('@electron-internal/extract-zip')).default;
    await extractZip(destination, { dir: extracted });

    assert.deepEqual(fs.readdirSync(extracted), ['Lights Out']);
    for (const [relativePath, content] of files) {
      assert.equal(fs.readFileSync(path.join(extracted, 'Lights Out', relativePath), 'utf8'), content);
    }
    assert.equal(fs.existsSync(path.join(extracted, 'Lights Out.exe')), false);
    assert.equal(fs.existsSync(path.join(extracted, 'resources')), false);
    assert.deepEqual(files.map(([relativePath]) => sha256(path.join(source, relativePath))), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('portable ZIP rejects an unsafe archive root before writing output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-portable-layout-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'unsafe.zip');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'Lights Out.exe'), 'launcher');

  try {
    const result = spawnSync(powershell, [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', script,
      '-SourceRoot', source,
      '-DestinationPath', destination,
      '-RootFolderName', '..\\escape'
    ], { encoding: 'utf8' });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /one safe archive folder name/);
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
