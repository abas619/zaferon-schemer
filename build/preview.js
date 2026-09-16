'use strict';

/**
 * Headless panel preview.
 *
 *   node build/preview.js
 *
 * The agent sandbox cannot run GUI Electron (see MEMORY.md), so the smoke/shots
 * suites are unavailable. This mounts the *real* panel modules against the
 * *real* stylesheets inside headless Chrome instead, and writes PNGs to
 * shots/preview/.
 *
 * `build/preview.html` loads util/color/store/theme/data/icons/widgets plus the
 * panels under test — deliberately not app.js, which needs the preload bridge.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots', 'preview');
fs.mkdirSync(OUT, { recursive: true });

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];

const CHROME = CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error('no Chrome or Edge found — cannot render the preview');
  process.exit(1);
}

const COLS = 4;

const CONFIGS = [
  { name: 'light-373', theme: 'light', w: 373, h: 640, dock: 1 },
  { name: 'light-180', theme: 'light', w: 180, h: 640, dock: 1 },
  { name: 'light-280', theme: 'light', w: 280, h: 620, dock: 0 },
  { name: 'dark-373', theme: 'dark', w: 373, h: 640, dock: 1 }
];

const userDataDir = path.join(os.tmpdir(), 'zaferon-preview-profile');
fs.rmSync(userDataDir, { recursive: true, force: true });

let failed = 0;

CONFIGS.forEach((c) => {
  const url =
    'file:///' +
    path.join(ROOT, 'build', 'preview.html').replace(/\\/g, '/').replace(/ /g, '%20') +
    `?theme=${c.theme}&w=${c.w}&h=${c.h}&dock=${c.dock}&hex=${c.hex || '#F4C430'}`;

  const out = path.join(OUT, `${c.name}.png`);
  const winW = COLS * (c.w + 16) + 32;
  const winH = c.h + 60;

  const res = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--user-data-dir=${userDataDir}`,
      `--window-size=${winW},${winH}`,
      '--virtual-time-budget=8000',
      `--screenshot=${out}`,
      url
    ],
    { encoding: 'utf8' }
  );

  const ok = fs.existsSync(out) && fs.statSync(out).size > 2000;
  if (!ok) failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${c.name}.png  ${winW}x${winH}  ${c.theme}` +
      (ok ? `  ${(fs.statSync(out).size / 1024).toFixed(0)}kB` : `  ${res.stderr || res.error || ''}`)
  );
});

console.log(failed ? `\n${failed} capture(s) failed` : `\n${CONFIGS.length} captures written to shots/preview/`);
process.exit(failed ? 1 : 0);
