// Preflight check: fail clearly on unsupported Node versions.
const required = require('../package.json').engines?.node || '>=22.13.0';
const [major, minor, patch] = process.version.slice(1).split('-')[0].split('.').map(Number);

function parseConstraint(range) {
  const m = range.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

const min = parseConstraint(required);
if (!min) {
  console.error(`Unable to parse Node engine requirement: ${required}`);
  process.exit(1);
}

const current = { major, minor, patch };
function satisfies(current, min) {
  if (current.major !== min.major) return current.major > min.major;
  if (current.minor !== min.minor) return current.minor > min.minor;
  return current.patch >= min.patch;
}

if (!satisfies(current, min)) {
  console.error(`Unsupported Node.js version: ${process.version}`);
  console.error(`Required range: ${required}`);
  process.exit(1);
}

console.log(`Node.js ${process.version} satisfies ${required}`);
