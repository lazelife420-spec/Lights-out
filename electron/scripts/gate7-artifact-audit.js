#!/usr/bin/env node
'use strict';

// Receipt-grade identity and package-content audit for the current native
// portable build. Read-only: it never modifies the staged application.

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const electronRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(electronRoot, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(electronRoot, 'package.json'), 'utf8'));
const outputFlag = process.argv.indexOf('--output');
const labelFlag = process.argv.indexOf('--label');
const outputPath = outputFlag >= 0 && process.argv[outputFlag + 1]
  ? path.resolve(process.argv[outputFlag + 1])
  : path.join(repoRoot, 'dist-native', 'gate7-artifact-manifest.json');
const label = labelFlag >= 0 && process.argv[labelFlag + 1] ? process.argv[labelFlag + 1] : 'candidate';
const distRoot = path.join(repoRoot, 'dist-native');
const unpackedRoot = path.join(distRoot, 'win-unpacked');
const appRoot = path.join(unpackedRoot, 'resources', 'app');
const exePath = path.join(unpackedRoot, 'Lights Out.exe');
const zipPath = path.join(distRoot, `Lights-Out-Portable-v${packageJson.version}-win-x64.zip`);

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex').toUpperCase();
}

function directoryManifest(root) {
  const files = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, item.name);
      if (item.isDirectory()) walk(absolute);
      else if (item.isFile()) {
        files.push({
          path: path.relative(root, absolute).split(path.sep).join('/'),
          bytes: fs.statSync(absolute).size,
          sha256: sha256File(absolute)
        });
      }
    }
  }
  walk(root);
  const identity = crypto.createHash('sha256');
  for (const file of files) identity.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`);
  return { root, fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), sha256: identity.digest('hex').toUpperCase(), files };
}

function git(...args) {
  return execFileSync('git.exe', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true }).trim();
}

function powershellJson(command) {
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true
  }).trim();
  return JSON.parse(raw);
}

function scanApplication(manifest) {
  const prohibitedNames = /(^|\/)(\.git|\.github|test|tests|__tests__|docs?|examples?|demos?)(\/|$)|(^|\/)(keystore\.properties|[^/]+\.(?:jks|keystore|pfx|p12|pem|key|map))$/i;
  const textExtensions = new Set(['.js', '.json', '.html', '.css', '.txt', '.md', '.xml', '.yml', '.yaml', '.ps1']);
  const secretPatterns = [
    { name: 'private-key-header', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { name: 'github-token', regex: /gh[pousr]_[A-Za-z0-9]{36,}/ },
    { name: 'aws-access-key', regex: /AKIA[0-9A-Z]{16}/ },
    { name: 'openai-secret-key', regex: /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/ }
  ];
  const prohibitedPathHits = [];
  const secretHits = [];
  const developerPathHits = [];

  for (const file of manifest.files) {
    if (prohibitedNames.test(file.path)) prohibitedPathHits.push(file.path);
    const ext = path.extname(file.path).toLowerCase();
    if (!textExtensions.has(ext) || file.bytes > 2 * 1024 * 1024) continue;
    const absolute = path.join(appRoot, ...file.path.split('/'));
    const text = fs.readFileSync(absolute, 'utf8');
    for (const pattern of secretPatterns) {
      if (pattern.regex.test(text)) secretHits.push({ path: file.path, pattern: pattern.name });
    }
    if (/C:\\Users\\KickA|C:\/Users\/KickA/i.test(text)) developerPathHits.push(file.path);
  }

  return { prohibitedPathHits, secretHits, developerPathHits };
}

for (const required of [unpackedRoot, appRoot, exePath, zipPath]) {
  if (!fs.existsSync(required)) throw new Error(`Required candidate artifact is missing: ${required}`);
}

const appManifest = directoryManifest(appRoot);
const unpackedManifest = directoryManifest(unpackedRoot);
const escapedExe = exePath.replace(/'/g, "''");
const versionInfo = powershellJson(`$v=(Get-ItemProperty -LiteralPath '${escapedExe}').VersionInfo; [pscustomobject]@{CompanyName=$v.CompanyName;ProductName=$v.ProductName;FileDescription=$v.FileDescription;FileVersion=$v.FileVersion;ProductVersion=$v.ProductVersion;InternalName=$v.InternalName;OriginalFilename=$v.OriginalFilename;LegalCopyright=$v.LegalCopyright}|ConvertTo-Json -Compress`);
const authenticode = powershellJson(`$s=Get-AuthenticodeSignature -LiteralPath '${escapedExe}'; [pscustomobject]@{Status=[string]$s.Status;StatusMessage=$s.StatusMessage;SignerCertificateSubject=$s.SignerCertificate.Subject;TimeStamperCertificateSubject=$s.TimeStamperCertificate.Subject}|ConvertTo-Json -Compress`);
const contentAudit = scanApplication(appManifest);

const report = {
  schemaVersion: 1,
  label,
  generatedAt: new Date().toISOString(),
  source: {
    branch: git('branch', '--show-current'),
    head: git('rev-parse', 'HEAD'),
    tree: git('show', '-s', '--format=%T', 'HEAD'),
    desktopVersion: packageJson.version
  },
  distributionModel: 'portable-zip',
  artifacts: {
    launcher: { path: exePath, bytes: fs.statSync(exePath).size, sha256: sha256File(exePath), versionInfo, authenticode },
    portableZip: { path: zipPath, bytes: fs.statSync(zipPath).size, sha256: sha256File(zipPath) },
    applicationContent: appManifest,
    unpackedRuntime: unpackedManifest
  },
  contentAudit,
  acceptance: {
    noProhibitedPaths: contentAudit.prohibitedPathHits.length === 0,
    noSecretPatterns: contentAudit.secretHits.length === 0,
    noDeveloperHomePaths: contentAudit.developerPathHits.length === 0
  },
  realPowerActions: 0
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  source: report.source,
  launcher: report.artifacts.launcher,
  portableZip: report.artifacts.portableZip,
  applicationContent: {
    fileCount: appManifest.fileCount,
    totalBytes: appManifest.totalBytes,
    sha256: appManifest.sha256
  },
  unpackedRuntime: {
    fileCount: unpackedManifest.fileCount,
    totalBytes: unpackedManifest.totalBytes,
    sha256: unpackedManifest.sha256
  },
  contentAudit,
  acceptance: report.acceptance,
  realPowerActions: 0
}, null, 2));

if (!Object.values(report.acceptance).every(Boolean)) process.exitCode = 1;
