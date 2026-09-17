'use strict';

/**
 * Panel interaction probe.
 *
 *   node build/panel-probe.js            # every mode
 *   node build/panel-probe.js tone cvd   # just these
 *
 * Some of what the Base Color panel does cannot be seen in a screenshot: a tone
 * button moving the colour the wrong way, a swatch that is not actually a drag
 * source, a library rendering fewer rows than it declares. This drives those in
 * headless Chrome and reads the result back — `--dump-dom` gives a text oracle.
 *
 * The assertions live in `build/preview.html?probe=<mode>`; this only runs
 * Chrome and pulls the <pre> block out. Adding a mode means adding a branch
 * there and a name to MODES here.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const MODES = ['tone', 'cvd', 'library'];

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
const CHROME = CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error('no Chrome or Edge found — cannot run the panel probe');
  process.exit(1);
}

const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const modes = requested.length ? requested : MODES;
const unknown = modes.filter((m) => !MODES.includes(m));
if (unknown.length) {
  console.error(`unknown mode(s): ${unknown.join(', ')} — known: ${MODES.join(', ')}`);
  process.exit(1);
}

const userDataDir = path.join(os.tmpdir(), 'zaferon-panel-probe');
fs.rmSync(userDataDir, { recursive: true, force: true });

const PAGE = 'file:///' + path.join(ROOT, 'build', 'preview.html').replace(/\\/g, '/').replace(/ /g, '%20');

let failures = 0;

modes.forEach((mode) => {
  const res = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--user-data-dir=${userDataDir}`,
      '--window-size=900,900',
      '--virtual-time-budget=6000',
      '--dump-dom',
      `${PAGE}?probe=${mode}&w=373&h=640`
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );

  /* The page serialises its own script into the dump, so the literal markup
   * appears before the element does. Take every candidate and keep the last
   * one that is a real report. */
  const blocks = [...String(res.stdout || '').matchAll(/<pre id="probe">([\s\S]*?)<\/pre>/g)]
    .map((m) => m[1])
    .filter((t) => t.includes('-PROBE'));

  console.log(`\n=== ${mode} ===`);
  if (!blocks.length) {
    console.log('FAIL no report — the page probably threw');
    console.log(String(res.stderr || '').slice(0, 600));
    failures++;
    return;
  }

  const report = blocks[blocks.length - 1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  console.log(report);

  const bad = report.split('\n').filter((l) => l.trim().startsWith('FAIL'));
  failures += bad.length;
});

console.log(`\nproblems: ${failures}`);
process.exit(failures ? 1 : 0);
