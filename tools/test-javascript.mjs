#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { transform } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const warnings = [];
const fail = (message) => failures.push(message);

async function walk(dir, extension) {
  const out = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(item.name)) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...await walk(full, extension));
    else if (!extension || full.endsWith(extension)) out.push(full);
  }
  return out;
}

const jsFiles = await walk(path.join(root, 'assets', 'js'), '.js');
for (const file of jsFiles) {
  const source = await fs.readFile(file, 'utf8');
  const rel = path.relative(root, file);
  try { new vm.Script(source, { filename: rel }); }
  catch (error) { fail(`${rel}: JavaScript parser: ${error.message}`); }
  try { await transform(source, { loader: 'js', target: 'es2020', sourcefile: rel }); }
  catch (error) { fail(`${rel}: esbuild: ${error.message}`); }
}

const htmlFiles = await walk(root, '.html');
let platformPageCount = 0;
let inlineCount = 0;
for (const file of htmlFiles) {
  const source = await fs.readFile(file, 'utf8');
  const rel = path.relative(root, file);
  const dom = new JSDOM(source);
  const doc = dom.window.document;
  if (!doc.querySelector('meta[charset]')) fail(`${rel}: missing charset metadata`);
  if (!doc.title?.trim()) fail(`${rel}: missing document title`);

  const ids = [...doc.querySelectorAll('[id]')].map((node) => node.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) fail(`${rel}: duplicate id(s): ${duplicates.join(', ')}`);

  const scripts = [...doc.querySelectorAll('script')];
  const sources = scripts.map((node) => node.getAttribute('src')).filter(Boolean);
  const pmIndex = sources.findIndex((src) => /platform-management\.js(?:\?|$)/.test(src));
  if (pmIndex >= 0) {
    platformPageCount += 1;
    if (pmIndex === 0 || !/resilience\.js(?:\?|$)/.test(sources[pmIndex - 1])) {
      fail(`${rel}: platform-management.js must immediately follow resilience.js`);
    }
  }

  for (const [index, node] of scripts.entries()) {
    if (node.src || !node.textContent.trim() || /^(application\/json|importmap)$/i.test(node.type)) continue;
    inlineCount += 1;
    try { new vm.Script(node.textContent, { filename: `${rel}#inline-${index + 1}` }); }
    catch (error) { fail(`${rel} inline script ${index + 1}: ${error.message}`); }
  }
  dom.window.close();
}

const requiredPages = ['settings.html','admin-data.html','storage-manager.html','platform-health.html','roles-status.html','site-license.html'];
for (const page of requiredPages) {
  const file = path.join(root, 'pages', page);
  try { await fs.access(file); }
  catch { fail(`pages/${page}: required control-plane surface missing`); }
}

const license = await fs.readFile(path.join(root, 'pages', 'site-license.html'), 'utf8');
if (!/checkSession\(\{\s*allowRestricted:\s*true\s*\}\)/.test(license)) {
  fail('pages/site-license.html: restricted-session access is not enabled');
}
const layout = await fs.readFile(path.join(root, 'assets', 'js', 'layout.js'), 'utf8');
for (const page of requiredPages) {
  if (!layout.includes(page)) fail(`assets/js/layout.js: missing navigation link for ${page}`);
}
const sw = await fs.readFile(path.join(root, 'sw.js'), 'utf8');
for (const required of ['assets/js/platform-management.js', ...requiredPages.map((p) => `pages/${p}`)]) {
  if (!sw.includes(required)) fail(`sw.js: missing control-plane precache entry ${required}`);
}
if (!/dramaconnect-v14\.0/.test(sw)) fail('sw.js: release cache is not v14.0');

const portability = await fs.readFile(path.join(root, 'assets', 'js', 'data-portability.js'), 'utf8');
if (!/SCHEMA_VERSION\s*=\s*['"]14\.0['"]/.test(portability)) fail('data-portability.js: schema version is not 14.0');
const tableMatch = portability.match(/const TABLES\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/);
if (!tableMatch) fail('data-portability.js: TABLES declaration not found');
else {
  const tableCount = [...tableMatch[1].matchAll(/name:\s*['"][a-z0-9_]+['"]/gi)].length;
  if (tableCount !== 25) fail(`data-portability.js: expected 25 archive tables; found ${tableCount}`);
}

if (platformPageCount < 33) fail(`expected platform management on at least 33 HTML files; found ${platformPageCount}`);
if (failures.length) {
  console.error(`Validation failed (${failures.length} issue(s)):`);
  failures.forEach((item) => console.error(` - ${item}`));
  process.exitCode = 1;
} else {
  console.log(`JavaScript/HTML validation: PASS`);
  console.log(`Checked ${jsFiles.length} browser scripts with VM + esbuild, ${htmlFiles.length} HTML files, and ${inlineCount} inline scripts.`);
  console.log(`Verified platform-management ordering on ${platformPageCount} pages and all six administration surfaces.`);
}
if (warnings.length) warnings.forEach((item) => console.warn(`warning: ${item}`));
