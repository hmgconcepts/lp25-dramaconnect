#!/usr/bin/env node
/**
 * Blocked-storage regression suite.
 *
 * Bug this locks down: `localStorage` throws outright when site data is blocked
 * (Safari private browsing, restricted iframe, cookies disabled in Chrome). Two
 * modules touched it while they were still evaluating:
 *
 *   - i18n.js read it in an object-literal initialiser, so a throw aborted the file
 *     before `I18n` existed. i18n.js loads before ui.js/auth.js/db.js/utils.js, so
 *     one blocked browser setting broke every page in the app.
 *   - ui.js ran `UI.applyStoredTheme()` BEFORE `window.UI = UI`, so a throw there
 *     left `window.UI` undefined and took down UI.esc/UI.toast everywhere.
 *
 * Both must now survive a localStorage that throws on every access.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (name, condition, detail = '') => {
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

/** A localStorage stand-in that throws on every access, like a blocked browser. */
const hostileStorage = () => ({
  getItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  setItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  removeItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  clear() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
});

class DOMException extends Error {
  constructor(message, name) { super(message); this.name = name; }
}

async function loadModule(file, globals = {}) {
  const source = await fs.readFile(path.join(root, 'assets', 'js', file), 'utf8');
  const sandbox = {
    window: {}, document: { documentElement: { classList: { add() {}, toggle() {} } },
      dispatchEvent() {}, querySelectorAll: () => [] },
    localStorage: hostileStorage(),
    DOMException, console,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    ...globals,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox, run: () => new vm.Script(source, { filename: file }).runInContext(sandbox) };
}

// --- i18n.js -----------------------------------------------------------------
// i18n.js publishes `window.I18n = I18n` on the LAST line, so if the object literal
// throws while reading localStorage, window.I18n is never assigned at all. That is
// the exact failure this suite exists to prevent.
{
  const { sandbox, run } = await loadModule('i18n.js');
  let threw = null;
  try { run(); } catch (error) { threw = error; }
  check('i18n.js evaluates without throwing when localStorage is blocked', !threw, threw?.message);
  const I18n = sandbox.window.I18n;
  check('window.I18n is published after load', !!I18n);
  check('I18n.lang falls back to "en"', I18n?.lang === 'en', String(I18n?.lang));

  if (I18n) {
    let setThrew = null;
    try { I18n.set('yo'); } catch (error) { setThrew = error; }
    check('I18n.set() survives a blocked setItem', !setThrew, setThrew?.message);
    check('I18n.set() still switches language in memory', I18n.lang === 'yo', I18n.lang);
  } else {
    check('I18n.set() survives a blocked setItem', false, 'window.I18n was never published');
    check('I18n.set() still switches language in memory', false, 'window.I18n was never published');
  }
}

// --- ui.js -------------------------------------------------------------------
{
  const { sandbox, run } = await loadModule('ui.js');
  let threw = null;
  try { run(); } catch (error) { threw = error; }
  check('ui.js evaluates without throwing when localStorage is blocked', !threw, threw?.message);
  check('window.UI is published even if the stored theme cannot be read', !!sandbox.window.UI);
  check('UI.esc still works', sandbox.window.UI?.esc?.('<b>&') === '&lt;b&gt;&amp;', sandbox.window.UI?.esc?.('<b>&'));

  let toggleThrew = null;
  try { sandbox.window.UI.toggleTheme(); } catch (error) { toggleThrew = error; }
  check('UI.toggleTheme() survives a blocked setItem', !toggleThrew, toggleThrew?.message);
}

// --- utils.js (depends on UI) ------------------------------------------------
{
  const { sandbox, run } = await loadModule('utils.js', {
    UI: { esc: (v) => String(v ?? ''), toast: () => {} },
    CONFIG: { CURRENCY: '\u20a6' },
  });
  let threw = null;
  try { run(); } catch (error) { threw = error; }
  check('utils.js evaluates without throwing', !threw, threw?.message);
  check('Utils.formatDate still renders', /\d{4}/.test(sandbox.window.Utils.formatDate('2025-09-17')), sandbox.window.Utils?.formatDate('2025-09-17'));
}

console.log('blocked-storage regression suite');
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(`\nblocked-storage regression suite: ${failures.length} FAILURE(S)`);
  process.exit(1);
}
console.log('  all modules survive blocked localStorage (9 checks)');
console.log('blocked-storage regression suite: PASS');
