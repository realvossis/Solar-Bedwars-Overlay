'use strict';
// Runs every *.test.js in this folder, each in its own process. Run: npm test
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let failed = 0;
for (const f of fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort()) {
  console.log('\n== ' + f);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} test file(s) failed` : '\nall test files passed');
process.exit(failed ? 1 : 0);
