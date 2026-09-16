/* ==================================================================
 * Color engine — conversions, perception, harmonies, mixing.
 * Everything is a plain object: { r, g, b } for RGB, { h, s, v } for HSV
 * (h in degrees, s/v in 0..1), { h, s, l } for HSL.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});
  const { clamp, wrapHue, round } = CS.Util;

  /* ------------------------------------------------------------------ *
   * Parsing / formatting
   * ------------------------------------------------------------------ */

  const HEX3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;
  const HEX6 = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
  const HEX8 = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
  const RGB_FN = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*[\d.]+\s*)?\)$/i;
  const HSL_FN = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*[\d.]+\s*)?\)$/i;

  /**
   * Parse just about any colour string. Returns { r, g, b } or null.
   */
  function parse(input) {
    if (input == null) return null;
    if (typeof input === 'object' && 'r' in input) return { r: input.r | 0, g: input.g | 0, b: input.b | 0 };

    const str = String(input).trim();
    if (!str) return null;

    let m = str.match(HEX6);
    if (m) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };

    m = str.match(HEX3);
    if (m) return { r: parseInt(m[1] + m[1], 16), g: parseInt(m[2] + m[2], 16), b: parseInt(m[3] + m[3], 16) };

    m = str.match(HEX8);
    if (m) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };

    m = str.match(RGB_FN);
    if (m) return { r: clamp255(+m[1]), g: clamp255(+m[2]), b: clamp255(+m[3]) };

    m = str.match(HSL_FN);
    if (m) return hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);

    // bare 6-digit hex without the hash
    if (/^[0-9a-f]{6}$/i.test(str)) {
      return { r: parseInt(str.slice(0, 2), 16), g: parseInt(str.slice(2, 4), 16), b: parseInt(str.slice(4, 6), 16) };
    }

    return null;
  }

  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

  function toHex(rgb, withHash = true) {
    const p = (v) => clamp255(v).toString(16).padStart(2, '0');
    return (withHash ? '#' : '') + p(rgb.r) + p(rgb.g) + p(rgb.b);
  }

  function toHexUpper(rgb) {
    return toHex(rgb).toUpperCase();
  }

  function toCssRgb(rgb) {
    return `rgb(${clamp255(rgb.r)}, ${clamp255(rgb.g)}, ${clamp255(rgb.b)})`;
  }

  function toCssHsl(rgb) {
    const { h, s, l } = rgbToHsl(rgb);
    return `hsl(${round(h, 1)}, ${round(s * 100, 1)}%, ${round(l * 100, 1)}%)`;
  }

  /* ------------------------------------------------------------------ *
   * RGB <-> HSV
   * ------------------------------------------------------------------ */

  function rgbToHsv(rgb) {
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;

    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }

    return { h: wrapHue(h), s: max === 0 ? 0 : d / max, v: max };
  }

  function hsvToRgb(hsv) {
    const h = wrapHue(hsv.h);
    const s = clamp(hsv.s);
    const v = clamp(hsv.v);

    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    return { r: clamp255((r + m) * 255), g: clamp255((g + m) * 255), b: clamp255((b + m) * 255) };
  }

  /* ------------------------------------------------------------------ *
   * RGB <-> HSL
   * ------------------------------------------------------------------ */

  function rgbToHsl(rgb) {
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 2;

    let h = 0;
    let s = 0;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: wrapHue(h), s, l };
  }

  function hslToRgb(h, s, l) {
    h = wrapHue(h);
    s = clamp(s);
    l = clamp(l);

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;

    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    return { r: clamp255((r + m) * 255), g: clamp255((g + m) * 255), b: clamp255((b + m) * 255) };
  }

  /* ------------------------------------------------------------------ *
   * RGB <-> CMY
   * ------------------------------------------------------------------ */

  function rgbToCmy(rgb) {
    return { c: 1 - rgb.r / 255, m: 1 - rgb.g / 255, y: 1 - rgb.b / 255 };
  }

  function cmyToRgb(cmy) {
    return {
      r: clamp255(255 * (1 - clamp(cmy.c))),
      g: clamp255(255 * (1 - clamp(cmy.m))),
      b: clamp255(255 * (1 - clamp(cmy.y)))
    };
  }

  /* ------------------------------------------------------------------ *
   * RGB <-> YIQ (NTSC, FCC coefficients)
   * ------------------------------------------------------------------ */

  function rgbToYiq(rgb) {
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    // Full-range YIQ; I/Q are reported on the standard -0.5957..0.5957 scale.
    return {
      y: r * 0.299 + g * 0.587 + b * 0.114,
      i: r * 0.5959 - g * 0.2746 - b * 0.3213,
      q: r * 0.2115 - g * 0.5227 + b * 0.3112
    };
  }

  function yiqToRgb(yiq) {
    const { y, i, q } = yiq;
    return {
      r: clamp255(255 * (y + 0.9563 * i + 0.621 * q)),
      g: clamp255(255 * (y - 0.2721 * i - 0.6474 * q)),
      b: clamp255(255 * (y - 1.107 * i + 1.7046 * q))
    };
  }

  /* ------------------------------------------------------------------ *
   * RGB <-> CMYK
   * ------------------------------------------------------------------ */

  function rgbToCmyk(rgb) {
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const k = 1 - Math.max(r, g, b);
    if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };
    return {
      c: (1 - r - k) / (1 - k),
      m: (1 - g - k) / (1 - k),
      y: (1 - b - k) / (1 - k),
      k
    };
  }

  function cmykToRgb(cmyk) {
    const { c, m, y, k } = cmyk;
    return {
      r: clamp255(255 * (1 - c) * (1 - k)),
      g: clamp255(255 * (1 - m) * (1 - k)),
      b: clamp255(255 * (1 - y) * (1 - k))
    };
  }

  /* ------------------------------------------------------------------ *
   * XYZ / Lab (D65)
   * ------------------------------------------------------------------ */

  const WHITE_D65 = { x: 95.047, y: 100.0, z: 108.883 };

  function srgbToLinear(v) {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(v) {
    const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return clamp255(c * 255);
  }

  function rgbToXyz(rgb) {
    const r = srgbToLinear(rgb.r) * 100;
    const g = srgbToLinear(rgb.g) * 100;
    const b = srgbToLinear(rgb.b) * 100;
    return {
      x: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
      y: r * 0.2126729 + g * 0.7151522 + b * 0.072175,
      z: r * 0.0193339 + g * 0.119192 + b * 0.9503041
    };
  }

  function xyzToRgb(xyz) {
    const { x, y, z } = xyz;
    const r = (x * 3.2404542 + y * -1.5371385 + z * -0.4985314) / 100;
    const g = (x * -0.969266 + y * 1.8760108 + z * 0.041556) / 100;
    const b = (x * 0.0556434 + y * -0.2040259 + z * 1.0572252) / 100;
    return { r: linearToSrgb(clamp(r)), g: linearToSrgb(clamp(g)), b: linearToSrgb(clamp(b)) };
  }

  function xyzToLab(xyz) {
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(xyz.x / WHITE_D65.x);
    const fy = f(xyz.y / WHITE_D65.y);
    const fz = f(xyz.z / WHITE_D65.z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  function labToXyz(lab) {
    const fy = (lab.L + 16) / 116;
    const fx = fy + lab.a / 500;
    const fz = fy - lab.b / 200;
    const inv = (t) => {
      const t3 = t * t * t;
      return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
    };
    return {
      x: inv(fx) * WHITE_D65.x,
      y: inv(fy) * WHITE_D65.y,
      z: inv(fz) * WHITE_D65.z
    };
  }

  const rgbToLab = (rgb) => xyzToLab(rgbToXyz(rgb));
  const labToRgb = (lab) => xyzToRgb(labToXyz(lab));

  /* ------------------------------------------------------------------ *
   * Perception
   * ------------------------------------------------------------------ */

  function relativeLuminance(rgb) {
    return 0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b);
  }

  /** WCAG contrast ratio, 1..21 */
  function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** Perceptual distance (CIE76 in Lab). */
  function deltaE(a, b) {
    const la = rgbToLab(a);
    const lb = rgbToLab(b);
    return Math.sqrt(Math.pow(la.L - lb.L, 2) + Math.pow(la.a - lb.a, 2) + Math.pow(la.b - lb.b, 2));
  }

  /** Pick black or white for maximum readability on a background. */
  function readableText(rgb) {
    return contrastRatio(rgb, { r: 255, g: 255, b: 255 }) >= contrastRatio(rgb, { r: 0, g: 0, b: 0 })
      ? { r: 255, g: 255, b: 255 }
      : { r: 0, g: 0, b: 0 };
  }

  function isDark(rgb) {
    return relativeLuminance(rgb) < 0.35;
  }

  /* ------------------------------------------------------------------ *
   * Websafe
   * ------------------------------------------------------------------ */

  function toWebsafe(rgb) {
    const q = (v) => clamp255(Math.round(clamp255(v) / 51) * 51);
    return { r: q(rgb.r), g: q(rgb.g), b: q(rgb.b) };
  }

  function isWebsafe(rgb) {
    return [rgb.r, rgb.g, rgb.b].every((v) => v % 51 === 0);
  }

  /* ------------------------------------------------------------------ *
   * Colour vision deficiency (Machado, Oliveira & Fernandes 2009)
   * ------------------------------------------------------------------ */

  const CVD_MATRICES = {
    protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
    deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
    tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
    protanomaly: [0.458064, 0.679578, -0.137642, 0.092785, 0.846313, 0.060902, -0.007494, -0.016807, 1.024301],
    deuteranomaly: [0.547494, 0.607765, -0.155259, 0.181692, 0.781742, 0.036566, -0.01041, 0.027275, 0.983136],
    tritanomaly: [1.017277, 0.027029, -0.044306, -0.006113, 0.958479, 0.047634, 0.006379, 0.248708, 0.744913]
  };

  const CVD_TYPES = [
    { id: 'none', label: 'None' },
    { id: 'protanopia', label: 'Protanopia (no red)' },
    { id: 'protanomaly', label: 'Protanomaly (weak red)' },
    { id: 'deuteranopia', label: 'Deuteranopia (no green)' },
    { id: 'deuteranomaly', label: 'Deuteranomaly (weak green)' },
    { id: 'tritanopia', label: 'Tritanopia (no blue)' },
    { id: 'tritanomaly', label: 'Tritanomaly (weak blue)' },
    { id: 'achromatopsia', label: 'Achromatopsia (no colour)' },
    { id: 'grayscale', label: 'Grayscale' }
  ];

  function simulateCvd(rgb, type) {
    if (!type || type === 'none') return { r: rgb.r, g: rgb.g, b: rgb.b };

    if (type === 'achromatopsia') {
      const y = clamp255(relativeLuminance(rgb) * 255);
      return { r: y, g: y, b: y };
    }
    if (type === 'grayscale') {
      const y = clamp255(0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b);
      return { r: y, g: y, b: y };
    }

    const m = CVD_MATRICES[type];
    if (!m) return { r: rgb.r, g: rgb.g, b: rgb.b };

    const lr = srgbToLinear(rgb.r);
    const lg = srgbToLinear(rgb.g);
    const lb = srgbToLinear(rgb.b);

    const r = m[0] * lr + m[1] * lg + m[2] * lb;
    const g = m[3] * lr + m[4] * lg + m[5] * lb;
    const b = m[6] * lr + m[7] * lg + m[8] * lb;

    return { r: linearToSrgb(clamp(r)), g: linearToSrgb(clamp(g)), b: linearToSrgb(clamp(b)) };
  }

  /* ------------------------------------------------------------------ *
   * Mixing
   * ------------------------------------------------------------------ */

  const MIX_SPACES = [
    { id: 'rgb', label: 'RGB' },
    { id: 'linear', label: 'Linear RGB' },
    { id: 'hsv', label: 'HSV' },
    { id: 'hsl', label: 'HSL' },
    { id: 'lab', label: 'CIELAB' },
    { id: 'cmyk', label: 'CMYK' }
  ];

  function mix(a, b, t, space = 'lab') {
    t = clamp(t);
    switch (space) {
      case 'rgb':
        return {
          r: clamp255(a.r + (b.r - a.r) * t),
          g: clamp255(a.g + (b.g - a.g) * t),
          b: clamp255(a.b + (b.b - a.b) * t)
        };
      case 'linear': {
        const lr = srgbToLinear(a.r) + (srgbToLinear(b.r) - srgbToLinear(a.r)) * t;
        const lg = srgbToLinear(a.g) + (srgbToLinear(b.g) - srgbToLinear(a.g)) * t;
        const lb = srgbToLinear(a.b) + (srgbToLinear(b.b) - srgbToLinear(a.b)) * t;
        return { r: linearToSrgb(lr), g: linearToSrgb(lg), b: linearToSrgb(lb) };
      }
      case 'hsv': {
        const ha = rgbToHsv(a);
        const hb = rgbToHsv(b);
        const d = CS.Util.hueDelta(ha.h, hb.h);
        return hsvToRgb({
          h: ha.h + d * t,
          s: ha.s + (hb.s - ha.s) * t,
          v: ha.v + (hb.v - ha.v) * t
        });
      }
      case 'hsl': {
        const ha = rgbToHsl(a);
        const hb = rgbToHsl(b);
        const d = CS.Util.hueDelta(ha.h, hb.h);
        return hslToRgb(ha.h + d * t, ha.s + (hb.s - ha.s) * t, ha.l + (hb.l - ha.l) * t);
      }
      case 'cmyk': {
        const ca = rgbToCmyk(a);
        const cb = rgbToCmyk(b);
        return cmykToRgb({
          c: ca.c + (cb.c - ca.c) * t,
          m: ca.m + (cb.m - ca.m) * t,
          y: ca.y + (cb.y - ca.y) * t,
          k: ca.k + (cb.k - ca.k) * t
        });
      }
      case 'lab':
      default: {
        const la = rgbToLab(a);
        const lb = rgbToLab(b);
        return labToRgb({
          L: la.L + (lb.L - la.L) * t,
          a: la.a + (lb.a - la.a) * t,
          b: la.b + (lb.b - la.b) * t
        });
      }
    }
  }

  /** A ramp of `steps` colours between a and b (inclusive). */
  function ramp(a, b, steps, space = 'lab') {
    steps = Math.max(2, Math.round(steps));
    const out = [];
    for (let i = 0; i < steps; i++) out.push(mix(a, b, i / (steps - 1), space));
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Harmonies
   * ------------------------------------------------------------------ */

  const SCHEMES = [
    { id: 'complementary', label: 'Complements', short: 'COMPLEMENTS' },
    { id: 'split-complementary', label: 'Split Complements', short: 'SPLIT COMPLEMENTS' },
    { id: 'analogous', label: 'Analogous', short: 'ANALOGOUS' },
    { id: 'accented-analogous', label: 'Accented Analogous', short: 'ACCENTED ANALOGOUS' },
    { id: 'triadic', label: 'Triads', short: 'TRIADS' },
    { id: 'tetradic', label: 'Tetrads', short: 'TETRADS' },
    { id: 'square', label: 'Square', short: 'SQUARE' },
    { id: 'rectangle', label: 'Rectangle', short: 'RECTANGLE' },
    { id: 'monochromatic', label: 'Monochromatic', short: 'MONOCHROMATIC' },
    { id: 'shades', label: 'Shades', short: 'SHADES' },
    { id: 'tints', label: 'Tints', short: 'TINTS' },
    { id: 'tones', label: 'Tones', short: 'TONES' },
    { id: 'clash', label: 'Clash', short: 'CLASH' },
    { id: 'five-tone', label: 'Five-Tone', short: 'FIVE-TONE' },
    { id: 'six-tone', label: 'Six-Tone', short: 'SIX-TONE' },
    { id: 'neutral', label: 'Neutral', short: 'NEUTRAL' }
  ];

  const SCHEME_DEFS = {
    complementary: [{ dh: 0 }, { dh: 180 }],
    'split-complementary': [{ dh: 0 }, { dh: 150 }, { dh: 210 }],
    analogous: [{ dh: -60 }, { dh: -30 }, { dh: 0 }, { dh: 30 }, { dh: 60 }],
    'accented-analogous': [{ dh: -30 }, { dh: 0 }, { dh: 30 }, { dh: 180 }],
    triadic: [{ dh: 0 }, { dh: 120 }, { dh: 240 }],
    tetradic: [{ dh: 0 }, { dh: 90 }, { dh: 180 }, { dh: 270 }],
    square: [{ dh: 0 }, { dh: 90 }, { dh: 180 }, { dh: 270 }],
    rectangle: [{ dh: 0 }, { dh: 60 }, { dh: 180 }, { dh: 240 }],
    monochromatic: [
      { dh: 0, dv: 0 },
      { dh: 0, dv: -0.22, ds: -0.1 },
      { dh: 0, dv: -0.42, ds: -0.2 },
      { dh: 0, dv: 0.18, ds: -0.3 },
      { dh: 0, dv: 0.34, ds: -0.55 }
    ],
    shades: [
      { dh: 0, dv: 0 },
      { dh: 0, dv: -0.18 },
      { dh: 0, dv: -0.34 },
      { dh: 0, dv: -0.5 },
      { dh: 0, dv: -0.66 }
    ],
    tints: [
      { dh: 0, dv: 0, ds: 0 },
      { dh: 0, dv: 0.14, ds: -0.2 },
      { dh: 0, dv: 0.26, ds: -0.4 },
      { dh: 0, dv: 0.36, ds: -0.6 },
      { dh: 0, dv: 0.44, ds: -0.8 }
    ],
    tones: [
      { dh: 0 },
      { dh: 0, ds: -0.2 },
      { dh: 0, ds: -0.4, dv: -0.08 },
      { dh: 0, ds: -0.6, dv: -0.16 },
      { dh: 0, ds: -0.8, dv: -0.24 }
    ],
    clash: [{ dh: 0 }, { dh: 90 }, { dh: 270 }],
    'five-tone': [{ dh: 0 }, { dh: 72 }, { dh: 144 }, { dh: 216 }, { dh: 288 }],
    'six-tone': [{ dh: 0 }, { dh: 60 }, { dh: 120 }, { dh: 180 }, { dh: 240 }, { dh: 300 }],
    neutral: [{ dh: 0 }, { dh: 30 }, { dh: 60 }, { dh: 180 }, { dh: 210 }]
  };

  /**
   * Build a harmony from a base colour.
   * @returns {{h,s,v}[]}
   */
  function harmony(hsv, schemeId) {
    const def = SCHEME_DEFS[schemeId] || SCHEME_DEFS.complementary;
    return def.map((d) => ({
      h: wrapHue(hsv.h + (d.dh || 0)),
      s: clamp(hsv.s + (d.ds || 0)),
      v: clamp(hsv.v + (d.dv || 0))
    }));
  }

  function harmonyRgb(hsv, schemeId) {
    return harmony(hsv, schemeId).map(hsvToRgb);
  }

  function schemeLabel(schemeId) {
    const s = SCHEMES.find((x) => x.id === schemeId);
    return s ? s.short : 'COMPLEMENTS';
  }

  /* ------------------------------------------------------------------ *
   * Random
   * ------------------------------------------------------------------ */

  function randomHsv(opts = {}) {
    const sMin = opts.sMin == null ? 0.35 : opts.sMin;
    const vMin = opts.vMin == null ? 0.45 : opts.vMin;
    return {
      h: Math.random() * 360,
      s: sMin + Math.random() * (1 - sMin),
      v: vMin + Math.random() * (1 - vMin)
    };
  }

  function randomRgb(opts) {
    return hsvToRgb(randomHsv(opts));
  }

  /* ------------------------------------------------------------------ *
   * Nearest named colour
   * ------------------------------------------------------------------ */

  function nearestNamed(rgb, list) {
    if (!list || !list.length) return null;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const d = deltaE(rgb, c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best ? { color: best, distance: bestD } : null;
  }

  /* ------------------------------------------------------------------ *
   * Quantisation (median cut) — used by PhotoSchemer
   * ------------------------------------------------------------------ */

  function quantize(pixels, count) {
    // pixels: Uint8ClampedArray RGBA
    const samples = [];
    const step = Math.max(4, Math.floor(pixels.length / 4 / 12000) * 4);
    for (let i = 0; i < pixels.length; i += step) {
      if (pixels[i + 3] < 128) continue;
      samples.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
    }
    if (!samples.length) return [];

    let buckets = [samples];
    while (buckets.length < count) {
      // split the bucket with the largest channel spread
      let target = -1;
      let targetScore = -1;
      let targetChannel = 0;
      for (let i = 0; i < buckets.length; i++) {
        const b = buckets[i];
        if (b.length < 2) continue;
        let min = [255, 255, 255];
        let max = [0, 0, 0];
        for (const p of b) {
          for (let c = 0; c < 3; c++) {
            if (p[c] < min[c]) min[c] = p[c];
            if (p[c] > max[c]) max[c] = p[c];
          }
        }
        const spread = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
        const score = Math.max(...spread) * Math.log(b.length + 1);
        if (score > targetScore) {
          targetScore = score;
          target = i;
          targetChannel = spread.indexOf(Math.max(...spread));
        }
      }
      if (target < 0) break;

      const bucket = buckets[target];
      bucket.sort((p, q) => p[targetChannel] - q[targetChannel]);
      const mid = Math.floor(bucket.length / 2);
      buckets.splice(target, 1, bucket.slice(0, mid), bucket.slice(mid));
    }

    return buckets
      .filter((b) => b.length)
      .map((b) => {
        let r = 0;
        let g = 0;
        let bl = 0;
        for (const p of b) {
          r += p[0];
          g += p[1];
          bl += p[2];
        }
        return { r: Math.round(r / b.length), g: Math.round(g / b.length), b: Math.round(bl / b.length) };
      })
      .sort((a, b) => relativeLuminance(b) - relativeLuminance(a));
  }

  /* ------------------------------------------------------------------ *
   * Universal formatter — one colour, every space
   * ------------------------------------------------------------------ */

  /**
   * Every representation we know how to render, as display-ready strings.
   * `decimals` controls fractional precision for the non-integer spaces.
   */
  function formatAll(rgb, decimals = 2) {
    const r = clamp255(rgb.r);
    const g = clamp255(rgb.g);
    const b = clamp255(rgb.b);
    const px = { r, g, b };

    const hsv = rgbToHsv(px);
    const hsl = rgbToHsl(px);
    const cmy = rgbToCmy(px);
    const cmyk = rgbToCmyk(px);
    const xyz = rgbToXyz(px);
    const yiq = rgbToYiq(px);
    const d = decimals;

    return {
      hex: toHexUpper(px),
      hexLower: toHex(px),
      rgb: { values: [r, g, b], text: `rgb(${r}, ${g}, ${b})` },
      rgbPct: {
        values: [r, g, b],
        text: `rgb(${round((r / 255) * 100, d)}%, ${round((g / 255) * 100, d)}%, ${round((b / 255) * 100, d)}%)`
      },
      cmy: {
        values: [cmy.c, cmy.m, cmy.y],
        text: `cmy(${round(cmy.c * 100, d)}%, ${round(cmy.m * 100, d)}%, ${round(cmy.y * 100, d)}%)`
      },
      cmyk: {
        values: [cmyk.c, cmyk.m, cmyk.y, cmyk.k],
        text: `cmyk(${round(cmyk.c * 100, d)}%, ${round(cmyk.m * 100, d)}%, ${round(cmyk.y * 100, d)}%, ${round(cmyk.k * 100, d)}%)`
      },
      hsl: {
        values: [hsl.h, hsl.s, hsl.l],
        text: `hsl(${round(hsl.h, 1)}, ${round(hsl.s * 100, d)}%, ${round(hsl.l * 100, d)}%)`
      },
      hsv: {
        values: [hsv.h, hsv.s, hsv.v],
        text: `hsv(${round(hsv.h, 1)}, ${round(hsv.s * 100, d)}%, ${round(hsv.v * 100, d)}%)`
      },
      xyz: {
        values: [xyz.x, xyz.y, xyz.z],
        text: `xyz(${round(xyz.x, d)}, ${round(xyz.y, d)}, ${round(xyz.z, d)})`
      },
      yiq: {
        values: [yiq.y, yiq.i, yiq.q],
        text: `yiq(${round(yiq.y * 100, d)}%, ${round(yiq.i * 100, d)}%, ${round(yiq.q * 100, d)}%)`
      }
    };
  }

  /** Parsed numeric channels, label + unit, for tabular display. */
  const FORMAT_DEFS = [
    { id: 'hex', label: 'HEX', raw: 'hex' },
    { id: 'rgb', label: 'RGB', raw: 'rgb' },
    { id: 'cmy', label: 'CMY', raw: 'cmy' },
    { id: 'cmyk', label: 'CMYK', raw: 'cmyk' },
    { id: 'hsl', label: 'HSL', raw: 'hsl' },
    { id: 'hsv', label: 'HSV', raw: 'hsv' },
    { id: 'xyz', label: 'XYZ', raw: 'xyz' },
    { id: 'yiq', label: 'YIQ', raw: 'yiq' }
  ];

  /* ------------------------------------------------------------------ *
   * Exports
   * ------------------------------------------------------------------ */

  CS.Color = {
    parse,
    toHex,
    toHexUpper,
    toCssRgb,
    toCssHsl,
    clamp255,

    rgbToHsv,
    hsvToRgb,
    rgbToHsl,
    hslToRgb,
    rgbToCmy,
    cmyToRgb,
    rgbToCmyk,
    cmykToRgb,
    rgbToXyz,
    xyzToRgb,
    rgbToYiq,
    yiqToRgb,
    rgbToLab,
    labToRgb,

    formatAll,
    FORMAT_DEFS,

    relativeLuminance,
    contrastRatio,
    deltaE,
    readableText,
    isDark,

    toWebsafe,
    isWebsafe,

    simulateCvd,
    CVD_TYPES,
    CVD_MATRICES,

    mix,
    ramp,
    MIX_SPACES,

    SCHEMES,
    SCHEME_DEFS,
    harmony,
    harmonyRgb,
    schemeLabel,

    randomHsv,
    randomRgb,
    nearestNamed,
    quantize
  };
})();
