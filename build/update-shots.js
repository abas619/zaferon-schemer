'use strict';

/**
 * The update banner, driven through every state it can be shown in.
 *
 *   npm run update-shots      (or: npx electron build/update-shots.js)
 *
 * `updater.js` only ever talks to GitHub when `app.isPackaged` is true, so no
 * harness here can produce a real available/progress/downloaded event — this
 * one manufactures the events at the renderer boundary instead
 * (`CS.Update.apply`), which is exactly the seam the main process writes into.
 * It proves the UI reacts; it does not prove the network path, and nothing here
 * should be read as if it did.
 *
 * Exits non-zero on any FAIL. Writes shots/update-*.png.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('in-process-gpu');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const check = (ok, msg) => {
  if (!ok) problems.push(msg);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`);
};

ipcMain.handle('app:info', () => ({ name: app.getName(), version: app.getVersion() }));
ipcMain.handle('shell:openExternal', async () => true);
ipcMain.handle('picker:start', async () => null);
ipcMain.handle('clipboard:writeText', () => true);
ipcMain.handle('clipboard:readText', () => '');
ipcMain.handle('update:check', async () => ({ packaged: false }));
ipcMain.handle('update:download', async () => ({ packaged: false }));
ipcMain.handle('update:install', async () => ({ packaged: false }));
ipcMain.handle('update:status', () => ({ packaged: false, state: { type: 'idle' } }));

/* Geometry of the banner relative to the strips it must sit between.
 * Wrapped in JSON.stringify and — note for anyone copying this file — the IIFE
 * must actually be *called*: `executeJavaScript("(function(){…})")` evaluates
 * to a function, which Electron cannot ship across the boundary, and it fails
 * with a bare "An object could not be cloned" naming nothing. */
const READ = `JSON.stringify((function () {
  const r = (n) => { if (!n) return null; const b = n.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) }; };
  const banner = document.querySelector('.update-banner');
  if (!banner) return { missing: true };
  /* A control counts as offered only if it is displayed AND has height — an
   * ancestor with display:none would otherwise leave a button computed 'inline'.
   * The three buttons are addressed by the order update.js builds them in
   * (Later, Download, Install) rather than by class, so the UI carries no
   * test-only selectors. */
  const shown = (n) => !!(n && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().height > 0);
  const act = banner.querySelectorAll('.update-acts button');
  const fill = banner.querySelector('.update-progress-fill');
  const bar = banner.querySelector('.update-progress');
  return {
    rect: r(banner),
    titlebar: r(document.getElementById('titlebar')),
    menubar: r(document.getElementById('menubar')),
    text: banner.querySelector('.update-status').textContent,
    labels: Array.prototype.map.call(act, function (b) { return b.textContent; }).join(','),
    later: shown(act[0]), download: shown(act[1]), install: shown(act[2]),
    bar: shown(bar),
    fillPct: fill.style.width,
    bg: getComputedStyle(banner).backgroundColor,
    ink: getComputedStyle(banner.querySelector('.update-status')).color
  };
})())`;

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name), img.toPNG());
  console.log(`      wrote shots/${name}`);
}

async function apply(win, payload) {
  stage = 'apply ' + payload.type;
  await win.webContents.executeJavaScript(`CS.Update.apply(${JSON.stringify(payload)})`, true);
  await sleep(150);
  stage = 'read after ' + payload.type;
  const raw = await win.webContents.executeJavaScript(READ, true);
  return JSON.parse(raw);
}

let stage = 'starting';

