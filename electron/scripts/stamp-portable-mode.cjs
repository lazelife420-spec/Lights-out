'use strict';
const fs = require('node:fs'), path = require('node:path');
// Build transform only: never mark the source package or the installed runtime.
function stampPortableMode(source, destination) {
  if (path.resolve(source).toLowerCase() === path.resolve(destination).toLowerCase()) throw Error('Portable marking requires a separate staging package.');
  const pkg = JSON.parse(fs.readFileSync(source, 'utf8'));
  if (pkg.lightsOutDistribution !== undefined) throw Error('Source package must remain distribution-neutral.');
  fs.writeFileSync(destination, JSON.stringify({ ...pkg, lightsOutDistribution: 'portable' }, null, 2) + '\n');
}
if (require.main === module) stampPortableMode(process.argv[2], process.argv[3]);
module.exports = { stampPortableMode };
