/** Compare two screenshots pixel by pixel and report how different they are.
 * Usage: node scripts/pixel-diff.cjs before.png after.png [diff-out.png] [tolerance]
 * Writes a JSON summary to stdout: mean absolute channel difference, percentage of pixels
 * beyond the tolerance, and the largest localised change. Used to prove that a model,
 * delivery or styling change did not alter the rendered result unexpectedly.
 */
const fs = require('node:fs');
const zlib = require('node:zlib');

/** Minimal PNG reader for 8-bit RGB/RGBA non-interlaced files (what Chromium emits). */
function decodePng(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);
  let offset = 8, width = 0, height = 0, colorType = 6, bitDepth = 8;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG is not supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error('only 8-bit PNG is supported');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * channels);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const current = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? current[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      current[x] = value & 0xff;
    }
    current.copy(pixels, y * stride);
    previous = current;
  }
  return { width, height, channels, pixels };
}

function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crcTable = encodePng.table ?? (encodePng.table = (() => {
      const table = new Int32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
      return table;
    })());
    let crc = -1;
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const tail = Buffer.alloc(4);
    tail.writeInt32BE((crc ^ -1) | 0, 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const [before, after, diffOut, toleranceArg] = process.argv.slice(2);
if (!before || !after) { console.error('usage: node scripts/pixel-diff.cjs before.png after.png [diff.png] [tolerance]'); process.exit(1); }
const tolerance = Number(toleranceArg || 8);
const a = decodePng(before), b = decodePng(after);
if (a.width !== b.width || a.height !== b.height) { console.error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`); process.exit(1); }
const toRgb = (image, index) => {
  const base = index * image.channels;
  return [image.pixels[base], image.pixels[base + 1], image.pixels[base + 2]];
};
let sum = 0, changed = 0, worst = 0, worstIndex = -1;
const diff = Buffer.alloc(a.width * a.height * 3);
for (let i = 0; i < a.width * a.height; i++) {
  const [r1, g1, b1] = toRgb(a, i), [r2, g2, b2] = toRgb(b, i);
  const delta = (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)) / 3;
  sum += delta;
  if (delta > tolerance) changed++;
  if (delta > worst) { worst = delta; worstIndex = i; }
  diff[i * 3] = Math.min(255, Math.round(delta * 8));
  diff[i * 3 + 1] = delta > tolerance ? 0 : Math.min(255, Math.round(delta * 3));
  diff[i * 3 + 2] = delta > tolerance ? 0 : Math.min(255, Math.round(delta * 3));
}
if (diffOut) fs.writeFileSync(diffOut, encodePng(a.width, a.height, diff));
console.log(JSON.stringify({
  before, after, size: `${a.width}x${a.height}`, tolerance,
  meanAbsoluteDifference: +(sum / (a.width * a.height)).toFixed(3),
  changedPixels: changed,
  changedPercent: +((changed / (a.width * a.height)) * 100).toFixed(3),
  worstPixelDelta: +worst.toFixed(1),
  worstPixelAt: worstIndex >= 0 ? { x: worstIndex % a.width, y: Math.floor(worstIndex / a.width) } : null,
  identical: changed === 0 && sum === 0,
}, null, 2));
