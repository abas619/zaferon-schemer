'use strict';

/**
 * Zero-dependency asset generator.
 *
 *   node build/make-assets.js
 *
 * Produces:
 *   src/assets/sample-photo.png  - default picture for the PhotoSchemer panel
 *
 * A minimal PNG encoder (zlib is part of Node) keeps this dependency-free.
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ *
 *  PNG encoder
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------------ *
 *  Tiny raster canvas
 * ------------------------------------------------------------------ */

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = Buffer.alloc(w * h * 4);
  }

  idx(x, y) {
    return (y * this.w + x) * 4;
  }

  /** Alpha-blend a colour onto the canvas. */
  blend(x, y, [r, g, b], a = 1) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = this.idx(x, y);
    const d = this.data;
    const src = a >= 1 ? 1 : a;
    d[i] = Math.round(d[i] * (1 - src) + r * src);
    d[i + 1] = Math.round(d[i + 1] * (1 - src) + g * src);
    d[i + 2] = Math.round(d[i + 2] * (1 - src) + b * src);
    d[i + 3] = Math.max(d[i + 3], Math.round(255 * src));
  }

  fill(color, a = 1) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.blend(x, y, color, a);
  }

  rect(x0, y0, w, h, color, a = 1) {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++)
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) this.blend(x, y, color, a);
  }

  /** Vertical gradient inside a rect. */
  vGradient(x0, y0, w, h, c0, c1) {
    for (let y = 0; y < h; y++) {
      const t = h <= 1 ? 0 : y / (h - 1);
      const c = [
        c0[0] + (c1[0] - c0[0]) * t,
        c0[1] + (c1[1] - c0[1]) * t,
        c0[2] + (c1[2] - c0[2]) * t
      ];
      this.rect(x0, y0 + y, w, 1, c, 1);
    }
  }

  circle(cx, cy, r, color, a = 1) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.blend(x, y, color, a);
      }
    }
  }

  /** Soft-edged circle for organic shapes. */
  blob(cx, cy, r, color, a = 1, wobble = 0, seed = 0) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r - 2); y <= Math.ceil(cy + r + 2); y++) {
      for (let x = Math.floor(cx - r - 2); x <= Math.ceil(cx + r + 2); x++) {
        const dx = x - cx;
        const dy = y - cy;
        const ang = Math.atan2(dy, dx);
        const rr = r * (1 + wobble * Math.sin(ang * 3 + seed) * 0.5 + wobble * Math.sin(ang * 5 - seed) * 0.35);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= rr) {
          const edge = Math.min(1, (rr - d) / 1.5);
          this.blend(x, y, color, a * edge);
        } else if (d <= rr + 1.6) {
          this.blend(x, y, color, a * Math.max(0, (rr + 1.6 - d) / 1.6) * 0.6);
        }
      }
    }
    void r2;
  }
}

/* ------------------------------------------------------------------ *
 *  Application icon — hand-drawn, not generated
 *
 *  `src/assets/icon.png` (256) and `icon@2x.png` (512) are committed art, the
 *  same as `media/*.png`. This script used to draw a procedural colour disc
 *  into those exact paths, so `npm run assets` quietly replaced the shipped
 *  saffron-flower icon with a superseded design — and the generated file was
 *  byte-identical on every run, which made it look like nothing had changed.
 *  The generator is gone; git history has it.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  Sample photo — a small illustrated landscape
 * ------------------------------------------------------------------ */

