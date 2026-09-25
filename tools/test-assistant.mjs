#!/usr/bin/env node
/**
 * tools/test-assistant.mjs
 * -----------------------------------------------------------------------------
 * Guards the two guarantees that made the help system worth building:
 *
 *   A. EVERY page has a real, complete description (not a stub).
 *   B. The assistant answers usefully for every page and every headline topic,
 *      picks the BEST match rather than the first, and never dead-ends.
 *
 * Runs the real browser scripts in a VM against a minimal DOM, so this test
 * fails if someone edits page-guide.js/assistant.js and breaks them.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const failures = [];

const check = (name, condition, detail = '') => {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ sandbox */
function makeSandbox(pathname = '/pages/admin-data.html') {
  const listeners = {};
  const doc = {
    readyState: 'loading',
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    removeEventListener: () => {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {}, setAttribute() {}, querySelector: () => null }),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    body: { appendChild() {} }
  };
  const win = {};
  win.window = win;
  win.document = doc;
  win.location = { pathname, origin: 'https://example.test' };
  win.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  win.localStorage = { getItem: () => null, setItem: () => {} };
  win.console = console;
  win.setTimeout = () => 0;
  win.matchMedia = () => ({ matches: false });
  win.navigator = { standalone: false };
  return win;
}

async function load(win, relPath) {
  const source = await fs.readFile(path.join(root, relPath), 'utf8');
  vm.createContext(win);
  new vm.Script(source, { filename: relPath }).runInContext(win);
}

/* --------------------------------------------------------------- page files */
const pageFiles = (await fs.readdir(path.join(root, 'pages'))).filter(f => f.endsWith('.html'));
const pageIds = pageFiles.map(f => f.replace(/\.html$/, ''));

/* ------------------------------------------------------------------ A. guides */
const win = makeSandbox();
await load(win, 'assets/js/page-guide.js');

const guides = win.window.PAGE_GUIDE;
check('A1. PAGE_GUIDE is exported', guides && typeof guides === 'object');

const guideIds = Object.keys(guides || {});
const missing = pageIds.filter(id => !guideIds.includes(id));
check('A2. every page has a guide', missing.length === 0, `missing: ${missing.join(', ')}`);

const orphanGuides = guideIds.filter(id => !pageIds.includes(id));
check('A3. no guide points at a page that does not exist', orphanGuides.length === 0, `orphans: ${orphanGuides.join(', ')}`);

// The Help Centre renders the index from PageGuide.groups(), so a guide that is
// authored but not grouped would exist and still never appear in the help index.
const grouped = (win.window.PageGuide.groups() || []).reduce((acc, [, ids]) => acc.concat(ids), []);
const ungrouped = guideIds.filter(id => !grouped.includes(id));
check('A3b. every guide is reachable from the Help Centre index', ungrouped.length === 0, `ungrouped: ${ungrouped.join(', ')}`);
check('A3c. the help index lists nothing twice',
      grouped.length === new Set(grouped).size, `duplicates in groups()`);

// Minimum length per field. An icon is legitimately short ("fa-house"), so it is
// checked by shape rather than length; short label fields need only be non-trivial.
const MIN = { group: 3, roles: 4, who: 8, summary: 40, purpose: 12, does: 40, benefit: 12 };
const REQUIRED = Object.keys(MIN);
const REQUIRED_ARRAYS = ['steps', 'advantages'];
for (const id of guideIds) {
  const g = guides[id];
  if (typeof g.icon !== 'string' || !/^fa[bsr]?(?: fa-|-)[a-z0-9-]+$/.test(g.icon)) {
    failures.push(`A4. ${id}.icon is not a valid Font Awesome class`);
  } else passed++;
  for (const key of REQUIRED) {
    if (typeof g[key] !== 'string' || g[key].trim().length < MIN[key]) {
      failures.push(`A4. ${id}.${key} is missing or too short (needs ${MIN[key]}+ chars)`);
    } else passed++;
  }
  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(g[key]) || g[key].length < 2) failures.push(`A4. ${id}.${key} needs at least two entries`);
    else passed++;
  }
}

// The description shown under the page header must be a sentence, not a label.
for (const id of guideIds) {
  if ((guides[id].summary || '').trim().length < 40) {
    failures.push(`A5. ${id}.summary is too short to describe the page`);
  } else passed++;
}

// "related" must only reference real pages.
for (const id of guideIds) {
  const bad = (guides[id].related || []).filter(r => !guideIds.includes(r));
  check(`A6. ${id}.related targets exist`, bad.length === 0, `unknown: ${bad.join(', ')}`);
}

