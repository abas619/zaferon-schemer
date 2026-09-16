'use strict';

/**
 * CSS coverage check.
 *
 *   node build/css-coverage.js
 *
 * A rewritten stylesheet silently drops rules that no JS references *by name*,
 * and the damage only shows up much later as a layout bug. The conversion rows
 * lost `.conv-row`/`.conv-tag`/`.conv-value`/`.conv-copy` exactly that way: the
 * colour overrides survived, the layout did not, and the table quietly fell back
 * to inline flow — tags of unequal width pushed each field to a different x and
 * the values ran off the panel.
 *
 * This walks every class name the renderer asks for and reports the ones no
 * stylesheet defines. A class listed here is either a typo or a dropped rule.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/* Classes that need no rule of their own. Everything here is deliberate —
 * add to it only with a reason, or the check stops meaning anything. */
const ALLOWED = new Map([
  /* Read back by JS, or toggled purely as a state flag. */
  ['is-dragging', 'drag state, read by JS'],
  ['is-hidden', 'visibility flag'],
  ['is-open', 'visibility flag'],
  ['is-collapsed', 'visibility flag'],
  ['is-active', 'selection flag, styled via the base class'],
  ['is-done', 'transient flag'],
  ['is-off', 'transient flag'],
  ['is-current', 'selection flag'],
  ['is-light', 'ink-colour flag on .conv-cvd — styled as `.conv-cvd.is-light span`'],
  ['is-selected', 'selection flag'],
  ['is-busy', 'transient flag'],
  ['is-narrow', 'layout flag'],
  ['hidden', 'visibility flag'],
  ['show', 'picker.html toast flag — styled in picker.html, not in src/styles'],
  ['has-label', 'chip flag; the label carries its own rule (.chip-label)'],

  /* Modifiers: the base class carries every property. */
  ['menu-sub', 'modifier on .menu-popup'],
  ['panel-btn-menu', 'modifier on .panel-btn'],
  ['bc-view-convert', 'plain .bc-view; no tab-specific override needed'],

  /* Pure wrappers whose children each carry their own layout. */
  ['about', 'dialog content wrapper (.about-* children are styled)'],
  ['ca', 'dialog content wrapper (.ca-* children are styled)'],
  ['qp', 'dialog content wrapper (.qp-* children are styled)'],
  ['help-body', 'dialog content wrapper (.help-* children are styled)'],
  ['builder-work', 'wrapper; .builder-work-strip/-item are styled'],
  ['builder-suggestions', 'wrapper; .builder-sug-* are styled']
]);

function walk(dir, ext, out = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  });
  return out;
}

/* `el('div.foo.bar')` is the only way this codebase creates elements. Also
 * picks up classList calls and querySelector('.x'). */
function classesInJs(text) {
  const found = new Set();
  let m;

  const elRe = /\bel\(\s*(['"`])([^'"`]+)\1/g;
  while ((m = elRe.exec(text))) {
    const tagMatch = m[2].match(/^([a-zA-Z0-9-]*)((?:[.#][^.#]+)*)$/);
    if (!tagMatch) continue;
    (tagMatch[2] || '').split(/(?=[.#])/).forEach((part) => {
      if (part[0] === '.') found.add(part.slice(1));
    });
  }

  const classListRe = /classList\.(?:add|remove|toggle|contains)\(\s*(['"])([^'"]+)\1/g;
  while ((m = classListRe.exec(text))) found.add(m[2]);

  const qsRe = /querySelector(?:All)?\(\s*(['"])([^'"]+)\1/g;
  while ((m = qsRe.exec(text))) {
    (m[2].match(/\.[a-zA-Z0-9_-]+/g) || []).forEach((c) => found.add(c.slice(1)));
  }

  return found;
}

function classNames(text) {
  const found = new Set();
  const re = /\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g;
  let m;
  while ((m = re.exec(text))) found.add(m[1]);
  return found;
}

const jsClasses = new Set();
walk(SRC, '.js').forEach((file) => {
  if (file.includes(path.sep + 'styles')) return;
  classesInJs(fs.readFileSync(file, 'utf8')).forEach((c) => jsClasses.add(c));
});

/* HTML counts too — picker.html carries its own <style> block. */
const cssClasses = new Set();
walk(SRC, '.css').concat(walk(SRC, '.html')).forEach((file) => {
  classNames(fs.readFileSync(file, 'utf8')).forEach((c) => cssClasses.add(c));
});

const missing = [...jsClasses].filter((c) => !cssClasses.has(c)).sort();
const real = missing.filter((c) => !ALLOWED.has(c));
const waived = missing.filter((c) => ALLOWED.has(c));

console.log(`classes referenced in JS : ${jsClasses.size}`);
console.log(`classes defined in CSS   : ${cssClasses.size}`);
console.log('');

if (real.length) {
  console.log(`UNSTYLED (${real.length}) — typo, or a rule a rewrite dropped:`);
  real.forEach((c) => console.log(`  .${c}`));
} else {
  console.log('UNSTYLED (0) — every class the renderer asks for has a rule.');
}

console.log('');
console.log(`waived (${waived.length}): ${waived.join(', ') || '(none)'}`);

process.exit(real.length ? 1 : 0);
