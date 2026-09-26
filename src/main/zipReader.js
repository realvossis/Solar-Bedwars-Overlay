'use strict';
// Just enough of the ZIP format to pull one file out of a Minecraft client jar (a jar is a zip):
// find the central directory, look the entry up by name, inflate it. No dependencies.
const fs = require('fs');
const zlib = require('zlib');

const MAX_ENTRY = 8 * 1024 * 1024; // nothing we read is anywhere near this; refuses zip bombs

function readEntry(zipPath, entryName) {
  const buf = fs.readFileSync(zipPath);
  // End-of-central-directory record: last 22 bytes + up to 64 KB of trailing comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === entryName) {
      if (size > MAX_ENTRY || compSize > MAX_ENTRY) throw new Error('entry too large');
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('corrupt local header');
      const start = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
      throw new Error('unsupported compression method ' + method);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

module.exports = { readEntry };
