'use strict';

/**
 * Donation release gate — `src/js/data/donate.js` must be production-clean.
 *
 *   npm run donate-check      (node build/donate-check.js)
 *
 * The support dialog and `support-check` both prove the UI faithfully renders
 * whatever is in `CS.Donate`. Neither can answer the shipping question: is
 * what is in there *real*? A demo address renders a beautiful QR. This is the
 * gate that turns "do not publish with demo data" into an exit code.
 *
 *   FATAL (exit 1) — a wallet with no address, a wallet still carrying the
 *                    PLACEHOLDER marker, a wallet flagged `demo: true`, a TRC20
 *                    address that fails base58check, an explorer URL that does
 *                    not contain its own address, or a README.md that is missing
 *                    or does not print every published address verbatim.
 *   WARN  (exit 0) — a link carrying PLACEHOLDER. The rial channel is pending
 *                    by design and `isReady()` already hides it from the UI.
 *
 * The base58check rule is implemented here from scratch (alphabet + double
 * sha256 with node `crypto`) rather than copied from the app, because the app
 * never validates an address — it only prints and encodes one. A gate that
 * reuses the code under test cannot fail for that code.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DONATE = path.join(ROOT, 'src', 'js', 'data', 'donate.js');
const README = path.join(ROOT, 'README.md');
const MARKER = 'PLACEHOLDER';
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/* ---------------- base58check ---------------- */

/** Base58 → bytes. Returns null on a non-alphabet character. */
function b58decode(str) {
  let n = 0n;
  for (const ch of str) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  /* Leading `1`s are leading zero bytes — the alphabet has no digit for 0. */
  for (let i = 0; i < str.length && str[i] === '1'; i++) bytes.unshift(0);
  return Uint8Array.from(bytes);
}

const sha256 = (buf) => Uint8Array.from(crypto.createHash('sha256').update(buf).digest());

/**
 * A TRON address is 25 bytes: version 0x41 + 20-byte payload + 4-byte
 * checksum, where the checksum is the first four bytes of sha256(sha256(payload)).
 */
function base58check(addr) {
  const bytes = b58decode(addr);
  if (!bytes) return { ok: false, reason: 'not valid base58' };
  if (bytes.length !== 25) return { ok: false, reason: `decoded to ${bytes.length} bytes, expected 25` };
  if (bytes[0] !== 0x41) {
    return { ok: false, reason: `version byte 0x${bytes[0].toString(16).padStart(2, '0')}, expected 0x41` };
  }
  const body = bytes.slice(0, 21);
  const sum = sha256(sha256(body));
  for (let i = 0; i < 4; i++) {
    if (sum[i] !== bytes[21 + i]) {
      return { ok: false, reason: 'checksum mismatch' };
    }
  }
  return { ok: true, reason: 'ok' };
}

const isTrc20 = (w) => /trc20|tron/i.test(String(w.id || '') + ' ' + String(w.network || ''));

/* ---------------- load the data ---------------- */

function loadDonate() {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(DONATE, 'utf8'), sandbox, { filename: DONATE });
  if (!sandbox.CS || !sandbox.CS.Donate) throw new Error('donate.js did not define CS.Donate');
  return sandbox.CS.Donate;
}

/* ---------------- report ---------------- */

const fatal = [];
const warn = [];
const rows = [];
let readmeState = 'not checked';

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function padL(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function run() {
  const D = loadDonate();

  (D.wallets || []).forEach((w) => {
    const addr = String(w.address || '');
    const problems = [];
    if (!addr) problems.push('empty address');
    if (addr.indexOf(MARKER) !== -1) problems.push('address is still a PLACEHOLDER');
    if (w.demo) problems.push('entry is flagged demo: true');

    let checksum = 'n/a';
    if (isTrc20(w) && addr && addr.indexOf(MARKER) === -1) {
      const r = base58check(addr);
      checksum = r.ok ? 'OK' : 'BAD — ' + r.reason;
      if (!r.ok) problems.push('base58check: ' + r.reason);
    }

    if (w.explorer) {
      if (String(w.explorer).indexOf(addr) === -1) problems.push('explorer URL does not contain the address');
    }

    const flags = [w.demo ? 'DEMO' : null, addr.indexOf(MARKER) !== -1 ? 'PENDING' : null]
      .filter(Boolean)
      .join(',') || '—';
    rows.push([w.id, w.network, addr.length, checksum, flags, problems]);
    problems.forEach((p) => fatal.push(`wallet "${w.id}": ${p}`));
  });

  /* ---------- README sync ---------- */

  /* The address a stranger copies off GitHub and the address the app shows are
   * two different files. Two copies means one can drift, and a drifted donation
   * address sends money to nobody — so the README is checked against the data,
   * never against anyone's memory of what it says. */
  const published = (D.readyWallets() || []).map((w) => String(w.address));
  let readme = null;
  try {
    readme = fs.readFileSync(README, 'utf8');
  } catch (err) {
    fatal.push('README.md is missing from the repo root — every wallet address must be published there');
  }
  if (readme) {
    published.forEach((addr) => {
      if (readme.indexOf(addr) === -1) {
        fatal.push(`README.md does not carry the address "${addr}" verbatim`);
      }
    });
  }
  readmeState =
    !readme
      ? 'MISSING'
      : published.length
        ? `ok, ${published.length} address(es) matched`
        : 'nothing to publish';

  (D.links || []).forEach((l) => {
    const url = String(l.url || '');
    if (!url) fatal.push(`link "${l.id}": empty url`);
    else if (url.indexOf(MARKER) !== -1) warn.push(`link "${l.id}": still a PLACEHOLDER (hidden from the UI until configured)`);
  });

  console.log('wallets');
  console.log(
    '  ' +
      pad('id', 14) +
      pad('network', 26) +
      padL('len', 4) +
      pad('  checksum', 28) +
      pad('flags', 8) +
      'verdict'
  );
  rows.forEach(([id, network, len, checksum, flags, problems]) => {
    console.log(
      '  ' +
        pad(id, 14) +
        pad(network, 26) +
        padL(len, 4) +
        pad('  ' + checksum, 28) +
        pad(flags, 8) +
        (problems.length ? 'FATAL' : 'ok')
    );
  });

  console.log(`README.md   : ${readmeState}`);

  warn.forEach((m) => console.log(`\n  WARN   ${m}`));
  fatal.forEach((m) => console.log(`\n  FATAL  ${m}`));

  console.log(
    `\n${fatal.length ? 'DO NOT SHIP' : 'donate.js is release-clean'} — ` +
      `${rows.length} wallet(s), fatal: ${fatal.length}, warn: ${warn.length}`
  );
  return fatal.length ? 1 : 0;
}

let code = 1;
try {
  code = run();
} catch (err) {
  console.error('HARNESS CRASH  ' + ((err && err.stack) || err));
}
process.exit(code);