function drawSample(w, h) {
  const c = new Canvas(w, h);

  // sky
  c.vGradient(0, 0, w, h, [158, 216, 245], [226, 244, 252]);

  // sun
  c.circle(w * 0.70, h * 0.20, h * 0.085, [250, 205, 60]);
  c.circle(w * 0.70, h * 0.20, h * 0.062, [252, 176, 44]);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    c.circle(
      w * 0.70 + Math.cos(a) * h * 0.105,
      h * 0.20 + Math.sin(a) * h * 0.105,
      h * 0.014,
      [250, 205, 60],
      0.9
    );
  }

  // clouds
  const cloud = (cx, cy, s) => {
    const puffs = [
      [0, 0, 1.0],
      [-0.9, 0.15, 0.72],
      [0.95, 0.18, 0.66],
      [-0.35, -0.45, 0.68],
      [0.45, -0.4, 0.6]
    ];
    puffs.forEach(([dx, dy, r]) => c.blob(cx + dx * s, cy + dy * s, r * s, [255, 255, 255], 1, 0.10, dx * 3));
  };
  cloud(w * 0.36, h * 0.20, h * 0.115);
  cloud(w * 0.88, h * 0.36, h * 0.075);
  cloud(w * 0.08, h * 0.42, h * 0.055);

  // distant hill
  for (let x = 0; x < w; x++) {
    const t = x / w;
    const top =
      h * 0.68 +
      Math.sin(t * 5.2 + 1.1) * h * 0.035 +
      Math.sin(t * 11 + 0.4) * h * 0.016;
    c.rect(x, top, 1, h - top, [96, 176, 92]);
  }

  // main hill
  for (let x = 0; x < w; x++) {
    const t = x / w;
    const top =
      h * 0.78 +
      Math.sin(t * 3.4 - 0.6) * h * 0.045 +
      Math.sin(t * 7.7 + 2.2) * h * 0.018;
    c.rect(x, top, 1, h - top, [74, 158, 74]);
  }

  // grass texture
  for (let i = 0; i < 420; i++) {
    const x = (i * 137.508) % w;
    const y = h * 0.8 + ((i * 71.3) % (h * 0.2));
    c.rect(x, y, 2, 3, [62, 140, 62], 0.35);
  }

  // tree trunk
  const trunkX = w * 0.30;
  for (let y = Math.round(h * 0.42); y < h * 0.86; y++) {
    const t = (y - h * 0.42) / (h * 0.44);
    const halfW = h * (0.017 + t * 0.016);
    const bend = Math.sin(t * 2.4) * h * 0.022;
    for (let x = Math.round(trunkX + bend - halfW); x <= trunkX + bend + halfW; x++) {
      const shade = 1 - Math.abs(x - (trunkX + bend)) / halfW;
      c.blend(x, y, [38 + shade * 14, 46 + shade * 12, 42 + shade * 10], 1);
    }
  }

  // foliage
  const leaves = [
    [0.30, 0.36, 0.155],
    [0.20, 0.42, 0.115],
    [0.41, 0.41, 0.115],
    [0.27, 0.30, 0.105],
    [0.35, 0.28, 0.095],
    [0.16, 0.34, 0.085],
    [0.44, 0.32, 0.08]
  ];
  leaves.forEach(([lx, ly, lr], i) => {
    c.blob(w * lx, h * ly, h * lr, [56, 158, 122], 1, 0.20, i * 1.7);
    c.blob(w * lx - h * 0.012, h * ly - h * 0.014, h * lr * 0.72, [74, 178, 138], 1, 0.22, i * 2.3);
  });

  // apples
  const apples = [
    [0.245, 0.44, 0.033],
    [0.355, 0.31, 0.030],
    [0.20, 0.385, 0.026],
    [0.30, 0.475, 0.027]
  ];
  apples.forEach(([ax, ay, ar]) => {
    c.circle(w * ax, h * ay, h * ar, [214, 40, 62]);
    c.circle(w * ax - h * ar * 0.3, h * ay - h * ar * 0.32, h * ar * 0.42, [236, 92, 108], 0.85);
    c.rect(w * ax - 1, h * ay - h * ar * 1.5, 2, h * ar * 0.7, [90, 60, 30]);
  });

  // vignette-ish softening on the top edge
  c.vGradient(0, 0, w, Math.round(h * 0.04), [255, 255, 255], [158, 216, 245]);

  return c;
}

/* ------------------------------------------------------------------ *
 *  Main
 * ------------------------------------------------------------------ */

function main() {
  const outDir = path.join(__dirname, '..', 'src', 'assets');
  fs.mkdirSync(outDir, { recursive: true });

  const photo = drawSample(900, 600);
  fs.writeFileSync(path.join(outDir, 'sample-photo.png'), encodePng(photo.w, photo.h, photo.data));

  console.log('assets written to', outDir);
  console.log('  sample-photo.png');
  console.log('  icon.png / icon@2x.png are hand-drawn — see the note above');
}

main();