// rendered HTML must not be empty and must not contain raw undefined
const win2 = makeSandbox();
await load(win2, 'assets/js/page-guide.js');
for (const id of guideIds) {
  const html = win2.window.PageGuide.html(id);
  if (!html || html.length < 400) failures.push(`A7. ${id} renders an empty page guide`);
  else if (/undefined|\[object Object\]/.test(html)) failures.push(`A7. ${id} guide renders a broken value`);
  else passed++;
}

/* --------------------------------------------------------------- B. assistant */
const win3 = makeSandbox();
await load(win3, 'assets/js/page-guide.js');
await load(win3, 'assets/js/assistant.js');
const A = win3.window.Assistant;
const G = win3.window.PageGuide;

check('B1. Assistant is exported', A && typeof A.answer === 'function');

// Every page must be answerable by name.
for (const id of guideIds) {
  const label = id.replace(/-/g, ' ');
  const res = A.answer(`explain ${label}`);
  const ok = res && res.r && res.r.length > 300 && res.r.toLowerCase().includes(label.split(' ')[0].toLowerCase());
  check(`B2. assistant explains "${label}"`, ok, ok ? '' : 'reply missing or too thin');
}

// Headline topics must all resolve to a specific, substantial answer.
const TOPICS = [
  'how do i back up', 'restore', 'disaster recovery', 're-link manifest',
  'google drive', 'heartbeat', 'paused', 'single point of failure',
  'license', 'approve a member', 'roles', 'attendance', 'casting',
  'storage full', 'retention', 'audit trail', 'forgot password',
  'install the app', 'export csv', 'notifications', 'dark mode',
  'where did the backup controls go', 'contact support',
  'register people for a special programme', 'barcode will not scan', 'duty roster swap',
  'download calendar ics', 'follow up absent members'
];
for (const t of TOPICS) {
  const res = A.answer(t);
  check(`B3. topic "${t}" answered`, !!(res && res.r && res.r.length > 200));
}

// Scored matching must beat first-match: "storage" is dominated by
// "storage manager" in the KB, but a query about heartbeats must NOT return it.
const hb = A.answer('how do i stop supabase pausing our project');
check('B4. anti-pause query resolves to Platform Health', /platform-health|Platform Health/i.test(hb.r));
const lic = A.answer('do we have to pay a subscription');
check('B4. licensing query resolves to Site License', /site-license|Site License/i.test(lic.r));
const rl = A.answer('why did attendance lose names after recovery');
check('B4. re-link query resolves to Admin Data', /admin-data|Admin Data/i.test(rl.r));

const pr = A.answer('how do we share a registration link on social media');
check('B4. programme query resolves to Programmes', /Programmes/.test(pr.r) && /src=/.test(pr.r));
const bc = A.answer('my barcode is not scanning');
check('B4. barcode query resolves to ID cards', /Code 128/.test(bc.r));

// "this page" must resolve to the page in the sandbox location.
const thisPage = A.answer('explain this page');
check('B5. "explain this page" uses the current page', /Admin Data/i.test(thisPage.r));

// Unknown input must not dead-end.
const junk = A.answer('zzzz qqqq nonexistent thing');
check('B6. unknown query still returns guidance', !!(junk && junk.r && junk.r.length > 100));
const polite = A.answer('thanks');
check('B6. politeness handled', /welcome/i.test(polite.r));

// Chips must be real questions, and the bot must offer follow-ups.
const withChips = A.answer('how do i back up');
check('B7. answers offer follow-up chips', Array.isArray(withChips.chips) && withChips.chips.length >= 2);

// Full-text fallback should surface the right page for a phrase no KB entry owns.
const cast = A.searchGuides('rehearsal schedule');
check('B8. full-text search finds pages', cast.length > 0 && cast[0].score > 0,
      cast.length ? `top=${cast[0].id}` : 'no hits');
check('B8. full-text search ranks the owner first',
      cast.length > 0 && ['rehearsals', 'productions'].includes(cast[0].id), `top=${cast[0]?.id}`);

/* --------------------------------------------------------------------- report */
console.log(`\nAssistant & page-guide coverage`);
console.log(`  pages discovered: ${pageIds.length}`);
console.log(`  guides authored:  ${guideIds.length}`);
console.log(`  topics verified:  ${TOPICS.length}`);
if (failures.length) {
  console.log(`\nFAIL — ${passed} passed, ${failures.length} failed.`);
  failures.slice(0, 40).forEach(f => console.log('  ✗ ' + f));
  if (failures.length > 40) console.log(`  … and ${failures.length - 40} more.`);
  process.exit(1);
}
console.log(`PASS — ${passed} passed, 0 failed.\n`);
