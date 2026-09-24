'use strict';

/**
 * Menu audit.
 *
 *   npm run menu-audit        (npx electron build/menu-audit.js)
 *
 * Walks `CS.App.menus`, then INVOKES every leaf item and records what it did.
 *
 * Why this exists: a screenshot of an open menu tells you an item is *there*,
 * never that it *works*. `{ action: () => {} }`, `{ action: () => setStatus(
 * 'done') }` and a real handler all render identically, and a `checked:` flag
 * is just a boolean computed at open time — it can disagree with the panel it
 * claims to describe. So this harness answers four questions a screenshot
 * cannot:
 *
 *   1. Does the item throw when clicked?
 *   2. Does it change anything at all? (state fingerprint before/after)
 *   3. Does its `checked:` flag agree with the DOM it names?
 *   4. Do two items claim the same accelerator?
 *
 * It runs the real renderer through the real preload bridge — menus live in
 * `app.js`, which needs `window.cs`, so `build/preview.html` cannot host them.
 *
 * Exit code is 1 when a hard problem is found, so it can gate a release.
 */

const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'menu-audit.json');

// Throwaway profile: the audit must not read or write the real user's state.
const PROFILE = path.join(os.tmpdir(), 'zaferon-menu-audit-profile');
try {
  fs.rmSync(PROFILE, { recursive: true, force: true });
} catch (_) {
  /* ignore */
}
app.setPath('userData', PROFILE);

/* See build/smoke.js — the GPU process aborts before `whenReady` unless
 * software rendering is forced from inside the script. */
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('in-process-gpu');

process.env.CS_SMOKE = '1';

const problems = [];
const notes = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => process.stdout.write('  · ' + m + '\n');

/* ------------------------------------------------------------------ *
 * Stubbed IPC — every action must be able to run to completion without a
 * human. Anything that would open a native dialog resolves to null, which is
 * the same shape a cancelled dialog produces, so the action's own cancel
 * branch is what gets exercised.
 * ------------------------------------------------------------------ */

ipcMain.handle('clipboard:writeText', (_e, t) => {
  clipboard.writeText(String(t == null ? '' : t));
  return true;
});
ipcMain.handle('clipboard:readText', () => clipboard.readText());
/* The audit replaces the main process, so every channel the renderer reaches
 * for has to exist here too — otherwise About falls back to its default and
 * the audit never exercises the real path. */
ipcMain.handle('app:info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  electron: process.versions.electron,
  platform: process.platform
}));
/* The audit INVOKES Help ▸ Check for Updates…, so the updater channels have to
 * answer. `{ packaged: false }` is the honest reply for a harness — it is what
 * the real main process says when run from source, and it is the branch that
 * shows the "no update service" dialog rather than a network call. */
ipcMain.handle('update:check', async () => ({ packaged: false }));
ipcMain.handle('update:download', async () => ({ packaged: false }));
ipcMain.handle('update:install', async () => ({ packaged: false }));
ipcMain.handle('update:status', () => ({ packaged: false, state: { type: 'idle' } }));
ipcMain.handle('file:save', async () => path.join(os.tmpdir(), 'menu-audit-save.json'));
ipcMain.handle('file:openImage', async () => null);
ipcMain.handle('file:openText', async () => null);
ipcMain.handle('file:exportPng', async () => null);
ipcMain.handle('file:openPath', async () => null);
ipcMain.handle('shell:openExternal', async (_e, url) => {
  opened.push(String(url));
  return true;
});
ipcMain.handle('picker:start', async () => null);
ipcMain.on('win:minimize', () => {});
ipcMain.on('win:maximize', () => {});
ipcMain.on('win:close', () => {});

const opened = [];

/* ------------------------------------------------------------------ *
 * The renderer-side audit
 * ------------------------------------------------------------------ */

