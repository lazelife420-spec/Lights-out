'use strict';
const nodeFs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Only a portable build carries this package metadata. Installed/source builds
// return without inspecting, changing, or migrating their existing profile.
function configurePortableProfile({ app, packageInfo, executable = process.execPath,
  appDirectory = __dirname, argv = process.argv, fs = nodeFs }) {
  if (packageInfo.lightsOutDistribution === undefined || packageInfo.lightsOutDistribution === 'installed') return { portable: false };
  const fail = message => { throw Object.assign(new Error(message), { code: 'PORTABLE_STARTUP_BLOCKED' }); };
  if (packageInfo.lightsOutDistribution !== 'portable' || !app.isPackaged || app.isReady()) fail('Portable startup must run before application readiness.');
  const same = (a, b) => {
    const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    return normalize(a) === normalize(b);
  };
  const exeDir = path.dirname(executable), root = path.dirname(exeDir), expected = path.join(root, 'user-data');
  if (path.basename(exeDir).toLowerCase() !== 'app' || !same(appDirectory, path.join(exeDir, 'resources', 'app'))) fail('The portable application folder is incomplete.');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, 'MANIFEST.json'), 'utf8'));
    for (const name of ['Start Lights Out.cmd', 'Launch Lights Out.cmd']) if (!fs.statSync(path.join(root, name)).isFile()) fail('The portable launcher is missing.');
  } catch { fail('Extract the complete portable folder before opening Lights Out.'); }
  if (manifest.schema !== 'lights-out.portable/v1' || manifest.version !== packageInfo.version) fail('The portable manifest does not match this application.');
  let supplied = false;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!/^--user-data-dir(?:=|$)/i.test(arg)) continue;
    if (supplied) fail('Multiple profile arguments are not supported by this portable.');
    supplied = true;
    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++i];
    if (!value || !path.isAbsolute(value) || !same(value, expected)) fail('This portable only opens its sibling user-data folder. Use its Start Lights Out.cmd.');
  }
  // Reject a redirected profile rather than following a junction into another
  // application's data. No automatic migration or default-AppData fallback.
  const directory = target => {
    if (!fs.existsSync(target)) fs.mkdirSync(target);
    const info = fs.lstatSync(target);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('The portable profile must be a local folder, not a file or redirected link.');
  };
  let profile, logs;
  try {
    directory(expected);
    profile = fs.realpathSync(expected);
    if (!same(profile, path.join(fs.realpathSync(root), 'user-data'))) fail('The portable profile resolves outside its application folder.');
    logs = path.join(profile, 'logs'); directory(logs);
    const probe = path.join(profile, '.startup-' + randomUUID()); let fd;
    try { fd = fs.openSync(probe, 'wx', 0o600); fs.writeSync(fd, 'portable profile write check'); fs.fsyncSync(fd); }
    finally { if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(probe); } }
  } catch { fail('The sibling portable user-data folder is unavailable or not writable.'); }
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  app.setPath('logs', logs);
  if (!same(app.getPath('userData'), profile) || !same(app.getPath('sessionData'), profile)) fail('Portable profile binding could not be verified.');
  return { portable: true, userData: profile, sessionData: profile };
}

module.exports = { configurePortableProfile };
