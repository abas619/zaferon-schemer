'use strict';

/**
 * Whole-window capture pass — the design-review companion to smoke.js.
 *
 *   npx electron build/shots.js --disable-gpu --no-sandbox --in-process-gpu
 *
 * smoke.js asserts behaviour; this one only takes pictures. It walks every
 * document in both themes so a visual change can be compared side by side
 * with the previous run. Output goes to ./shots/ui/<theme>-<doc>.png.
 *
 * Pass a theme name to capture only that theme: `... build/shots.js dark`
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots', 'ui');
fs.mkdirSync(OUT, { recursive: true });

const PROFILE = path.join(os.tmpdir(), 'zaferon-shots-profile');
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (_) {
  /* ignore */
}
app.setPath('userData', PROFILE);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('in-process-gpu');

const only = (process.argv.find((a) => a === 'light' || a === 'dark') || '').trim();
const problems = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => process.stdout.write('  · ' + m + '\n');

async function js(win, code) {
  return win.webContents.executeJavaScript(code, true).catch((e) => {
    problems.push(`EVAL FAILED ${e.message}`);
    return null;
  });
}

async function shot(win, name, rect) {
  await sleep(430);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const img = await win.webContents.capturePage(rect || undefined);
      const png = img.toPNG();
      if (!png || png.length < 200) throw new Error('empty capture');
      fs.writeFileSync(path.join(OUT, `${name}.png`), png);
      log(`captured ${name}`);
      return;
    } catch (err) {
      if (attempt === 2) problems.push(`CAPTURE FAILED ${name}: ${err.message}`);
      else await sleep(350);
    }
  }
}

const rectOf = (sel) => `
  (() => {
    const n = document.querySelector(${JSON.stringify(sel)});
    if (!n) return null;
    const r = n.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  })()`;

async function setTheme(win, theme) {
  await js(win, `window.CS.Theme.set(${JSON.stringify(theme)}); 'ok'`);
  await sleep(500);
}

async function run(win) {
  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await sleep(1800);

  const painting = await js(
    win,
    `new Promise((resolve) => {
       const t = setTimeout(() => resolve('rAF never fired'), 2000);
       requestAnimationFrame(() => { clearTimeout(t); resolve('ok'); });
     })`
  );
  if (painting !== 'ok') problems.push(`RENDERER not painting (${painting}) — captures will be stale`);

  const docs = ['matching', 'gallery', 'photo', 'builder', 'browser'];
  const themes = only ? [only] : ['light', 'dark'];

  for (const theme of themes) {
    await setTheme(win, theme);
    await shot(win, `${theme}-00-shell`);
    for (const doc of docs) {
      await js(win, `CS.App.openDocument(${JSON.stringify(doc)}); 'ok'`);
      await sleep(650);
      await shot(win, `${theme}-doc-${doc}`);
    }
    /* The Matching document has four tabs and they each lay out differently;
     * the wheel tab is the only one the doc loop above reaches. Walk the rest
     * so a regression in LiveSchemes/Mixer/Variations shows up in the set. */
    await js(win, `CS.App.openDocument('matching'); 'ok'`);
    await sleep(500);
    for (const tab of ['wheel', 'live', 'mixer', 'variations']) {
      const ok = await js(win, `(() => {
        const t = document.querySelector('#doc-host .panel-tabrow .tab[data-id=' + ${JSON.stringify(tab)} + ']');
        if (!t) return false;
        t.click();
        return true;
      })()`);
      if (!ok) { problems.push(`shots: no matching tab [data-id=${tab}]`); continue; }
      await sleep(650);
      await shot(win, `${theme}-doc-matching-${tab}`);
    }
    /* LiveSchemes has its own view switch (wheel / square / strip). The buttons
     * carry no data attribute — they are icon buttons distinguished by title.
     * They only exist while the LiveSchemes tab is the active one. */
    await js(win, `document.querySelector('#doc-host .panel-tabrow .tab[data-id="live"]').click(); 'ok'`);
    await sleep(500);
    for (const view of ['Strip']) {
      const title = view + ' view';
      const ok = await js(win, `(() => {
        const want = ${JSON.stringify(title)};
        const b = [...document.querySelectorAll('#doc-host .icon-btn')].find((n) => n.title === want);
        if (!b) return false;
        b.click();
        return true;
      })()`);
      if (!ok) { problems.push(`shots: no LiveSchemes "${view} view" button`); continue; }
      await sleep(650);
      await shot(win, `${theme}-doc-live-${view.toLowerCase()}`);
    }
  }

  log(`problems: ${JSON.stringify(problems)}`);
  app.quit();
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
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
  win.webContents.on('console-message', (...args) => {
    let level = 0;
    let message = '';
    if (args.length >= 5) [, level, message] = args;
    else if (args[1] && typeof args[1] === 'object') {
      level = args[1].level;
      message = args[1].message;
    }
    if (level === 3 || level === 'error') problems.push(`ERROR ${message}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => problems.push(`RENDERER GONE ${JSON.stringify(d)}`));
  run(win).catch((e) => {
    log(`RUN FAILED ${e && e.stack}`);
    app.quit();
  });
});
