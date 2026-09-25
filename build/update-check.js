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
check(!!(build.nsis && build.nsis.oneClick === false), 'nsis.oneClick is false (user picks the folder)');
check(
  !build.nsis || build.nsis.deleteAppDataOnUninstall !== true,
  'uninstall does not delete app data (the user\'s favourites live there)'
);
check(!!(build.publish && build.publish.provider === 'github'), 'publish provider is github');
check(/^\d+\.\d+\.\d+$/.test(String(pkg.version || '')), `version is valid semver (${pkg.version})`);

/* ------------------------------------------------------------------ *
 * 2b. Every platform the release promises
 *
 * These are the four files a user can download, so each one is a promise made
 * in `package.json` and kept (or not) by CI. A target listed here that the
 * workflow's runner cannot build is a red X on the release page; a target the
 * workflow builds but the config does not list is an artifact nothing publishes.
 * ------------------------------------------------------------------ */

console.log('\nbuild targets');
/* `target` is a string in the simple case and a list of names or {target, arch}
 * objects in the case where architectures are pinned. Accept all three shapes so
 * a legitimate reformatting of the config is not read as a missing target. */
const targetNames = (t) =>
  (Array.isArray(t) ? t : [t]).map((x) => (typeof x === 'string' ? x : x && x.target)).filter(Boolean);
const has = (list, name) => list.indexOf(name) !== -1;

const winTargets = targetNames(build.win && build.win.target);
check(has(winTargets, 'nsis'), `win installs from an exe (${winTargets.join(', ')})`);
check(has(winTargets, 'portable'), `win ships a portable single exe too (${winTargets.join(', ')})`);
/* electron-builder's defaults put a space between the name and the kind
 * ("Zaferon Schemer Setup 1.0.1.exe"). Both defaults would sit in one release
 * looking nearly identical; distinct, hyphenated names make the download table
 * in the README readable. */
check(/\bSetup\b/.test((build.nsis || {}).artifactName || ''), 'nsis artifactName marks it as the installer');
check(
  /\bPortable\b/.test((build.portable || {}).artifactName || ''),
  'portable artifactName marks it as the portable build'
);

const linuxTargets = targetNames(build.linux && build.linux.target);
check(has(linuxTargets, 'AppImage'), 'linux ships an AppImage (the only linux target that can self-update)');
check(has(linuxTargets, 'deb'), 'linux ships a .deb (Debian/Ubuntu)');
check(has(linuxTargets, 'rpm'), 'linux ships an .rpm (Fedora/openSUSE)');
/* dpkg-deb rejects a control file whose short description is long enough to
 * wrap, and the failure looks like a broken toolchain rather than a copy problem. */
const synopsis = String((build.linux || {}).synopsis || '');
check(synopsis.length > 0 && synopsis.length <= 60, `linux synopsis fits one control line (${synopsis.length} chars)`);
check(/^[A-Z]/.test(String((build.linux || {}).category || '')), `linux category is a freedesktop category (${build.linux && build.linux.category})`);
check(!!(build.linux && build.linux.maintainer), 'linux declares a maintainer (required by deb)');

const macTargets = targetNames(build.mac && build.mac.target);
check(has(macTargets, 'dmg'), 'mac ships a dmg');
check(has(macTargets, 'zip'), 'mac ships a zip (what electron-updater has to unarchive)');
/* The one that would cost the most to discover: without a Developer ID in CI,
 * codesign hangs looking for a keychain identity and the mac job dies after a
 * full Electron download. `identity: null` says "do not sign" up front. */
check(build.mac && build.mac.identity === null, 'mac.identity is null — CI has no Developer ID and must not look for one');

/* ------------------------------------------------------------------ *
 * 2c. The portable build must not lie to the user
 *
 * electron-updater has no notion of a portable exe: `quitAndInstall()` on one
 * runs the embedded NSIS installer, which performs an ordinary per-user install
 * and relaunches *that* — the user gets an installed copy they never asked for
 * and still has the old portable exe. So the updater opts out, and the dialog
 * has to say why instead of offering a button that does the wrong thing.
 * ------------------------------------------------------------------ */

console.log('\nportable build is handled on both sides');
check(/PORTABLE_EXECUTABLE_DIR/.test(up), 'updater.js reads electron-builder\'s PORTABLE_EXECUTABLE_DIR marker');
check(/isPortable\(\)/.test(up), 'updater.js short-circuits its paths on isPortable()');

/* The per-OS shortcuts exist so `npm run dist:mac` on a Mac is a local check, not
 * a release — the release path is CI's, and only it publishes. A `dist*` script
 * without `--publish never` would push a half-finished local build to GitHub. */
