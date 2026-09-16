'use strict';

/**
 * One-shot: rewrite the hard-coded colour literals in app/widgets/panels
 * to the design tokens in tokens.css.
 *
 *   node build/tmp-migrate.js --dry      report only
 *   node build/tmp-migrate.js            write the files
 *
 * Property-aware on purpose: `#fff` is a surface in `background:` but the
 * "on accent" ink in `color:` and a marker ring in `border:`. A blind
 * find/replace gets two of those three wrong.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'styles');
const FILES = ['app.css', 'widgets.css', 'panels.css'];
const DRY = process.argv.includes('--dry');

/* Surfaces — anything that fills an area. */
const SURFACE = {
  '#ffffff': 'var(--surface)',
  '#fff': 'var(--surface)',
  '#fdfdfd': 'var(--surface)',
  '#fbfbfb': 'var(--surface-2)',
  '#fafafa': 'var(--surface-2)',
  '#f7f7f7': 'var(--surface-2)',
  '#f5f5f5': 'var(--surface-2)',
  '#f2f2f2': 'var(--surface-3)',
  '#f0f0f0': 'var(--surface-3)',
  '#efefef': 'var(--surface-3)',
  '#eef0f1': 'var(--surface-3)',
  '#ececec': 'var(--hover)',
  '#ebebeb': 'var(--hover)',
  '#e9e9e9': 'var(--hover)',
  '#e8e8e8': 'var(--hover)',
  '#e6e6e6': 'var(--hover)',
  '#e4e4e4': 'var(--hover)',
  '#e0e0e0': 'var(--hover)',
  '#dedede': 'var(--border)',
  '#dcdcdc': 'var(--border)',
  '#d9d9d9': 'var(--border)',
  '#d8d8d8': 'var(--border)',
  '#d5d5d5': 'var(--border)',
  '#d4d4d4': 'var(--border)',
  '#d0d0d0': 'var(--border)',
  '#cdcdcd': 'var(--border-2)',
  '#c8c8c8': 'var(--border-2)',
  '#c6c6c6': 'var(--border-2)',
  '#c4c4c4': 'var(--border-2)',
  '#bdbdbd': 'var(--border-2)',
  '#b8b8b8': 'var(--border-3)',
  '#b4b4b4': 'var(--border-3)',
  '#b0b0b0': 'var(--border-3)',
  '#adadad': 'var(--border-3)',
  '#e6effa': 'var(--focus-soft)',
  '#d6e6f7': 'var(--focus-soft)',
  '#e3f0fb': 'var(--focus-soft)',
  '#dbeaf9': 'var(--focus-soft)',
  '#dceaf8': 'var(--focus-soft)',
  '#d3e2f2': 'var(--focus-soft)',
  '#cfe3f7': 'var(--focus-soft)',
  '#cfe0f3': 'var(--focus-soft)',
  '#f4faff': 'var(--focus-soft)',
  '#b9d4f0': 'var(--focus-line)',
  '#a8c8e8': 'var(--focus-line)',
  '#c9dff5': 'var(--focus-line)',
  '#eaf7e7': 'var(--accent-soft)',
  '#eef8ec': 'var(--accent-soft)',
  '#e2f0df': 'var(--accent-soft)',
  '#f4fbf3': 'var(--accent-soft)',
  '#d5ecd0': 'var(--accent-line)',
  '#b6dcae': 'var(--accent-line)',
  '#fdeeec': 'var(--danger-soft)',
  '#e8b4b0': 'var(--danger-line)',
  '#e6b6b0': 'var(--danger-line)',
  '#ffffe1': 'var(--warn-soft)',
  '#ffe082': 'var(--warn-soft)',
  /* solid accent / danger fills */
  '#3f8f34': 'var(--accent)',
  '#4aa03d': 'var(--accent)',
  '#5f9c50': 'var(--accent)',
  '#7ecb6c': 'var(--accent-hi)',
  '#93d982': 'var(--accent-hi)',
  '#e05a4a': 'var(--danger)',
  '#c0392b': 'var(--danger)',
  /* near-black wells (the mixer grid) */
  '#1a1a1a': 'var(--text)'
};

/* Ink — anything that draws text or a glyph. */
const INK = {
  '#a8a8a8': 'var(--text-mute)',
  '#a0a0a0': 'var(--text-mute)',
  '#9e9e9e': 'var(--text-mute)',
  '#9c9c9c': 'var(--text-mute)',
  '#9a9a9a': 'var(--text-mute)',
  '#999': 'var(--text-mute)',
  '#909090': 'var(--text-mute)',
  '#8f8f8f': 'var(--text-mute)',
  '#8e8e8e': 'var(--text-mute)',
  '#8c8c8c': 'var(--text-mute)',
  '#8a8a8a': 'var(--text-mute)',
  '#8f8f8f': 'var(--text-mute)',
  '#777': 'var(--text-dim)',
  '#767676': 'var(--text-dim)',
  '#6b6b6b': 'var(--text-dim)',
  '#666': 'var(--text-dim)',
  '#555': 'var(--text-dim)',
  '#444': 'var(--text-dim)',
  '#3a3a3a': 'var(--text)',
  '#333': 'var(--text)',
  '#2a2a2a': 'var(--text)',
  '#222': 'var(--text)',
  '#1b1b1b': 'var(--text)',
  '#1a1a1a': 'var(--text)',
  '#111': 'var(--text)',
  '#000': 'var(--text)',
  '#fff': 'var(--on-accent)',
  '#ffffff': 'var(--on-accent)',
  '#3f8f34': 'var(--accent)',
  '#2f7d1f': 'var(--accent)',
  '#4aa03d': 'var(--accent)',
  '#5f9c50': 'var(--accent)',
  '#56ac48': 'var(--accent-hi)',
  '#7ecb6c': 'var(--accent-hi)',
  '#93d982': 'var(--accent-hi)',
  '#7d9c74': 'var(--accent-line)',
  '#c0392b': 'var(--danger)',
  '#b03024': 'var(--danger)',
  '#e05a4a': 'var(--danger)',
  '#7a1f14': 'var(--danger)',
  '#4a90d9': 'var(--focus)',
  '#569de5': 'var(--focus)',
  '#7eb4ea': 'var(--focus)'
};

