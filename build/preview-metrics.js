'use strict';

/**
 * Geometry dump for the headless panel preview.
 *
 *   node build/preview-metrics.js [width] [dock]
 *
 * Runs preview.html with `?metrics=1`, reads the `<pre id="metrics">` block out
 * of the dumped DOM, and prints the vertical seams between the sections of each
 * column. This is how "the section spacing is uniform" gets checked without
 * eyeballing a screenshot.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const width = Number(process.argv[2] || 373);
const dock = process.argv[3] === '0' ? '0' : '1';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
const CHROME = CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error('no Chrome or Edge found');
  process.exit(1);
}

const url =
  'file:///' +
  path.join(ROOT, 'build', 'preview.html').replace(/\\/g, '/').replace(/ /g, '%20') +
  `?theme=light&w=${width}&h=640&dock=${dock}&metrics=1`;

const res = spawnSync(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--user-data-dir=${path.join(os.tmpdir(), 'zaferon-preview-profile')}`,
    '--window-size=1800,900',
    '--virtual-time-budget=8000',
    '--dump-dom',
    url
  ],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
);

const m = /<pre id="metrics">([\s\S]*?)<\/pre>/.exec(res.stdout || '');
if (!m) {
  console.error('no metrics block in the dumped DOM');
  console.error((res.stderr || res.error || '').slice(0, 800));
  process.exit(1);
}

const decoded = m[1]
  .replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

const columns = JSON.parse(decoded);
const f = (n) => String(n).padStart(7);

columns.forEach((col) => {
  const r = col.rects;
  if (!Object.keys(r).length) return;
  console.log(`\n${col.caption}`);
  console.log('  element        top    bottom  height');
  Object.keys(r).forEach((k) => {
    console.log(`  ${k.padEnd(14)}${f(r[k].top)}${f(r[k].bottom)}${f(r[k].h)}`);
  });

  const seams = [];
  const gap = (label, a, b) => {
    if (r[a] && r[b]) seams.push([label, +(r[b].top - r[a].bottom).toFixed(1)]);
  };
  gap('view-top -> wheel canvas', 'bc-view', 'wheel-canvas');
  gap('wheel canvas -> readout', 'wheel-canvas', 'readout');
  gap('readout -> view-bottom', 'readout', 'bc-view');
  gap('view-top -> convert', 'bc-view', 'convert');
  gap('convert -> cvd grid', 'convert', 'cvd-grid');
  gap('palette head -> grid', 'palette-head', 'palette-grid');

  if (seams.length) {
    console.log('  seams');
    seams.forEach(([l, v]) => console.log(`    ${l.padEnd(30)}${String(v).padStart(7)}`));
  }
});