console.log('\ndist scripts');
const distScripts = Object.keys(pkg.scripts || {}).filter((k) => k === 'dist' || /^dist:/.test(k));
check(distScripts.length >= 5, `dist scripts cover all the platforms (${distScripts.join(', ')})`);
['dist', 'dist:win', 'dist:linux', 'dist:mac'].forEach((k) =>
  check(/--publish\s+never/.test(pkg.scripts[k] || ''), `npm run ${k} never publishes`)
);
check(
  !!pkg.scripts['dist:publish'] && /--publish\s+always/.test(pkg.scripts['dist:publish'] || ''),
  'npm run dist:publish is the only script that publishes'
);
['dist:win', 'dist:linux', 'dist:mac'].forEach((k) =>
  check(new RegExp('--' + k.split(':')[1] + '\\b').test(pkg.scripts[k] || ''), `npm run ${k} passes --${k.split(':')[1]}`)
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
/* The other half of the portable gate (updater.js above): the renderer must not
 * offer "Download" / "Install & Restart" on a build where they do the wrong thing. */
check(/portable/.test(updateJs), 'update.js answers the portable build with words, not with an installer');

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

/* A target in `package.json` with no runner to build it publishes nothing: the
 * release page shows the files that happened to be built, and the missing one is
 * discovered by a user on that OS. So the matrix and the config are compared, not
 * just each of them alone. */
console.log('\nthe CI matrix covers every declared platform');
[['windows-latest', '--win'], ['ubuntu-latest', '--linux'], ['macos-latest', '--mac']].forEach(([runner, flag]) => {
  check(wf.includes(runner), `matrix runs on ${runner}`);
  check(wf.includes(flag), `matrix builds ${flag}`);
});
check(/needs:\s*gates/.test(wf), 'the builds wait for the gates (a broken address must not reach a release)');
check(/fail-fast:\s*false/.test(wf), 'fail-fast is off — one platform dying must not cancel the other two');
check(/rpmbuild|apt-get install -y rpm/.test(wf), 'the linux job installs rpmbuild (the rpm target shells out to it)');

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

/* ------------------------------------------------------------------ *
 * 7b. The icons the three packagers are pointed at
 *
 * electron-builder reads the PNG and rejects it by size — quietly for Windows
 * (a small icon stretched over the installer), loudly for macOS ("size of icon
 * must be at least 512x512", after the whole build). Reading the IHDR is four
 * bytes of work; discovering the same fact in CI is a wasted release.
 *
 * The second half is the trap this gate was written for: `build/make-assets.js`
 * used to draw a procedural icon into `src/assets/icon.png`, which is a
 * hand-drawn file the app ships and the titlebar shows. Regenerating it was
 * silent and byte-stable, so the wrong icon would have ridden into every build.
 * ------------------------------------------------------------------ */

console.log('\nplatform icons exist and are big enough');
const pngDims = (p) => {
  const abs = path.join(ROOT, p);
  if (!fs.existsSync(abs)) return null;
  const b = fs.readFileSync(abs);
  if (b.length < 24 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
[['win', build.win, 256], ['linux', build.linux, 512], ['mac', build.mac, 512]].forEach(([os, cfg, min]) => {
  const p = cfg && cfg.icon;
  if (!p) {
    problems.push(`build.${os}.icon is unset — electron-builder would look for build/icon.png instead`);
    return;
  }
  const d = pngDims(p);
  check(!!d, `build.${os}.icon (${p}) is a readable PNG`);
  if (d) check(d.w >= min && d.h >= min, `build.${os}.icon is at least ${min}x${min} (${d.w}x${d.h})`);
});
const assetsJs = read('build/make-assets.js') || '';
check(!/['"]icon(@2x)?\.png['"]/.test(assetsJs), 'make-assets.js never writes the hand-drawn app icons');

/* ------------------------------------------------------------------ *
 * 8. The download table lists what the config builds
 *
 * A release page with seven files and a README that says "grab a build from
 * Releases" is a support queue: the Linux user downloads the .AppImage into a
 * `~/Downloads` they cannot execute, or the Windows user takes the portable exe
 * and then asks why it never updated. Each row here is generated from the target
 * list in package.json, so adding a target without documenting it fails the gate.
 * ------------------------------------------------------------------ */

console.log('\nREADME names every artifact the config builds');
const readme = read('README.md') || '';
/* Only the table rows count. Searching the whole file let the AppImage assertion
 * pass on a sentence three sections further down, so deleting the row itself —
 * the exact edit this gate exists to catch — went unnoticed. */
const downloadTable = readme
  .split('\n')
  .filter((line) => /^\|/.test(line) && !/^\|[-\s|]+$/.test(line))
  .join('\n');
const documented = {
  nsis: /Setup.{0,20}\.exe/,
  portable: /[Pp]ortable.{0,20}\.exe/,
  AppImage: /\.AppImage/,
  deb: /\.deb\b/,
  rpm: /\.rpm\b/,
  dmg: /\.dmg\b/,
  zip: /\.zip\b/,
};
[...winTargets, ...linuxTargets, ...macTargets].forEach((t) => {
  const re = documented[t];
  if (!re) {
    problems.push(`target ${t} has no entry in the documented map — add its README pattern`);
    return;
  }
  check(re.test(downloadTable), `README documents the ${t} artifact`);
});
check(/Open Anyway|right-click/.test(readme), 'README explains how to get past Gatekeeper');
/* The claim in the table that is not obvious from the app: which builds can
 * actually replace themselves. If this sentence ever contradicts updater.js, the
 * portable gate above is the one that is right. */
check(/[Pp]ortable/.test(readme) && /cannot update itself/.test(readme), 'README states that the portable build does not self-update');
check(/only Linux build that updates itself|AppImage.{0,60}updates itself/i.test(readme), 'README says which Linux build self-updates');

/* ------------------------------------------------------------------ */

console.log('\n' + notes.map((n) => '      ' + n).join('\n'));
warns.forEach((w) => console.log(`\n  WARN   ${w}`));
warns.forEach((w) => console.log(`\n  WARN   ${w}`));
console.log('\n============ UPDATE CHECK ============');
if (problems.length) problems.forEach((p) => console.log('  ' + p));
else console.log(`  no problems found${warns.length ? ` — ${warns.length} warning(s) above` : ''}.`);
console.log(`problems: ${problems.length}`);
console.log('======================================\n');

process.exit(problems.length ? 1 : 0);
