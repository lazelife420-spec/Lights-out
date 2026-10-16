'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function appSourceFiles(sourceRoot) {
  const repo = path.resolve(sourceRoot, '..');
  const base = path.relative(repo, sourceRoot).replaceAll('\\', '/');
  const pkg = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
  const result = new Set(['package.json']);
  for (const pattern of pkg.build.files) {
    if (pattern.startsWith('!')) continue;
    if (pattern.endsWith('/**')) {
      const prefix = base + '/' + pattern.slice(0, -3);
      // Generated screenshots and local assets must never enter a release.
      const tracked = execFileSync('git', ['ls-files', '-z', '--', prefix], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
      for (const file of tracked) result.add(file.slice(base.length + 1));
    } else {
      if (pattern.includes('*')) throw new Error('Unsupported application file glob: ' + pattern);
      result.add(pattern);
    }
  }
  for (const name of result) {
    const file = path.resolve(sourceRoot, name);
    if (!file.startsWith(path.resolve(sourceRoot) + path.sep) || !fs.lstatSync(file).isFile()) throw new Error('Invalid application source file: ' + name);
  }
  return [...result].sort();
}
if (require.main === module) console.log(JSON.stringify(appSourceFiles(path.resolve(process.argv[2] || path.join(__dirname, '..')))));
module.exports = { appSourceFiles };