const AUDIT = `(async () => {
  /* NO BACKTICKS IN THIS STRING. It is a template literal, so one backtick in
   * a comment ends it early and the whole file fails to parse with a
   * misleading "Unexpected identifier" pointing at the next word. */
  const q = (s) => document.querySelector(s);
  const has = (s, c) => { const n = q(s); return n ? n.classList.contains(c) : null; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clearModals = () => document.querySelectorAll('.modal-layer').forEach((n) => n.remove());

  /* Everything an action could plausibly move. Anything missing from this
   * fingerprint is a change the audit cannot see. */
  const state = () => ({
    hex: CS.Store.hex(),
    doc: CS.Store.get('document'),
    tab: CS.Store.get('matchingTab'),
    scheme: CS.Store.get('scheme'),
    theme: CS.Store.get('theme'),
    cvd: CS.Store.get('cvd'),
    space: CS.Store.get('prefs.colorSpace'),
    websafeMode: CS.Store.get('websafeMode'),
    showPalette: CS.Store.get('showPalette'),
    showBaseColor: CS.Store.get('showBaseColor'),
    showFavorites: CS.Store.get('showFavorites'),
    favCount: (CS.Store.state.favorites || []).length,
    histLen: (CS.Store.state.history || []).length,
    status: (q('#status-left') || {}).textContent,
    modals: document.querySelectorAll('.modal-layer').length,
    leftHidden: has('#dock-left', 'is-hidden'),
    rightHidden: has('#dock-right', 'is-hidden'),
    palHidden: has('#palette-host', 'is-hidden'),
    rootTheme: document.documentElement.getAttribute('data-theme')
  });

  const diff = (a, b) => {
    const keys = {};
    Object.keys(a).forEach((k) => { if (a[k] !== b[k]) keys[k] = [a[k], b[k]]; });
    return keys;
  };

  /* ---- 1. Walk the table ------------------------------------------- */
  const records = [];
  const seenMenus = [];

  const walk = (items, trail) => {
    items.forEach((it) => {
      if (!it || it.separator) {
        records.push({ kind: 'separator', path: trail.join(' > ') + ' > ---' });
        return;
      }
      const p = trail.concat(it.label || '(unlabelled)');
      if (it.submenu) {
        records.push({
          kind: 'submenu',
          path: p.join(' > '),
          accel: it.accel || null,
          checked: !!it.checked,
          disabled: !!it.disabled,
          children: it.submenu.length
        });
        walk(it.submenu, p);
      } else {
        records.push({
          kind: 'action',
          path: p.join(' > '),
          label: it.label,
          accel: it.accel || null,
          checked: !!it.checked,
          disabled: !!it.disabled,
          hasAction: typeof it.action === 'function',
          fn: typeof it.action === 'function' ? it.action : null,
          src: typeof it.action === 'function' ? String(it.action).replace(/\\s+/g, ' ').slice(0, 160) : null
        });
      }
    });
  };

  const tableErrors = [];
  (CS.App.menus || []).forEach((m) => {
    seenMenus.push(m.label);
    let items;
    try {
      items = m.items();
    } catch (e) {
      tableErrors.push({ menu: m.label, error: (e && e.stack) || String(e) });
      return;
    }
    if (!Array.isArray(items)) {
      tableErrors.push({ menu: m.label, error: 'items() did not return an array' });
      return;
    }
    walk(items, [m.label]);
  });

  /* ---- 2. A disabled row must be inert ------------------------------ */
  /* The invoke loop below calls actions directly, which bypasses the renderer
   * entirely — so it can never see whether the is-disabled class actually stops
   * a click. This section drives the real popup instead. It runs first, because
   * the invoke loop pushes history and would re-enable Undo.
   *
   * Which items are worth clicking matters. Undo and Redo are disabled exactly
   * when their action is already a no-op (canGoBack() is false, so goBack()
   * returns early), so a MISSING guard is invisible on them — the first version
   * of this check passed against a deliberately broken renderer. "Show Color
   * Palette" in a non-matching workspace is the one disabled row whose action
   * would visibly flip state, so it is the one that proves the guard. */
  const disabledCheck = await (async () => {
    const out = { checked: 0, inert: 0, rows: [] };
    const passes = [
      { menu: 'File', doc: null },
      { menu: 'Edit', doc: null },
      { menu: 'Tools', doc: 'gallery' }
    ];
    for (const pass of passes) {
      if (pass.doc) {
        CS.App.openDocument(pass.doc);
        await wait(180);
      }
      const btn = [...document.querySelectorAll('.menubar-item')].find((b) => b.textContent.trim() === pass.menu);
      if (!btn) continue;
      btn.click();
      await wait(90);
      const popup = document.querySelector('.menu-popup');
      if (!popup) {
        out.rows.push({ menu: pass.menu, doc: pass.doc, error: 'menu popup did not open' });
        continue;
      }
      const disabledRows = [...popup.querySelectorAll('.menu-item.is-disabled')];
      out.checked += disabledRows.length;
      for (const row of disabledRows) {
        const label = (row.querySelector('.menu-label') || {}).textContent || '?';
        const before = JSON.stringify(state());
        /* A real bubbling click, the same event the renderer sees. */
        row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await wait(80);
        const after = JSON.stringify(state());
        const inert = before === after;
        const open = !!document.querySelector('.menu-popup');
        if (inert) out.inert++;
        out.rows.push({ menu: pass.menu, doc: pass.doc, label, inert, menuStayedOpen: open });
        /* Once the popup is gone, the remaining rows are detached and clicking
         * them proves nothing. The dismissal itself is already recorded. */
        if (!open) break;
      }
      if (CS.Widgets && CS.Widgets.closeMenu) CS.Widgets.closeMenu();
      await wait(60);
    }
    CS.App.openDocument('matching');
    await wait(160);
    return out;
  })();

  /* ---- 3. Invoke every leaf ---------------------------------------- */
  const results = [];

  for (const rec of records.filter((r) => r.kind === 'action')) {
    clearModals();
    /* A disabled item is deliberately unreachable now, so invoking it proves
     * nothing about the shipped behaviour — the section above covers it. */
    if (rec.disabled) {
      results.push({ path: rec.path, accel: rec.accel, declaredChecked: rec.checked, declaredDisabled: true, skipped: true });
      continue;
    }
    /* Reset the status line to its idle text first. Two actions that set the
     * SAME status string (Save then Save As…) would otherwise look like the
     * second one did nothing. */
    if (CS.App.setStatus) CS.App.setStatus('');
    const before = state();
    let error = null;
    if (!rec.fn) {
      error = 'NO ACTION — item has neither submenu nor action';
    } else {
      try {
        const ret = rec.fn();
        if (ret && typeof ret.then === 'function') await ret;
      } catch (e) {
        error = (e && e.stack) || String(e);
      }
    }
    await wait(110);
    const after = state();
    const changed = diff(before, after);
    clearModals();
    results.push({
      path: rec.path,
      accel: rec.accel,
      declaredChecked: rec.checked,
      declaredDisabled: rec.disabled,
      emptyBody: !!(rec.src && /^(async )?\\(?[^)]*\\)?\\s*=>\\s*\\{\\s*\\}$/.test(rec.src)),
      error,
      changed,
      noop: !error && Object.keys(changed).length === 0
    });
  }

  /* ---- 4. Does the checked flag agree with the thing it names? ----- */
  /* Re-open each menu so the flags are recomputed, then compare the three
   * visibility items against the DOM they claim to control. */
  const flagChecks = [];
  const MENUS = CS.App.menus;
  const tools = MENUS.find((m) => m.label === 'Tools');
  if (tools) {
    const items = tools.items();
    const pairs = [
      { label: 'Show Color Palette', dom: '#palette-host', cls: 'is-hidden', store: 'showPalette' },
      { label: 'Show Base Color Panel', dom: '#dock-left', cls: 'is-hidden', store: 'showBaseColor' },
      { label: 'Show Favorite Colors Panel', dom: '#dock-right', cls: 'is-hidden', store: 'showFavorites' }
    ];
    pairs.forEach((p) => {
      const it = items.find((i) => i.label === p.label);
      if (!it) {
        flagChecks.push({ label: p.label, error: 'item not found' });
        return;
      }
      const hidden = has(p.dom, p.cls);
      flagChecks.push({
        label: p.label,
        checked: !!it.checked,
        storeValue: CS.Store.get(p.store, '(unset)'),
        domHidden: hidden,
        agrees: !!it.checked === !hidden
      });
    });
  }

  /* ---- 5. The palette toggle must not promise what it cannot do ------ */
  /* The palette strip is hidden in every workspace except Matching Colors, so
   * "Show Color Palette" has to be disabled elsewhere — otherwise it is a
   * control that flips a preference and moves nothing on screen. Checked in
   * both directions, because "disabled on matching too" would be just as
   * broken in the other way. */
  const paletteToggle = { onMatching: null, elsewhere: null, doc: null };
  const readPaletteItem = () => {
    const m = CS.App.menus.find((x) => x.label === 'Tools');
    const it = m && m.items().find((i) => i.label === 'Show Color Palette');
    return it ? { disabled: !!it.disabled, checked: !!it.checked } : null;
  };
  CS.App.openDocument('matching');
  await wait(140);
  paletteToggle.onMatching = readPaletteItem();
  CS.App.openDocument('gallery');
  await wait(140);
  paletteToggle.doc = CS.Store.get('document');
  paletteToggle.elsewhere = readPaletteItem();
  CS.App.openDocument('matching');
  await wait(140);

  /* ---- 6. The tab items must move the tab, not just the view --------- */
  /* Color Wheel / Color Mixer / Variations each name a Matching Colors tab.
   * They have to leave matchingTab on that tab: the tick beside the item, the
   * tab restored on the next launch, and the comparison that produces the tick
   * all read that preference. Asserting the tick too, because a view that
   * moves while the tick stays put is exactly the bug this caught. */
  const TAB_ITEMS = [
    { label: 'Color Wheel', tab: 'wheel' },
    { label: 'Color Mixer', tab: 'mixer' },
    { label: 'Variations', tab: 'variations' }
  ];
  const tabSync = [];
  for (const spec of TAB_ITEMS) {
    const m = CS.App.menus.find((x) => x.label === 'Tools');
    const it = m && m.items().find((i) => i.label === spec.label);
    if (!it) {
      tabSync.push({ label: spec.label, error: 'item not found' });
      continue;
    }
    try {
      it.action();
    } catch (e) {
      tabSync.push({ label: spec.label, error: (e && e.message) || String(e) });
      continue;
    }
    await wait(160);
    /* Re-read the table so the checked flag is recomputed the way the real
     * menu does — on every open. */
    const fresh = m.items();
    const ticked = fresh.filter((i) => i.checked && TAB_ITEMS.some((t) => t.label === i.label)).map((i) => i.label);
    const got = CS.Store.get('matchingTab');
    tabSync.push({
      label: spec.label,
      want: spec.tab,
      got,
      agrees: got === spec.tab,
      ticked,
      tickAgrees: ticked.length === 1 && ticked[0] === spec.label
    });
  }

  return {
    menus: seenMenus,
    tableErrors,
    records: records.map((r) => ({
      kind: r.kind, path: r.path, accel: r.accel, checked: r.checked,
      disabled: r.disabled, hasAction: r.hasAction, src: r.src, children: r.children
    })),
    results,
    disabledCheck,
    flagChecks,
    paletteToggle,
    tabSync
  };
})()`;