async function run(win) {
  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await sleep(1700);

  /* The proxied bridge throws `An object could not be cloned` from deep inside
   * Electron's own frames, which names no application code. Record the real
   * stack in the page instead and dump it after the fact. */
  await win.webContents.executeJavaScript(`(function () {
    window.__pageErrors = [];
    window.addEventListener('error', function (e) {
      window.__pageErrors.push(String((e.error && e.error.stack) || e.message));
    });
    window.addEventListener('unhandledrejection', function (e) {
      window.__pageErrors.push('rejection: ' + String((e.reason && e.reason.stack) || e.reason));
    });
    return 1;
  })()`, true);
  stage = 'after boot';

  const has = await win.webContents.executeJavaScript(
    `!!(window.CS && CS.Update && typeof CS.Update.apply === 'function')`,
    true
  );
  check(has, 'CS.Update is loaded and exposes apply()');
  if (!has) return;

  const quiet = await win.webContents.executeJavaScript(
    `!document.querySelector('.update-banner')`,
    true
  );
  check(quiet, 'boot alone shows no banner — an idle app never mentions updates');

  /* ---------- available ---------- */
  const avail = await apply(win, { type: 'available', version: '1.0.2', releaseNotes: '' });
  check(!avail.missing && avail.rect && avail.rect.h > 0, 'available: the banner is painted');
  check(avail.text === 'Version 1.0.2 is available.', `available: reads "${avail.text}"`);
  check(avail.download && !avail.install, `available: Download offered, Install not (${avail.labels})`);
  check(avail.later, 'available: "Later" is always there to dismiss it');
  check(avail.bar === false, 'available: no progress bar yet');
  check(avail.titlebar && avail.menubar && avail.rect.top >= avail.titlebar.bottom - 1
    && avail.rect.bottom <= avail.menubar.top + 1,
    `available: banner sits between titlebar (${avail.titlebar && avail.titlebar.bottom}) and menubar (${avail.menubar && avail.menubar.top})`);
  await shot(win, 'update-available.png');

  /* ---------- progress ---------- */
  const prog = await apply(win, { type: 'progress', percent: 42.7, transferred: 4.2e6, total: 1e7 });
  check(/43%/.test(prog.text), `progress: reads "${prog.text}"`);
  check(prog.fillPct === '42.7%', `progress: fill width is ${prog.fillPct}`);
  check(prog.bar === true, 'progress: the bar is visible');
  check(prog.download === false && prog.install === false,
    `progress: neither action offered mid-download (${prog.labels})`);
  await shot(win, 'update-downloading.png');

  /* ---------- downloaded ---------- */
  const done = await apply(win, { type: 'downloaded', version: '1.0.2' });
  check(done.text === 'Version 1.0.2 is ready to install.', `downloaded: reads "${done.text}"`);
  check(done.install && !done.download, `downloaded: Install offered, Download retired (${done.labels})`);
  check(done.bar === false, 'downloaded: the bar is gone');
  await shot(win, 'update-ready.png');

  /* ---------- the states that must NOT show a strip ---------- */
  const gone = await apply(win, { type: 'not-available', version: '1.0.2' });
  check(gone.rect.h === 0 || gone.rect.w === 0, 'not-available: the banner hides itself');
  const err = await apply(win, { type: 'error', message: 'Cannot connect to the server.' });
  check(err.rect.h === 0 || err.rect.w === 0, 'error: no strip for something the user did not ask about');

  /* ---------- dark theme ---------- */
  await win.webContents.executeJavaScript(`CS.Theme.set('dark')`, true);
  await sleep(250);
  const dark = await apply(win, { type: 'available', version: '1.0.2', releaseNotes: '' });
  check(dark.bg !== avail.bg, `dark: banner background follows the theme (${avail.bg} → ${dark.bg})`);
  check(dark.ink !== avail.ink, `dark: text colour follows the theme (${avail.ink} → ${dark.ink})`);
  await shot(win, 'update-dark.png');
  await win.webContents.executeJavaScript(`CS.Theme.set('light')`, true);
  await sleep(200);

  /* ---------- the dialog answers, in a dev build ---------- */
  await win.webContents.executeJavaScript(
    `CS.Update.hideBanner(); CS.Update.check({ projectUrl: 'https://github.com/abas619/zaferon-schemer' })`,
    true
  );
  await sleep(400);
  const dlg = await win.webContents.executeJavaScript(
    `(function () {
       const box = document.querySelector('.modal');
       if (!box) return { missing: true };
       return {
         title: box.querySelector('.modal-title span').textContent,
         line: box.querySelector('.update-dialog-line').textContent,
         buttons: Array.prototype.slice.call(box.querySelectorAll('.modal-actions button'))
           .map(function (b) { return b.textContent; }).join(', ')
       };
     })()`,
    true
  );
  check(!dlg.missing, 'dialog: Check for Updates opened a dialog');
  check(/running from source/.test(dlg.line || ''), `dialog: says so honestly — "${dlg.line}"`);
  check(/Open Project Page/.test(dlg.buttons || ''), `dialog: offers the page (${dlg.buttons})`);
  await shot(win, 'update-dialog.png');
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    show: true,
    frame: false,
    backgroundColor: '#f0f0f0',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.webContents.on('console-message', (_e, level, message) => {
    if (/willReadFrequently/.test(message)) return;
    if (level >= 2) problems.push(`CONSOLE  ${message}`);
  });

  try {
    await run(win);
  } catch (err) {
    problems.push(`HARNESS CRASH at [${stage}]  ${(err && err.stack) || err}`);
  }

  try {
    const page = await win.webContents.executeJavaScript('window.__pageErrors || []', true);
    (page || []).forEach((p) => problems.push('PAGE  ' + p));
  } catch (e) { /* window already gone */ }

  console.log('\n============ UPDATE SHOTS ============');
  if (problems.length) problems.forEach((p) => console.log('  ' + p));
  else console.log('  no problems found.');
  console.log(`problems: ${problems.length}`);
  console.log('======================================\n');

  setTimeout(() => app.exit(problems.length ? 1 : 0), 300);
});
