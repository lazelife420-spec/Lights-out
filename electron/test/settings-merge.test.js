// Regression test for the settings persistence merge contract.
// Confirms that updateSection('app', { nsActiveTab: 'lib' }) deep-merges
// and preserves unrelated app keys.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

let originalLoad;

describe('settings merge contract', () => {
  let tmpDir;
  let settings;

  test.before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightsout-settings-merge-'));
    originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === 'electron') {
        return { app: { getPath: () => tmpDir }, safeStorage: { isEncryptionAvailable: () => false } };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    // Clear require cache so settings.js loads with mocked electron.
    delete require.cache[require.resolve('../settings.js')];
    settings = require('../settings.js');
  });

  test.after(() => {
    Module._load = originalLoad;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('updateSection deep-merges app and preserves unrelated keys', () => {
    settings.updateSection('app', {
      nsActiveTab: 'set',
      unrelatedProofKey: 'preserve-me',
      dryRun: true
    });
    settings.updateSection('app', { nsActiveTab: 'lib' });

    const app = settings.getSection('app');
    assert.equal(app.nsActiveTab, 'lib', 'nsActiveTab should be migrated to lib');
    assert.equal(app.unrelatedProofKey, 'preserve-me', 'unrelated app key must be preserved');
    assert.equal(app.dryRun, true, 'other app keys must remain after partial update');

    const disk = JSON.parse(fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8'));
    assert.equal(disk.app.nsActiveTab, 'lib', 'disk nsActiveTab should be lib');
    assert.equal(disk.app.unrelatedProofKey, 'preserve-me', 'disk unrelated key must be preserved');
  });

  test('legacy nsActiveTab "help" migration preserves sibling keys', () => {
    settings.updateSection('app', {
      nsActiveTab: 'help',
      unrelatedProofKey: 'preserve-me-2',
      clockFace: 'analog'
    });
    settings.updateSection('app', { nsActiveTab: 'lib' });

    const app = settings.getSection('app');
    assert.equal(app.nsActiveTab, 'lib');
    assert.equal(app.unrelatedProofKey, 'preserve-me-2');
    assert.equal(app.clockFace, 'analog');
  });
});
