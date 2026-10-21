'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { configurePortableProfile } = require('../portableStartup');
const { stampPortableMode } = require('../scripts/stamp-portable-mode.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-direct-entry-'));
  t.after(() => { const real = fs.realpathSync(root), prefix = fs.realpathSync(os.tmpdir()) + path.sep + 'lo-direct-entry-'; if (!real.startsWith(prefix)) throw Error('Unexpected cleanup target'); fs.rmSync(real, { recursive: true, force: true }); });
  const appDir = path.join(root, 'app/resources/app'); fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'MANIFEST.json'), JSON.stringify({ schema: 'lights-out.portable/v1', version: '11.2.1-rc.5' }));
  for (const f of ['Start Lights Out.cmd', 'Launch Lights Out.cmd']) fs.writeFileSync(path.join(root, f), 'fixture');
  const paths = {}, calls = [], app = { isPackaged: true, isReady: () => false, setPath: (kind, value) => { calls.push([kind, value]); paths[kind] = value; }, getPath: kind => paths[kind] };
  const options = { app, packageInfo: { version: '11.2.1-rc.5', lightsOutDistribution: 'portable' }, executable: path.join(root, 'app/Lights Out.exe'), appDirectory: appDir, argv: ['Lights Out.exe'] };
  return { root, paths, calls, options, profile: path.join(root, 'user-data') };
}
test('unmarked installed edition performs no path or filesystem operation', () => {
  const fail = () => { throw Error('Installed profile must remain untouched'); };
  assert.deepEqual(configurePortableProfile({ app: { setPath: fail, getPath: fail, isReady: fail }, packageInfo: {}, fs: new Proxy({}, { get: fail }) }), { portable: false });
});
test('bare portable binds both storage paths and logs before returning', t => {
  const f = fixture(t), result = configurePortableProfile(f.options);
  assert.equal(result.portable, true); assert.equal(f.paths.userData, fs.realpathSync(f.profile)); assert.equal(f.paths.sessionData, f.paths.userData); assert.equal(f.paths.logs, path.join(f.paths.userData, 'logs'));
  assert.deepEqual(f.calls.map(c => c[0]), ['userData', 'sessionData', 'logs']); assert.deepEqual(fs.readdirSync(f.profile), ['logs']);
});
test('matching wrapper path and First Light flags are preserved without migration', t => {
  const f = fixture(t), args = ['Lights Out.exe', '--user-data-dir=' + f.profile, '--no-auto-start', '--first-light', '--first-light-request-id=synthetic'];
  fs.mkdirSync(f.profile); fs.writeFileSync(path.join(f.profile, 'sentinel.json'), 'existing portable data');
  const copy = [...args]; configurePortableProfile({ ...f.options, argv: args }); assert.deepEqual(args, copy); assert.equal(fs.readFileSync(path.join(f.profile, 'sentinel.json'), 'utf8'), 'existing portable data');
});
test('separated absolute profile argument selects the same sibling profile', t => {
  const f = fixture(t); configurePortableProfile({ ...f.options, argv: ['Lights Out.exe', '--user-data-dir', f.profile] }); assert.equal(f.paths.userData, fs.realpathSync(f.profile));
});
test('empty, relative, conflicting and duplicate paths fail before any binding', t => {
  const f = fixture(t);
  for (const args of [['--user-data-dir='], ['--user-data-dir=relative'], ['--user-data-dir=' + path.join(f.root, 'other')], ['--user-data-dir=' + f.profile, '--user-data-dir=' + f.profile]]) {
    assert.throws(() => configurePortableProfile({ ...f.options, argv: ['Lights Out.exe', ...args] }), { code: 'PORTABLE_STARTUP_BLOCKED' }); assert.equal(f.calls.length, 0);
  }
  assert.equal(fs.existsSync(f.profile), false);
});
test('missing complete-folder marker fails closed', t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.root, 'Start Lights Out.cmd')); assert.throws(() => configurePortableProfile(f.options), { code: 'PORTABLE_STARTUP_BLOCKED' }); assert.equal(f.calls.length, 0);
});
test('malformed or mismatched manifest fails closed', t => {
  const f = fixture(t);
  for (const text of ['broken', JSON.stringify({ schema: 'other', version: f.options.packageInfo.version }), JSON.stringify({ schema: 'lights-out.portable/v1', version: 'old' })]) {
    fs.writeFileSync(path.join(f.root, 'MANIFEST.json'), text); assert.throws(() => configurePortableProfile(f.options), { code: 'PORTABLE_STARTUP_BLOCKED' }); assert.equal(f.calls.length, 0);
  }
});
test('a profile file or junction cannot redirect into another profile', t => {
  const f = fixture(t); fs.writeFileSync(f.profile, 'not a directory'); assert.throws(() => configurePortableProfile(f.options), { code: 'PORTABLE_STARTUP_BLOCKED' }); fs.unlinkSync(f.profile);
  const other = path.join(f.root, 'other'); fs.mkdirSync(other); fs.symlinkSync(other, f.profile, process.platform === 'win32' ? 'junction' : 'dir'); assert.throws(() => configurePortableProfile(f.options), { code: 'PORTABLE_STARTUP_BLOCKED' }); assert.equal(f.calls.length, 0);
});
test('unwritable portable profile never falls back to installed storage', t => {
  const f = fixture(t), guardedFs = Object.create(fs); guardedFs.openSync = () => { throw Object.assign(Error('synthetic denied write'), { code: 'EACCES' }); };
  assert.throws(() => configurePortableProfile({ ...f.options, fs: guardedFs }), { code: 'PORTABLE_STARTUP_BLOCKED' }); assert.equal(f.calls.length, 0);
});
test('late binding and unexpected portable layout are rejected', t => {
  const f = fixture(t); assert.throws(() => configurePortableProfile({ ...f.options, app: { ...f.options.app, isReady: () => true } }), { code: 'PORTABLE_STARTUP_BLOCKED' });
  assert.throws(() => configurePortableProfile({ ...f.options, executable: path.join(f.root, 'Lights Out.exe') }), { code: 'PORTABLE_STARTUP_BLOCKED' }); assert.equal(f.calls.length, 0);
});
test('portable marking transforms only a separate staged package', t => {
  const f = fixture(t), source = path.join(f.root, 'source-package.json'), target = path.join(f.root, 'portable-package.json'); fs.writeFileSync(source, JSON.stringify({ version: '11.2.1-rc.5' })); const original = fs.readFileSync(source);
  stampPortableMode(source, target); assert.deepEqual(fs.readFileSync(source), original); assert.equal(JSON.parse(fs.readFileSync(target)).lightsOutDistribution, 'portable'); assert.throws(() => stampPortableMode(source, source));
});
