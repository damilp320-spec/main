// Генерирует иконку приложения (PNG + ICO) без внешних зависимостей.
// Рисует фирменный градиентный скруглённый квадрат с монограммой «N».
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
const VIOLET = [124, 92, 255];
const TEAL = [41, 211, 194];

function roundedAlpha(x, y, size, radius) {
  // Антиалиасинг краёв скруглённого квадрата.
  const r = radius;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dist = Math.hypot(x - cx, y - cy);
  if (dist <= r - 1) return 1;
  if (dist >= r + 1) return 0;
  return (r + 1 - dist) / 2;
}

function nMask(x, y, size) {
  // Монограмма N из двух вертикалей и диагонали.
  const s = size / 256;
  const left = 74 * s, right = 182 * s, barW = 26 * s;
  const top = 74 * s, bot = 182 * s;
  const inBar = (cx) => x >= cx - barW / 2 && x <= cx + barW / 2 && y >= top && y <= bot;
  if (inBar(left + barW / 2) || inBar(right - barW / 2 + barW / 2 - barW / 2)) {}
  const lc = left + barW / 2, rc = right - barW / 2;
  if (x >= lc - barW / 2 && x <= lc + barW / 2 && y >= top && y <= bot) return true;
  if (x >= rc - barW / 2 && x <= rc + barW / 2 && y >= top && y <= bot) return true;
  // Диагональ.
  const t = (y - top) / (bot - top);
  if (t >= 0 && t <= 1) {
    const dc = lc + (rc - lc) * t;
    if (Math.abs(x - dc) <= barW / 1.7) return true;
  }
  return false;
}

function renderRGBA(size) {
  const buf = Buffer.alloc(size * size * 4);
  const radius = Math.round(size * 0.22);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const t = (x + y) / (2 * size); // диагональный градиент
      let r = lerp(VIOLET[0], TEAL[0], t);
      let g = lerp(VIOLET[1], TEAL[1], t);
      let b = lerp(VIOLET[2], TEAL[2], t);
      const baseA = roundedAlpha(x, y, size, radius);
      if (nMask(x, y, size)) { r = 255; g = 255; b = 255; } // белая монограмма
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = Math.round(255 * baseA);
    }
  }
  return buf;
}

function encodePNG(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }

function encodeICO(pngBuf, size) {
  // ICO с одним PNG-изображением (поддерживается Windows Vista+).
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8); entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([header, entry, pngBuf]);
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });

const png512 = encodePNG(renderRGBA(512), 512);
fs.writeFileSync(path.join(outDir, 'icon.png'), png512);

const png256 = encodePNG(renderRGBA(256), 256);
fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeICO(png256, 256));

console.log('Иконки созданы: build/icon.png (512), build/icon.ico (256)');
