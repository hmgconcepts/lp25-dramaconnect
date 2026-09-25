#!/usr/bin/env node
/**
 * Optional real-browser smoke test for the ID card, public verification page
 * and attendance scanning desk (Item 18).
 *
 *   npx playwright install --with-deps chromium   # once per machine
 *   npm run smoke:browser
 *
 * It serves the repository from a fake origin, replaces supabase-js with an
 * in-page fake client (fixtures + RPC handlers) and blocks every other network
 * request, so it never touches a real Supabase project. It is kept out of the
 * default `npm test` chain because CI images do not always ship a browser.
 *
 * What it proves in a real rendering engine:
 *  - idcard.html renders the Code 128 barcode (member number) and the QR code
 *    (verification URL), and both DECODE back to the right values from the
 *    rendered pixels (screenshot → dc-codes.js / jsQR decoders).
 *  - verify.html shows VALID / REVOKED states from dc_verify_card.
 *  - attendance.html shows the scanning desk to a unit leader, sends typed /
 *    USB-wedge codes to dc_scan_attendance and updates the checklist row.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://dc.test';
let passed = 0, failed = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { passed += 1; console.log('  ok   ' + label); }
  else { failed += 1; console.log('  FAIL ' + label + (extra ? ' — ' + extra : '')); }
};

const TOKEN = '0123456789abcdef0123456789abcdef';
const MEMBER = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', full_name: 'Musa Member', email: 'm@x.io', role: 'member', status: 'approved', unit: 'Acting', is_unit_leader: false };
const LEADER = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', full_name: 'Lola Leader', email: 'l@x.io', role: 'member', status: 'approved', unit: 'Acting', is_unit_leader: true };

// Runs inside the page before any script. `window.__DC_FAKE` is injected per test.
function fakeSupabase() {
  const cfg = window.__DC_FAKE;
  window.__calls = [];
  function builder(table) {
    const state = { table, filters: [] };
    const result = () => {
      let rows = (cfg.tables[table] || []).slice();
      state.filters.forEach(([col, val]) => { rows = rows.filter((r) => String(r[col]) === String(val)); });
      return rows;
    };
    const api = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve({ data: state.single ? (result()[0] || null) : result(), error: null }).then(res, rej);
        if (prop === 'eq') return (c, v) => { state.filters.push([c, v]); return api; };
        if (prop === 'single' || prop === 'maybeSingle') return () => { state.single = true; return api; };
        if (['insert', 'update', 'upsert', 'delete'].includes(prop)) return (payload) => { window.__calls.push({ table, op: prop, payload }); return api; };
        return () => api;
      }
    });
    return api;
  }
  window.supabase = {
    createClient() {
      return {
        auth: {
          getUser: async () => ({ data: { user: cfg.user ? { id: cfg.user.id, email: cfg.user.email } : null } }),
          getSession: async () => ({ data: { session: cfg.user ? { user: { id: cfg.user.id } } : null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signOut: async () => ({})
        },
        from: builder,
        storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }), upload: async () => ({}) }) },
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel() {},
        rpc: async (name, args) => {
          window.__calls.push({ rpc: name, args });
          const h = cfg.rpc[name];
          if (!h) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function ' + name } };
          // eslint-disable-next-line no-new-func
          return { data: new Function('args', 'return (' + h + ')(args)')(args), error: null };
        }
      };
    }
  };
}

async function openPage(browser, file, fake, viewport = { width: 1200, height: 1600 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN) {
      const file = path.join(root, decodeURIComponent(url.pathname));
      if (!file.startsWith(root)) return route.fulfill({ status: 403, body: '' });
      try {
        const body = await fs.readFile(file);
        const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream';
        return route.fulfill({ status: 200, body, contentType: type });
      } catch { return route.fulfill({ status: 404, body: 'not found' }); }
    }
    // Google Drive emulation, matching production behaviour observed with curl:
    // /thumbnail → 302 to lh3 WITHOUT Access-Control-Allow-Origin. File ids starting
    // with GOOD are shared publicly, PRIV are private (403 everywhere), THRT have the
    // thumbnail endpoint throttled (429) while lh3 still serves the image.
    if (url.host === 'drive.google.com' || url.host === 'lh3.googleusercontent.com') {
      const id = url.searchParams.get('id') || (url.pathname.match(/\/d\/([^=/]+)/) || [])[1] || '';
      if (url.host === 'drive.google.com' && url.pathname === '/thumbnail') {
        if (id.startsWith('GOOD')) return route.fulfill({ status: 302, headers: { location: `https://lh3.googleusercontent.com/d/${id}=w800` }, body: '' });
        return route.fulfill({ status: id.startsWith('THRT') ? 429 : 403, contentType: 'text/html', body: 'denied' });
      }
      if (url.host === 'lh3.googleusercontent.com' && (id.startsWith('GOOD') || id.startsWith('THRT'))) {
        return route.fulfill({ status: 200, contentType: 'image/png', body: await fs.readFile(path.join(root, 'assets/img/rccg_logo.png')) });
      }
      return route.fulfill({ status: 403, contentType: 'text/html', body: 'denied' });
    }
    // SMOKE_CDN=1 lets the real Tailwind/Font Awesome CDNs through so screenshots look like production.
    if (process.env.SMOKE_CDN && /cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com/.test(url.host)) return route.continue();
    if (/supabase-js/.test(url.href)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: `(${fakeSupabase})();` });
    if (/\.css(\?|$)/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  await page.addInitScript((f) => { window.__DC_FAKE = f; }, fake);
  await page.goto(ORIGIN + file, { waitUntil: 'load' });
  return { page, context, errors };
}

const cardJson = (status) => `() => ({ status: '${status}', member_no: 'DC-000123', full_name: 'Musa Member', role: 'Member', unit: 'Acting',
  avatar_url: null, issued_at: '2026-01-10T10:00:00Z', expires_at: '2028-01-10T10:00:00Z', org_name: 'Test Parish', app_name: 'DramaConnect',
  logo_url: null, checked_at: new Date().toISOString(), member_id: '${MEMBER.id}', card_token: '${TOKEN}', reissue_count: 0, verify_count: 2,
  settings: { member_no_prefix: 'DC', validity_months: 24, template: 'classic', signatory_name: 'Pastor', signatory_title: 'Coordinator', contact_line: 'Call 0800', back_note: 'Return if found', show_phone: false } })`;

const browser = await chromium.launch();
try {
  console.log('ID card page (real rendering + decode of the pixels)');
  {
    const { page, context, errors } = await openPage(browser, '/pages/idcard.html', {
      user: MEMBER, tables: { profiles: [MEMBER], tenant_settings: [{ id: 1, org_name: 'Test Parish', app_name: 'DramaConnect' }] },
      rpc: { dc_my_card: cardJson('valid') }
    });
    await page.waitForFunction(() => document.querySelectorAll('svg').length >= 2 && /DC-000123/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText);
    ok(/DC-000123/.test(text) && /Musa Member/.test(text), 'card shows the member number and name', errors.join(' | '));
    const decoded = await page.evaluate(async () => {
      const out = {};
      const svgs = [...document.querySelectorAll('svg')];
      const toImage = async (svg, scale) => {
        const xml = new XMLSerializer().serializeToString(svg);
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
        await img.decode();
        const vb = svg.viewBox.baseVal;
        const c = document.createElement('canvas');
        c.width = Math.round((vb.width || img.width) * scale); c.height = Math.round((vb.height || img.height) * scale);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return ctx.getImageData(0, 0, c.width, c.height);
      };
      await DCCodes.ensureJsQR();
      for (const svg of svgs) {
        const label = svg.getAttribute('aria-label') || '';
        try {
          const image = await toImage(svg, 4);
          const bar = DCCodes.decodeCode128Image(image);
          if (bar) out.barcode = bar;
          const qr = window.jsQR && window.jsQR(image.data, image.width, image.height);
          if (qr && qr.data) out.qr = qr.data;
        } catch (e) { out.err = (out.err || '') + label + ':' + e.message + ';'; }
      }
      return out;
    });
    ok(decoded.barcode === 'DC-000123', 'rendered Code 128 barcode decodes to the member number', JSON.stringify(decoded));
    ok(typeof decoded.qr === 'string' && decoded.qr.includes('/pages/verify.html?c=' + '0123456789abcdef0123456789abcdef'), 'rendered QR decodes to the verification URL', JSON.stringify(decoded));
    ok(errors.length === 0, 'no uncaught page errors on idcard.html', errors.join(' | '));
    if (!process.env.SMOKE_CDN) {
      const w = await page.evaluate(() => document.getElementById('app-sidebar').getBoundingClientRect().width);
      ok(w > 0 && w < 400, 'CDN blocked → offline Tailwind keeps the app shell laid out', String(w));
    }
    await page.locator('#my-card').screenshot({ path: '/tmp/smoke-idcard.png' }).catch(() => page.screenshot({ path: '/tmp/smoke-idcard.png', fullPage: true }));
    await context.close();
  }

  console.log('ID card photo (Google Drive links, fallback chain, no CORS mode)');
  {
    const withPhoto = (avatar, logo = null) => cardJson('valid')
      .replace('avatar_url: null', `avatar_url: '${avatar}'`)
      .replace('logo_url: null', `logo_url: ${logo ? `'${logo}'` : 'null'}`);
    const cases = [
      ['public Drive photo renders on the card', 'https://drive.google.com/thumbnail?id=GOODphoto123456789&sz=w800', 'img', /lh3\.googleusercontent\.com\/d\/GOODphoto/],
      ['legacy /file/d/ link is normalised and renders', 'https://drive.google.com/file/d/GOODlegacy12345678/view?usp=sharing', 'img', /GOODlegacy/],
      ['throttled thumbnail falls back to lh3 and renders', 'https://drive.google.com/thumbnail?id=THRTphoto123456789&sz=w800', 'img', /lh3\.googleusercontent\.com\/d\/THRTphoto/],
      ['private Drive photo degrades to initials (no broken image)', 'https://drive.google.com/thumbnail?id=PRIVphoto123456789&sz=w800', 'div', /^MM$/]
    ];
    for (const [label, avatar, tag, re] of cases) {
      const { page, context, errors } = await openPage(browser, '/pages/idcard.html', {
        user: MEMBER, tables: { profiles: [MEMBER], tenant_settings: [{ id: 1, org_name: 'Test Parish', app_name: 'DramaConnect' }] },
        rpc: { dc_my_card: withPhoto(avatar, 'https://drive.google.com/thumbnail?id=PRIVlogo1234567890&sz=w400') }
      });
      const res = await page.waitForFunction((want) => {
        const el = document.querySelector('#my-card .photo');
        if (!el) return null;
        if (want === 'img' && el.tagName === 'IMG' && el.complete && el.naturalWidth > 0) return { tag: 'img', src: el.currentSrc || el.src, co: el.hasAttribute('crossorigin') };
        if (want === 'div' && el.tagName === 'DIV') return { tag: 'div', text: el.textContent.trim() };
        return null;
      }, tag, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => null);
      ok(!!res && res.tag === tag && re.test(tag === 'img' ? res.src : res.text) && !res.co, label, JSON.stringify(res));
      if (label.startsWith('public')) {
        const logo = await page.waitForFunction(() => {
          const im = document.querySelector('#my-card .band img');
          return im && im.complete && im.naturalWidth > 0 && /rccg_logo\.png/.test(im.src) ? im.src : null;
        }, null, { timeout: 10000 }).then(h => h.jsonValue()).catch(() => null);
        ok(!!logo, 'unviewable tenant logo falls back to the bundled logo', String(logo));
        const nocors = await page.evaluate(() => document.querySelectorAll('img[crossorigin]').length);
        ok(nocors === 0, 'no <img crossorigin> left on the ID card page (root cause of the missing photo)', String(nocors));
        const proof = await page.evaluate(() => new Promise(r => {
          const a = new Image(); a.crossOrigin = 'anonymous';
          a.onload = () => r('loaded'); a.onerror = () => r('blocked');
          a.src = 'https://drive.google.com/thumbnail?id=GOODproof12345678&sz=w800';
        }));
        ok(proof === 'blocked', 'regression proof: the same Drive URL in CORS mode is blocked by the browser', proof);
        const ids = await page.evaluate(() => [
          'https://drive.google.com/file/d/1AbC_dEf-123456789/view?usp=sharing',
          'https://drive.google.com/open?id=1AbC_dEf-123456789',
          'https://drive.google.com/uc?export=view&id=1AbC_dEf-123456789',
          'https://docs.google.com/uc?id=1AbC_dEf-123456789',
          'https://lh3.googleusercontent.com/d/1AbC_dEf-123456789=w800',
          'https://example.com/me.jpg'
        ].map(u => Utils.drivePhotoId(u)));
        ok(ids.slice(0, 5).every(x => x === '1AbC_dEf-123456789') && ids[5] === '', 'Utils.drivePhotoId understands every Drive link shape', JSON.stringify(ids));
        await page.locator('#my-card').screenshot({ path: '/tmp/smoke-idcard-photo.png' }).catch(() => {});
      }
      ok(errors.length === 0, `no page errors (${label})`, errors.join(' | '));
      await context.close();
    }
    // Public verification + attendance scan show the same resilient photo.
    const { page, context, errors } = await openPage(browser, `/pages/verify.html?c=${TOKEN}`, {
      tables: { tenant_settings: [{ id: 1, org_name: 'Test Parish', app_name: 'DramaConnect' }] },
      rpc: { dc_verify_card: withPhoto('https://drive.google.com/thumbnail?id=THRTverify12345678&sz=w800') }
    });
    const vr = await page.waitForFunction(() => {
      const im = document.querySelector('img[alt="Card holder photo"]');
      return im && im.complete && im.naturalWidth > 0 ? im.src : null;
    }, null, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => null);
    ok(!!vr && /lh3/.test(vr), 'verify.html shows the holder photo via the fallback chain', String(vr));
    ok(errors.length === 0, 'no page errors on verify.html (photo)', errors.join(' | '));
    await context.close();
  }

  console.log('Public verification page');
  for (const [status, re] of [['valid', /valid/i], ['revoked', /revoked/i]]) {
    const { page, context, errors } = await openPage(browser, `/pages/verify.html?c=${TOKEN}`, {
      user: null, tables: { tenant_settings: [{ id: 1, org_name: 'Test Parish' }] }, rpc: { dc_verify_card: cardJson(status) }
    }, { width: 420, height: 900 });
    await page.waitForFunction(() => /Musa Member/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText);
    ok(re.test(text) && /Musa Member/.test(text), `verify.html renders the ${status.toUpperCase()} state`, text.slice(0, 200) + errors.join('|'));
    const calls = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_verify_card'));
    ok(calls.length === 1 && calls[0].args.p_token === TOKEN, `verify.html sends only the token (${status})`, JSON.stringify(calls));
    if (!process.env.SMOKE_CDN) {
      const layout = await page.evaluate(() => ({
        offline: !!document.getElementById('tailwind-offline-css'),
        logo: document.getElementById('org-logo').getBoundingClientRect().height
      }));
      ok(layout.offline && layout.logo > 0 && layout.logo <= 80, `CDN blocked → offline Tailwind keeps verify.html laid out (${status})`, JSON.stringify(layout));
    }
    await page.waitForTimeout(900); // let the fade-in finish
    await page.screenshot({ path: `/tmp/smoke-verify-${status}.png`, fullPage: true });
    await context.close();
  }

  console.log('Attendance scanning desk (unit leader)');
  {
    const REH = '11111111-1111-4111-8111-111111111111';
    const { page, context, errors } = await openPage(browser, `/pages/attendance.html?rehearsal=${REH}`, {
      user: LEADER,
      tables: {
        profiles: [LEADER, MEMBER], member_directory: [LEADER, MEMBER],
        rehearsals: [{ id: REH, rehearsal_date: '2026-09-26', notes: 'Dress rehearsal' }],
        rehearsal_schedule: [{ id: REH, rehearsal_date: '2026-09-26', notes: 'Dress rehearsal' }], attendance: [],
        tenant_settings: [{ id: 1, org_name: 'Test Parish' }]
      },
      rpc: {
        dc_scan_attendance: `(a) => a.p_code.toUpperCase() === 'DC-000123'
          ? { result: 'checked_in', member_id: '${MEMBER.id}', full_name: 'Musa Member', member_no: 'DC-000123', unit: 'Acting', status: 'valid' }
          : { result: 'not_found' }`
      }
    });
    await page.waitForTimeout(1500);
    const visible = await page.isVisible('#qr-scan-btn');
    ok(visible, 'unit leader sees the "Scan ID Cards" button', errors.join('|'));
    if (visible) {
      await page.click('#qr-scan-btn');
      ok(await page.isVisible('#qr-reader-container'), 'scanning desk opens');
      await page.fill('#scan-manual', 'dc-000123');
      await page.press('#scan-manual', 'Enter');
      await page.waitForFunction(() => /Checked in/.test(document.getElementById('scan-result').innerText), null, { timeout: 5000 }).catch(() => {});
      const res = await page.innerText('#scan-result');
      ok(/Checked in/.test(res) && /Musa Member/.test(res), 'typed member number → dc_scan_attendance → green result panel', res);
      const badge = await page.evaluate((id) => { const el = document.querySelector(`[data-mid="${id}"]`); return el && (el.value || el.textContent); }, MEMBER.id);
      ok(badge === 'present', 'checklist row updates to present without reload', String(badge));
      // USB wedge: a fast keystroke burst with no field focused.
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await page.keyboard.type('DC-999999', { delay: 5 });
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /No member has this card/.test(document.getElementById('scan-result').innerText), null, { timeout: 5000 }).catch(() => {});
      ok(/No member has this card/.test(await page.innerText('#scan-result')), 'USB keyboard-wedge burst is captured page-wide and resolved');
      const calls = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_scan_attendance').length);
      ok(calls === 2, 'exactly one RPC per scan (duplicate guard)', String(calls));
    }
    ok(errors.length === 0, 'no uncaught page errors on attendance.html', errors.join(' | '));
    await page.locator('#qr-reader-container').screenshot({ path: '/tmp/smoke-attendance.png' }).catch(() => page.screenshot({ path: '/tmp/smoke-attendance.png', fullPage: true }));
    await context.close();
  }

  console.log('Platform Health — anti-pause layer matrix (Item 19)');
  {
    const ADMIN = { ...LEADER, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Ada Admin', role: 'admin' };
    const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    const { page, context, errors } = await openPage(browser, '/pages/platform-health.html', {
      user: ADMIN,
      tables: {
        profiles: [ADMIN], tenant_settings: [{ id: 1, org_name: 'Test Parish' }],
        dc_heartbeat_sources: [
          { source: 'site-visit', last_ping_at: ago(1), ping_count: 40 },
          { source: 'manual-button', last_ping_at: ago(2), ping_count: 3 },
          { source: 'github-actions', last_ping_at: ago(300), ping_count: 1 }
        ],
        dc_backup_settings: [{ id: 1 }], dc_backup_runs: [], dc_platform_settings: [{ id: 1, lockdown_enabled: false, idle_timeout_minutes: 60 }],
        dc_retention_settings: [{ id: 1, login_audit_days: 180 }], dc_login_audit: [], dc_site_license: [{ id: 1, model: 'lifetime', status: 'active' }]
      },
      rpc: {
        dc_platform_health: `() => ({ database: { reachable: true }, schemaVersion: '14.1', checkedAt: new Date().toISOString(), heartbeat: { lastPingAt: new Date().toISOString() }, backup: { status: 'never' }, license: { model: 'lifetime', status: 'active' } })`,
        dc_heartbeat_health: `() => ({ status: 'healthy', pauseAfterHours: 168, daysUntilPause: 6.9, sourcesTotal: 3, sourcesFresh: 2, quorum: true, singlePointOfFailure: false,
          automatedSourcesFresh: 0, automatedQuorum: false, neverReported: ['vercel-cron','pg-cron','edge-ping'], silentSources: ['github-actions'] })`,
        dc_keep_alive: `(a) => ({ ok: true, status: 'written', source: a.p_source })`,
        dc_access_state: `() => ({ allowed: true, is_admin: true })`,
        dc_update_platform_settings: `(a) => ({ id: 1, lockdown_enabled: a.p_lockdown_enabled, idle_timeout_minutes: a.p_idle_timeout_minutes })`
      }
    }, { width: 1280, height: 1400 });
    await page.waitForFunction(() => document.querySelectorAll('#heartbeats tr').length >= 10, null, { timeout: 15000 }).catch(() => {});
    const rows = await page.$$eval('#heartbeats tr', (trs) => trs.map((t) => t.innerText.replace(/\s+/g, ' ')));
    ok(rows.length === 11, 'matrix lists all 11 layers, including never-reported ones', String(rows.length));
    ok(rows.some((r) => /Vercel Cron/.test(r) && /Not set up/.test(r)), 'never-reported layer shows "Not set up" with its fix', rows.join(' || ').slice(0, 300));
    ok(rows.some((r) => /GitHub Actions/.test(r) && /Silent/.test(r)), 'stale scheduler is flagged Silent');
    ok(rows.some((r) => /Site visits/.test(r) && /Reporting/.test(r)), 'fresh layer shows Reporting');
    const banner = await page.innerText('#quorum-banner').catch(() => '');
    ok(/Only human traffic/.test(banner), 'banner warns when only human traffic keeps the project awake', banner.slice(0, 160));
    await page.click('#heartbeat');
    await page.waitForTimeout(300);
    const sent = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_keep_alive').map((c) => c.args.p_source));
    ok(sent.includes('manual-button'), 'Test heartbeat records the manual-button layer (not site-visit)', JSON.stringify(sent));
    const retTxt = await page.innerText('#login_audit_retention_display').catch(() => '');
    ok(/180 days/.test(retTxt), 'retention is shown read-only from the Storage Manager', retTxt);
    await page.fill('#idle_timeout_minutes', '45');
    await page.click('#security-form button[type=submit]');
    await page.waitForTimeout(400);
    const saved = await page.evaluate(() => window.__calls.filter((c) => c.rpc === 'dc_update_platform_settings').map((c) => c.args));
    ok(saved.length === 1 && saved[0].p_login_audit_retention_days === null && saved[0].p_idle_timeout_minutes === 45,
      'Save security state sends null retention (keep) instead of NaN', JSON.stringify(saved));
    ok(errors.length === 0, 'no uncaught page errors on platform-health.html', errors.join(' | '));
    await page.screenshot({ path: '/tmp/smoke-platform-health.png', fullPage: true });
    await context.close();
  }

  // ---------------------------------------------------------------- Item 18 pages
  const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const inDays = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const soon = new Date(Date.now() + 5 * 864e5).toISOString();

  console.log('Public registration page (shareable link → ticket)');
  {
    const TICKET = `() => ({ found: true, result: 'created', status: 'registered', checked_in: false, ticket_code: 'A1B2C3D4', ticket_token: '${TOKEN}', full_name: 'Guest One', party_size: 1,
      title: 'Easter Drama', slug: 'easter', starts_at: '${soon}', ends_at: null, venue: 'Main Hall', feedback_open: false })`;
    const { page, context, errors } = await openPage(browser, '/pages/register.html?p=easter&src=whatsapp', {
      user: null, tables: { tenant_settings: [{ id: 1, org_name: 'Test Parish' }] },
      rpc: {
        dc_public_program: `() => ({ found: true, phase: 'open', slug: 'easter', title: 'Easter Drama', category: 'production', starts_at: '${soon}', venue: 'Main Hall',
          seats_left: 5, allow_waitlist: true, phone_mode: 'required', email_mode: 'optional', max_party_size: 1, custom_questions: [{ id: 'q1', label: 'Dietary needs', type: 'text', required: false }] })`,
        dc_register_for_program: TICKET, dc_program_ticket: TICKET
      }
    }, { width: 420, height: 900 });
    await page.waitForSelector('#reg-form', { timeout: 15000 }).catch(() => {});
    ok(await page.$('#reg-form') !== null, 'registration form renders from the public link without sign-in');
    ok(/5 seat/.test(await page.innerText('#view').catch(() => '')), 'seats-left pill shows');
    await page.click('#reg-submit');
    ok(await page.isVisible('#form-error'), 'empty form is blocked with a visible message');
    await page.fill('[name=full_name]', 'Guest One'); await page.fill('[name=phone]', '08031234567'); await page.fill('[name=q_q1]', 'None');
    await page.check('[name=consent]');
    await page.click('#reg-submit');
    await page.waitForFunction(() => /A1B2C3D4/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
    const call = await page.evaluate(() => window.__calls.find((c) => c.rpc === 'dc_register_for_program'));
    ok(call && call.args.p_payload.source === 'whatsapp' && call.args.p_payload.answers.q1 === 'None' && call.args.p_payload.website === '', 'payload carries channel tag, custom answers and empty honeypot', JSON.stringify(call && call.args));
    ok(/A1B2C3D4/.test(await page.innerText('#view')), 'ticket with code is shown after registering');
    ok(await page.$('#view svg') !== null, 'ticket QR code is rendered');
    ok(await page.evaluate(() => (JSON.parse(localStorage.getItem('dc_my_tickets') || '[]')).length === 1), 'ticket is remembered on the device');
    ok(errors.length === 0, 'no uncaught page errors on register.html', errors.join(' | '));
    await context.close();
  }

  console.log('Calendar — combined month view');
  {
    const { page, context, errors } = await openPage(browser, '/pages/calendar.html', {
      user: MEMBER,
      tables: {
        profiles: [MEMBER], tenant_settings: [{ id: 1 }],
        rehearsal_schedule: [{ id: 'r1', rehearsal_date: todayIso, notes: 'Act 2 blocking' }],
        events: [{ id: 'e1', title: 'Drama Night', event_date: soon, location: 'Hall' }],
        dc_programs: [{ id: 'p1', title: 'Easter Drama', slug: 'easter', starts_at: soon, venue: 'Main Hall', status: 'open' }],
        member_directory: [{ id: MEMBER.id, full_name: 'Musa Member', birth_month: new Date().getMonth() + 1, birth_day: new Date().getDate() }],
        dc_duty_roster: [{ id: 'd1', member_id: MEMBER.id, duty_date: todayIso, service_label: 'Sunday Service', duty_role: 'Ushering', status: 'assigned' }]
      },
      rpc: { dc_access_state: `() => ({ allowed: true })` }
    }, { width: 1280, height: 1200 });
    await page.waitForFunction(() => document.querySelectorAll('#grid > *').length >= 35, null, { timeout: 15000 }).catch(() => {});
    ok((await page.$$('#grid > *')).length === 42, 'month grid has 42 day cells');
    const txt = await page.innerText('body');
    ok(/Rehearsal/.test(txt) && /Ushering/.test(txt) && /Musa Member/.test(txt), 'rehearsal, own duty and birthday appear');
    ok(/Easter Drama/.test(txt), 'open programme appears');
    ok(errors.length === 0, 'no uncaught page errors on calendar.html', errors.join(' | '));
    await context.close();
  }

  console.log('Duty roster — member answers, leader manages');
  {
    const duty = { id: 'd1', member_id: MEMBER.id, duty_date: inDays(3), service_label: 'Sunday Service', duty_role: 'Ushering', status: 'assigned', notes: 'Come early' };
    const { page, context, errors } = await openPage(browser, '/pages/roster.html', {
      user: MEMBER, tables: { profiles: [MEMBER], tenant_settings: [{ id: 1 }], dc_duty_roster: [duty], member_directory: [MEMBER] },
      rpc: { dc_respond_duty: `() => ({ ok: true })`, dc_access_state: `() => ({ allowed: true })` }
    }, { width: 1280, height: 1200 });
    await page.waitForSelector('[data-respond="confirmed"]', { timeout: 15000 }).catch(() => {});
    ok(await page.isHidden('#manage'), 'ordinary member does not see the assign form');
    await page.click('[data-respond="confirmed"]');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => window.__calls.find((c) => c.rpc === 'dc_respond_duty'));
    ok(r && r.args.p_status === 'confirmed' && r.args.p_duty_id === 'd1', 'confirm calls dc_respond_duty', JSON.stringify(r));
    ok(errors.length === 0, 'no uncaught page errors on roster.html (member)', errors.join(' | '));
    await context.close();
  }
  {
    const { page, context, errors } = await openPage(browser, '/pages/roster.html', {
      user: LEADER, tables: { profiles: [LEADER], tenant_settings: [{ id: 1 }], dc_duty_roster: [], member_directory: [LEADER, MEMBER] },
      rpc: { dc_access_state: `() => ({ allowed: true })` }
    }, { width: 1280, height: 1200 });
    await page.waitForSelector('#manage:not(.hidden)', { timeout: 15000 }).catch(() => {});
    ok(await page.isVisible('#manage'), 'leader sees the assign form');
    await page.fill('[name=duty_role]', 'Props');
    await page.selectOption('[name=member_ids]', [MEMBER.id]);
    await page.click('#assign-form button[type=submit]');
    await page.waitForTimeout(300);
    const up = await page.evaluate(() => window.__calls.find((c) => c.table === 'dc_duty_roster' && c.op === 'upsert'));
    ok(up && up.payload[0].member_id === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' && up.payload[0].duty_role === 'Props', 'assign upserts the roster rows', JSON.stringify(up));
    ok(errors.length === 0, 'no uncaught page errors on roster.html (leader)', errors.join(' | '));
    await context.close();
  }

  console.log('Programmes — share kit and insights (administrator)');
  {
    const ADMIN = { ...LEADER, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Ada Admin', role: 'admin' };
    const prog = { id: 'p1', slug: 'easter', title: 'Easter Drama', category: 'production', status: 'open', starts_at: soon, venue: 'Main Hall', capacity: 100, custom_questions: [], phone_mode: 'required', email_mode: 'optional' };
    const { page, context, errors } = await openPage(browser, '/pages/programs.html', {
      user: ADMIN,
      tables: { profiles: [ADMIN], tenant_settings: [{ id: 1 }], dc_programs: [prog],
        dc_program_registrations: [{ id: 'g1', program_id: 'p1', full_name: 'Guest', status: 'registered', party_size: 2, source: 'whatsapp', ticket_code: 'A1B2C3D4', created_at: soon }] },
      rpc: {
        dc_program_insights: `() => ({ program: { capacity: 100 }, totals: { registrations: 1, seats: 2, checked_in: 0, checked_in_people: 0, first_timers: 1 }, by_source: { whatsapp: 1 }, by_how_heard: {}, by_gender: {}, by_age_group: {}, by_day: [{ day: '${todayIso}', count: 1 }], checkin_by_hour: [], rating_distribution: {}, questions: [], generated_at: new Date().toISOString() })`,
        dc_access_state: `() => ({ allowed: true })`
      }
    }, { width: 1280, height: 1400 });
    await page.waitForSelector('[data-act="share"]', { timeout: 15000 }).catch(() => {});
    ok(await page.isVisible('#btn-new'), 'administrator sees New programme');
    await page.click('[data-act="share"]');
    await page.waitForSelector('[data-copy]', { timeout: 5000 }).catch(() => {});
    const links = await page.$$eval('[data-copy]', (b) => b.map((x) => x.dataset.copy));
    ok(links.length >= 3 && links.every((l) => /register\.html\?p=easter/.test(l)) && links.some((l) => /src=whatsapp/.test(l)), 'share kit gives per-channel register links', links.slice(0, 3).join(' '));
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelectorAll('.fixed.inset-0').forEach((o) => o.remove()));
    await page.click('[data-act="open"]').catch(() => {});
    await page.click('.dc-tab[data-tab="insights"]').catch(() => {});
    await page.waitForFunction(() => /Registrations/.test((document.getElementById('ins-body') || {}).innerText || ''), null, { timeout: 8000 }).catch(() => {});
    ok(/turnout/i.test(await page.innerText('#ins-body').catch(() => '')), 'insights render for the chosen programme');
    ok(errors.length === 0, 'no uncaught page errors on programs.html', errors.join(' | '));
    await context.close();
  }

  console.log('Care & follow-up — leaders only');
  {
    const { page, context, errors } = await openPage(browser, '/pages/care.html', {
      user: LEADER,
      tables: {
        profiles: [LEADER], tenant_settings: [{ id: 1 }], member_directory: [LEADER, MEMBER],
        dc_care_cases: [{ id: 'c1', member_id: MEMBER.id, reason: 'illness', summary: 'Hospitalised', status: 'open', priority: 'high', followup_log: [], created_at: soon, updated_at: new Date().toISOString() }]
      },
      rpc: {
        dc_absentee_candidates: `() => ([{ member_id: '${MEMBER.id}', full_name: 'Musa Member', unit: 'Acting', phone: '0803', missed_in_a_row: 4, last_present: null, open_case: false }])`,
        dc_care_add_note: `() => ({})`, dc_access_state: `() => ({ allowed: true })`
      }
    }, { width: 1280, height: 1200 });
    await page.waitForFunction(() => /Hospitalised/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    ok(/Hospitalised/.test(await page.innerText('#cases')), 'case list renders');
    await page.click('[data-tab="absent"]');
    await page.waitForSelector('[data-case]', { timeout: 5000 }).catch(() => {});
    ok(await page.$('[data-case]') !== null, 'missing-members tab lists absentees with Open case');
    ok(await page.$('#absent a[href^="https://wa.me"], #absent a[href*="whatsapp"]') !== null, 'WhatsApp follow-up link offered');
    ok(errors.length === 0, 'no uncaught page errors on care.html', errors.join(' | '));
    await context.close();
  }
  {
    const { page, context } = await openPage(browser, '/pages/care.html', {
      user: MEMBER, tables: { profiles: [MEMBER], tenant_settings: [{ id: 1 }], member_directory: [MEMBER], dc_care_cases: [] }, rpc: { dc_access_state: `() => ({ allowed: true })` }
    });
    await page.waitForURL(/dashboard\.html/, { timeout: 8000 }).catch(() => {});
    ok(/dashboard\.html/.test(page.url()), 'ordinary members are sent away from care.html');
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(`\nbrowser smoke: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
