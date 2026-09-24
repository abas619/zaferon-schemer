'use strict';

/**
 * Update-infrastructure gate — is the auto-update path actually wired end to end?
 *
 *   npm run update-check      (node build/update-check.js)
 *
 * Auto-update is the one feature in this repo that cannot be tested by running
 * the app: `app.isPackaged` is false in every dev and harness context, so the
 * code path that talks to GitHub Releases never executes, and `npm start` will
 * never show it broken. It also fails *silently* when it is misconfigured — a
 * typo'd channel name, a script tag in the wrong slot, and the feature is dead
 * with no error anywhere.
 *
 * So this reads the wiring instead of running it. Every assertion below is a
 * link that can be broken by an edit somewhere else in the repo:
 *
 *   donate.js → README            (donate-check)      — an address, printed
 *   package.json → preload → renderer → CI (this)     — a pipeline, assembled
 *
 * The three highest-value ones, because each is invisible until it bites:
 *   · `electron-updater` must be a **dependency**, not a devDependency —
 *     electron-builder ships only production deps, so the wrong slot gives a
 *     packaged app that throws on `require('./updater')` at boot.
 *   · `updater.js` must be listed in `build.files`, for the same reason.
 *   · `js/ui/update.js` must load **before** `js/app.js` — the load order in
 *     index.html *is* the dependency graph here, and `boot()` calls CS.Update.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => {
  try {
    return fs.readFileSync(path.join(ROOT, p), 'utf8');
  } catch (err) {
    return null;
  }
};

const problems = [];
const notes = [];
/* WARNs exit 0, like donate-check's: they name a pending human action, not a bug. */
const warns = [];
const check = (ok, msg) => {
  if (!ok) problems.push(msg);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${msg}`);
};
const exists = (p) => fs.existsSync(path.join(ROOT, p));

/* ------------------------------------------------------------------ *
 * 1. The main-process module
 * ------------------------------------------------------------------ */

console.log('\nupdater.js (main process, repo root)');
const UPDATER = 'updater.js';
check(exists(UPDATER), `${UPDATER} exists at the repo root`);
const up = read(UPDATER) || '';

check(/require\(['"]electron-updater['"]\)/.test(up), 'requires electron-updater');
check(/app\.isPackaged/.test(up), 'guards every network path on app.isPackaged');
check(/autoDownload\s*=\s*false/.test(up), 'autoDownload is off — a download is the user\'s decision');
check(/ipcMain/.test(up) === false, 'registers no IPC itself (channels belong to main.js)');
check(!/localStorage|zaferon-scheme\/state/.test(up), 'never touches the state store');

/* The invariant the file's location is there to protect: nothing the app itself
 * wrote under src/js/ is Node code. A require() in the renderer tree would throw
 * at load, and the CSP has no way to allow it.
 *
 * `src/js/vendor/` is exempt: it holds third-party UMD bundles (qrcode-generator),
 * which carry a module.exports branch by design and take the browser path here.
 * That exemption is why this check found something on its first run — and why the
 * rule is about our own files rather than about the word "require". */
console.log('\nrenderer tree stays browser-only');
const before = problems.length;
(function walk(dir) {
  if (!exists(dir) || dir === 'src/js/vendor') return;
  fs.readdirSync(path.join(ROOT, dir)).forEach((name) => {
    const rel = `${dir}/${name}`;
    if (fs.statSync(path.join(ROOT, rel)).isDirectory()) return walk(rel);
    if (!/\.js$/.test(name)) return;
    const src = read(rel) || '';
    if (/^\s*(const|var|let)\s+\{?[^;]*\}\s*=\s*require\(/m.test(src) || /^\s*module\.exports\s*=/m.test(src)) {
      problems.push(`${rel} is CommonJS — src/js/ is renderer code with no Node access`);
    }
  });
})('src/js');
check(problems.length === before, 'no CommonJS found under src/js/');

/* ------------------------------------------------------------------ *
 * 2. package.json
 * ------------------------------------------------------------------ */

console.log('\npackage.json');
const pkg = JSON.parse(read('package.json') || '{}');
const deps = pkg.dependencies || {};
const devDeps = pkg.devDependencies || {};

check(!!deps['electron-updater'], 'electron-updater is a runtime dependency (builder ships only those)');
check(!devDeps['electron-updater'], 'electron-updater is NOT also a devDependency');
check(!!devDeps['electron-builder'], 'electron-builder is a devDependency (never shipped)');

const build = pkg.build || {};
check(build.main === undefined || build.main === 'main.js', 'build.main does not contradict "main"');
check((pkg.main || '') === 'main.js', 'main entry is main.js');
check(
  (build.files || []).some((f) => /(^|[/*])updater\.js$/.test(f)),
  'build.files includes updater.js'
);
check((build.files || []).some((f) => /^src\/\*\*\/\*?$/.test(f)), 'build.files includes src/**');
check(build.appId === 'com.zaferon.schemer', `appId is ${build.appId}`);
check(!!(build.win && build.win.target === 'nsis'), 'win target is nsis');
check(!!(build.nsis && build.nsis.oneClick === false), 'nsis.oneClick is false (user picks the folder)');
check(
  !build.nsis || build.nsis.deleteAppDataOnUninstall !== true,
  'uninstall does not delete app data (the user\'s favourites live there)'
);
check(!!(build.publish && build.publish.provider === 'github'), 'publish provider is github');
check(/^\d+\.\d+\.\d+$/.test(String(pkg.version || '')), `version is valid semver (${pkg.version})`);
check(!!pkg.scripts.dist && /--publish\s+never/.test(pkg.scripts.dist || ''), 'npm run dist never publishes');
check(
  !!pkg.scripts['dist:publish'] && /--publish\s+always/.test(pkg.scripts['dist:publish'] || ''),
  'npm run dist:publish publishes'
);

/* ------------------------------------------------------------------ *
 * 3. The bridge, and the channels it names
 * ------------------------------------------------------------------ */

console.log('\npreload.js ↔ main.js channels');
const preload = read('preload.js') || '';
const main = read('main.js') || '';

const wanted = ['update:check', 'update:download', 'update:install', 'update:status'];
wanted.forEach((ch) => {
  check(main.includes(`ipcMain.handle('${ch}'`), `main.js handles ${ch}`);
  check(preload.includes(`'${ch}'`), `preload.js exposes ${ch}`);
});
check(preload.includes("'update:status'") && /ipcRenderer\.on\('update:status'/.test(preload), 'preload forwards update:status events');
/* contextBridge structured-clones: a function handed *in* is the one thing that
 * cannot cross, so onStatus must register the listener itself. */
check(/removeListener\('update:status'/.test(preload), 'onStatus returns a disposer that removes its own listener');
check(/require\(['"]\.\/updater['"]\)/.test(main), 'main.js requires ./updater');
check(/updater\.init\(/.test(main), 'main.js starts the updater with the main window');

/* ------------------------------------------------------------------ *
 * 4. The renderer module and its slot in the load order
 * ------------------------------------------------------------------ */

console.log('\nrenderer wiring');
check(exists('src/js/ui/update.js'), 'src/js/ui/update.js exists');
const html = read('src/index.html') || '';
const tags = (html.match(/<script src="([^"]+)"/g) || []).map((s) => s.split('"')[1]);
const iUpdate = tags.indexOf('js/ui/update.js');
const iApp = tags.indexOf('js/app.js');
check(iUpdate !== -1, 'index.html loads js/ui/update.js');
check(iUpdate > tags.indexOf('js/ui/widgets.js'), 'it loads after js/ui/widgets.js (it uses CS.Widgets)');
check(iApp !== -1 && iUpdate < iApp, 'it loads before js/app.js (boot() calls CS.Update)');
check(/CS\.Update\.init\(\)/.test(read('src/js/app.js') || ''), 'app.js boot() initialises CS.Update');

const updateJs = read('src/js/ui/update.js') || '';
check(/CS\.Update\s*=/.test(updateJs), 'update.js exports CS.Update');
check(!/fetch\(|XMLHttpRequest/.test(updateJs), 'update.js makes no request of its own');
check(/titlebar/.test(updateJs), 'the banner is inserted below the titlebar, not over the drag region');

/* ------------------------------------------------------------------ *
 * 5. CSS the banner asks for
 * ------------------------------------------------------------------ */

console.log('\nstyles');
const css = read('src/styles/widgets.css') || '';
['update-banner', 'update-status', 'update-progress', 'update-progress-fill', 'update-acts']
  .forEach((c) => check(css.includes('.' + c), `widgets.css defines .${c}`));
check(/--app-region|app-region/.test(read('src/styles/app.css') || ''), 'app.css still owns the drag region');

/* ------------------------------------------------------------------ *
 * 6. CI
 * ------------------------------------------------------------------ */

console.log('\nGitHub Actions');
const WF = '.github/workflows/release.yml';
check(exists(WF), `${WF} exists`);
const wf = read(WF) || '';
check(/push:/.test(wf) && /tags:\s*\n?\s*-\s*['"]?v\*/.test(wf), 'it triggers on v* tags');
check(/contents:\s*write/.test(wf), 'permissions: contents write — GITHUB_TOKEN is read-only by default');
check(/npm\s+ci/.test(wf), 'it installs with npm ci (the lockfile, not a moving tree)');
check(/dist:publish/.test(wf), 'it runs npm run dist:publish');
check(/GH_TOKEN/.test(wf), 'it passes GH_TOKEN to electron-builder');
check(/windows-latest/.test(wf), 'it builds on windows-latest (nsis needs it)');

/* ------------------------------------------------------------------ *
 * 7. One repo name, four places
 * ------------------------------------------------------------------ */

console.log('\nthe repo slug agrees everywhere');
const slug = (o) => `${o.owner}/${o.repo}`;
const pub = build.publish || {};
const projectUrl = (read('src/js/app.js') || '').match(/PROJECT_URL\s*=\s*'([^']+)'/);
const funding = (read('.github/FUNDING.yml') || '').match(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)/);
const expected = slug(pub);
notes.push(`publish  → ${expected}`);
notes.push(`app.js   → ${(projectUrl && projectUrl[1].replace('https://github.com/', '')) || '—'}`);
notes.push(`FUNDING  → ${(funding && funding[1]) || '—'}`);
check(!!projectUrl && projectUrl[1] === `https://github.com/${expected}`, `PROJECT_URL matches build.publish (${expected})`);
check(!!funding && funding[1] === expected, '.github/FUNDING.yml matches build.publish');

/* The one place a *pending* repo rename shows up. `build.publish` is what a
 * packaged app polls; if `origin` is still the old name, tagging from here
 * publishes releases the shipped updater will never find. Warn rather than
 * fail: the rename is a human action on GitHub, and the gate cannot do it.
 * `git` is absent in CI's checkout-less runs, so a missing remote is no news. */
let remote = '';
try {
  remote = require('child_process')
    .execSync('git remote get-url origin', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch (e) { remote = ''; }
const m = remote.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
if (!m) notes.push(`origin   → not found (${remote || 'no origin remote'})`);
else {
  const origin = m[1];
  notes.push(`origin   → ${origin}`);
  if (origin !== expected) {
    warns.push(
      `origin remote is ${origin} but build.publish is ${expected}. A packaged app polls ${expected}, ` +
      'so a tag pushed from here publishes releases the shipped updater can never find. ' +
      'Rename the repository on GitHub (or fix build.publish) before tagging.'
    );
  }
}

/* ------------------------------------------------------------------ */

console.log('\n' + notes.map((n) => '      ' + n).join('\n'));
warns.forEach((w) => console.log(`\n  WARN   ${w}`));
console.log('\n============ UPDATE CHECK ============');
if (problems.length) problems.forEach((p) => console.log('  ' + p));
else console.log(`  no problems found${warns.length ? ` — ${warns.length} warning(s) above` : ''}.`);
console.log(`problems: ${problems.length}`);
console.log('======================================\n');

process.exit(problems.length ? 1 : 0);
