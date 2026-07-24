'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const electronPackagePath = require.resolve('electron/package.json');
const electronPackage = require(electronPackagePath);
const electronRoot = path.dirname(electronPackagePath);
const executable = path.join(electronRoot, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const pathFile = path.join(electronRoot, 'path.txt');

assert.ok(fs.existsSync(executable), `Electron binary is missing: ${executable}. Run npm run electron:provision first.`);
assert.ok(fs.existsSync(pathFile), `Electron path marker is missing: ${pathFile}. Run npm run electron:provision first.`);
console.log(`Electron ${electronPackage.version} provisioned at ${executable}`);
