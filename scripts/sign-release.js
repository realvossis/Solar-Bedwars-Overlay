'use strict';
// Writes dist/SHA256SUMS.txt (hash of each release exe, under the name GitHub will give it) and
// dist/SHA256SUMS.txt.sig (Ed25519 signature, base64). Upload all four files to the release; the
// updater refuses anything not listed in a correctly signed SHA256SUMS.txt.
//
// The private key never goes in the repo: SOLAR_SIGNING_KEY or ~/.solar-overlay-release/signing-key.pem.
// Run after `npm run dist`:  node scripts/sign-release.js
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RELEASE_PUBLIC_KEY } = require('../src/main/updater');

const version = require('../package.json').version;
const dist = path.join(__dirname, '..', 'dist');
const keyFile = process.env.SOLAR_SIGNING_KEY || path.join(os.homedir(), '.solar-overlay-release', 'signing-key.pem');
const files = [`Solar Overlay ${version}.exe`, `Solar Overlay Setup ${version}.exe`];

const key = crypto.createPrivateKey(fs.readFileSync(keyFile));
// Refuse to sign with a key the shipped app wouldn't accept.
if (crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }).trim() !== RELEASE_PUBLIC_KEY.trim()) {
  console.error('This key does not match RELEASE_PUBLIC_KEY in src/main/updater.js - refusing to sign.');
  process.exit(1);
}
const lines = files.map((f) => {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dist, f))).digest('hex');
  return `${hash}  ${f.replace(/ /g, '.')}`; // GitHub turns spaces in asset names into dots
});
const sums = lines.join('\n') + '\n';
const sig = crypto.sign(null, Buffer.from(sums), key).toString('base64');
if (!crypto.verify(null, Buffer.from(sums), RELEASE_PUBLIC_KEY, Buffer.from(sig, 'base64'))) throw new Error('self-check failed');
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), sums);
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt.sig'), sig + '\n');
console.log(sums + 'signed -> dist/SHA256SUMS.txt.sig');