/* Rules — borders, outlines, focus rings. */
const RULE = {
  '#dedede': 'var(--border)',
  '#dcdcdc': 'var(--border)',
  '#d9d9d9': 'var(--border)',
  '#d8d8d8': 'var(--border)',
  '#d5d5d5': 'var(--border)',
  '#d4d4d4': 'var(--border)',
  '#d0d0d0': 'var(--border)',
  '#cdcdcd': 'var(--border)',
  '#c8c8c8': 'var(--border-2)',
  '#c6c6c6': 'var(--border-2)',
  '#c4c4c4': 'var(--border-2)',
  '#e0e0e0': 'var(--border)',
  '#e4e4e4': 'var(--border)',
  '#e6e6e6': 'var(--border)',
  '#e8e8e8': 'var(--border)',
  '#e9e9e9': 'var(--border)',
  '#ebebeb': 'var(--border)',
  '#ececec': 'var(--border)',
  '#efefef': 'var(--border)',
  '#bdbdbd': 'var(--border-2)',
  '#b8b8b8': 'var(--border-3)',
  '#b4b4b4': 'var(--border-3)',
  '#b0b0b0': 'var(--border-3)',
  '#adadad': 'var(--border-3)',
  '#a8a8a8': 'var(--border-3)',
  '#a0a0a0': 'var(--border-3)',
  '#9e9e9e': 'var(--border-3)',
  '#9c9c9c': 'var(--border-3)',
  '#9a9a9a': 'var(--border-3)',
  '#999': 'var(--border-3)',
  '#8a8a8a': 'var(--border-3)',
  '#b9d4f0': 'var(--focus-line)',
  '#a8c8e8': 'var(--focus-line)',
  '#c9dff5': 'var(--focus-line)',
  '#7eb4ea': 'var(--focus)',
  '#569de5': 'var(--focus)',
  '#4a90d9': 'var(--focus)',
  '#b6dcae': 'var(--accent-line)',
  '#d5ecd0': 'var(--accent-line)',
  '#93d982': 'var(--accent)',
  '#7ecb6c': 'var(--accent)',
  '#e8b4b0': 'var(--danger-line)',
  '#e6b6b0': 'var(--danger-line)',
  '#c0392b': 'var(--danger)',
  '#e05a4a': 'var(--danger)',
  '#3f8f34': 'var(--accent)',
  '#56ac48': 'var(--accent)',
  /* A white rule here is a ring drawn over colour art, not chrome. */
  '#fff': 'var(--ring-contrast)',
  '#ffffff': 'var(--ring-contrast)',
  '#111': 'var(--ring-strong)',
  '#1a1a1a': 'var(--ring-strong)',
  '#7d9c74': 'var(--accent-line)',
  '#5f9c50': 'var(--accent)',
  '#8f8f8f': 'var(--border-3)',
  '#767676': 'var(--border-3)',
  '#ffe082': 'var(--warn-line)'
};

/* Left exactly as they are, with the reason. */
const KEEP = new Set([
  '#000', // the slider's black→white fallback gradient
  '#e81123' // the Windows close-button red
]);

function mapFor(prop) {
  if (/^background/.test(prop)) return SURFACE;
  if (prop === 'color' || prop === 'fill' || prop === 'stroke' || prop === 'caret-color') return INK;
  if (/^(border|outline|box-shadow|column-rule|text-decoration)/.test(prop)) return RULE;
  return null;
}

const unmapped = new Map();
const counts = new Map();
let changedFiles = 0;

for (const file of FILES) {
  const full = path.join(DIR, file);
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  let hits = 0;

  const out = lines.map((line) => {
    const m = /^(\s*)([-a-z]+)\s*:\s*(.*)$/.exec(line);
    if (!m) return line;
    const [, indent, prop, rest] = m;
    const table = mapFor(prop);
    if (!table) return line;

    const value = rest.replace(/#[0-9a-fA-F]{3,8}\b/g, (lit) => {
      const key = lit.toLowerCase();
      if (KEEP.has(key)) return lit;
      const token = table[key];
      if (!token) {
        unmapped.set(key, (unmapped.get(key) || 0) + 1);
        return lit;
      }
      counts.set(key, (counts.get(key) || 0) + 1);
      hits++;
      return token;
    });

    return value === rest ? line : `${indent}${prop}: ${value}`;
  });

  if (hits && !DRY) fs.writeFileSync(full, out.join('\n'));
  if (hits) changedFiles++;
  process.stdout.write(`${file}: ${hits} literals -> tokens\n`);
}

process.stdout.write(`\nfiles ${DRY ? 'would change' : 'changed'}: ${changedFiles}\n`);
process.stdout.write(`\nunmapped literals (left alone):\n`);
[...unmapped.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, n]) => process.stdout.write(`  ${k}  x${n}\n`));