/* ------------------------------------------------------------------ *
 * Optional screenshot pass (`--shots`)
 *
 * The audit proves the menus work; it cannot show anyone what they look like.
 * This captures each menu as it renders, including the one state that is
 * impossible to reach by hand without knowing to switch documents first —
 * "Show Color Palette" greyed out in a workspace that has no palette.
 * ------------------------------------------------------------------ */

async function captureMenus(win) {
  const dir = path.join(ROOT, 'shots');
  fs.mkdirSync(dir, { recursive: true });

  const evalJs = (code) => win.webContents.executeJavaScript(code, true).catch(() => null);
  const grab = async (name) => {
    await sleep(340);
    const png = (await win.webContents.capturePage()).toPNG();
    fs.writeFileSync(path.join(dir, `${name}.png`), png);
    log(`captured ${name}`);
  };
  const clickMenu = (label) =>
    evalJs(
      `(() => {
         const b = [...document.querySelectorAll('.menubar-item')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
         if (!b) return 'missing';
         b.click();
         return 'ok';
       })()`
    );
  const openSub = (label) =>
    evalJs(
      `(() => {
         const row = [...document.querySelectorAll('.menu-popup > .menu-item')]
           .find((r) => ((r.querySelector('.menu-label') || {}).textContent || '') === ${JSON.stringify(label)});
         if (!row) return 'missing';
         row.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
         return 'ok';
       })()`
    );
  const closeAll = () =>
    evalJs(`(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return 'ok'; })()`);

  for (const label of ['File', 'Edit', 'Adjust', 'Tools', 'Help']) {
    await clickMenu(label);
    await grab(`menu-${label.toLowerCase()}`);
    await closeAll();
    await sleep(170);
  }

  await clickMenu('Adjust');
  await openSub('Color Scheme');
  await grab('menu-adjust-scheme');
  await closeAll();
  await sleep(170);

  await evalJs(`CS.App.openDocument('gallery'); 'ok'`);
  await sleep(420);
  await clickMenu('Tools');
  await grab('menu-tools-gallery');
  await closeAll();
  await evalJs(`CS.App.openDocument('matching'); 'ok'`);
  await sleep(320);
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

function report(audit) {
  const { records, results, tableErrors, flagChecks, disabledCheck, paletteToggle, menus } = audit;

  process.stdout.write('\n');
  log(`menus: ${menus.join('  ')}`);

  /* --- table shape --- */
  const byKind = { action: 0, submenu: 0, separator: 0 };
  records.forEach((r) => { byKind[r.kind] = (byKind[r.kind] || 0) + 1; });
  log(`items: ${byKind.action} actions, ${byKind.submenu} submenus, ${byKind.separator} separators`);

  if (tableErrors.length) {
    tableErrors.forEach((t) => problems.push(`TABLE  ${t.menu}.items() threw: ${t.error}`));
  }

  /* --- disabled rows must be inert --- */
  if (disabledCheck) {
    disabledCheck.rows.forEach((r) => {
      const where = `${r.menu}${r.doc ? ` (in ${r.doc})` : ''}`;
      if (r.error) { problems.push(`DISABLED  ${where}: ${r.error}`); return; }
      if (!r.inert) problems.push(`DISABLED  ${where} > "${r.label}" is greyed out but clicking it still changed the app`);
      if (!r.menuStayedOpen) problems.push(`DISABLED  ${where} > "${r.label}" is greyed out but the click still dismissed the menu`);
    });
    log(`disabled rows exercised: ${disabledCheck.checked} (inert: ${disabledCheck.inert})`);
    if (disabledCheck.checked === 0) {
      problems.push('no disabled menu rows were found — the inertness check did not actually run');
    }
  }

  /* --- items that are structurally dead --- */
  /* An enabled item with no action is dead. A DISABLED one with no action is
   * the "Open Recent ▸ (nothing yet)" placeholder, which is correct. */
  const noAction = records.filter((r) => r.kind === 'action' && !r.hasAction && !r.disabled);
  noAction.forEach((r) => problems.push(`DEAD     ${r.path} — enabled, but has no action`));
  records
    .filter((r) => r.kind === 'action' && !r.hasAction && r.disabled)
    .forEach((r) => notes.push(`placeholder  ${r.path} — disabled, no action (correct for an empty list)`));

  const emptyBody = results.filter((r) => r.emptyBody);
  emptyBody.forEach((r) => problems.push(`STUB     ${r.path} — action body is empty`));

  /* --- items that throw --- */
  const threw = results.filter((r) => r.error);
  threw.forEach((r) => problems.push(`THROWS   ${r.path} — ${String(r.error).split('\n')[0]}`));

  /* --- items that do nothing observable --- */
  const noop = results.filter((r) => r.noop && !r.emptyBody && !r.skipped);
  noop.forEach((r) => notes.push(`no-op    ${r.path} — ran without error but changed nothing the audit can see`));

  /* --- duplicate accelerators --- */
  const accels = {};
  records.forEach((r) => {
    if (!r.accel) return;
    (accels[r.accel] = accels[r.accel] || []).push(r.path);
  });
  Object.keys(accels).forEach((a) => {
    if (accels[a].length > 1) problems.push(`ACCEL    ${a} is claimed by ${accels[a].length} items: ${accels[a].join('  |  ')}`);
  });

  /* --- accelerators that nothing listens for --- */
  /* Every accel shown in a menu is a promise that the key does something. The
   * key handler in app.js is the only thing that can keep it. */
  const KEY_HANDLED = [
    'Ctrl+N', 'Ctrl+O', 'Ctrl+S', 'Shift+Ctrl+S', 'Ctrl+P', 'Ctrl+Z', 'Shift+Ctrl+Z',
    'Ctrl+R', 'F3', 'F1', 'Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Ctrl+6',
    'Ctrl+7', 'Ctrl+8', 'Ctrl+A', 'Ctrl+Shift+T', 'Ctrl+C', 'Ctrl+D'
  ];
  Object.keys(accels).forEach((a) => {
    if (KEY_HANDLED.indexOf(a) === -1) {
      problems.push(`ACCEL    ${a} (${accels[a][0]}) is displayed but no key handler implements it`);
    }
  });

  /* --- the palette toggle's scope --- */
  if (paletteToggle && paletteToggle.onMatching && paletteToggle.elsewhere) {
    if (paletteToggle.onMatching.disabled) {
      problems.push('PALETTE  "Show Color Palette" is disabled in Matching Colors, where the palette actually lives');
    }
    if (!paletteToggle.elsewhere.disabled) {
      problems.push(`PALETTE  "Show Color Palette" is still enabled in ${paletteToggle.doc}, where the palette is hidden no matter what`);
    }
    if (paletteToggle.onMatching.disabled === false && paletteToggle.elsewhere.disabled === true) {
      notes.push(`palette toggle enabled on matching, disabled on ${paletteToggle.doc} — as intended`);
    }
  } else {
    problems.push('PALETTE  could not read the "Show Color Palette" item in both documents');
  }

  /* --- tab items: preference and tick --- */
  (audit.tabSync || []).forEach((t) => {
    if (t.error) { problems.push(`TAB      ${t.label} — ${t.error}`); return; }
    if (!t.agrees) {
      problems.push(`TAB      "${t.label}" left matchingTab on "${t.got}" instead of "${t.want}" — the view moved but the preference did not`);
    }
    if (!t.tickAgrees) {
      problems.push(`TAB      "${t.label}" is the active tab but the tick is on ${JSON.stringify(t.ticked)}`);
    }
    if (t.agrees && t.tickAgrees) {
      notes.push(`tab ok   ${t.label} — matchingTab=${t.got}, tick on the right row`);
    }
  });

  /* --- checked flag vs the DOM it names --- */
  flagChecks.forEach((f) => {
    if (f.error) { problems.push(`FLAG     ${f.label} — ${f.error}`); return; }
    if (!f.agrees) {
      problems.push(
        `FLAG     "${f.label}" checked=${f.checked} but the panel is ${f.domHidden ? 'HIDDEN' : 'VISIBLE'}` +
        ` (store ${f.store} = ${JSON.stringify(f.storeValue)})`
      );
    } else {
      notes.push(`flag ok  ${f.label} — checked=${f.checked}, hidden=${f.domHidden}, store=${JSON.stringify(f.storeValue)}`);
    }
  });

  /* --- per-menu listing --- */
  process.stdout.write('\n');
  let current = null;
  records.forEach((r) => {
    const top = r.path.split(' > ')[0];
    if (top !== current) {
      current = top;
      process.stdout.write(`\n  ${top}\n`);
    }
    const depth = r.path.split(' > ').length - 2;
    const pad = '    ' + '  '.repeat(Math.max(0, depth));
    if (r.kind === 'separator') { process.stdout.write(`${pad}----\n`); return; }
    const marks = [
      r.kind === 'submenu' ? '[+]' : '   ',
      r.checked ? 'check' : '     ',
      r.disabled ? 'off  ' : '     ',
      r.accel ? r.accel.padEnd(13) : ''.padEnd(13)
    ].join(' ');
    process.stdout.write(`${pad}${marks} ${r.path.split(' > ').slice(-1)[0]}\n`);
  });

  /* --- what each item actually did --- */
  process.stdout.write('\n');
  log('effects');
  results.forEach((r) => {
    const label = r.path.split(' > ').slice(-1)[0];
    if (r.skipped) {
      process.stdout.write(`    ${label.padEnd(30)} disabled — not invoked (see the inertness check)\n`);
      return;
    }
    if (r.error) {
      process.stdout.write(`    ${label.padEnd(30)} THREW  ${String(r.error).split('\n')[0]}\n`);
      return;
    }
    const keys = Object.keys(r.changed);
    if (!keys.length) {
      process.stdout.write(`    ${label.padEnd(30)} (nothing changed)\n`);
      return;
    }
    const desc = keys.map((k) => `${k}: ${JSON.stringify(r.changed[k][0])} -> ${JSON.stringify(r.changed[k][1])}`).join(', ');
    process.stdout.write(`    ${label.padEnd(30)} ${desc}\n`);
  });

  if (disabledCheck && disabledCheck.rows.length) {
    process.stdout.write('\n');
    log('disabled rows');
    disabledCheck.rows.forEach((r) => {
      if (r.error) {
        process.stdout.write(`    ${r.menu.padEnd(8)} ERROR ${r.error}\n`);
        return;
      }
      process.stdout.write(`    ${r.menu.padEnd(8)} ${r.label.padEnd(24)} inert=${r.inert}  menu stayed open=${r.menuStayedOpen}\n`);
    });
  }

  if (notes.length) {
    process.stdout.write('\n');
    notes.forEach((n) => log(n));
  }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      /* An occluded window suspends rAF — see build/smoke.js. */
      backgroundThrottling: false
    }
  });

  win.webContents.on('console-message', (...args) => {
    let level = 0;
    let message = '';
    let source = '';
    let line = 0;
    if (args.length >= 5) {
      [, level, message, line, source] = args;
    } else if (args[1] && typeof args[1] === 'object') {
      level = args[1].level;
      message = args[1].message;
      line = args[1].lineNumber;
      source = args[1].sourceId;
    }
    if (/ResizeObserver loop (completed|limit exceeded)/.test(message)) return;
    if (level === 3 || level === 'error') {
      problems.push(`CONSOLE  ${message}   (${String(source).replace(/^.*\//, '')}:${line})`);
    }
  });
  win.webContents.on('render-process-gone', (_e, d) => problems.push(`RENDERER GONE  ${JSON.stringify(d)}`));
  win.webContents.on('preload-error', (_e, p, err) => problems.push(`PRELOAD ERROR  ${p}  ${err && err.message}`));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => problems.push(`LOAD FAILED  ${code} ${desc} ${url}`));

  await win.loadFile(path.join(ROOT, 'src', 'index.html'));
  await sleep(1800);

  const booted = await win.webContents
    .executeJavaScript('!!(window.CS && CS.App && CS.App.menus)', true)
    .catch(() => false);
  if (!booted) {
    problems.push('BOOT  CS.App.menus is not reachable — the renderer never finished booting');
  }

  let audit = null;
  if (booted) {
    /* Before the audit, which leaves panels toggled off and the theme flipped. */
    if (process.argv.includes('--shots')) await captureMenus(win);
    audit = await win.webContents.executeJavaScript(AUDIT, true).catch((e) => {
      problems.push(`EVAL  the audit script itself threw: ${e.message}`);
      return null;
    });
  }

  if (audit) {
    report(audit);
    fs.writeFileSync(OUT, JSON.stringify({ audit, opened, problems, notes }, null, 2));
  }

  process.stdout.write('\n');
  if (problems.length) {
    process.stdout.write(`  ${problems.length} problem(s):\n`);
    problems.forEach((p) => process.stdout.write(`    ! ${p}\n`));
  } else {
    process.stdout.write('  no problems found.\n');
  }
  if (opened.length) {
    process.stdout.write(`\n  external URLs opened: ${opened.join(', ')}\n`);
  }
  process.stdout.write(`\n  report written to ${OUT}\n`);

  win.destroy();
  app.exit(problems.length ? 1 : 0);
}

app.whenReady().then(() =>
  main().catch((err) => {
    process.stdout.write(`\n  FATAL ${err && err.stack}\n`);
    app.exit(2);
  })
);
