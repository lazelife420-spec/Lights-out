const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

(async () => {
  const dir = path.resolve(__dirname, '../docs/proof/v11.1.2/settings-runtime/screenshots');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
  const issues = [];
  for (const f of files) {
    const full = path.join(dir, f);
    const meta = await sharp(full).metadata();
    const stats = await sharp(full).stats();
    const size = fs.statSync(full).size;
    const channel = stats.channels[0];
    const isBlank = channel.max === channel.min;
    const mostlyBlank = channel.mean < 2 || channel.mean > 253;
    if (isBlank || mostlyBlank) issues.push(`${f}: likely blank (mean ${channel.mean})`);
    else console.log(`OK ${f}\t${meta.width}x${meta.height}\t${size}\tmean=${channel.mean.toFixed(1)}`);
  }
  if (issues.length) {
    console.error('Issues found:');
    for (const i of issues) console.error(i);
    process.exit(1);
  } else {
    console.log('All', files.length, 'screenshots inspected and non-blank.');
  }
})();
