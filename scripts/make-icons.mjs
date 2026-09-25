// Draws the toolbar icon (blue rounded square, white I-beam, yellow "edited" dot) as PNGs.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function shade(u, v) {
  // u, v in [0,1]. Returns [r,g,b,a] or null.
  const r = 0.22;
  const dx = Math.max(r - u, 0, u - (1 - r));
  const dy = Math.max(r - v, 0, v - (1 - r));
  if (dx * dx + dy * dy > r * r) return null;
  // yellow dot, top-right
  if ((u - 0.76) ** 2 + (v - 0.24) ** 2 < 0.105 ** 2) return [250, 204, 21, 255];
  if ((u - 0.76) ** 2 + (v - 0.24) ** 2 < 0.15 ** 2) return [59, 130, 246, 255];
  // I-beam
  const stem = Math.abs(u - 0.44) < 0.055 && v > 0.22 && v < 0.78;
  const serif = (Math.abs(v - 0.22) < 0.05 || Math.abs(v - 0.78) < 0.05) && Math.abs(u - 0.44) < 0.16;
  if (stem || serif) return [255, 255, 255, 255];
  return [59, 130, 246, 255];
}

function png(size) {
  const ss = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const px = shade((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
        if (px) { r += px[0] * px[3]; g += px[1] * px[3]; b += px[2] * px[3]; a += px[3]; }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = a / (ss * ss);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

await mkdir('public/icon', { recursive: true });
for (const size of [16, 32, 48, 96, 128]) await writeFile(`public/icon/${size}.png`, png(size));
console.log('icons written');
