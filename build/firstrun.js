'use strict';

/**
 * First-run / rename probe.
 *
 *   node build/firstrun.js   (npx electron build/firstrun.js)
 *
 * The smoke and verify suites wipe userData, so they can never observe
 * persisted state. This one drives the real profile lifecycle instead:
 *
 *   1. genuine first run  -> saffron, and the new name everywhere
 *   2. legacy state present -> favourites/prefs migrate, colour does NOT
 *   3. colour chosen, relaunch -> the chosen colour wins over saffron
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const PROFILE = path.join(os.tmpdir(), 'zaferon-firstrun-profile');
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (_) {
  /* ignore */
}
app.setPath('userData', PROFILE);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('in-process-gpu');

const NEW_KEY = 'zaferon-scheme/state/v1';
const OLD_KEY = 'colorschemer-studio/state/v1';
const SAFFRON = '#F4C430';
const NAME = 'Zaferon Schemer';

const problems = [];
const trace = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Windows GUI Electron has no attached stdout, so the report is written to a
 * file as well — that is the copy that survives. */
const REPORT = path.join(__dirname, 'firstrun-report.txt');

function say(line) {
  trace.push(line);
  console.log(line);
}

function writeReport() {
  try {
    fs.writeFileSync(
      REPORT,
      trace.join('\n') + `\n\nproblems: ${problems.length}\n` +
        problems.map((p) => `  ! ${p}\n`).join(''),
      'utf8'
    );
  } catch (_) {
    /* ignore */
  }
}

function check(ok, msg) {
  say(`  ${ok ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!ok) problems.push(msg);
}

const js = (win, code) => win.webContents.executeJavaScript(code, true);

async function boot() {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });
  await win.loadFile(path.join(SRC, 'index.html'));
  await sleep(900);
  return win;
}

async function reload(win) {
  const done = new Promise((r) => win.webContents.once('did-finish-load', r));
  win.webContents.reload();
  await done;
  await sleep(1200); // let the migration's debounced persist land
}

async function run() {
  const win = await boot();

  /* ---- 1. genuine first run ---------------------------------------- */
  say('\nfirst run (empty profile)\n');
  const hex = await js(win, 'window.CS.Store.hexUpper()');
  check(hex === SAFFRON, `base colour is saffron — got ${hex}`);

  const title = win.getTitle();
  check(title === NAME, `window title — got ${JSON.stringify(title)}`);

  const docTitle = await js(win, 'document.title');
  check(docTitle === NAME, `document.title — got ${JSON.stringify(docTitle)}`);

  const bar = await js(win, "document.getElementById('titlebar-title').textContent.trim()");
  check(bar === NAME, `title bar — got ${JSON.stringify(bar)}`);

  const about = await js(win, '!!window.CS.App');
  check(about, 'app booted');

  /* ---- 2. legacy state migrates, minus the colour ------------------- */
  say('\nlegacy state present (simulating an upgrade)\n');
  /* The new key has to go as well: `load()` reads the legacy key only when
   * `readKey(STORAGE_KEY)` comes back empty (store.js:127), and step 1 already
   * persisted one. Seeding legacy on top of it tests nothing — the app correctly
   * prefers its own newer state. Deleting it is what makes this a first launch
   * under the new name. */
  await js(
    win,
    `(() => {
       localStorage.removeItem(${JSON.stringify(NEW_KEY)});
       localStorage.setItem(${JSON.stringify(OLD_KEY)}, JSON.stringify({
         baseHsv: { h: 210, s: 0.8, v: 0.6 },
         favorites: ['#AABBCC', '#DDEEFF'],
         prefs: { previewSize: 'large' },
         history: ['#123456'],
         historyIndex: 0
       }));
       return 'seeded';
     })()`
  );
  await reload(win);

  const mig = await js(
    win,
    `(() => ({
       hex: CS.Store.hexUpper(),
       favs: CS.Store.state.favorites,
       previewSize: CS.Store.get('prefs.previewSize'),
       history: CS.Store.state.history.slice(),
       historyIndex: CS.Store.state.historyIndex,
       newKey: !!localStorage.getItem(${JSON.stringify(NEW_KEY)}),
       oldKey: !!localStorage.getItem(${JSON.stringify(OLD_KEY)})
     }))()`
  );

  check(mig.hex === SAFFRON, `legacy colour ignored, saffron kept — got ${mig.hex}`);
  check(
    JSON.stringify(mig.favs) === JSON.stringify(['#aabbcc', '#ddeeff']),
    `favourites migrated + lowercased — got ${JSON.stringify(mig.favs)}`
  );
  check(mig.previewSize === 'large', `prefs migrated — got ${JSON.stringify(mig.previewSize)}`);
  /* Lower-cased, like `store-test` asserts: the store normalises every colour it
   * writes into `history`, so an uppercase expectation can never be met. */
  check(
    JSON.stringify(mig.history) === JSON.stringify([SAFFRON.toLowerCase()]) && mig.historyIndex === 0,
    `history restarts on saffron — got ${JSON.stringify(mig.history)} @ ${mig.historyIndex}`
  );
  check(mig.newKey, 'migrated state written under the new key');
  check(mig.oldKey, 'legacy key left in place (non-destructive)');

  /* ---- 3. the chosen colour survives a relaunch -------------------- */
  say('\npick a colour, then relaunch\n');
  await js(win, "window.CS.Store.setColor('#2E7D32'); 'ok'");
  await sleep(700); // persist() is debounced by 250ms
  await reload(win);

  const again = await js(win, 'CS.Store.hexUpper()');
  check(again === '#2E7D32', `last chosen colour restored — got ${again}`);

  await reload(win);
  const third = await js(win, 'CS.Store.hexUpper()');
  check(third === '#2E7D32', `still restored on a second relaunch — got ${third}`);

  /* ---- 4. the migrated favourites really are persisted ------------- */
  const favs2 = await js(win, 'CS.Store.state.favorites.slice()');
  check(
    JSON.stringify(favs2) === JSON.stringify(['#aabbcc', '#ddeeff']),
    `favourites survive relaunch — got ${JSON.stringify(favs2)}`
  );

  win.destroy();

  writeReport();
  say(problems.length ? `\nproblems: ${problems.length}` : '\nproblems: 0');
  problems.forEach((p) => say(`  ! ${p}`));
  app.exit(problems.length ? 1 : 0);
}

app.whenReady().then(() =>
  run().catch((err) => {
    say(`\nFATAL ${err && err.stack}`);
    writeReport();
    app.exit(1);
  })
);
