'use strict';

/**
 * Headless store test — first-run colour + the rename migration.
 *
 *   node build/store-test.js
 *
 * This environment has no usable GUI Electron (the sandbox forces
 * ELECTRON_RUN_AS_NODE, and outside it the GUI binary exits without running the
 * script), so the real smoke/verify suites cannot boot here. What *can* be run
 * is the renderer's own store code, evaluated in a `vm` sandbox with a stub
 * `window` + `localStorage`.
 *
 * Re-evaluating the scripts against the same storage map is exactly a relaunch,
 * which is the only way to observe the first-run / last-colour behaviour.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = ['js/core/util.js', 'js/core/color.js', 'js/core/store.js'].map((p) =>
  path.join(ROOT, 'src', p)
);

const NEW_KEY = 'zaferon-scheme/state/v1';
const OLD_KEY = 'colorschemer-studio/state/v1';
const RECENT_OLD = 'colorschemer-studio/recent/v1';
const SAFFRON = '#F4C430';

const problems = [];

function check(ok, msg) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!ok) problems.push(msg);
}

function makeStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    _map: map
  };
}

/** Boot the renderer core against `storage` and hand back its `CS` namespace. */
function boot(storage) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.console = console;
  sandbox.localStorage = storage;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.clearInterval = clearInterval;
  sandbox.setInterval = setInterval;
  sandbox.document = {
    createElement: () => ({ getContext: () => null, style: {} }),
    documentElement: { setAttribute() {}, style: { setProperty() {} } }
  };
  vm.createContext(sandbox);
  SCRIPTS.forEach((file) => {
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  });
  return sandbox.CS;
}

/** The 250ms persist debounce has to be flushed before a "relaunch". */
function settle(store) {
  return new Promise((r) => setTimeout(() => {
    store.persist();
    setTimeout(r, 60);
  }, 300));
}

async function main() {
  /* ---- 1. genuine first run ---------------------------------------- */
  console.log('\n1. first run (empty storage)');
  let storage = makeStorage();
  let CS = boot(storage);
  check(CS.Store.hexUpper() === SAFFRON, `base colour is saffron — got ${CS.Store.hexUpper()}`);
  /* history/favorites are lowercase #rrggbb strings — see normaliseHexList */
  check(
    JSON.stringify(CS.Store.state.history) === JSON.stringify([SAFFRON.toLowerCase()]),
    `history seeded with saffron — got ${JSON.stringify(CS.Store.state.history)}`
  );
  check(!storage.getItem(OLD_KEY), 'legacy state key not created');

  /* ---- 2. legacy state migrates, minus the colour ------------------- */
  console.log('\n2. legacy state present (simulating an upgrade)');
  storage = makeStorage({
    [OLD_KEY]: JSON.stringify({
      baseHsv: { h: 210, s: 0.8, v: 0.6 },
      favorites: ['#AABBCC', '#DDEEFF'],
      prefs: { previewSize: 'large' },
      history: ['#123456'],
      historyIndex: 0,
      scheme: 'triadic'
    })
  });
  CS = boot(storage);
  check(CS.Store.hexUpper() === SAFFRON, `legacy colour ignored, saffron kept — got ${CS.Store.hexUpper()}`);
  check(
    JSON.stringify(CS.Store.state.favorites) === JSON.stringify(['#aabbcc', '#ddeeff']),
    `favourites migrated + lowercased — got ${JSON.stringify(CS.Store.state.favorites)}`
  );
  check(
    CS.Store.get('prefs.previewSize') === 'large',
    `prefs migrated — got ${JSON.stringify(CS.Store.get('prefs.previewSize'))}`
  );
  check(
    CS.Store.get('prefs.autoCopyHex') === true,
    'unset prefs still come from DEFAULTS (deep merge, not replace)'
  );
  check(
    JSON.stringify(CS.Store.state.history) === JSON.stringify([SAFFRON.toLowerCase()]),
    `history restarts on saffron — got ${JSON.stringify(CS.Store.state.history)}`
  );
  check(CS.Store.state.historyIndex === 0, `historyIndex reset — got ${CS.Store.state.historyIndex}`);
  check(CS.Store.get('scheme') === 'complementary', 'scheme falls back to the default, not the legacy one');

  await settle(CS.Store);
  check(!!storage.getItem(NEW_KEY), 'migrated state written under the new key');
  check(!!storage.getItem(OLD_KEY), 'legacy key left in place (non-destructive)');

  /* ---- 3. the chosen colour survives a relaunch -------------------- */
  console.log('\n3. pick a colour, then relaunch');
  CS.Store.setColor('#2E7D32');
  check(CS.Store.hexUpper() === '#2E7D32', `setColor took effect — got ${CS.Store.hexUpper()}`);
  await settle(CS.Store);

  CS = boot(storage);
  check(CS.Store.hexUpper() === '#2E7D32', `last chosen colour restored — got ${CS.Store.hexUpper()}`);
  check(
    JSON.stringify(CS.Store.state.favorites) === JSON.stringify(['#aabbcc', '#ddeeff']),
    `favourites survive relaunch — got ${JSON.stringify(CS.Store.state.favorites)}`
  );

  /* ---- 4. legacy is read exactly once ------------------------------ */
  console.log('\n4. the legacy key is no longer consulted');
  storage._map.set(
    OLD_KEY,
    JSON.stringify({ baseHsv: { h: 30, s: 1, v: 1 }, favorites: ['#ff0000'] })
  );
  CS = boot(storage);
  check(
    CS.Store.hexUpper() === '#2E7D32',
    `new key wins over a changed legacy key — got ${CS.Store.hexUpper()}`
  );
  check(
    JSON.stringify(CS.Store.state.favorites) === JSON.stringify(['#aabbcc', '#ddeeff']),
    'favourites still come from the new key'
  );

  /* ---- 5. reset goes back to saffron ------------------------------- */
  console.log('\n5. Store.reset()');
  CS.Store.reset();
  check(CS.Store.hexUpper() === SAFFRON, `reset returns to saffron — got ${CS.Store.hexUpper()}`);

  console.log(problems.length ? `\nproblems: ${problems.length}` : '\nproblems: 0');
  problems.forEach((p) => console.log(`  ! ${p}`));
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
  console.log(`\nFATAL ${err && err.stack}`);
  process.exit(1);
});
